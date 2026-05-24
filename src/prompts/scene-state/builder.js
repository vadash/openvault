/**
 * Scene state extraction prompt builder.
 */

/** @typedef {import('../../../types.d.ts').LLMMessages} LLMMessages */

import {
    assembleSystemPrompt,
    assembleUserConstraints,
    buildMessages,
    resolveLanguageInstruction,
} from '../shared/formatters.js';
import { getSceneStateExamples } from './examples/index.js';
import { SCENE_STATE_ROLE } from './role.js';
import { SCENE_STATE_RULES } from './rules.js';
import { SCENE_STATE_SCHEMA } from './schema.js';

/**
 * Build the scene state extraction prompt.
 * @param {object|null} prevState - Previous scene state (null for cold start)
 * @param {string} messages - New message text to extract from
 * @param {'auto'|'en'|'ru'} [outputLanguage='auto'] - Output language
 * @param {string} [prefill='<thinking>\n'] - Assistant prefill text
 * @returns {LLMMessages} Array of {role, content} message objects
 */
export function buildSceneStatePrompt(prevState, messages, outputLanguage = 'auto', prefill = '<thinking>\n') {
    const systemPrompt = assembleSystemPrompt({
        role: SCENE_STATE_ROLE,
        examples: getSceneStateExamples(outputLanguage),
        outputLanguage,
    });

    const prevStateBlock = prevState
        ? `<previous_state>\n${JSON.stringify(prevState, null, 2)}\n</previous_state>`
        : '<previous_state>\nNo previous state — this is the first extraction.\n</previous_state>';

    const languageInstruction = resolveLanguageInstruction(messages, outputLanguage);
    const constraints = assembleUserConstraints({
        rules: SCENE_STATE_RULES,
        schema: SCENE_STATE_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `${prevStateBlock}

<new_messages>
${messages}
</new_messages>

Extract the current scene state from these messages.

${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill || '');
}
