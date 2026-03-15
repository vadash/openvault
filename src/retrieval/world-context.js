/**
 * OpenVault World Context Retrieval
 *
 * Retrieves relevant community summaries for injection into the prompt.
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
 * Retrieve the most relevant community summaries for the current context.
 * Now supports intent-based routing: macro queries use global state, local queries use vector search.
 *
 * @param {Object} communities - Community data from state
 * @param {Object|null} globalState - Pre-computed global world state
 * @param {string} userMessagesString - Concatenated user messages for intent detection
 * @param {Float32Array} queryEmbedding - Embedding of current context
 * @param {number} tokenBudget - Max tokens for world context (default: 2000)
 * @returns {{ text: string, communityIds: string[], isMacroIntent: boolean }}
 */
export function retrieveWorldContext(communities, globalState, userMessagesString, queryEmbedding, tokenBudget = 2000) {
    // Intent-based routing: check for macro intent first
    if (detectMacroIntent(userMessagesString) && globalState?.summary) {
        return {
            text: `<world_context>\n${globalState.summary}\n</world_context>`,
            communityIds: [],
            isMacroIntent: true,
        };
    }

    // Fall back to existing vector search logic
    if (!communities || !queryEmbedding) {
        return { text: '', communityIds: [], isMacroIntent: false };
    }

    // Score communities by cosine similarity
    const scored = [];
    for (const [id, community] of Object.entries(communities)) {
        if (!hasEmbedding(community)) continue;
        const score = cosineSimilarity(queryEmbedding, getEmbedding(community));
        scored.push({ id, community, score });
    }

    if (scored.length === 0) {
        return { text: '', communityIds: [], isMacroIntent: false };
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Select communities within token budget
    const selected = [];
    let usedTokens = 0;

    for (const { id, community } of scored) {
        const entry = formatCommunityEntry(community);
        const tokens = countTokens(entry);
        if (usedTokens + tokens > tokenBudget) break;
        selected.push({ id, entry });
        usedTokens += tokens;
    }

    if (selected.length === 0) {
        return { text: '', communityIds: [], isMacroIntent: false };
    }

    const text = '<world_context>\n' + selected.map((s) => s.entry).join('\n\n') + '\n</world_context>';

    return {
        text,
        communityIds: selected.map((s) => s.id),
        isMacroIntent: false,
    };
}

/**
 * Format a community summary for prompt injection.
 * @param {Object} community
 * @returns {string}
 */
function formatCommunityEntry(community) {
    const findings = community.findings ? community.findings.map((f) => `  - ${f}`).join('\n') : '';
    return `## ${community.title}\n${community.summary}${findings ? '\nKey findings:\n' + findings : ''}`;
}
