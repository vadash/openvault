/**
 * OpenVault World State Module
 *
 * Replaces Louvain communities with top-K entity selection and single LLM world-state summary.
 * Pure functions only — no CDN imports, no graphology.
 */

import { WORLD_STATE_ENTITY_COUNT } from '../constants.js';
import { getDeps } from '../deps.js';
import { parseGlobalSynthesisResponse } from '../extraction/structured.js';
import { callLLM, LLM_CONFIGS } from '../llm.js';
import { buildGlobalWorldStatePrompt } from '../prompts/index.js';

/**
 * Select top-K entities by mention count and collect intra-set edges.
 *
 * @param {Object} graphData - Flat graph data with { nodes, edges }
 * @param {number} [count=WORLD_STATE_ENTITY_COUNT] - Max entities to select
 * @returns {{ entities: Array, edges: Array }} Top entities and edges between them
 */
export function selectTopEntities(graphData, count = WORLD_STATE_ENTITY_COUNT) {
    const nodes = graphData.nodes || {};
    const edges = graphData.edges || {};

    // Sort nodes by mentions descending
    const sortedNodeKeys = Object.entries(nodes)
        .sort(([, a], [, b]) => b.mentions - a.mentions)
        .slice(0, count)
        .map(([key]) => key);

    // Build entity list with display names (never raw keys)
    const selectedEntities = sortedNodeKeys.map((key) => {
        const node = nodes[key];
        return {
            name: node.name,
            type: node.type,
            description: node.description,
            mentions: node.mentions,
        };
    });

    const selectedKeySet = new Set(sortedNodeKeys);

    // Collect edges where both endpoints are in the selected set
    const selectedEdges = Object.values(edges)
        .filter((edge) => selectedKeySet.has(edge.source) && selectedKeySet.has(edge.target))
        .map((edge) => ({
            source: nodes[edge.source].name,
            target: nodes[edge.target].name,
            sourceType: nodes[edge.source].type,
            targetType: nodes[edge.target].type,
            description: edge.description,
            weight: edge.weight,
        }));

    return {
        entities: selectedEntities,
        edges: selectedEdges,
    };
}

/**
 * Generate world state summary from top entities and edges.
 *
 * @param {Array} entities - Top entities from selectTopEntities
 * @param {Array} edges - Intra-set edges from selectTopEntities
 * @param {string} preamble - Extraction preamble language
 * @param {string} outputLanguage - Output language setting
 * @param {string} prefill - Required prefill for assistant message
 * @returns {Promise<{ summary: string, last_updated: number }>}
 */
export async function generateWorldState(entities, edges, preamble, outputLanguage, prefill) {
    const deps = getDeps();
    const prompt = buildGlobalWorldStatePrompt(entities, edges, preamble, outputLanguage, prefill);
    const response = await callLLM(prompt, LLM_CONFIGS.worldState, { structured: true });
    const parsed = parseGlobalSynthesisResponse(response);

    return {
        summary: parsed.global_summary,
        last_updated: deps.Date.now(),
    };
}
