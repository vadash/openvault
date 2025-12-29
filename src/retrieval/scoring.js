/**
 * OpenVault Memory Scoring
 *
 * Algorithms for selecting relevant memories for retrieval.
 */

import { extension_settings } from '../../../../../extensions.js';
import { log, parseJsonFromMarkdown } from '../utils.js';
import { extensionName, SCORING_WEIGHTS } from '../constants.js';
import { callLLMForRetrieval } from '../llm.js';

/**
 * Select relevant memories using simple scoring (fast mode)
 * @param {Object[]} memories - Available memories
 * @param {string} recentContext - Recent chat context
 * @param {string} characterName - POV character name
 * @param {string[]} activeCharacters - List of active characters
 * @param {number} limit - Maximum memories to return
 * @returns {Object[]} Selected memories
 */
export function selectRelevantMemoriesSimple(memories, recentContext, characterName, activeCharacters, limit) {
    // Simple relevance scoring based on:
    // 1. Importance (highest weight)
    // 2. Recency
    // 3. Character involvement
    // 4. Keyword matching

    const scored = memories.map(memory => {
        let score = 0;

        // Importance bonus (major factor: 0-20 points based on 1-5 scale)
        const importance = memory.importance || 3;
        score += importance * SCORING_WEIGHTS.IMPORTANCE_MULTIPLIER;

        // Recency bonus (newer = higher)
        const age = Date.now() - memory.created_at;
        const ageHours = age / (1000 * 60 * 60);
        score += Math.max(0, SCORING_WEIGHTS.RECENCY_MAX_POINTS - ageHours);

        // Character involvement bonus
        for (const char of activeCharacters) {
            if (memory.characters_involved?.includes(char)) score += SCORING_WEIGHTS.CHARACTER_INVOLVED;
            if (memory.witnesses?.includes(char)) score += SCORING_WEIGHTS.CHARACTER_WITNESS;
        }

        // Keyword matching (simple)
        const summaryLower = memory.summary?.toLowerCase() || '';
        const contextLower = recentContext.toLowerCase();
        const contextWords = contextLower.split(/\s+/).filter(w => w.length > 3);

        for (const word of contextWords) {
            if (summaryLower.includes(word)) score += SCORING_WEIGHTS.KEYWORD_MATCH;
        }

        // Event type bonus
        if (memory.event_type === 'revelation') score += SCORING_WEIGHTS.EVENT_TYPE_REVELATION;
        if (memory.event_type === 'relationship_change') score += SCORING_WEIGHTS.EVENT_TYPE_RELATIONSHIP;

        return { memory, score };
    });

    // Sort by score and take top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.memory);
}

/**
 * Select relevant memories using LLM (smart mode)
 * @param {Object[]} memories - Available memories to select from
 * @param {string} recentContext - Recent chat context
 * @param {string} characterName - POV character name
 * @param {number} limit - Maximum memories to select
 * @returns {Promise<Object[]>} - Selected memories
 */
export async function selectRelevantMemoriesSmart(memories, recentContext, characterName, limit) {
    if (memories.length === 0) return [];
    if (memories.length <= limit) return memories; // No need to select if we have few enough

    log(`Smart retrieval: analyzing ${memories.length} memories to select ${limit} most relevant`);

    // Build numbered list of memories with importance
    const numberedList = memories.map((m, i) => {
        const typeTag = `[${m.event_type || 'event'}]`;
        const importance = m.importance || 3;
        const importanceTag = `[\u2605${'\u2605'.repeat(importance - 1)}]`; // Show 1-5 stars
        const secretTag = m.is_secret ? '[Secret] ' : '';
        return `${i + 1}. ${typeTag} ${importanceTag} ${secretTag}${m.summary}`;
    }).join('\n');

    const prompt = `You are a narrative memory analyzer. Given the current roleplay scene and a list of available memories, select which memories are most relevant for the AI to reference in its response.

CURRENT SCENE:
${recentContext}

AVAILABLE MEMORIES (numbered):
${numberedList}

[Task]: Select up to ${limit} memories that would be most useful for ${characterName} to know for the current scene. Consider:
- Importance level (\u2605 to \u2605\u2605\u2605\u2605\u2605) - higher importance events are more critical to the story
- Direct relevance to current conversation topics
- Character relationships being discussed
- Background context that explains current situations
- Emotional continuity
- Secrets the character knows

[Return]: JSON object with selected memory numbers (1-indexed) and brief reasoning:
{"selected": [1, 4, 7], "reasoning": "Brief explanation of why these memories are relevant"}

Only return valid JSON, no markdown formatting.`;

    try {
        // Call LLM for retrieval (uses retrieval profile, separate from extraction)
        const response = await callLLMForRetrieval(prompt);

        // Parse the response
        let parsed;
        try {
            parsed = parseJsonFromMarkdown(response);
        } catch (parseError) {
            log(`Smart retrieval: Failed to parse LLM response, falling back to simple mode. Error: ${parseError.message}`);
            return selectRelevantMemoriesSimple(memories, recentContext, characterName, [], limit);
        }

        // Extract selected indices
        const selectedIndices = parsed.selected || [];
        if (!Array.isArray(selectedIndices) || selectedIndices.length === 0) {
            log('Smart retrieval: No memories selected by LLM, falling back to simple mode');
            return selectRelevantMemoriesSimple(memories, recentContext, characterName, [], limit);
        }

        // Convert 1-indexed to 0-indexed and filter valid indices
        const selectedMemories = selectedIndices
            .map(i => memories[i - 1]) // Convert to 0-indexed
            .filter(m => m !== undefined);

        if (selectedMemories.length === 0) {
            log('Smart retrieval: Invalid indices from LLM, falling back to simple mode');
            return selectRelevantMemoriesSimple(memories, recentContext, characterName, [], limit);
        }

        log(`Smart retrieval: LLM selected ${selectedMemories.length} memories. Reasoning: ${parsed.reasoning || 'none provided'}`);
        return selectedMemories;
    } catch (error) {
        log(`Smart retrieval error: ${error.message}, falling back to simple mode`);
        return selectRelevantMemoriesSimple(memories, recentContext, characterName, [], limit);
    }
}

/**
 * Select relevant memories using LLM or simple matching (dispatcher)
 * Uses smart retrieval if enabled in settings
 * @param {Object[]} memories - Available memories
 * @param {string} recentContext - Recent chat context
 * @param {string} characterName - POV character name
 * @param {string[]} activeCharacters - List of active characters
 * @param {number} limit - Maximum memories to return
 * @returns {Promise<Object[]>} Selected memories
 */
export async function selectRelevantMemories(memories, recentContext, characterName, activeCharacters, limit) {
    const settings = extension_settings[extensionName];

    if (settings.smartRetrievalEnabled) {
        return selectRelevantMemoriesSmart(memories, recentContext, characterName, limit);
    } else {
        return selectRelevantMemoriesSimple(memories, recentContext, characterName, activeCharacters, limit);
    }
}
