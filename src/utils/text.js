import { jsonrepair } from 'https://esm.sh/jsonrepair';
import { logError, logWarn } from './logging.js';
import { countTokens } from './tokens.js';

/**
 * Slice memories array to fit within a token budget
 * @param {Object[]} memories - Array of memory objects with summary field
 * @param {number} tokenBudget - Maximum tokens to include
 * @returns {Object[]} Sliced memories array that fits within budget
 */
export function sliceToTokenBudget(memories, tokenBudget) {
    if (!memories || memories.length === 0) return [];
    if (!tokenBudget || tokenBudget <= 0) return [];

    const result = [];
    let totalTokens = 0;

    for (const memory of memories) {
        const memoryTokens = countTokens(memory.summary);
        if (totalTokens + memoryTokens > tokenBudget) {
            break;
        }
        result.push(memory);
        totalTokens += memoryTokens;
    }

    return result;
}

/**
 * Strip thinking/reasoning tags from LLM response
 * @param {string} text - Raw LLM response text
 * @returns {string} Text with thinking tags removed
 */
export function stripThinkingTags(text) {
    if (typeof text !== 'string') return text;
    return (
        text
            // Paired XML tags: <think>...</think>, <thinking>...</thinking>, etc.
            .replace(/<(think|thinking|thought|reasoning|reflection)>[\s\S]*?<\/\1>/gi, '')
            // Paired bracket tags: [THINK]...[/THINK], etc.
            .replace(/\[(THINK|THOUGHT|REASONING)\][\s\S]*?\[\/\1\]/gi, '')
            .replace(/\*thinks?:[\s\S]*?\*/gi, '')
            .replace(/\(thinking:[\s\S]*?\)/gi, '')
            // Orphaned closing tags (opening tag was in assistant prefill)
            .replace(/^[\s\S]*?<\/(think|thinking|thought|reasoning)>\s*/i, '')
            .trim()
    );
}

/**
 * Extract the first balanced JSON object or array from a string.
 * Uses bracket counting to correctly handle nested structures.
 * @param {string} str - Input string potentially containing JSON
 * @returns {string|null} Extracted JSON substring or null
 */
function extractBalancedJSON(str) {
    const startIdx = str.search(/[[{]/);
    if (startIdx === -1) return null;

    const open = str[startIdx];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let isEscaped = false;

    for (let i = startIdx; i < str.length; i++) {
        const ch = str[i];
        if (isEscaped) {
            isEscaped = false;
            continue;
        }
        if (ch === '\\' && inString) {
            isEscaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return str.slice(startIdx, i + 1);
        }
    }
    return null;
}

/**
 * Safely parse JSON, handling markdown code blocks and malformed JSON
 * @param {string} input - Raw JSON string potentially wrapped in markdown
 * @returns {any} Parsed JSON object/array, or null on failure
 */
export function safeParseJSON(input) {
    try {
        let cleanedInput = stripThinkingTags(input);

        // Strip markdown code fences
        const codeBlockMatch = cleanedInput.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (codeBlockMatch) {
            cleanedInput = codeBlockMatch[1].trim();
        }

        // Extract JSON using bracket balancing to handle nested structures
        const extracted = extractBalancedJSON(cleanedInput);
        if (extracted) {
            cleanedInput = extracted;
        }

        const repaired = jsonrepair(cleanedInput);
        const parsed = JSON.parse(repaired);

        if (parsed === null || typeof parsed !== 'object') {
            logError('JSON parse returned non-object/array', null, {
                type: typeof parsed,
                rawInput: input.slice(0, 500),
            });
            return null;
        }

        // Graceful array recovery - if LLM returned a bare array of events
        if (Array.isArray(parsed)) {
            logWarn('LLM returned array instead of object, applying recovery wrapper');
            return {
                events: parsed,
                entities: [],
                relationships: [],
                reasoning: null,
            };
        }

        return parsed;
    } catch (e) {
        logError('JSON parse failed', e, { rawInput: input.slice(0, 2000) });
        return null;
    }
}

/**
 * Sort memories by sequence number or creation time
 * @param {Object[]} memories - Array of memory objects
 * @param {boolean} ascending - Sort ascending (oldest first) or descending (newest first)
 * @returns {Object[]} Sorted copy of memories array
 */
export function sortMemoriesBySequence(memories, ascending = true) {
    return [...memories].sort((a, b) => {
        const seqA = a.sequence ?? a.created_at ?? 0;
        const seqB = b.sequence ?? b.created_at ?? 0;
        return ascending ? seqA - seqB : seqB - seqA;
    });
}
