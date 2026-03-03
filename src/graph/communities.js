/**
 * OpenVault Community Detection & Summarization
 *
 * Uses graphology for graph computation and Louvain for community detection.
 */

import Graph from 'https://esm.sh/graphology@0.25.4';
import louvain from 'https://esm.sh/graphology-communities-louvain@0.12.0';
import { toUndirected } from 'https://esm.sh/graphology-operators@1.6.0';
import { getDeps } from '../deps.js';
import { getQueryEmbedding } from '../embeddings.js';
import { callLLM, LLM_CONFIGS } from '../llm.js';
import { buildCommunitySummaryPrompt } from '../prompts.js';
import { parseCommunitySummaryResponse } from '../extraction/structured.js';
import { log } from '../utils.js';

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
 * @param {Object} graphData - Flat graph data
 * @returns {{ communities: Object<string, number>, count: number } | null}
 */
export function detectCommunities(graphData) {
    if (Object.keys(graphData.nodes || {}).length < 3) return null;

    const directed = toGraphology(graphData);
    const undirected = toUndirected(directed);

    const details = louvain.detailed(undirected, {
        getEdgeWeight: 'weight',
        resolution: 1.0,
    });

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
            groups[communityId].nodeLines.push(
                `- ${node.name} (${node.type || 'UNKNOWN'}): ${node.description}`
            );
        }
    }

    // Assign edges to communities
    for (const [edgeKey, edge] of Object.entries(graphData.edges || {})) {
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
    return b.every(item => setA.has(item));
}

/**
 * Generate or update community summaries.
 * Only regenerates communities whose node membership changed.
 * Skips communities with fewer than 2 nodes (islands).
 * @param {Object} graphData - Flat graph data
 * @param {Object} communityGroups - Output of buildCommunityGroups
 * @param {Object} existingCommunities - Current community summaries from state
 * @returns {Promise<Object>} Updated communities object
 */
export async function updateCommunitySummaries(graphData, communityGroups, existingCommunities) {
    const deps = getDeps();
    const updatedCommunities = {};

    for (const [communityId, group] of Object.entries(communityGroups)) {
        // Skip solo nodes - they don't form a meaningful community
        if (group.nodeKeys.length < 2) continue;

        const key = `C${communityId}`;
        const existing = existingCommunities[key];

        // Skip if membership hasn't changed
        if (existing && sameMembers(existing.nodeKeys, group.nodeKeys)) {
            updatedCommunities[key] = existing;
            continue;
        }

        // Generate new summary
        try {
            const prompt = buildCommunitySummaryPrompt(group.nodeLines, group.edgeLines);
            const response = await callLLM(prompt, LLM_CONFIGS.community, { structured: true });
            const parsed = parseCommunitySummaryResponse(response);

            // Embed the summary for retrieval
            const embedding = await getQueryEmbedding(parsed.summary);

            updatedCommunities[key] = {
                nodeKeys: group.nodeKeys,
                title: parsed.title,
                summary: parsed.summary,
                findings: parsed.findings,
                embedding: embedding || [],
                lastUpdated: deps.Date.now(),
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
