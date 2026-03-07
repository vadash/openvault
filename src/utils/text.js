import { jsonrepair } from 'https://esm.sh/jsonrepair';
import { getDeps } from '../deps.js';
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
    return text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
        .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '')
        .replace(/\[THOUGHT\][\s\S]*?\[\/THOUGHT\]/gi, '')
        .replace(/\[REASONING\][\s\S]*?\[\/REASONING\]/gi, '')
        .replace(/\*thinks?:[\s\S]*?\*/gi, '')
        .replace(/\(thinking:[\s\S]*?\)/gi, '')
        .trim();
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
            getDeps().console.error('[OpenVault] JSON Parse returned non-object/array:', typeof parsed);
            getDeps().console.error('[OpenVault] Raw LLM response:', input);
            return null;
        }

        // Graceful array recovery - if LLM returned a bare array of events
        if (Array.isArray(parsed)) {
            getDeps().console.warn('[OpenVault] LLM returned array instead of object, applying recovery wrapper');
            return {
                events: parsed,
                entities: [],
                relationships: [],
                reasoning: null,
            };
        }

        return parsed;
    } catch (e) {
        getDeps().console.error('[OpenVault] JSON Parse failed', e);
        getDeps().console.error('[OpenVault] Raw LLM response:', input);
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
