/**
 * OpenVault Community Detection & Summarization
 *
 * Uses graphology for graph computation and Louvain for community detection.
 */

import Graph from 'https://esm.sh/graphology';
import louvain from 'https://esm.sh/graphology-communities-louvain';
import { toUndirected } from 'https://esm.sh/graphology-operators';
import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { getQueryEmbedding, maybeRoundEmbedding } from '../embeddings.js';
import { parseCommunitySummaryResponse } from '../extraction/structured.js';
import { callLLM, LLM_CONFIGS } from '../llm.js';
import { buildCommunitySummaryPrompt, resolveExtractionPreamble, resolveOutputLanguage } from '../prompts/index.js';
import { log } from '../utils/logging.js';
import { yieldToMain } from '../utils/st-helpers.js';

/**
 * Convert flat graph data to a graphology instance.
 * @param {Object} graphData - { nodes, edges } from chatMetadata
 * @returns {Graph}
 */
export function toGraphology(graphData) {
    const graph = new Graph({ type: 'directed', allowSelfLoops: false });

    for (const [key, attrs] of Object.entries(graphData.nodes || {})) {
        graph.addNode(key, { ...attrs });
    }

    for (const [key, attrs] of Object.entries(graphData.edges || {})) {
        // Delete self-loops from backing store (defensive - should be prevented at insertion time)
        if (attrs.source === attrs.target) {
            log(`[communities] Removing self-loop edge ${key}: ${attrs.source} -> ${attrs.target}`);
            delete graphData.edges[key];
            continue;
        }
        if (graph.hasNode(attrs.source) && graph.hasNode(attrs.target)) {
            graph.addEdgeWithKey(key, attrs.source, attrs.target, {
                description: attrs.description,
                weight: attrs.weight || 1,
            });
        }
    }

    return graph;
}

/**
 * Run Louvain community detection on the graph.
 * Temporarily prunes edges involving main characters to avoid hairball effect.
 * @param {Object} graphData - Flat graph data
 * @param {string[]} mainCharacterKeys - Node keys for main characters (User + Char) to prune
 * @returns {{ communities: Object<string, number>, count: number } | null}
 */
export function detectCommunities(graphData, mainCharacterKeys = []) {
    if (Object.keys(graphData.nodes || {}).length < 3) return null;

    const directed = toGraphology(graphData);
    const undirected = toUndirected(directed);

    // Temporarily remove edges involving main characters for better community structure
    const mainSet = new Set(mainCharacterKeys);
    if (mainSet.size > 0) {
        const edgesToDrop = [];
        undirected.forEachEdge((edge, _attrs, source, target) => {
            if (mainSet.has(source) || mainSet.has(target)) {
                edgesToDrop.push(edge);
            }
        });
        for (const edge of edgesToDrop) {
            undirected.dropEdge(edge);
        }
        // Also drop isolated nodes that lost all edges (main chars themselves)
        undirected.forEachNode((node) => {
            if (undirected.degree(node) === 0) {
                undirected.dropNode(node);
            }
        });
    }

    // Need at least 3 nodes after pruning
    if (undirected.order < 3) {
        // Fallback: run without pruning
        const fallbackDirected = toGraphology(graphData);
        const fallbackUndirected = toUndirected(fallbackDirected);
        const details = louvain.detailed(fallbackUndirected, {
            getEdgeWeight: 'weight',
            resolution: 1.0,
        });
        return { communities: details.communities, count: details.count };
    }

    const details = louvain.detailed(undirected, {
        getEdgeWeight: 'weight',
        resolution: 1.0,
    });

    // Re-assign main characters to the community of their strongest remaining neighbor
    for (const mainKey of mainCharacterKeys) {
        if (!graphData.nodes[mainKey]) continue;
        // Find neighbor with highest edge weight
        let bestCommunity = 0;
        let bestWeight = -1;
        for (const [_edgeKey, edge] of Object.entries(graphData.edges || {})) {
            const neighborKey = edge.source === mainKey ? edge.target : edge.target === mainKey ? edge.source : null;
            if (neighborKey && details.communities[neighborKey] !== undefined) {
                if ((edge.weight || 1) > bestWeight) {
                    bestWeight = edge.weight || 1;
                    bestCommunity = details.communities[neighborKey];
                }
            }
        }
        details.communities[mainKey] = bestCommunity;
    }

    return {
        communities: details.communities,
        count: details.count,
    };
}

/**
 * Group nodes by community ID and extract subgraph data for LLM prompts.
 * @param {Object} graphData - Flat graph data
 * @param {Object} communityPartition - nodeKey → communityId mapping
 * @returns {Object<number, { nodeKeys: string[], nodeLines: string[], edgeLines: string[] }>}
 */
