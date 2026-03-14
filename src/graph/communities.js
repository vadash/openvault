/**
 * OpenVault Community Detection & Summarization
 *
 * Uses graphology for graph computation and Louvain for community detection.
 */

import { cdnImport } from '../utils/cdn.js';

const [{ default: Graph }, { default: louvain }, { toUndirected }] = await Promise.all([
    cdnImport('graphology'),
    cdnImport('graphology-communities-louvain'),
    cdnImport('graphology-operators'),
]);

import { extensionName, GLOBAL_SYNTHESIS_CHUNK_SIZE } from '../constants.js';
import { getDeps } from '../deps.js';
import { getQueryEmbedding } from '../embeddings.js';
import { parseCommunitySummaryResponse, parseGlobalSynthesisResponse } from '../extraction/structured.js';
import { callLLM, LLM_CONFIGS } from '../llm.js';
import { record } from '../perf/store.js';
import { buildCommunitySummaryPrompt, buildGlobalSynthesisPrompt, resolveExtractionPreamble, resolveExtractionPrefill, resolveOutputLanguage } from '../prompts/index.js';
import { hasEmbedding, setEmbedding } from '../utils/embedding-codec.js';
import { logDebug } from '../utils/logging.js';
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
            logDebug(`[communities] Removing self-loop edge ${key}: ${attrs.source} -> ${attrs.target}`);
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

    const t0 = performance.now();
    const nodeCount = Object.keys(graphData.nodes).length;
    const edgeCount = Object.keys(graphData.edges || {}).length;

    try {
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
                const neighborKey =
                    edge.source === mainKey ? edge.target : edge.target === mainKey ? edge.source : null;
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
    } finally {
        record('louvain_detection', performance.now() - t0, `${nodeCount} nodes, ${edgeCount} edges`);
    }
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
 * @returns {Promise<{ communities: Object, global_world_state: Object|null }>} Updated communities and optional global state
 */
export async function updateCommunitySummaries(
    _graphData,
    communityGroups,
    existingCommunities,
    currentMessageCount = 0,
    stalenessThreshold = 100,
    isSingleCommunity = false
) {
    const t0 = performance.now();
    const deps = getDeps();
    const settings = deps.getExtensionSettings()?.[extensionName] || {};
    const preamble = resolveExtractionPreamble(settings);
    const outputLanguage = resolveOutputLanguage(settings);
    const prefill = resolveExtractionPrefill(settings);
    const updatedCommunities = {};

    // Track how many communities were actually updated
    let updatedCount = 0;

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

        // Check if embedding is missing (need to regenerate if so)
        const missingEmbedding = existing && !hasEmbedding(existing);

        // Special case: if only one community, always re-summarize at staleness interval
        const singleCommunityForceRefresh = isSingleCommunity && isStale;

        // Skip if membership hasn't changed AND not stale AND not missing embedding (unless single community forcing refresh)
        if (!membershipChanged && !isStale && !missingEmbedding && !singleCommunityForceRefresh) {
            updatedCommunities[key] = existing;
            continue;
        }

        // Generate new summary
        try {
            const prompt = buildCommunitySummaryPrompt(group.nodeLines, group.edgeLines, preamble, outputLanguage, prefill);
            const response = await callLLM(prompt, LLM_CONFIGS.community, { structured: true });
            const parsed = parseCommunitySummaryResponse(response);

            // Embed the summary for retrieval
            const embedding = await getQueryEmbedding(parsed.summary);

            const community = {
                nodeKeys: group.nodeKeys,
                title: parsed.title,
                summary: parsed.summary,
                findings: parsed.findings,
                lastUpdated: deps.Date.now(),
                lastUpdatedMessageCount: currentMessageCount,
            };
            if (embedding) {
                setEmbedding(community, embedding);
            }
            updatedCommunities[key] = community;
            updatedCount++;

            logDebug(`Community ${key}: "${parsed.title}" (${group.nodeKeys.length} nodes)`);
        } catch (error) {
            logDebug(`Community ${key} summarization failed: ${error.message}`);
            // Keep existing if available, otherwise skip
            if (existing) {
                updatedCommunities[key] = existing;
            }
        }
    }

    const communityCount = Object.keys(updatedCommunities).length;
    record('llm_communities', performance.now() - t0, `${communityCount} communities`);

    // Trigger global world state synthesis if any communities were updated
    let globalState = null;
    if (updatedCount > 0) {
        globalState = await generateGlobalWorldState(updatedCommunities, preamble, outputLanguage);
    }

    // Return object with communities and optional global state
    return {
        communities: updatedCommunities,
        global_world_state: globalState,
    };
}

