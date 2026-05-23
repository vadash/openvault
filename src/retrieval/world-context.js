/**
 * OpenVault World Context Retrieval
 *
 * Retrieves relevant entity descriptions and relationships for injection into the prompt.
 */

import { getEmbedding, hasEmbedding } from '../utils/embedding-codec.js';
import { countTokens } from '../utils/tokens.js';
import { cosineSimilarity } from './math.js';

/**
 * Multilingual regex for macro-intent detection.
 * Matches keywords that indicate user wants a global summary rather than local context.
 * English + Russian triggers as per Phase 2 design.
 */
const MACRO_INTENT_REGEX =
    /(summarize|recap|story so far|overall|time skip|what has happened|lately|dynamic|вкратце|что было|расскажи|итог|наполни|напомни)/i;

/**
 * Detect if user message indicates macro-intent (global summary needed).
 * @param {string|null|undefined} userMessagesString - Concatenated user messages
 * @returns {boolean} True if macro intent detected
 */
export function detectMacroIntent(userMessagesString) {
    if (!userMessagesString || typeof userMessagesString !== 'string') {
        return false;
    }
    return MACRO_INTENT_REGEX.test(userMessagesString);
}

/**
 * Retrieve the most relevant entity descriptions and relationships for the current context.
 * Intent-based routing: macro queries use global state, local queries use vector search over entities.
 *
 * @param {{ nodes: Record<string, any>, edges: Record<string, any> } | Record<string, any>} graphData - Graph with { nodes, edges } or legacy communities object
 * @param {Object|null} globalState - Pre-computed global world state
 * @param {string} userMessagesString - Concatenated user messages for intent detection
 * @param {Float32Array} queryEmbedding - Embedding of current context
 * @param {number} tokenBudget - Max tokens for world context (default: 2000)
 * @returns {{ text: string, entityKeys: string[], isMacroIntent: boolean }}
 */
export async function retrieveWorldContext(
    graphData,
    globalState,
    userMessagesString,
    queryEmbedding,
    tokenBudget = 2000
) {
    // Intent-based routing: check for macro intent first
    if (detectMacroIntent(userMessagesString) && globalState?.summary) {
        return {
            text: `<world_context>\n[This is background knowledge about the world, its communities, and broader context the character is aware of]\n${globalState.summary}\n</world_context>`,
            entityKeys: [],
            isMacroIntent: true,
        };
    }

    // Handle legacy communities format (Task 4 will update call sites to use graphData)
    if (!graphData?.nodes) {
        return { text: '', entityKeys: [], isMacroIntent: false };
    }

    // Local mode: requires queryEmbedding for cosine similarity
    // Fallback: if no embedding, use mentions count + keyword matching
    if (!queryEmbedding) {
        const scored = [];
        const queryLower = userMessagesString?.toLowerCase() || '';

        for (const [key, node] of Object.entries(graphData.nodes)) {
            let score = node.mentions || 0; // Base score on frequency

            // Keyword matching with Unicode-aware boundary regex
            const nameLower = node.name?.toLowerCase() || '';
            if (queryLower && nameLower) {
                const escapedName = nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedName}(?![\\p{L}\\p{N}])`, 'iu');
                if (regex.test(queryLower)) {
                    score += 100; // Strong boost for name in query
                }
            }

            // Check aliases
            if (
                node.aliases?.some((alias) => {
                    const aliasLower = alias.toLowerCase();
                    const escapedAlias = aliasLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const aliasRegex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedAlias}(?![\\p{L}\\p{N}])`, 'iu');
                    return aliasRegex.test(queryLower);
                })
            ) {
                score += 100;
            }

            scored.push({ key, node, score });
        }

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        // Select entities within token budget (reuse selection logic)
        const selected = [];
        let usedTokens = 0;

        for (const { key, node } of scored) {
            const entry = formatEntityEntry(key, node, graphData);
            const tokens = await countTokens(entry);
            if (usedTokens + tokens > tokenBudget) break;
            selected.push({ key, entry });
            usedTokens += tokens;
        }

        if (selected.length === 0) {
            return { text: '', entityKeys: [], isMacroIntent: false };
        }

        const text =
            '<world_context>\n[This is background knowledge about the world, its communities, and broader context the character is aware of]\n' +
            selected.map((s) => s.entry).join('\n\n') +
            '\n</world_context>';

        return {
            text,
            entityKeys: selected.map((s) => s.key),
            isMacroIntent: false,
        };
    }

    // Score entities by cosine similarity
    const scored = [];
    for (const [key, node] of Object.entries(graphData.nodes)) {
        if (!hasEmbedding(node)) continue;
        const score = cosineSimilarity(queryEmbedding, getEmbedding(node));
        scored.push({ key, node, score });
    }

    if (scored.length === 0) {
        return { text: '', entityKeys: [], isMacroIntent: false };
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Select entities within token budget
    const selected = [];
    let usedTokens = 0;

    for (const { key, node } of scored) {
        const entry = formatEntityEntry(key, node, graphData);
        const tokens = await countTokens(entry);
        if (usedTokens + tokens > tokenBudget) break;
        selected.push({ key, entry });
        usedTokens += tokens;
    }

    if (selected.length === 0) {
        return { text: '', entityKeys: [], isMacroIntent: false };
    }

    const text =
        '<world_context>\n[This is background knowledge about the world, its communities, and broader context the character is aware of]\n' +
        selected.map((s) => s.entry).join('\n\n') +
        '\n</world_context>';

    return {
        text,
        entityKeys: selected.map((s) => s.key),
        isMacroIntent: false,
    };
}

/**
 * Format an entity description with its top 3 edges for prompt injection.
 * @param {string} key - Entity key
 * @param {Object} node - Entity node
 * @param {{ nodes: Record<string, any>, edges: Record<string, any> }} graphData - Graph data
 * @returns {string}
 */
function formatEntityEntry(key, node, graphData) {
    let entry = `## ${node.name} (${node.type})\n${node.description}`;

    // Find top 3 edges by weight where this entity is the source
    const edges = [];
    for (const [_edgeKey, edge] of Object.entries(graphData.edges || {})) {
        if (edge.source === key && graphData.nodes[edge.target]) {
            edges.push(edge);
        }
    }

    // Sort by weight descending and take top 3
    edges.sort((a, b) => b.weight - a.weight);
    const topEdges = edges.slice(0, 3);

    if (topEdges.length > 0) {
        entry += '\nConnections:\n';
        for (const edge of topEdges) {
            const targetNode = graphData.nodes[edge.target];
            entry += `  → ${targetNode.name} (${targetNode.type}): ${edge.description}\n`;
        }
    }

    return entry.trim();
}
