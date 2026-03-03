/**
 * OpenVault World Context Retrieval
 *
 * Retrieves relevant community summaries for injection into the prompt.
 */

import { cosineSimilarity } from './math.js';
import { estimateTokens } from '../utils.js';

/**
 * Retrieve the most relevant community summaries for the current context.
 * @param {Object} communities - Community data from state
 * @param {number[]} queryEmbedding - Embedding of current context
 * @param {number} tokenBudget - Max tokens for world context (default: 2000)
 * @returns {{ text: string, communityIds: string[] }}
 */
export function retrieveWorldContext(communities, queryEmbedding, tokenBudget = 2000) {
    if (!communities || !queryEmbedding) {
        return { text: '', communityIds: [] };
    }

    // Score communities by cosine similarity
    const scored = [];
    for (const [id, community] of Object.entries(communities)) {
        if (!community.embedding || community.embedding.length === 0) continue;
        const score = cosineSimilarity(queryEmbedding, community.embedding);
        scored.push({ id, community, score });
    }

    if (scored.length === 0) {
        return { text: '', communityIds: [] };
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Select communities within token budget
    const selected = [];
    let usedTokens = 0;

    for (const { id, community } of scored) {
        const entry = formatCommunityEntry(community);
        const tokens = estimateTokens(entry);
        if (usedTokens + tokens > tokenBudget) break;
        selected.push({ id, entry });
        usedTokens += tokens;
    }

    if (selected.length === 0) {
        return { text: '', communityIds: [] };
    }

    const text = '<world_context>\n' +
        selected.map(s => s.entry).join('\n\n') +
        '\n</world_context>';

    return {
        text,
        communityIds: selected.map(s => s.id),
    };
}

/**
 * Format a community summary for prompt injection.
 * @param {Object} community
 * @returns {string}
 */
function formatCommunityEntry(community) {
    const findings = community.findings
        ? community.findings.map(f => `  - ${f}`).join('\n')
        : '';
    return `## ${community.title}\n${community.summary}${findings ? '\nKey findings:\n' + findings : ''}`;
}
