/**
 * OpenVault Graph Module
 *
 * Flat-JSON graph CRUD for entity and relationship storage.
 * All data stored in chatMetadata.openvault.graph as { nodes, edges }.
 */

import { getDocumentEmbedding } from '../embeddings.js';
import { cosineSimilarity } from '../retrieval/math.js';

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
 */
export function upsertRelationship(graphData, source, target, description, cap = 5) {
    const srcKey = normalizeKey(source);
    const tgtKey = normalizeKey(target);

    if (!graphData.nodes[srcKey] || !graphData.nodes[tgtKey]) return;

    const edgeKey = `${srcKey}__${tgtKey}`;
    const existing = graphData.edges[edgeKey];

    if (existing) {
        existing.weight += 1;
        if (!existing.description.includes(description)) {
            existing.description = existing.description + ' | ' + description;
        }

        // Cap description segments (FIFO eviction)
        const segments = existing.description.split(' | ');
        if (cap > 0 && segments.length > cap) {
            existing.description = segments.slice(-cap).join(' | ');
        }
    } else {
        graphData.edges[edgeKey] = {
            source: srcKey,
            target: tgtKey,
            description,
            weight: 1,
        };
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
 * @returns {Promise<string>} The key of the node (existing or new)
 */
export async function mergeOrInsertEntity(graphData, name, type, description, cap, settings) {
    const key = normalizeKey(name);

    // Fast path: exact key match
    if (graphData.nodes[key]) {
        upsertEntity(graphData, name, type, description, cap);
        return key;
    }

    // Slow path: semantic match
    let newEmbedding;
    try {
        newEmbedding = await getDocumentEmbedding(`${type}: ${name}`);
    } catch {
        newEmbedding = null;
    }

    if (!newEmbedding) {
        upsertEntity(graphData, name, type, description, cap);
        return key;
    }

    const threshold = settings?.entityMergeSimilarityThreshold ?? 0.8;
    let bestMatch = null;
    let bestScore = 0;

    for (const [existingKey, node] of Object.entries(graphData.nodes)) {
        if (node.type !== type) continue;
        if (!node.embedding) continue;

        const sim = cosineSimilarity(newEmbedding, node.embedding);
        if (sim >= threshold && sim > bestScore) {
            bestMatch = existingKey;
            bestScore = sim;
        }
    }

    if (bestMatch) {
        upsertEntity(graphData, graphData.nodes[bestMatch].name, type, description, cap);
        return bestMatch;
    }

    // No match: create new node with embedding
    upsertEntity(graphData, name, type, description, cap);
    graphData.nodes[key].embedding = newEmbedding;
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
export function redirectEdges(graphData, oldKey, newKey) {
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
    const threshold = settings?.entityMergeSimilarityThreshold ?? 0.8;
    let mergedCount = 0;
    let embeddedCount = 0;

    // Step 1: Embed all nodes that lack embeddings
    for (const [key, node] of Object.entries(graphData.nodes)) {
        if (!node.embedding) {
            try {
                node.embedding = await getDocumentEmbedding(`${node.type}: ${node.name}`);
                if (node.embedding) embeddedCount++;
            } catch {
                // Skip nodes that can't be embedded
            }
        }
    }

    // Step 2: Group nodes by type
    const byType = {};
    for (const [key, node] of Object.entries(graphData.nodes)) {
        if (!node.embedding) continue;
        if (!byType[node.type]) byType[node.type] = [];
        byType[node.type].push(key);
    }

    // Step 3: Pairwise comparison within each type
    const mergeMap = new Map(); // oldKey -> newKey

    for (const keys of Object.values(byType)) {
        for (let i = 0; i < keys.length; i++) {
            if (mergeMap.has(keys[i])) continue; // Already merged

            for (let j = i + 1; j < keys.length; j++) {
                if (mergeMap.has(keys[j])) continue;

                const nodeA = graphData.nodes[keys[i]];
                const nodeB = graphData.nodes[keys[j]];
                const sim = cosineSimilarity(nodeA.embedding, nodeB.embedding);

                if (sim >= threshold) {
                    // Merge B into A (A has lower index = likely older/more established)
                    const keepKey = nodeA.mentions >= nodeB.mentions ? keys[i] : keys[j];
                    const removeKey = keepKey === keys[i] ? keys[j] : keys[i];

                    mergeMap.set(removeKey, keepKey);
                }
            }
        }
    }

    // Step 4: Execute merges
    const entityCap = settings?.entityDescriptionCap ?? 3;
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

        // Redirect edges
        redirectEdges(graphData, removeKey, keepKey);

        // Remove old node
        delete graphData.nodes[removeKey];
        mergedCount++;
    }

    return { mergedCount, embeddedCount };
}
