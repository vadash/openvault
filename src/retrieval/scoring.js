/**
 * OpenVault Memory Scoring
 *
 * Algorithms for selecting relevant memories for retrieval.
 */

import { getContext, extension_settings } from '../../../../../extensions.js';
import { ConnectionManagerRequestService } from '../../../../shared.js';
import { log, showToast } from '../utils.js';
import { extensionName } from '../constants.js';

/**
 * Call LLM for retrieval using ConnectionManagerRequestService
 * Uses the retrieval profile setting (separate from extraction profile)
 * @param {string} prompt - The retrieval prompt
 * @returns {Promise<string>} The LLM response content
 * @throws {Error} If the LLM call fails or no profile is available
 */
async function callLLMForRetrieval(prompt) {
    const settings = extension_settings[extensionName];

    // Get profile ID - use retrieval profile or fall back to currently selected profile
    let profileId = settings.retrievalProfile;

    // If no profile specified, use the currently selected profile
    if (!profileId) {
        profileId = extension_settings?.connectionManager?.selectedProfile;
        if (profileId) {
            const profiles = extension_settings?.connectionManager?.profiles || [];
            const profile = profiles.find(p => p.id === profileId);
            log(`No retrieval profile set, using current profile: ${profile?.name || profileId}`);
        }
    }

    if (!profileId) {
        throw new Error('No connection profile available for retrieval. Please configure a profile in Connection Manager.');
    }

    try {
        log(`Using ConnectionManagerRequestService for retrieval with profile: ${profileId}`);

        // Build messages array
        const messages = [
            {
                role: 'system',
                content: 'You are a helpful assistant that analyzes memories for relevance. Always respond with valid JSON only, no markdown formatting.'
            },
            { role: 'user', content: prompt }
        ];

        // Send request via ConnectionManagerRequestService
        const result = await ConnectionManagerRequestService.sendRequest(
            profileId,
            messages,
            1000, // max tokens (retrieval needs less than extraction)
            {
                includePreset: true,
                includeInstruct: true,
                stream: false
            },
            {} // override payload
        );

        // Extract content from response
        const content = result?.content || result || '';

        if (!content) {
            throw new Error('Empty response from LLM');
        }

        // Parse reasoning if present (some models return thinking tags)
        const context = getContext();
        if (context.parseReasoningFromString) {
            const parsed = context.parseReasoningFromString(content);
            return parsed ? parsed.content : content;
        }

        return content;
    } catch (error) {
        const errorMessage = error.message || 'Unknown error';
        log(`Retrieval LLM call error: ${errorMessage}`);
        showToast('error', `Smart retrieval failed: ${errorMessage}`);
        throw error;
    }
}

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
        score += importance * 4; // 4, 8, 12, 16, 20 points

        // Recency bonus (newer = higher)
        const age = Date.now() - memory.created_at;
        const ageHours = age / (1000 * 60 * 60);
        score += Math.max(0, 10 - ageHours); // Up to 10 points for recent

        // Character involvement bonus
        for (const char of activeCharacters) {
            if (memory.characters_involved?.includes(char)) score += 5;
            if (memory.witnesses?.includes(char)) score += 3;
        }

        // Keyword matching (simple)
        const summaryLower = memory.summary?.toLowerCase() || '';
        const contextLower = recentContext.toLowerCase();
        const contextWords = contextLower.split(/\s+/).filter(w => w.length > 3);

        for (const word of contextWords) {
            if (summaryLower.includes(word)) score += 1;
        }

        // Event type bonus
        if (memory.event_type === 'revelation') score += 3;
        if (memory.event_type === 'relationship_change') score += 2;

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
            // Handle potential markdown code blocks
            let cleaned = response;
            const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                cleaned = jsonMatch[1];
            }
            parsed = JSON.parse(cleaned.trim());
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
