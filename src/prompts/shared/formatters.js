/**
 * Shared formatters for prompt construction.
 *
 * Language resolution, system prompt assembly, message building, context formatting.
 */

import { sortMemoriesBySequence } from '../../utils/text.js';
import { formatExamples } from './format-examples.js';
import { SYSTEM_PREAMBLE_CN } from './preambles.js';
import { MIRROR_LANGUAGE_RULES } from './rules.js';

// =============================================================================
// EXECUTION TRIGGER
// =============================================================================

/**
 * Positive output format instruction placed at the end of every user prompt.
 * Replaces negative "do not use tool calls" constraints with affirmative framing.
 */
export const EXECUTION_TRIGGER = `OUTPUT FORMAT: Write your reasoning in plain text inside <think> tags, then output a single raw JSON object immediately after. No tool calls, no function wrappers, no markdown code blocks.`;

// =============================================================================
// LANGUAGE RESOLUTION
// =============================================================================

const LANG_INSTRUCTION_RU =
    '\nIMPORTANT — LANGUAGE: Write ALL output string values (summaries, descriptions, emotions, relationship impacts) in Russian. JSON keys stay English. EXCEPTION: Character names MUST stay in their original script exactly as written — do NOT transliterate.\n';

const LANG_INSTRUCTION_EN =
    '\nIMPORTANT — LANGUAGE: Write ALL output string values (summaries, descriptions, emotions, relationship impacts) in English. JSON keys stay English. EXCEPTION: Character names MUST stay in their original script exactly as written — do NOT transliterate.\n';

const LANG_INSTRUCTION_MIRROR =
    '\nIMPORTANT — LANGUAGE: The text above is NOT in English. Per Language Rules, ALL output string values (summaries, descriptions, emotions, relationship impacts) MUST be in the SAME language as the narrative text. Do NOT translate to English. JSON keys stay English. EXCEPTION: Character names MUST stay in their original script exactly as written — do NOT transliterate.\n';

/**
 * Resolve the language instruction for a prompt's user message.
 * In forced mode ('en'/'ru'), returns a deterministic instruction.
 * In 'auto' mode, uses heuristic detection on the text to add a reminder for non-Latin scripts.
 * @param {string} text - The text to analyze (used only in 'auto' mode)
 * @param {'auto'|'en'|'ru'} outputLanguage - The output language setting
 * @returns {string} Language instruction string (may be empty)
 */
export function resolveLanguageInstruction(text, outputLanguage) {
    if (outputLanguage === 'ru') return LANG_INSTRUCTION_RU;
    if (outputLanguage === 'en') return LANG_INSTRUCTION_EN;

    // 'auto' mode — heuristic detection for non-Latin scripts
    if (!text) return '';
    const sample = text.slice(0, 2000);
    const allLetters = sample.match(/\p{L}/gu) || [];
    const latinLetters = allLetters.filter((c) => /[a-zA-Z]/.test(c)).length;
    const nonLatinLetters = allLetters.length - latinLetters;
    if (nonLatinLetters > latinLetters * 0.5) {
        return LANG_INSTRUCTION_MIRROR;
    }
    return '';
}

// =============================================================================
// SYSTEM PROMPT ASSEMBLY
// =============================================================================

/**
 * Assemble a system prompt with role and examples only.
 * Schema, rules, and language constraints have moved to the user prompt
 * (via assembleUserConstraints) to defeat recency bias in mid-tier models.
 *
 * @param {Object} opts
 * @param {string} opts.role - Role definition text
 * @param {Array} opts.examples - Few-shot example objects
 * @param {'auto'|'en'|'ru'} [opts.outputLanguage='auto'] - Language filter for examples
 * @returns {string} System prompt (role + examples)
 */
export function assembleSystemPrompt({ role, examples, outputLanguage = 'auto' }) {
    const parts = [`<role>\n${role}\n</role>`];
    const examplesStr = formatExamples(examples, outputLanguage);
    if (examplesStr) parts.push(`<examples>\n${examplesStr}\n</examples>`);
    return parts.join('\n\n');
}

/**
 * Assemble the user-prompt constraint block (placed AFTER messages, before prefill).
 * Orders: language_rules → dynamic instruction → task_rules → output_schema → execution_trigger.
 *
 * @param {Object} opts
 * @param {string} opts.schema - Output schema text
 * @param {string} [opts.rules] - Task-specific rules
 * @param {string} [opts.languageInstruction=''] - Dynamic language instruction from resolveLanguageInstruction
 * @returns {string} Constraint block to append to user prompt
 */
export function assembleUserConstraints({ schema, rules, languageInstruction = '' }) {
    const parts = [MIRROR_LANGUAGE_RULES];
    if (languageInstruction) parts.push(languageInstruction);
    if (rules) parts.push(`<task_rules>\n${rules}\n</task_rules>`);
    parts.push(`<output_schema>\n${schema}\n</output_schema>`);
    parts.push(EXECUTION_TRIGGER);
    return parts.join('\n\n');
}

// =============================================================================
// MESSAGE ASSEMBLY
// =============================================================================

/**
 * Wrap system prompt with preamble and build message array with assistant prefill.
 * @param {string} systemPrompt - The task-specific system prompt
 * @param {string} userPrompt - The user message
 * @param {string} [assistantPrefill='{'] - Assistant prefill to bias toward output mode
 * @param {string} [preamble=SYSTEM_PREAMBLE_CN] - System preamble to prepend
 * @returns {Array<{role: string, content: string}>}
 */
export function buildMessages(systemPrompt, userPrompt, assistantPrefill = '{', preamble = SYSTEM_PREAMBLE_CN) {
    const msgs = [
        { role: 'system', content: `${preamble}\n\n${systemPrompt}` },
        { role: 'user', content: userPrompt },
    ];
    if (assistantPrefill) {
        msgs.push({ role: 'assistant', content: assistantPrefill });
    }
    return msgs;
}

// =============================================================================
// CONTEXT FORMATTING
// =============================================================================

/**
 * Format existing memories as an XML section for dedup context.
 * @param {Object[]} existingMemories
 * @returns {string}
 */
export function formatEstablishedMemories(existingMemories) {
    if (!existingMemories?.length) return '';
    const memorySummaries = sortMemoriesBySequence(existingMemories, true)
        .map((m, i) => `${i + 1}. [${m.importance} Star] ${m.summary}`)
        .join('\n');
    return `<established_memories>\n${memorySummaries}\n</established_memories>`;
}

/**
 * Format character descriptions as an XML section.
 * @param {string} characterName
 * @param {string} userName
 * @param {string} characterDescription
 * @param {string} personaDescription
 * @returns {string}
 */
export function formatCharacters(characterName, userName, characterDescription, personaDescription) {
    userName = userName || 'User';
    characterName = characterName || 'Character';
    if (characterDescription || personaDescription) {
        const parts = ['<characters>'];
        if (characterDescription) {
            parts.push(`<character name="${characterName}" role="main">\n${characterDescription}\n</character>`);
        }
        if (personaDescription) {
            parts.push(`<character name="${userName}" role="user">\n${personaDescription}\n</character>`);
        }
        parts.push('</characters>');
        return parts.join('\n');
    }

    return `<characters>\n<character name="${characterName}" role="main"/>\n<character name="${userName}" role="user"/>\n</characters>`;
}
