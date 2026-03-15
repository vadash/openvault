/**
 * Event extraction prompt builder (Stage A).
 */

import {
    assembleSystemPrompt,
    buildMessages,
    formatCharacters,
    formatEstablishedMemories,
    resolveLanguageInstruction,
} from '../shared/formatters.js';
import { EVENT_ROLE } from './role.js';
import { EVENT_SCHEMA } from './schema.js';
import { EVENT_RULES } from './rules.js';
import { getExamples } from './examples/index.js';

/**
 * Build the event extraction prompt (Stage 1).
 * Extracts events only, not entities or relationships.
 * @returns {Array<{role: string, content: string}>} Array of message objects
 */
export function buildEventExtractionPrompt({
    messages,
    names,
    context = {},
    preamble,
    prefill,
    outputLanguage = 'auto',
}) {
    const { char: characterName, user: userName } = names;
    const {
        memories: existingMemories = [],
        charDesc: characterDescription = '',
        personaDesc: personaDescription = '',
    } = context;

    const systemPrompt = assembleSystemPrompt({
        role: EVENT_ROLE,
        schema: EVENT_SCHEMA,
        rules: EVENT_RULES,
        examples: getExamples(outputLanguage),
        outputLanguage,
    });

    const memoriesSection = formatEstablishedMemories(existingMemories);
    const charactersSection = formatCharacters(characterName, userName, characterDescription, personaDescription);
    const contextParts = [memoriesSection, charactersSection].filter(Boolean).join('\n');
    const contextSection = contextParts ? `<context>\n${contextParts}\n</context>\n` : '';

    const languageInstruction = resolveLanguageInstruction(messages, outputLanguage);
    const userPrompt = `${contextSection}
<messages>
${messages}
</messages>
${languageInstruction}
Analyze the messages above. Extract events only.
Use EXACT character names: ${characterName}, ${userName}. Never transliterate these names into another script.
Write your analysis inside <thinking> tags FIRST, then output the JSON object with "events" key. No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill ?? '<thinking>\n', preamble);
}
