/**
 * Graph extraction and edge consolidation prompt builders.
 */

/** @typedef {import('../../types.d.ts').GraphPromptParams} GraphPromptParams */
/** @typedef {import('../../types.d.ts').EdgeConsolidationParams} EdgeConsolidationParams */
/** @typedef {import('../../types.d.ts').LLMMessages} LLMMessages */
/** @typedef {import('../../types.d.ts').GraphEdge} GraphEdge */
/** @typedef {import('../../types.d.ts').PromptContext} PromptContext */

import {
    assembleSystemPrompt,
    assembleUserConstraints,
    buildMessages,
    formatCharacters,
    resolveLanguageInstruction,
} from '../shared/formatters.js';
import { getExamples } from './examples/index.js';
import { EDGE_CONSOLIDATION_ROLE, GRAPH_ROLE } from './role.js';
import { EDGE_CONSOLIDATION_RULES, GRAPH_RULES } from './rules.js';
import { EDGE_CONSOLIDATION_SCHEMA, GRAPH_SCHEMA } from './schema.js';

/**
 * Build the graph extraction prompt (Stage B).
 * @param {GraphPromptParams} params - Prompt builder parameters
 * @returns {LLMMessages} Array of {role, content} message objects
 */
export function buildGraphExtractionPrompt({
    messages,
    names,
    extractedEvents = [],
    context = /** @type {PromptContext} */ ({}),
    preamble,
    prefill,
    outputLanguage = 'auto',
}) {
    if (!prefill) {
        throw new Error('buildGraphExtractionPrompt: prefill is required');
    }
    const { char: characterName, user: userName } = names;
    const { charDesc: characterDescription = '', personaDesc: personaDescription = '' } = context;

    const systemPrompt = assembleSystemPrompt({
        role: GRAPH_ROLE,
        examples: getExamples(outputLanguage),
        outputLanguage,
    });

    const charactersSection = formatCharacters(characterName, userName, characterDescription, personaDescription);
    const contextSection = charactersSection ? `<context>\n${charactersSection}\n</context>\n` : '';
    const eventsSection =
        extractedEvents.length > 0 ? `<extracted_events>\n${extractedEvents.join('\n')}\n</extracted_events>\n` : '';

    const languageInstruction = resolveLanguageInstruction(messages, outputLanguage);
    const constraints = assembleUserConstraints({
        rules: GRAPH_RULES,
        schema: GRAPH_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `${contextSection}
<messages>
${messages}
</messages>

${eventsSection}Based on the messages${extractedEvents.length > 0 ? ' and extracted events above' : ''}, extract named entities and relationships.
Use EXACT character names: ${characterName}, ${userName}. Never transliterate these names into another script.

${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}

/**
 * Build the edge consolidation prompt.
 * @param {GraphEdge} edgeData - Edge to consolidate
 * @param {string} [preamble] - System prompt preamble
 * @param {'auto'|'en'|'ru'} [outputLanguage='auto'] - Output language
 * @param {string} [prefill] - Assistant prefill text (required at runtime, throws if missing)
 * @returns {LLMMessages} Array of {role, content} message objects
 */
export function buildEdgeConsolidationPrompt(edgeData, preamble, outputLanguage = 'auto', prefill) {
    if (!prefill) {
        throw new Error('buildEdgeConsolidationPrompt: prefill is required');
    }

    const systemPrompt = assembleSystemPrompt({
        role: EDGE_CONSOLIDATION_ROLE,
        examples: [],
        outputLanguage,
    });

    const segments = edgeData.description.split(' | ');
    const segmentText = segments.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const languageInstruction = resolveLanguageInstruction(segmentText, outputLanguage);
    const constraints = assembleUserConstraints({
        rules: EDGE_CONSOLIDATION_RULES,
        schema: EDGE_CONSOLIDATION_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `<edge_data>
Source: ${edgeData.source}
Target: ${edgeData.target}
Weight: ${edgeData.weight}

Timeline segments:
${segmentText}
</edge_data>

Synthesize these relationship developments into ONE unified description.

${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}
