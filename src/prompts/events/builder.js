/**
 * Event extraction prompt builder (Stage A).
 */

/** @typedef {import('../../types.d.ts').BasePromptParams} BasePromptParams */
/** @typedef {import('../../types.d.ts').LLMMessages} LLMMessages */
/** @typedef {import('../../types.d.ts').PromptContext} PromptContext */

import {
    assembleSystemPrompt,
    assembleUserConstraints,
    buildMessages,
    formatCharacters,
    formatEstablishedMemories,
    resolveLanguageInstruction,
} from '../shared/formatters.js';
import { getExamples } from './examples/index.js';
import { EVENT_ROLE } from './role.js';
import { EVENT_RULES } from './rules.js';
import { EVENT_SCHEMA } from './schema.js';

/**
 * Build the event extraction prompt (Stage 1).
 * @param {BasePromptParams & {extractionContext?: {location: string | null, time: string | null}}} params - Prompt builder parameters
 * @returns {LLMMessages} Array of {role, content} message objects
 */
export function buildEventExtractionPrompt({
    messages,
    names,
    context = /** @type {PromptContext} */ ({}),
    preamble,
    prefill,
    outputLanguage = 'auto',
    extractionContext,
}) {
    const { char: characterName, user: userName } = names;
    const safeCharName = characterName || 'Character';
    const safeUserName = userName || 'User';
    const {
        memories: existingMemories = [],
        charDesc: characterDescription = '',
        personaDesc: personaDescription = '',
    } = context;

    const systemPrompt = assembleSystemPrompt({
        role: EVENT_ROLE,
        examples: getExamples(outputLanguage),
        outputLanguage,
    });

    const memoriesSection = formatEstablishedMemories(existingMemories);
    const charactersSection = formatCharacters(safeCharName, safeUserName, characterDescription, personaDescription);
    const contextParts = [memoriesSection, charactersSection].filter(Boolean).join('\n');
    const contextSection = contextParts ? `<context>\n${contextParts}\n</context>\n` : '';

    const extractionContextSection =
        extractionContext?.location || extractionContext?.time
            ? `<extraction_context>
Scene: ${extractionContext.location || 'Unknown location'}
Time: ${extractionContext.time || 'Unknown time'}
</extraction_context>\n`
            : '';

    const languageInstruction = resolveLanguageInstruction(messages, outputLanguage);
    const constraints = assembleUserConstraints({
        rules: EVENT_RULES,
        schema: EVENT_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `${contextSection}${extractionContextSection}
<messages>
${messages}
</messages>

Analyze the messages above. Extract events only.
Use EXACT character names: ${safeCharName}, ${safeUserName}. Never transliterate these names into another script.

${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill || '', preamble);
}
