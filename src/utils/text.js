/**
 * OpenVault Text Utilities
 *
 * Text processing, token estimation, and JSON parsing utilities.
 */

import { getDeps } from '../deps.js';
import { jsonrepair } from '../vendor/json-repair.js';

/**
 * Estimate token count for a text string
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
export function estimateTokens(text) {
    return Math.ceil((text || '').length / 3.5);
}

/**
 * Slice memories array to fit within a token budget
 * Does not truncate individual summaries - stops before budget is exceeded
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
        const memoryTokens = estimateTokens(memory.summary);
        if (totalTokens + memoryTokens > tokenBudget) {
            break; // Stop before exceeding budget
        }
        result.push(memory);
        totalTokens += memoryTokens;
    }

    return result;
}

/**
 * Safely parse JSON, handling markdown code blocks and malformed JSON
 * Uses json-repair library for robust parsing
 * @param {string} input - Raw JSON string potentially wrapped in markdown
 * @returns {any} Parsed JSON object/array, or null on failure
 */
export function safeParseJSON(input) {
    try {
        const repaired = jsonrepair(input);
        const parsed = JSON.parse(repaired);
        // Only accept objects and arrays - reject primitives (string, number, boolean, null)
        if (parsed === null || typeof parsed !== 'object') {
            getDeps().console.error('[OpenVault] JSON Parse returned non-object/array:', typeof parsed);
            getDeps().console.error('[OpenVault] Raw LLM response:', input);
            return null;
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