export function buildCommunityGroups(graphData, communityPartition) {
    const groups = {};

    // Group node keys
    for (const [nodeKey, communityId] of Object.entries(communityPartition)) {
        if (!groups[communityId]) {
            groups[communityId] = { nodeKeys: [], nodeLines: [], edgeLines: [] };
        }
        groups[communityId].nodeKeys.push(nodeKey);

        const node = graphData.nodes[nodeKey];
        if (node) {
            groups[communityId].nodeLines.push(`- ${node.name} (${node.type || 'UNKNOWN'}): ${node.description}`);
        }
    }

    // Assign edges to communities
    for (const [_edgeKey, edge] of Object.entries(graphData.edges || {})) {
        const srcCommunity = communityPartition[edge.source];
        const tgtCommunity = communityPartition[edge.target];

        // Include edge if both endpoints are in the same community
        if (srcCommunity === tgtCommunity && groups[srcCommunity]) {
            const srcNode = graphData.nodes[edge.source];
            const tgtNode = graphData.nodes[edge.target];
            groups[srcCommunity].edgeLines.push(
                `- ${srcNode?.name || edge.source} → ${tgtNode?.name || edge.target}: ${edge.description} [weight: ${edge.weight}]`
            );
        }
    }

    return groups;
}

/**
 * Check if two arrays contain the same elements (order-independent).
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function sameMembers(a, b) {
    if (a.length !== b.length) return false;
    const setA = new Set(a);
    return b.every((item) => setA.has(item));
}

/**
 * Generate or update community summaries.
 * Only regenerates communities whose node membership changed.
 * Skips communities with fewer than 2 nodes (islands).
 * @param {Object} graphData - Flat graph data
 * @param {Object} communityGroups - Output of buildCommunityGroups
 * @param {Object} existingCommunities - Current community summaries from state
 * @param {number} currentMessageCount - Current graph message count for staleness detection
 * @param {number} stalenessThreshold - Message count threshold for forced re-summarization
 * @param {boolean} isSingleCommunity - Whether Louvain produced only one community
 * @returns {Promise<Object>} Updated communities object
 */
export async function updateCommunitySummaries(
    _graphData,
    communityGroups,
    existingCommunities,
    currentMessageCount = 0,
    stalenessThreshold = 100,
    isSingleCommunity = false
) {
    const deps = getDeps();
    const settings = deps.getExtensionSettings()?.[extensionName] || {};
    const preamble = resolveExtractionPreamble(settings);
    const outputLanguage = resolveOutputLanguage(settings);
    const updatedCommunities = {};

    for (const [communityId, group] of Object.entries(communityGroups)) {
        await yieldToMain();
        // Skip solo nodes - they don't form a meaningful community
        if (group.nodeKeys.length < 2) continue;

        const key = `C${communityId}`;
        const existing = existingCommunities[key];

        // Check if membership has changed
        const membershipChanged = !existing || !sameMembers(existing.nodeKeys, group.nodeKeys);

        // Check staleness: message count delta exceeds threshold
        const messageDelta = currentMessageCount - (existing?.lastUpdatedMessageCount || 0);
        const isStale = messageDelta >= stalenessThreshold;

        // Special case: if only one community, always re-summarize at staleness interval
        const singleCommunityForceRefresh = isSingleCommunity && isStale;

        // Skip if membership hasn't changed AND not stale (unless single community forcing refresh)
        if (!membershipChanged && !isStale && !singleCommunityForceRefresh) {
            updatedCommunities[key] = existing;
            continue;
        }

        // Generate new summary
        try {
            const prompt = buildCommunitySummaryPrompt(group.nodeLines, group.edgeLines, preamble, outputLanguage);
            const response = await callLLM(prompt, LLM_CONFIGS.community, { structured: true });
            const parsed = parseCommunitySummaryResponse(response);

            // Embed the summary for retrieval
            const embedding = await getQueryEmbedding(parsed.summary);

            updatedCommunities[key] = {
                nodeKeys: group.nodeKeys,
                title: parsed.title,
                summary: parsed.summary,
                findings: parsed.findings,
                embedding: maybeRoundEmbedding(embedding) || [],
                lastUpdated: deps.Date.now(),
                lastUpdatedMessageCount: currentMessageCount,
            };

            log(`Community ${key}: "${parsed.title}" (${group.nodeKeys.length} nodes)`);
        } catch (error) {
            log(`Community ${key} summarization failed: ${error.message}`);
            // Keep existing if available, otherwise skip
            if (existing) {
                updatedCommunities[key] = existing;
            }
        }
    }

    return updatedCommunities;
}
