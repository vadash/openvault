import { cdnImport } from './cdn.js';

const { jsonrepair } = await cdnImport('jsonrepair');

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
            // Paired XML tags: <think>...</think>, <tool_call>...</tool_call>, etc.
            // (?:s+[^>]*)? matches optional attributes like <tool_call name="extract_events">
            .replace(
                /<(think|thinking|thought|reasoning|reflection|tool_call|search)(?:\s+[^>]*)?>\s*[\s\S]*?<\/\1>/gi,
                ''
            )
            // Paired bracket tags: [THINK]...[/THINK], [TOOL_CALL]...[/TOOL_CALL], etc.
            .replace(/\[(THINK|THOUGHT|REASONING|TOOL_CALL)\][\s\S]*?\[\/\1\]/gi, '')
            .replace(/\*thinks?:[\s\S]*?\*/gi, '')
            .replace(/\(thinking:[\s\S]*?\)/gi, '')
            // Orphaned closing tags (opening tag was in assistant prefill)
            .replace(/^[\s\S]*?<\/(think|thinking|thought|reasoning|tool_call|search)>\s*/i, '')
            .trim()
    );
}

/**
 * Extract the LAST balanced JSON object or array from a string.
 * Scans all balanced blocks and returns the final one found.
 *
 * Why "Last"? LLMs output reasoning and hallucinated <tool_call> snippets
 * BEFORE the actual payload. The real JSON is always the last complete block.
 *
 * @param {string} str - Input string potentially containing JSON
 * @returns {string|null} Extracted JSON substring or null
 */
function extractBalancedJSON(str) {
    let lastMatch = null;
    let searchFrom = 0;

    while (searchFrom < str.length) {
        // Find next opening bracket
        let startIdx = -1;
        for (let i = searchFrom; i < str.length; i++) {
            if (str[i] === '{' || str[i] === '[') {
                startIdx = i;
                break;
            }
        }

        if (startIdx === -1) break;

        const open = str[startIdx];
        const close = open === '{' ? '}' : ']';
        let depth = 0;
        let inString = false;
        let isEscaped = false;
        let endIdx = -1;

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

            if (ch === open) {
                depth++;
            } else if (ch === close) {
                depth--;
                if (depth === 0) {
                    endIdx = i;
                    break;
                }
            }
        }

        if (endIdx !== -1) {
            lastMatch = str.slice(startIdx, endIdx + 1);
            searchFrom = endIdx + 1; // Continue searching for later blocks
        } else {
            // Unbalanced — skip past this opening bracket and try again
            searchFrom = startIdx + 1;
        }
    }

    return lastMatch;
}

/**
 * Safely parse JSON, handling markdown code blocks and malformed LLM syntax
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

        // Extract the LAST balanced block to dodge tool_call hallucinations
        const extracted = extractBalancedJSON(cleanedInput);
        if (extracted) {
            cleanedInput = extracted;
        }

        // --- LLM SYNTAX HALLUCINATION SANITIZER ---
        // Negative lookbehinds (?<!\\) ensure we don't accidentally remove escaped quotes inside valid strings.
        // Matches both standard (+) and full-width (＋) Chinese plus signs.

        // 1. Mid-string concatenation across newlines: "text" +\n "more" -> "textmore"
        cleanedInput = cleanedInput.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*(?<!\\)(["'])/g, '');

        // 2. Dangling plus before punctuation/newlines: "text" + , -> "text" ,
        cleanedInput = cleanedInput.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*([,}\]])/g, '$1$2');

        // 3. Cut-off dangling plus at EOF or followed by whitespace/EOF: "text" + \n -> "text"
        cleanedInput = cleanedInput.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*$/g, '$1');

        // 4. Pad truncated outputs: odd number of unescaped " means an unclosed string
        const withoutEscapedQuotes = cleanedInput.replace(/\\"/g, '');
        const unescapedQuoteCount = (withoutEscapedQuotes.match(/"/g) || []).length;
        if (unescapedQuoteCount % 2 !== 0) {
            cleanedInput = cleanedInput + '"]}]}'; // Pad brackets, jsonrepair will untangle
        }

        // Pass sanitized string to repair library
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

/**
 * Get the effective position of a memory in the chat timeline
 * @param {Object} memory - Memory object
 * @returns {number} Position as message number
 */
export function getMemoryPosition(memory) {
    const msgIds = memory.message_ids || [];
    if (msgIds.length > 0) {
        const sum = msgIds.reduce((a, b) => a + b, 0);
        return Math.round(sum / msgIds.length);
    }
    if (memory.sequence) {
        return Math.floor(memory.sequence / 1000);
    }
    return 0;
}

// Narrative engine constants
const CURRENT_SCENE_SIZE = 100; // "Current Scene" = last 100 messages
const LEADING_UP_SIZE = 500; // "Leading Up" = messages 101-500 ago

/**
 * Assign memories to temporal buckets based on chat position
 * @param {Object[]} memories - Array of memory objects
 * @param {number} chatLength - Current chat length
 * @returns {Object} Object with old, mid, recent arrays
 */
export function assignMemoriesToBuckets(memories, chatLength) {
    const result = { old: [], mid: [], recent: [] };

    if (!memories || memories.length === 0) {
        return result;
    }

    // Fixed window thresholds
    const recentThreshold = Math.max(0, chatLength - CURRENT_SCENE_SIZE);
    const midThreshold = Math.max(0, chatLength - LEADING_UP_SIZE);

    for (const memory of memories) {
        const position = getMemoryPosition(memory);

        if (chatLength === 0 || position >= recentThreshold) {
            result.recent.push(memory);
        } else if (position >= midThreshold) {
            result.mid.push(memory);
        } else {
            result.old.push(memory);
        }
    }

    // Sort each bucket chronologically by sequence
    const sortBySequence = (a, b) => (a.sequence || 0) - (b.sequence || 0);
    result.old.sort(sortBySequence);
    result.mid.sort(sortBySequence);
    result.recent.sort(sortBySequence);

    return result;
}