/**
 * Synthesize community summaries into a global narrative.
 * Uses single-pass for small sets, map-reduce for larger sets.
 *
 * @param {Object[]} communityList - Array of community objects with { title, summary, findings }
 * @param {string} preamble - Extraction preamble
 * @param {string} outputLanguage - Output language setting
 * @returns {Promise<string|null>} Global summary string, or null if all chunks fail
 */
export async function synthesizeInChunks(communityList, preamble, outputLanguage) {
    if (communityList.length <= GLOBAL_SYNTHESIS_CHUNK_SIZE) {
        // Small set: single-pass (current behavior)
        const prompt = buildGlobalSynthesisPrompt(communityList, preamble, outputLanguage);
        const response = await callLLM(prompt, LLM_CONFIGS.community, { structured: true });
        return parseGlobalSynthesisResponse(response).global_summary;
    }

    // Map phase: chunk communities, get regional summaries
    const chunks = [];
    for (let i = 0; i < communityList.length; i += GLOBAL_SYNTHESIS_CHUNK_SIZE) {
        chunks.push(communityList.slice(i, i + GLOBAL_SYNTHESIS_CHUNK_SIZE));
    }

    const regionalSummaries = [];
    for (const chunk of chunks) {
        try {
            const prompt = buildGlobalSynthesisPrompt(chunk, preamble, outputLanguage);
            const response = await callLLM(prompt, LLM_CONFIGS.community, { structured: true });
            const parsed = parseGlobalSynthesisResponse(response);
            regionalSummaries.push(parsed.global_summary);
        } catch (err) {
            logDebug(`Regional synthesis chunk failed, skipping: ${err.message}`);
        }
    }

    if (regionalSummaries.length === 0) return null;

    // Reduce phase: synthesize regional summaries into final global summary
    const pseudoCommunities = regionalSummaries.map((summary, i) => ({
        title: `Region ${i + 1}`,
        summary,
        findings: [],
    }));
    const reducePrompt = buildGlobalSynthesisPrompt(pseudoCommunities, preamble, outputLanguage);
    const reduceResponse = await callLLM(reducePrompt, LLM_CONFIGS.community, { structured: true });
    return parseGlobalSynthesisResponse(reduceResponse).global_summary;
}

/**
 * Generate global world state from all community summaries.
 * Called after community updates, only if 1+ communities changed.
 *
 * @param {Object} communities - All community summaries
 * @param {string} preamble - Extraction preamble language
 * @param {string} outputLanguage - Output language setting
 * @returns {Promise<{ summary: string, last_updated: number, community_count: number } | null>}
 */
export async function generateGlobalWorldState(communities, preamble, outputLanguage) {
    const communityList = Object.values(communities || {});
    if (communityList.length === 0) {
        return null;
    }

    const t0 = performance.now();
    const deps = getDeps();

    try {
        const summary = await synthesizeInChunks(communityList, preamble, outputLanguage);

        const result = {
            summary,
            last_updated: deps.Date.now(),
            community_count: communityList.length,
        };

        logDebug(`Global world state synthesized from ${communityList.length} communities`);
        record('global_synthesis', performance.now() - t0, `${communityList.length} communities`);
        return result;
    } catch (error) {
        logDebug(`Global world state synthesis failed: ${error.message}`);
        return null;
    }
}
