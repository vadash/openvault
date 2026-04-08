/**
 * OpenVault Graph Module
 *
 * Flat-JSON graph CRUD for entity and relationship storage.
 * All data stored in chatMetadata.openvault.graph as { nodes, edges }.
 */

// @ts-check

/** @typedef {import('../types').GraphData} GraphData */
/** @typedef {import('../types').GraphNode} GraphNode */
/** @typedef {import('../types').GraphEdge} GraphEdge */
/** @typedef {import('../types').MergeEntityResult} MergeEntityResult */
/** @typedef {import('../types').ConsolidateEdgesResult} ConsolidateEdgesResult */

import {
    CONSOLIDATION,
    ENTITY_MERGE_THRESHOLD,
    ENTITY_TOKEN_OVERLAP_MIN_RATIO,
    ENTITY_TYPES,
    extensionName,
    GRAPH_JACCARD_DUPLICATE_THRESHOLD,
} from '../constants.js';
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
import { cosineSimilarity, tokenize } from '../retrieval/math.js';
import { cyrb53, getEmbedding, hasEmbedding, setEmbedding } from '../utils/embedding-codec.js';
import { logDebug, logError } from '../utils/logging.js';
import { createLadderQueue } from '../utils/queue.js';
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
 * @param {string} name - Entity name to normalize
 * @returns {string} Normalized key
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
 * @param {Object.<string, GraphNode>} graphNodes - Graph nodes keyed by normalized name
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
 * @param {string[]} baseKeys - Normalized English main character keys
 * @param {Object.<string, GraphNode>} graphNodes - Graph nodes keyed by normalized name
 * @returns {string[]} Cyrillic node keys matching main characters
 */
