/**
 * OpenVault Graph Module
 *
 * Flat-JSON graph CRUD for entity and relationship storage.
 * All data stored in chatMetadata.openvault.graph as { nodes, edges }.
 */

import { CONSOLIDATION, extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { getDocumentEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { parseConsolidationResponse } from '../extraction/structured.js';
import { callLLM, LLM_CONFIGS } from '../llm.js';
import {
    buildEdgeConsolidationPrompt,
    resolveExtractionPreamble,
    resolveExtractionPrefill,
    resolveOutputLanguage,
} from '../prompts/index.js';
import { cosineSimilarity } from '../retrieval/math.js';
import { getEmbedding, hasEmbedding, setEmbedding, isStSynced, markStSynced, cyrb53 } from '../utils/embedding-codec.js';
import { isStVectorSource, syncItemsToST, deleteItemsFromST, getCurrentChatId } from '../utils/data.js';
import { logDebug, logError } from '../utils/logging.js';
import { createLadderQueue } from '../utils/queue.js';
import { yieldToMain } from '../utils/st-helpers.js';
import { stemWord } from '../utils/stemmer.js';
import { ALL_STOPWORDS } from '../utils/stopwords.js';
import { jaccardSimilarity } from '../utils/text.js';
import { countTokens } from '../utils/tokens.js';
import { levenshteinDistance, transliterateCyrToLat } from '../utils/transliterate.js';

/**
 * Compute dynamic Levenshtein distance threshold for cross-script matching.
 * Short names (≤4 chars) are more prone to false positives, so use stricter threshold.
 * @param {number} lenA - Length of first string
 * @param {number} lenB - Length of second string
 * @returns {number} Maximum allowed Levenshtein distance
 */
function getCrossScriptMaxDistance(lenA, lenB) {
    const minLen = Math.min(lenA, lenB);
    return minLen <= 4 ? 1 : 2;
}

/**
 * Resolve a raw entity name to its final graph key, accounting for merge redirects.
 * @param {Object} graphData - The graph object
 * @param {string} rawName - The raw entity name
 * @returns {string} The resolved key (may differ due to semantic merge)
 */
function _resolveKey(graphData, rawName) {
    const key = normalizeKey(rawName);
    return graphData._mergeRedirects?.[key] || key;
}

/**
 * Normalize an entity name to a consistent key.
 * - Lowercases the name
 * - Strips possessives (e.g., "Vova's" -> "Vova")
 * - Collapses whitespace
 * @param {string} name
 * @returns {string}
 */
export function normalizeKey(name) {
    return name
        .toLowerCase()
        .replace(/[''\u2019]s\b/g, '') // Strip possessives: 's, 's, 's
        .replace(/\s+/g, ' ') // Collapse whitespace
        .trim();
}

/**
 * Expand main character keys with aliases discovered in the graph.
 * Prevents alter-ego nodes from forming false secondary communities.
 * @param {string[]} baseKeys - Normalized main character keys
 * @param {Object} graphNodes - Graph nodes keyed by normalized name
 * @returns {string[]} Expanded array including alias keys
 */
export function expandMainCharacterKeys(baseKeys, graphNodes) {
    const expanded = [...baseKeys];
    for (const baseKey of baseKeys) {
        const node = graphNodes[baseKey];
        if (node?.aliases) {
            for (const alias of node.aliases) {
                const aliasKey = normalizeKey(alias);
                if (!expanded.includes(aliasKey)) {
                    expanded.push(aliasKey);
                }
            }
        }
    }
    return expanded;
}

/**
 * Find graph node keys that are Cyrillic transliterations of known main character names.
 * Used to expand mainCharacterKeys for community detection hairball prevention.
 *
 * Scans all PERSON-type nodes with Cyrillic names, transliterates them to Latin,
 * and checks Levenshtein distance against each base key. Distance ≤ 2 is a match
 * (handles minor transliteration variants like Сузи→Suzi vs Suzy).
 *
 * @param {string[]} baseKeys - Normalized English main character keys
 * @param {Object} graphNodes - Graph nodes keyed by normalized name
 * @returns {string[]} Cyrillic node keys matching main characters
 */
export function findCrossScriptCharacterKeys(baseKeys, graphNodes) {
    const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
    const crossScriptKeys = [];

    for (const [nodeKey, node] of Object.entries(graphNodes)) {
        if (node.type !== 'PERSON') continue;
        if (baseKeys.includes(nodeKey)) continue;
        if (!CYRILLIC_RE.test(nodeKey)) continue;

        const transliterated = transliterateCyrToLat(nodeKey);
        for (const baseKey of baseKeys) {
            if (levenshteinDistance(transliterated, baseKey) <= getCrossScriptMaxDistance(transliterated.length, baseKey.length)) {
                crossScriptKeys.push(nodeKey);
                break;
            }
        }
    }

    return crossScriptKeys;
}

/**
 * Upsert an entity node into the flat graph structure.
 * Merges descriptions and increments mentions on duplicates.
 * Descriptions are capped at a configurable number of segments.
 * @param {Object} graphData - The graph object { nodes, edges } (mutated in place)
 * @param {string} name - Entity name (original casing preserved on first insert)
 * @param {string} type - PERSON | PLACE | ORGANIZATION | OBJECT | CONCEPT
 * @param {string} description - Entity description
 * @param {number} cap - Maximum number of description segments to retain (default: 3)
 */
export function upsertEntity(graphData, name, type, description, cap = 3) {
    const key = normalizeKey(name);
    const existing = graphData.nodes[key];

    if (existing) {
        if (!existing.description.includes(description)) {
            existing.description = existing.description + ' | ' + description;
        }
        existing.mentions += 1;

        // Cap description segments
        const segments = existing.description.split(' | ');
        if (segments.length > cap) {
            // Remove oldest segments (from the beginning)
            const cappedSegments = segments.slice(-cap);
            existing.description = cappedSegments.join(' | ');
        }
    } else {
        graphData.nodes[key] = {
            name: name.trim(),
            type,
            description,
            mentions: 1,
        };
    }
}

/**
 * Upsert a relationship edge. Increments weight on duplicates.
 * On duplicate edges: increments weight AND appends description if different.
 * Silently skips if source or target node doesn't exist.
 * @param {Object} graphData - The graph object { nodes, edges } (mutated in place)
 * @param {string} source - Source entity name (will be normalized)
 * @param {string} target - Target entity name (will be normalized)
 * @param {string} description - Relationship description
 * @param {number} cap - Maximum number of description segments to retain (default: 5)
 * @param {Object} settings - Optional settings for consolidation behavior
 */
export function upsertRelationship(graphData, source, target, description, cap = 5, settings = null) {
    const srcKey = _resolveKey(graphData, source);
    const tgtKey = _resolveKey(graphData, target);

    // Prevent self-loops
    if (srcKey === tgtKey) {
        logDebug(`[graph] Edge skipped: ${source} -> ${target} — self-loops not allowed`);
        return;
    }

    if (!graphData.nodes[srcKey] || !graphData.nodes[tgtKey]) {
        logDebug(`[graph] Edge skipped: ${source} (${srcKey}) -> ${target} (${tgtKey}) — missing node`);
        return;
    }

    const edgeKey = `${srcKey}__${tgtKey}`;
    const existing = graphData.edges[edgeKey];

    if (existing) {
        existing.weight += 1;

        // Jaccard guard: only append if description is sufficiently different (>60% new content)
        const JACCARD_DUPLICATE_THRESHOLD = 0.6;
        const jaccard = jaccardSimilarity(existing.description, description);
        if (jaccard < JACCARD_DUPLICATE_THRESHOLD && !existing.description.includes(description)) {
            existing.description = existing.description + ' | ' + description;
        }
        // If jaccard >= threshold, this is a near-duplicate; drop the new description
        // but still increment weight (already done above)

        // Cap description segments (FIFO eviction)
        const segments = existing.description.split(' | ');
        if (cap > 0 && segments.length > cap) {
            existing.description = segments.slice(-cap).join(' | ');
        }

        // Track token count after update
        existing._descriptionTokens = countTokens(existing.description);

        // Mark for consolidation if over threshold
        const threshold = settings?.consolidationTokenThreshold ?? CONSOLIDATION.TOKEN_THRESHOLD;
        if (existing._descriptionTokens > threshold) {
            markEdgeForConsolidation(graphData, edgeKey);
        }
    } else {
        const newEdge = {
            source: srcKey,
            target: tgtKey,
            description,
            weight: 1,
            _descriptionTokens: countTokens(description),
        };
        graphData.edges[edgeKey] = newEdge;

        // Mark for consolidation if over threshold
        const threshold = settings?.consolidationTokenThreshold ?? CONSOLIDATION.TOKEN_THRESHOLD;
        if (newEdge._descriptionTokens > threshold) {
            markEdgeForConsolidation(graphData, edgeKey);
        }
    }
}

/**
 * Mark an edge for consolidation during next community detection.
 * @param {Object} graphData - The graph object
 * @param {string} edgeKey - The edge key to mark
 */
export function markEdgeForConsolidation(graphData, edgeKey) {
    if (!graphData._edgesNeedingConsolidation) {
        graphData._edgesNeedingConsolidation = [];
    }
    if (!graphData._edgesNeedingConsolidation.includes(edgeKey)) {
        graphData._edgesNeedingConsolidation.push(edgeKey);
    }
}

/**
 * Create an empty flat graph structure.
 * @returns {{ nodes: Object, edges: Object }}
 */
export function createEmptyGraph() {
    return { nodes: {}, edges: {} };
}

/**
 * Initialize graph-related state fields on the openvault data object.
 * Does not overwrite existing fields.
 * @param {Object} data - The openvault data object (mutated in place)
 */
export function initGraphState(data) {
    if (!data.graph) data.graph = createEmptyGraph();
    if (!data.communities) data.communities = {};
    if (!data.reflection_state) data.reflection_state = {};
    if (data.graph_message_count == null) data.graph_message_count = 0;
}

/**
 * Merge-or-insert an entity with semantic deduplication.
 * Fast path: exact normalizeKey match → upsert.
 * Slow path: embed name, compare against same-type nodes, merge if similar.
 * Fallback: if embeddings unavailable, insert as new node.
 *
 * @param {Object} graphData - The graph object { nodes, edges }
 * @param {string} name - Entity name
 * @param {string} type - Entity type
 * @param {string} description - Entity description
 * @param {number} cap - Description segment cap
 * @param {Object} settings - Extension settings
 * @param {string[]} [mainCharacterNames=[]] - Known main character names for cross-script merge
 * @returns {Promise<string>} The key of the node (existing or new)
 */

/**
 * Check if two token sets have sufficient overlap to consider merging.
 * Requires at least the specified ratio (default 0.5) of tokens to overlap.
 * Substring containment is treated as a separate positive signal.
 *
 * @param {Set<string>} tokensA - First set of tokens
 * @param {Set<string>} tokensB - Second set of tokens
 * @param {number} minOverlapRatio - Minimum overlap ratio (default: 0.5)
 * @param {string} [keyA] - Original key A for substring check
 * @param {string} [keyB] - Original key B for substring check
 * @returns {boolean}
 */
export function hasSufficientTokenOverlap(tokensA, tokensB, minOverlapRatio = 0.5, keyA = '', keyB = '') {
    // 1. NEW: Stem equality — immediate merge for morphological variants
    if (keyA && keyB) {
        const stemA = stemWord(keyA);
        const stemB = stemWord(keyB);
        if (stemA && stemB && stemA === stemB) return true;
    }

    // Helper: find longest common substring
    function longestCommonSubstring(a, b) {
        const longest = [0, 0];
        for (let i = 0; i < a.length; i++) {
            for (let j = 0; j < b.length; j++) {
                let k = 0;
                while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) {
                    k++;
                }
                if (k > longest[0]) longest[0] = k;
            }
        }
        return longest[0];
    }

    // 2. Direct substring containment
    if (keyA && keyB && (keyA.includes(keyB) || keyB.includes(keyA))) {
        return true;
    }

    // 3. LCS check — RAISED threshold to prevent suffix collisions
    if (keyA && keyB && keyA.length > 2 && keyB.length > 2) {
        const commonLen = longestCommonSubstring(keyA, keyB);
        const minLen = Math.min(keyA.length, keyB.length);
        const shortKeys = keyA.length <= 4 && keyB.length <= 4;
        const minAbsLen = shortKeys ? 2 : 4;
        const minRatio = shortKeys ? 0.6 : 0.85; // Changed from 0.7 to 0.85

        if (commonLen >= minAbsLen && commonLen / minLen >= minRatio) {
            return true;
        }
    }

    // Filter out common adjectives/stop words
    const significantA = new Set([...tokensA].filter((t) => !ALL_STOPWORDS.has(t.toLowerCase())));
    const significantB = new Set([...tokensB].filter((t) => !ALL_STOPWORDS.has(t.toLowerCase())));

    if (significantA.size === 0 || significantB.size === 0) {
        return false;
    }

    // Calculate overlap
    let overlapCount = 0;
    for (const token of significantA) {
        if (significantB.has(token)) {
            overlapCount++;
        }
    }

    const minSize = Math.min(significantA.size, significantB.size);
    const overlapRatio = overlapCount / minSize;

    // Check 4: Stem-based comparison (catches Russian morphological variants)
    const stemmedA = new Set([...significantA].map((t) => stemWord(t)).filter((s) => s.length >= 2));
    const stemmedB = new Set([...significantB].map((t) => stemWord(t)).filter((s) => s.length >= 2));
    if (stemmedA.size > 0 && stemmedB.size > 0) {
        let stemOverlap = 0;
        for (const s of stemmedA) {
            if (stemmedB.has(s)) stemOverlap++;
        }
        if (stemOverlap / Math.min(stemmedA.size, stemmedB.size) >= minOverlapRatio) {
            return true;
        }
    }

    return overlapRatio >= minOverlapRatio;
}

/**
 * Determine if two entities should merge based on cosine similarity
 * and optional token overlap confirmation.
 *
 * Above threshold: cosine alone is sufficient (catches true synonyms).
 * Grey zone (threshold - 0.10 to threshold): requires token overlap confirmation.
 * Below grey zone: no merge.
 *
 * tokensA is pre-computed by the caller (outer loop). tokensB is constructed
 * lazily from keyB only when cosine lands in the grey zone, avoiding
 * Set allocation on every iteration of the tight inner loop.
 *
 * @param {number} cosine - Cosine similarity between embeddings
 * @param {number} threshold - entityMergeSimilarityThreshold from settings
 * @param {Set<string>} tokensA - Word tokens from entity A's key (pre-computed)
 * @param {string} keyA - Entity A's normalized key (for LCS/substring checks)
 * @param {string} keyB - Entity B's normalized key
 * @returns {boolean}
 */
export function shouldMergeEntities(cosine, threshold, tokensA, keyA, keyB) {
    if (cosine >= threshold) return true;
    const greyZoneFloor = threshold - 0.1;
    if (cosine >= greyZoneFloor) {
        const tokensB = new Set(keyB.split(/\s+/));
        return hasSufficientTokenOverlap(tokensA, tokensB, 0.6, keyA, keyB);
    }
    return false;
}

export async function mergeOrInsertEntity(graphData, name, type, description, cap, settings) {
    const key = normalizeKey(name);

    // Fast path: exact key match
    if (graphData.nodes[key]) {
        upsertEntity(graphData, name, type, description, cap);
        return key;
    }

    // Universal cross-script merge: if this is a PERSON entity, check all existing
    // PERSON nodes for transliteration matches to prevent cross-script duplicates
    // (e.g., "Мина" vs "Mina", "Сузи" vs "Suzy").
    if (type === 'PERSON') {
        const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
        const keyIsCyrillic = CYRILLIC_RE.test(key);

        for (const [existingKey, node] of Object.entries(graphData.nodes)) {
            if (node.type !== 'PERSON') continue;

            const existingIsCyrillic = CYRILLIC_RE.test(existingKey);
            if (keyIsCyrillic === existingIsCyrillic) continue; // same script, skip

            const cyrKey = keyIsCyrillic ? key : existingKey;
            const latKey = keyIsCyrillic ? existingKey : key;

            if (levenshteinDistance(transliterateCyrToLat(cyrKey), latKey) <= getCrossScriptMaxDistance(cyrKey.length, latKey.length)) {
                logDebug(
                    `[graph] Cross-script merge: "${name}" (${key}) → "${node.name}" (${existingKey}), transliterated: "${transliterateCyrToLat(cyrKey)}"`
                );
                upsertEntity(graphData, node.name, type, description, cap);
                if (!node.aliases) node.aliases = [];
                node.aliases.push(name);
                if (!graphData._mergeRedirects) graphData._mergeRedirects = {};
                if (key !== existingKey) {
                    graphData._mergeRedirects[key] = existingKey;
                }
                return existingKey;
            }
        }
    }

    // Slow path: semantic match
    let newEmbedding;
    try {
        newEmbedding = await getDocumentEmbedding(`${type}: ${name} - ${description}`);
    } catch {
        newEmbedding = null;
    }

    if (!newEmbedding) {
        upsertEntity(graphData, name, type, description, cap);
        return key;
    }

    const threshold = settings.entityMergeSimilarityThreshold;
    let bestMatch = null;
    let bestScore = 0;

    // Token-overlap guard: extract word tokens from the new entity's key
    const newTokens = new Set(key.split(/\s+/));

    // Pre-decode embeddings of same-type nodes to avoid repeated Base64 decoding in loop
    const existingEmbeddings = new Map();
    for (const [existingKey, node] of Object.entries(graphData.nodes)) {
        if (node.type === type && hasEmbedding(node)) {
            existingEmbeddings.set(existingKey, getEmbedding(node));
        }
    }

    for (const [existingKey, existingEmbedding] of existingEmbeddings) {
        const sim = cosineSimilarity(newEmbedding, existingEmbedding);
        if (!shouldMergeEntities(sim, threshold, newTokens, key, existingKey)) {
            continue;
        }
        if (sim > bestScore) {
            bestMatch = existingKey;
            bestScore = sim;
        }
    }

    if (bestMatch) {
        logDebug(
            `[graph] Entity merged: "${name}" (${key}) → "${graphData.nodes[bestMatch].name}" (${bestMatch}), similarity: ${bestScore.toFixed(3)}`
        );
        upsertEntity(graphData, graphData.nodes[bestMatch].name, type, description, cap);
        // Persist alias for retrieval-time alternate name matching
        if (!graphData.nodes[bestMatch].aliases) graphData.nodes[bestMatch].aliases = [];
        graphData.nodes[bestMatch].aliases.push(name);
        // Record redirect so upsertRelationship can resolve
        if (!graphData._mergeRedirects) graphData._mergeRedirects = {};
        if (key !== bestMatch) {
            graphData._mergeRedirects[key] = bestMatch;
        }
        return bestMatch;
    }

    // No match: create new node with embedding
    upsertEntity(graphData, name, type, description, cap);
    setEmbedding(graphData.nodes[key], newEmbedding);

    // Sync graph node to ST Vector Storage
    if (isStVectorSource()) {
        const chatId = getCurrentChatId();
        const node = graphData.nodes[key];
        const text = `[OV_ID:${key}] ${node.description}`;
        await syncItemsToST([{ hash: cyrb53(text), text }], chatId);
        markStSynced(node);
    }

    return key;
}

/**
 * Redirect all edges from oldKey to newKey.
 * If redirection creates a duplicate edge, merges descriptions and sums weights.
 * Removes old edges after redirection. Self-loops are discarded.
 *
 * @param {Object} graphData - The graph object { nodes, edges }
 * @param {string} oldKey - Normalized key being removed
 * @param {string} newKey - Normalized key to redirect to
 */
export async function redirectEdges(graphData, oldKey, newKey) {
    const edgesToRemove = [];
    const edgesToAdd = [];

    for (const [edgeKey, edge] of Object.entries(graphData.edges)) {
        let src = edge.source;
        let tgt = edge.target;
        let changed = false;

        if (src === oldKey) {
            src = newKey;
            changed = true;
        }
        if (tgt === oldKey) {
            tgt = newKey;
            changed = true;
        }

        if (changed) {
            // Skip self-loops
            if (src === tgt) {
                edgesToRemove.push(edgeKey);
                continue;
            }
            edgesToRemove.push(edgeKey);
            edgesToAdd.push({ source: src, target: tgt, description: edge.description, weight: edge.weight });
        }
    }

    // Remove old edges
    for (const key of edgesToRemove) {
        delete graphData.edges[key];
    }

    // Delete old edges from ST Vector Storage
    if (isStVectorSource()) {
        const chatId = getCurrentChatId();
        for (const edgeKey of edgesToRemove) {
            // Reconstruct edge info from the edge key (format: source__target)
            const [source, target] = edgeKey.split('__');
            const edgeId = `edge_${source}_${target}`;
            const edge = edgesToAdd.find((e) => e.source === source || e.target === target);
            if (edge) {
                const text = `[OV_ID:${edgeId}] ${edge.description}`;
                await deleteItemsFromST([cyrb53(text)], chatId);
            }
        }
    }

    // Add redirected edges (merge if duplicate)
    for (const newEdge of edgesToAdd) {
        const newEdgeKey = `${newEdge.source}__${newEdge.target}`;
        const existing = graphData.edges[newEdgeKey];
        if (existing) {
            existing.weight += newEdge.weight;
            if (!existing.description.includes(newEdge.description)) {
                existing.description = existing.description + ' | ' + newEdge.description;
            }
        } else {
            graphData.edges[newEdgeKey] = newEdge;
        }
    }
}

/**
 * Retroactive graph consolidation: merge semantically duplicate nodes.
 * Embeds all nodes lacking embeddings, then pairwise-compares within each type.
 * Merges duplicates and redirects edges.
 *
 * @param {Object} graphData - The graph object { nodes, edges }
 * @param {Object} settings - Extension settings
 * @returns {Promise<{mergedCount: number, embeddedCount: number}>}
 */
export async function consolidateGraph(graphData, settings) {
    const threshold = settings.entityMergeSimilarityThreshold;
    let mergedCount = 0;
    let embeddedCount = 0;

    // Step 1: Embed all nodes that lack embeddings
    for (const [_key, node] of Object.entries(graphData.nodes)) {
        if (!hasEmbedding(node)) {
            try {
                const embedding = await getDocumentEmbedding(`${node.type}: ${node.name} - ${node.description}`);
                setEmbedding(node, embedding);
                if (hasEmbedding(node)) embeddedCount++;
            } catch {
                // Skip nodes that can't be embedded
            }
        }
    }

    // Step 2: Group nodes by type
    const byType = {};
    for (const [key, node] of Object.entries(graphData.nodes)) {
        if (!hasEmbedding(node)) continue;
        if (!byType[node.type]) byType[node.type] = [];
        byType[node.type].push(key);
    }

    // Step 3: Pairwise comparison within each type
    const mergeMap = new Map(); // oldKey -> newKey

    for (const keys of Object.values(byType)) {
        for (let i = 0; i < keys.length; i++) {
            if (mergeMap.has(keys[i])) continue; // Already merged

            if (i % 50 === 0 && i > 0) await yieldToMain();

            const tokensI = new Set(keys[i].split(/\s+/));

            for (let j = i + 1; j < keys.length; j++) {
                if (mergeMap.has(keys[j])) continue;

                const nodeA = graphData.nodes[keys[i]];
                const nodeB = graphData.nodes[keys[j]];
                const sim = cosineSimilarity(getEmbedding(nodeA), getEmbedding(nodeB));

                if (!shouldMergeEntities(sim, threshold, tokensI, keys[i], keys[j])) {
                    continue;
                }

                // Merge B into A (A has lower index = likely older/more established)
                const keepKey = nodeA.mentions >= nodeB.mentions ? keys[i] : keys[j];
                const removeKey = keepKey === keys[i] ? keys[j] : keys[i];

                mergeMap.set(removeKey, keepKey);
            }
        }
    }

    // Step 4: Execute merges
    const entityCap = settings.entityDescriptionCap;
    for (const [removeKey, keepKey] of mergeMap) {
        const removedNode = graphData.nodes[removeKey];
        if (!removedNode) continue;

        // Merge description
        upsertEntity(
            graphData,
            graphData.nodes[keepKey].name,
            graphData.nodes[keepKey].type,
            removedNode.description,
            entityCap
        );

        // Persist alias for retrieval-time alternate name matching
        if (!graphData.nodes[keepKey].aliases) graphData.nodes[keepKey].aliases = [];
        graphData.nodes[keepKey].aliases.push(removedNode.name);

        // Redirect edges
        await redirectEdges(graphData, removeKey, keepKey);

        // Delete orphaned node from ST Vector Storage
        if (isStVectorSource()) {
            const chatId = getCurrentChatId();
            const text = `[OV_ID:${removeKey}] ${removedNode.description}`;
            await deleteItemsFromST([cyrb53(text)], chatId);
        }

        // Remove old node
        delete graphData.nodes[removeKey];
        mergedCount++;
    }

    return { mergedCount, embeddedCount };
}

/**
 * Consolidate graph edges that have exceeded token budget.
 * Runs during community detection phase.
 * @param {Object} graphData - The graph object
 * @param {Object} settings - Extension settings
 * @returns {Promise<number>} Number of edges consolidated
 */
export async function consolidateEdges(graphData, _settings) {
    if (!graphData._edgesNeedingConsolidation?.length) {
        return 0;
    }

    const toProcess = graphData._edgesNeedingConsolidation.slice(0, CONSOLIDATION.MAX_CONSOLIDATION_BATCH);

    const deps = getDeps();
    const extensionSettings = deps.getExtensionSettings()?.[extensionName] || {};
    const preamble = resolveExtractionPreamble(extensionSettings);
    const outputLanguage = resolveOutputLanguage(extensionSettings);
    const prefill = resolveExtractionPrefill(extensionSettings);
    const maxConcurrency = extensionSettings.maxConcurrency;
    const ladderQueue = await createLadderQueue(maxConcurrency);

    const results = await Promise.all(
        toProcess.map((edgeKey) =>
            ladderQueue
                .add(async () => {
                    const edge = graphData.edges[edgeKey];
                    if (!edge) return null;

                    const prompt = buildEdgeConsolidationPrompt(edge, preamble, outputLanguage, prefill);
                    const response = await callLLM(prompt, LLM_CONFIGS.edge_consolidation, { structured: true });

                    const result = parseConsolidationResponse(response);
                    if (result.consolidated_description) {
                        edge.description = result.consolidated_description;
                        edge._descriptionTokens = countTokens(result.consolidated_description);

                        // Re-embed for accurate RAG (only if embeddings enabled)
                        if (isEmbeddingsEnabled()) {
                            const newEmbedding = await getDocumentEmbedding(
                                `relationship: ${edge.source} - ${edge.target}: ${edge.description}`
                            );
                            setEmbedding(edge, newEmbedding);
                        }

                        // Sync consolidated edge to ST Vector Storage
                        if (isStVectorSource()) {
                            const chatId = getCurrentChatId();
                            const edgeId = `edge_${edge.source}_${edge.target}`;
                            const text = `[OV_ID:${edgeId}] ${edge.description}`;
                            await syncItemsToST([{ hash: cyrb53(text), text }], chatId);
                            markStSynced(edge);
                        }

                        return edgeKey;
                    }
                    return null;
                })
                .catch((err) => {
                    logError(`Failed to consolidate edge ${edgeKey}`, err);
                    return null;
                })
        )
    );

    const successfulKeys = results.filter((k) => k !== null);

    // Remove only successfully processed edges from queue
    graphData._edgesNeedingConsolidation = graphData._edgesNeedingConsolidation.filter(
        (key) => !successfulKeys.includes(key)
    );

    return successfulKeys.length;
}
