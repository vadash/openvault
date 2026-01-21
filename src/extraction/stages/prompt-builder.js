/**
 * OpenVault Extraction Pipeline - Stage 2: Prompt Building
 *
 * Builds the extraction prompt from messages and context.
 * Pure function - easy to test.
 */

import { buildExtractionPrompt } from '../../prompts.js';
import { selectMemoriesForExtraction } from '../context-builder.js';
import { estimateTokens } from '../../utils.js';

/**
 * Build extraction prompt from messages and context
 * @param {Array} messages - Messages to extract from
 * @param {Object} context - Deps context (names, descriptions, etc)
 * @param {Object} data - OpenVault data object (for existing memories)
 * @param {Object} settings - Extension settings
 * @returns {string} The extraction prompt
 */
export function buildPrompt(messages, context, data, settings) {
    const characterName = context.name2;
    const userName = context.name1;

    // Format messages into text
    const messagesText = messages.map(m => {
        const speaker = m.is_user ? userName : (m.name || characterName);
        return `[${speaker}]: ${m.mes}`;
    }).join('\n\n');

    // Select relevant memories using hybrid recency/importance strategy
    const existingMemories = selectMemoriesForExtraction(data, settings);

    // Get character description from character card
    const characterDescription = context.characters?.[context.characterId]?.description || '';

    // Get persona description
    const personaDescription = context.powerUserSettings?.persona_description || '';

    const prompt = buildExtractionPrompt({
        messages: messagesText,
        names: { char: characterName, user: userName },
        context: {
            memories: existingMemories,
            charDesc: characterDescription,
            personaDesc: personaDescription,
        },
    });

    // DIAGNOSTIC: Log full prompt size
    const promptTokens = estimateTokens(prompt);
    console.error(`[OpenVault DIAGNOSTIC] Full prompt size: ${promptTokens} tokens`);
    console.error(`  Messages: ${messages.length}, Memories: ${existingMemories.length}`);
    console.error(`  Char desc: ${estimateTokens(characterDescription)} tokens, Persona: ${estimateTokens(personaDescription)} tokens`);

    return prompt;
}