export function findCrossScriptCharacterKeys(baseKeys, graphNodes) {
    const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
    const crossScriptKeys = [];

    for (const [nodeKey, node] of Object.entries(graphNodes)) {
        if (node.type !== ENTITY_TYPES.PERSON) continue;
        if (baseKeys.includes(nodeKey)) continue;
        if (!CYRILLIC_RE.test(nodeKey)) continue;

        const transliterated = transliterateCyrToLat(nodeKey);
        for (const baseKey of baseKeys) {
            if (
                levenshteinDistance(transliterated, baseKey) <=
                getCrossScriptMaxDistance(transliterated.length, baseKey.length)
            ) {
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
 * @param {GraphData} graphData - The graph object { nodes, edges } (mutated in place)
 * @param {string} name - Entity name (original casing preserved on first insert)
 * @param {"PERSON" | "PLACE" | "ORGANIZATION" | "OBJECT" | "CONCEPT"} type - Entity type
 * @param {string} description - Entity description
 * @param {number} [cap=3] - Maximum number of description segments to retain
 * @returns {void}
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
 * @param {GraphData} graphData - The graph object { nodes, edges } (mutated in place)
 * @param {string} source - Source entity name (will be normalized)
 * @param {string} target - Target entity name (will be normalized)
 * @param {string} description - Relationship description
 * @param {number} [cap=5] - Maximum number of description segments to retain
 * @param {Object} [settings=null] - Optional settings for consolidation behavior
 * @returns {void}
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
        const jaccard = jaccardSimilarity(existing.description, description, tokenize);
        if (jaccard < GRAPH_JACCARD_DUPLICATE_THRESHOLD && !existing.description.includes(description)) {
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
 * @returns {GraphData} Empty graph with nodes and edges objects
 */
export function createEmptyGraph() {
    return { nodes: {}, edges: {} };
}

/**
 * Initialize graph-related state fields on the openvault data object.
 * Does not overwrite existing fields.
 * @param {Object} data - The openvault data object (mutated in place)
 */
function _initGraphState(data) {
    if (!data.graph) data.graph = createEmptyGraph();
    if (!data.communities) data.communities = {};
    if (!data.reflection_state) data.reflection_state = {};
    if (data.graph_message_count == null) data.graph_message_count = 0;
}

/**
 * Check if two token sets have sufficient overlap to consider merging.
 * @param {Set<string>} tokensA - First set of tokens
 * @param {Set<string>} tokensB - Second set of tokens
 * @param {number} [minOverlapRatio=0.5] - Minimum overlap ratio
 * @param {string} [keyA=''] - Original key A for substring check
 * @param {string} [keyB=''] - Original key B for substring check
 * @returns {boolean}
 */
export function hasSufficientTokenOverlap(
    tokensA,
    tokensB,
    minOverlapRatio = ENTITY_TOKEN_OVERLAP_MIN_RATIO,
    keyA = '',
    keyB = ''
) {
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
 * Determine if two entities should merge based on cosine similarity and token overlap.
 * @param {number} cosine - Cosine similarity between embeddings
 * @param {number} threshold - entityMergeSimilarityThreshold from settings
 * @param {Set<string>} tokensA - Word tokens from entity A's key (pre-computed)
 * @param {string} keyA - Entity A's normalized key
 * @param {string} keyB - Entity B's normalized key
 * @param {"PERSON" | "PLACE" | "ORGANIZATION" | "OBJECT" | "CONCEPT"} [type='OBJECT'] - Entity type
 * @returns {boolean}
 */
export function shouldMergeEntities(cosine, threshold, tokensA, keyA, keyB, type = ENTITY_TYPES.OBJECT) {
    // PERSON entities: names are unique identifiers, high similarity is sufficient
    if (type === ENTITY_TYPES.PERSON && cosine >= threshold) return true;

    // All other types: always require token overlap confirmation
    // This prevents false merges when embeddings are inflated by shared context
    if (cosine < threshold - 0.1) return false;

    const tokensB = new Set(keyB.split(/\s+/));
    return hasSufficientTokenOverlap(tokensA, tokensB, GRAPH_JACCARD_DUPLICATE_THRESHOLD, keyA, keyB);
}

/**
 * Merge-or-insert an entity with semantic deduplication.
 * @param {GraphData} graphData - The graph object { nodes, edges }
 * @param {string} name - Entity name
 * @param {"PERSON" | "PLACE" | "ORGANIZATION" | "OBJECT" | "CONCEPT"} type - Entity type
 * @param {string} description - Entity description
 * @param {number} cap - Description segment cap
 * @param {Object} _settings - Extension settings
 * @returns {Promise<MergeEntityResult>} The key of the node and ST sync changes
 */
export async function mergeOrInsertEntity(graphData, name, type, description, cap, _settings) {
    const key = normalizeKey(name);
    const stChanges = { toSync: [], toDelete: [] };

    /** Push updated node to stChanges.toSync */
    const syncNode = (nodeKey) => {
        const n = graphData.nodes[nodeKey];
        if (n) {
            const t = `[OV_ID:${nodeKey}] ${n.description}`;
            stChanges.toSync.push({ hash: cyrb53(t), text: t, item: n });
        }
    };

    // Fast path: exact key match
    if (graphData.nodes[key]) {
        upsertEntity(graphData, name, type, description, cap);
        syncNode(key);
        return { key, stChanges };
    }

    // Universal cross-script merge: if this is a PERSON entity, check all existing
    // PERSON nodes for transliteration matches to prevent cross-script duplicates
    // (e.g., "Мина" vs "Mina", "Сузи" vs "Suzy").
    if (type === ENTITY_TYPES.PERSON) {
        const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
        const keyIsCyrillic = CYRILLIC_RE.test(key);

        for (const [existingKey, node] of Object.entries(graphData.nodes)) {
            if (node.type !== ENTITY_TYPES.PERSON) continue;

            const existingIsCyrillic = CYRILLIC_RE.test(existingKey);
            if (keyIsCyrillic === existingIsCyrillic) continue; // same script, skip

            const cyrKey = keyIsCyrillic ? key : existingKey;
            const latKey = keyIsCyrillic ? existingKey : key;

            if (
                levenshteinDistance(transliterateCyrToLat(cyrKey), latKey) <=
                getCrossScriptMaxDistance(cyrKey.length, latKey.length)
            ) {
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
                syncNode(existingKey);
                return { key: existingKey, stChanges };
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
        syncNode(key);
        return { key, stChanges };
    }

    const threshold = ENTITY_MERGE_THRESHOLD;
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
        // Cross-script PERSON merge guard: if both are PERSONs in different scripts,
        // they should only merge via transliteration match (handled earlier), not semantic similarity.
        // Prevents false merges like "Alice" -> "Мария" where descriptions are similar but names are different.
        if (type === ENTITY_TYPES.PERSON) {
            const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
            const keyIsCyrillic = CYRILLIC_RE.test(key);
            const existingIsCyrillic = CYRILLIC_RE.test(existingKey);
            if (keyIsCyrillic !== existingIsCyrillic) {
                continue; // Different scripts, skip semantic merge
            }
        }

        const sim = cosineSimilarity(newEmbedding, existingEmbedding);
        if (!shouldMergeEntities(sim, threshold, newTokens, key, existingKey, type)) {
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
        syncNode(bestMatch);
        return { key: bestMatch, stChanges };
    }

    // No match: create new node with embedding
    upsertEntity(graphData, name, type, description, cap);
    setEmbedding(graphData.nodes[key], newEmbedding);

    const node = graphData.nodes[key];
    const text = `[OV_ID:${key}] ${node.description}`;
    stChanges.toSync.push({ hash: cyrb53(text), text, item: node });

    return { key, stChanges };
}

/**
 * Consolidate graph edges that have exceeded token budget.
 * @param {GraphData} graphData - The graph object
 * @param {Object} _settings - Extension settings
 * @returns {Promise<ConsolidateEdgesResult>} Consolidation result
 */
export async function consolidateEdges(graphData, _settings) {
    if (!graphData._edgesNeedingConsolidation?.length) {
        return { count: 0, stChanges: { toSync: [], toDelete: [] } };
    }

    const stChanges = { toSync: [], toDelete: [] };
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
                        // Queue old embedding for ST deletion before overwrite
                        if (edge._st_synced) {
                            const oldEdgeId = `edge_${edge.source}_${edge.target}`;
                            const oldText = `[OV_ID:${oldEdgeId}] ${edge.description}`;
                            stChanges.toDelete.push({ hash: cyrb53(oldText) });
                        }

                        edge.description = result.consolidated_description;
                        edge._descriptionTokens = countTokens(result.consolidated_description);

                        // Re-embed for accurate RAG (only if embeddings enabled)
                        if (isEmbeddingsEnabled()) {
                            const newEmbedding = await getDocumentEmbedding(
                                `relationship: ${edge.source} - ${edge.target}: ${edge.description}`
                            );
                            setEmbedding(edge, newEmbedding);
                        }

                        // Return edge for ST sync (orchestrator handles bulk I/O)
                        const edgeId = `edge_${edge.source}_${edge.target}`;
                        const text = `[OV_ID:${edgeId}] ${edge.description}`;
                        stChanges.toSync.push({ hash: cyrb53(text), text, item: edge });

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

    return { count: successfulKeys.length, stChanges };
}
