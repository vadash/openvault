/**
 * Global world state synthesis prompt builder.
 */

/** @typedef {import('../../../types.d.ts').LLMMessages} LLMMessages */

import {
    assembleSystemPrompt,
    assembleUserConstraints,
    buildMessages,
    resolveLanguageInstruction,
} from '../shared/formatters.js';
import { getWorldStateExamples } from './examples/index.js';
import { WORLD_STATE_ROLE } from './role.js';
import { WORLD_STATE_RULES } from './rules.js';
import { WORLD_STATE_SCHEMA } from './schema.js';

/**
 * Build the global world state synthesis prompt.
 * @param {{ name: string, type: string, description: string, mentions: number }[]} entities - Top entities from selectTopEntities
 * @param {{ source: string, target: string, sourceType: string, targetType: string, description: string, weight: number }[]} edges - Intra-set edges from selectTopEntities
 * @param {string} preamble - System prompt preamble
 * @param {'auto'|'en'|'ru'} [outputLanguage='auto'] - Output language
 * @param {string} [prefill='<thinking>\n'] - Assistant prefill text
 * @returns {LLMMessages} Array of {role, content} message objects
 */
export function buildGlobalWorldStatePrompt(
    entities,
    edges,
    preamble,
    outputLanguage = 'auto',
    prefill = '<thinking>\n'
) {
    const systemPrompt = assembleSystemPrompt({
        role: WORLD_STATE_ROLE,
        examples: getWorldStateExamples(outputLanguage),
        outputLanguage,
    });

    const entityText = entities
        .map((e) => `- ${e.name} (${e.type}): ${e.description} [Mentions: ${e.mentions}]`)
        .join('\n');
    const edgeText = edges.map((e) => `- ${e.source} → ${e.target}: ${e.description} [Weight: ${e.weight}]`).join('\n');

    const languageInstruction = resolveLanguageInstruction(entityText, outputLanguage);
    const constraints = assembleUserConstraints({
        rules: WORLD_STATE_RULES,
        schema: WORLD_STATE_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `<world_entities>
${entityText}
</world_entities>

<world_relationships>
${edgeText}
</world_relationships>

Write a comprehensive report about the current world state based on these top entities and relationships.

${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill || '', preamble);
}
