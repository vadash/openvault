/**
 * Community summarization and global synthesis prompt builders.
 */

/** @typedef {import('../../types.d.ts').CommunitySummaryParams} CommunitySummaryParams */
/** @typedef {import('../../types.d.ts').GlobalSynthesisParams} GlobalSynthesisParams */
/** @typedef {import('../../types.d.ts').LLMMessages} LLMMessages */

import {
    assembleSystemPrompt,
    assembleUserConstraints,
    buildMessages,
    resolveLanguageInstruction,
} from '../shared/formatters.js';
import { getExamples } from './examples/index.js';
import { COMMUNITIES_ROLE, GLOBAL_SYNTHESIS_ROLE } from './role.js';
import { COMMUNITY_RULES, GLOBAL_SYNTHESIS_RULES } from './rules.js';
import { COMMUNITY_SCHEMA, GLOBAL_SYNTHESIS_SCHEMA } from './schema.js';

/**
 * Build the community summarization prompt.
 * @param {string[]} nodeLines - Formatted node descriptions
 * @param {string[]} edgeLines - Formatted edge descriptions
 * @param {string} preamble - System prompt preamble
 * @param {'auto'|'en'|'ru'} outputLanguage - Output language (default: 'auto')
 * @param {string} prefill - Assistant prefill text (required)
 * @returns {LLMMessages} Array of {role, content} message objects
 */
export function buildCommunitySummaryPrompt(nodeLines, edgeLines, preamble, outputLanguage = 'auto', prefill) {
    if (!prefill) {
        throw new Error('buildCommunitySummaryPrompt: prefill is required');
    }
    const systemPrompt = assembleSystemPrompt({
        role: COMMUNITIES_ROLE,
        examples: getExamples('COMMUNITIES', outputLanguage),
        outputLanguage,
    });

    const entityText = nodeLines.join('\n');
    const languageInstruction = resolveLanguageInstruction(entityText, outputLanguage);
    const constraints = assembleUserConstraints({
        rules: COMMUNITY_RULES,
        schema: COMMUNITY_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `<community_entities>
${entityText}
</community_entities>

<community_relationships>
${edgeLines.join('\n')}
</community_relationships>

Write a comprehensive report about this community of entities.

${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}

/**
 * Build the global world state synthesis prompt.
 * @param {import('../../types.d.ts').CommunitySummary[]} communities - Community summaries to synthesize
 * @param {string} preamble - System prompt preamble
 * @param {'auto'|'en'|'ru'} outputLanguage - Output language (default: 'auto')
 * @param {string} prefill - Assistant prefill text (required)
 * @returns {LLMMessages} Array of {role, content} message objects
 */
export function buildGlobalSynthesisPrompt(communities, preamble, outputLanguage = 'auto', prefill) {
    if (!prefill) {
        throw new Error('buildGlobalSynthesisPrompt: prefill is required');
    }

    const systemPrompt = assembleSystemPrompt({
        role: GLOBAL_SYNTHESIS_ROLE,
        examples: getExamples('GLOBAL_SYNTHESIS', outputLanguage),
        outputLanguage,
    });

    const communityText = communities
        .map(
            (c, i) =>
                `${i + 1}. ${c.title}\n${c.summary}${c.findings?.length ? '\nKey findings: ' + c.findings.join('; ') : ''}`
        )
        .join('\n\n');

    const languageInstruction = resolveLanguageInstruction(communityText, outputLanguage);
    const constraints = assembleUserConstraints({
        rules: GLOBAL_SYNTHESIS_RULES,
        schema: GLOBAL_SYNTHESIS_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `<communities>
${communityText}
</communities>

Synthesize these community summaries into a single global narrative (max ~300 tokens).
Focus on macro-relationships, overarching tensions, and plot trajectory.

${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}
