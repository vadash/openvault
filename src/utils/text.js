import { cdnImport } from './cdn.js';

const { jsonrepair } = await cdnImport('jsonrepair');

import { GRAPH_JACCARD_DUPLICATE_THRESHOLD } from '../constants.js';
import { countTokens } from './tokens.js';

/**
 * Normalize text by fixing invisible characters and typographical anomalies.
 * - Strips unescaped control characters (\x00-\x1F), preserving \n, \r, \t
 * - Replaces smart/curly quotes with standard quotes
 * - Strips Unicode line/paragraph separators (\u2028, \u2029)
 *
 * @param {string} text - Input text to normalize
 * @returns {string} Normalized text
 */
export function normalizeText(text) {
    if (!text || typeof text !== 'string') return text;

    return (
        text
            // Replace smart double quotes
            .replace(/[""]/g, '"')
            // Replace smart single quotes
            .replace(/['']/g, "'")
            // Strip Unicode line/paragraph separators
            .replace(/[\u2028\u2029]/g, '')
            // Strip unescaped control characters (preserve \n \r \t)
            // biome-ignore lint: control character stripping is intentional
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    );
}

/**
 * Extract all balanced JSON blocks from a string.
 * Correctly handles strings, escape sequences, and nested structures.
 *
 * @param {string} text - Input text potentially containing JSON
 * @param {Object} options - Options
 * @param {number} options.minSize - Minimum block size (default: 0)
 * @returns {Array<{start: number, end: number, text: string, isObject: boolean}>}
 */
export function extractJsonBlocks(text, _options = {}) {
    if (!text || typeof text !== 'string') return [];

    const blocks = [];
    let i = 0;

    while (i < text.length) {
        // Find opening bracket
        if (text[i] !== '{' && text[i] !== '[') {
            i++;
            continue;
        }

        const startIdx = i;
        const openChar = text[i];
        const closeChar = openChar === '{' ? '}' : ']';
        let depth = 0;
        let inString = false;
        let stringDelim = null;
        let isEscaped = false;
        let foundEnd = false;

        while (i < text.length) {
            const ch = text[i];

            if (isEscaped) {
                isEscaped = false;
                i++;
                continue;
            }

            if (ch === '\\' && inString) {
                isEscaped = true;
                i++;
                continue;
            }

            // String delimiter handling
            if ((ch === '"' || ch === "'" || ch === '`') && !inString) {
                inString = true;
                stringDelim = ch;
                i++;
                continue;
            }

            if (ch === stringDelim && inString) {
                inString = false;
                stringDelim = null;
                i++;
                continue;
            }

            if (inString) {
                i++;
                continue;
            }

            // Bracket counting
            if (ch === openChar) {
                depth++;
            } else if (ch === closeChar) {
                depth--;
                if (depth === 0) {
                    foundEnd = true;
                    break;
                }
            }

            i++;
        }

        if (foundEnd) {
            const blockText = text.slice(startIdx, i + 1);
            blocks.push({
                start: startIdx,
                end: i,
                text: blockText,
                isObject: openChar === '{',
            });
            i++;
        } else {
            // Unbalanced - move past opening bracket and continue
            i = startIdx + 1;
        }
    }

    return blocks;
}

/**
 * Fix string concatenation hallucinations from LLMs.
 * Only runs at Tier 4 (desperation) - applies strict patterns to avoid
 * damaging valid content like mathematical expressions.
 *
 * @param {string} text - JSON string with potential concatenation issues
 * @returns {string} Text with concatenation fixed
 */
export function scrubConcatenation(text) {
    if (!text || typeof text !== 'string') return text;

    let result = text;

    // 1. Mid-string concatenation: "text" + "more" -> "textmore"
    // Match both standard (+) and full-width (＋) plus signs
    result = result.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*(?<!\\)(["'])/g, '');

    // 2. Multi-line concatenation: "text"\n+\n"more"
    result = result.replace(/(["'])\s*(?:\r?\n)+\s*[+＋]\s*(?:\r?\n)+\s*(["'])/g, '$1$2');
    result = result.replace(/(["'])\s*(?:\r?\n)+\s*[+＋]\s*(["'])/g, '$1$2');

    // 3. Dangling plus before punctuation: "text" + , -> "text" ,
    result = result.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*([,}\]])/g, '$1$2');

    // 4. Trailing dangling plus: "text" + -> "text"
    result = result.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*$/g, '$1');

    return result;
}

/**
 * Calculate Jaccard similarity between two token sets.
 * Returns ratio of intersection / union (0.0 to 1.0).
 *
 * @param {Set<string>|string[]|string} setA - First token set (or string to tokenize)
 * @param {Set<string>|string[]|string} setB - Second token set (or string to tokenize)
 * @param {Function|null} tokenizeFn - Optional tokenizer for string inputs
 * @returns {number} Jaccard similarity score (0.0 - 1.0)
 */
export function jaccardSimilarity(setA, setB, tokenizeFn = null) {
    // Convert strings to sets if tokenizer provided
    const toSet = (x) => {
        if (typeof x === 'string') {
            if (!tokenizeFn) {
                // Default tokenizer: simple, fast
                return new Set(
                    x
                        .toLowerCase()
                        .split(/[^\p{L}\p{N}]+/u)
                        .filter((t) => t.length >= 2)
                );
            }
            return new Set(tokenizeFn(x));
        }
        return x instanceof Set ? x : new Set(x);
    };

    const a = toSet(setA);
    const b = toSet(setB);

    if (a.size === 0 || b.size === 0) return 0;

    // Calculate intersection
    let intersection = 0;
    for (const token of a) {
        if (b.has(token)) intersection++;
    }

    // Calculate union
    const union = a.size + b.size - intersection;

    return union === 0 ? 0 : intersection / union;
}

/**
 * Merge source description into target using segmented Jaccard deduplication.
 * @param {string} targetDesc - Current target description
 * @param {string} sourceDesc - Source description to merge
 * @param {number} [threshold] - Similarity threshold (defaults to GRAPH_JACCARD_DUPLICATE_THRESHOLD)
 * @returns {string} Combined description
 */
export function mergeDescriptions(targetDesc, sourceDesc, threshold = GRAPH_JACCARD_DUPLICATE_THRESHOLD) {
    if (!sourceDesc) return targetDesc || '';
    if (!targetDesc) return sourceDesc;

    const segments = sourceDesc.split(' | ');
    let result = targetDesc;

    for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;

        const similarity = jaccardSimilarity(trimmed, result);
        if (similarity < threshold) {
            result = result ? `${result} | ${trimmed}` : trimmed;
        }
    }

    return result;
}

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
            // (?:\s+[^>]*)? matches optional attributes like <thinking foo="bar">
            .replace(
                /<(think|thinking|thought|reasoning|reflection|draft|draft_process)(?:\s+[^>]*)?>\s*[\s\S]*?<\/\1>/gi,
                ''
            )
            // Paired bracket tags: [THINK]...[/THINK], [THOUGHT]...[/THOUGHT], etc.
            .replace(/\[(THINK|THOUGHT|REASONING|DRAFT|DRAFT_PROCESS)\][\s\S]*?\[\/\1\]/gi, '')
            .replace(/\*thinks?:[\s\S]*?\*/gi, '')
            .replace(/\(thinking:[\s\S]*?\)/gi, '')
            // Orphaned closing tags (opening tag was in assistant prefill)
            // NOTE: ideal_output is NOT included here because the pattern is different:
            // Thinking tags: [reasoning]</thinking>[json] → strip reasoning, keep json
            // ideal_output: [json]</ideal_output> → keep json, strip only the tag
            .replace(/^[\s\S]*?<\/(think|thinking|thought|reasoning|draft|draft_process)>\s*/i, '')
            // ideal_output: few-shot example wrapper that LLM sometimes reproduces after JSON
            .replace(/<\/ideal_output>\s*/gi, '')
            .trim()
    );
}

/**
 * Strip markdown code fences from content.
 * Handles both ``` and ~~~ fences, with or without language specifier.
 *
 * @param {string} text - Text that may contain markdown fences
 * @returns {string} Text with fences stripped
 */
export function stripMarkdownFences(text) {
    if (!text || typeof text !== 'string') return text;

    const trimmed = text.trim();

    // Complete fences: ```json ... ``` or ~~~json ... ~~~
    const fenceMatch = trimmed.match(/^(?:```|~~~)(?:json)?\s*([\s\S]*?)\s*(?:```|~~~)$/i);
    if (fenceMatch) return fenceMatch[1].trim();

    let result = trimmed;
    // Unclosed opening fence: ```json\n{...}
    result = result.replace(/^(?:```|~~~)(?:json)?\s*/i, '');
    // Orphan closing fence: {...}\n```
    result = result.replace(/\s*(?:```|~~~)\s*$/i, '');

    return result.trim();
}

/**
 * Safely parse JSON with progressive fallback waterfall.
 * Returns Zod-style result object for maximum reusability.
 *
 * Flow:
 *   Input Validation → stripThinkingTags → Strip Fences → Tier 1 (JSON.parse) → Tier 2 (jsonrepair)
 *   → Tier 3 (Normalize + Extract) → Tier 4 (Scrub) → Tier 5 (Failure)
 *
 * @param {*} input - Raw input (string, object, array, or primitive)
 * @param {Object} options - Options
 * @param {number} options.minimumBlockSize - Minimum block size for extraction (default: 50)
 * @param {Function} options.onError - Error callback: (context) => void
 * @returns {{success: boolean, data?: any, error?: Error, errorContext?: Object}}
 */
export function safeParseJSON(input, options = {}) {
    const { minimumBlockSize = 50, onError } = options;
    const originalLength = typeof input === 'string' ? input.length : 0;

    // === Tier 0: Input Validation ===
    if (input === null || input === undefined) {
        const error = new Error('Input is null or undefined');
        const context = { tier: 0, originalLength, error };
        onError?.(context);
        return { success: false, error, errorContext: context };
    }

    // Already an object/array - return as-is
    if (typeof input === 'object') {
        return { success: true, data: input };
    }

    // Coerce primitives to string
    let text = String(input);

    // Empty string check
    if (text.trim().length === 0) {
        const error = new Error('Input is empty or whitespace-only');
        const context = { tier: 0, originalLength, error };
        onError?.(context);
        return { success: false, error, errorContext: context };
    }

    // Strip thinking tags FIRST (before any parsing)
    text = stripThinkingTags(text);

    // Strip markdown fences EARLY (hoisted from Tier 3)
    // Mid-tier LLMs output valid JSON wrapped in fences 90% of the time
    text = stripMarkdownFences(text);

    // === Tier 1: Native Parse ===
    try {
        const parsed = JSON.parse(text);
        return { success: true, data: parsed };
    } catch {
        // Continue to Tier 2
    }

    // === Tier 2: Extract + JsonRepair ===
    // Extract JSON blocks first to avoid jsonrepair synthesizing arrays from conversational text
    try {
        const blocks = extractJsonBlocks(text);

        if (blocks.length > 0) {
            // Select last substantial block
            const substantialBlocks = blocks.filter((b) => b.text.length >= minimumBlockSize);
            const selectedBlock =
                substantialBlocks.length > 0
                    ? substantialBlocks[substantialBlocks.length - 1]
                    : blocks[blocks.length - 1];

            const repaired = jsonrepair(selectedBlock.text);
            const parsed = JSON.parse(repaired);
            return { success: true, data: parsed };
        }

        // No blocks found - apply jsonrepair to whole text (for cases like unquoted keys)
        const repaired = jsonrepair(text);
        const parsed = JSON.parse(repaired);
        return { success: true, data: parsed };
    } catch {
        // Continue to Tier 3
    }

    // === Tier 3: Normalize + Extract ===
    try {
        const normalized = normalizeText(text);
        const blocks = extractJsonBlocks(normalized);

        if (blocks.length === 0) {
            throw new Error('No JSON blocks found');
        }

        // Select last substantial block
        const substantialBlocks = blocks.filter((b) => b.text.length >= minimumBlockSize);
        const selectedBlock =
            substantialBlocks.length > 0 ? substantialBlocks[substantialBlocks.length - 1] : blocks[blocks.length - 1]; // Fallback to last (or largest if only tiny blocks)

        const repaired = jsonrepair(selectedBlock.text);
        const parsed = JSON.parse(repaired);
        return { success: true, data: parsed };
    } catch {
        // Continue to Tier 4
    }

    // === Tier 4: Aggressive Scrub ===
    try {
        const normalized = normalizeText(text);
        const blocks = extractJsonBlocks(normalized);

        if (blocks.length === 0) {
            throw new Error('No JSON blocks found');
        }

        const substantialBlocks = blocks.filter((b) => b.text.length >= minimumBlockSize);
        const selectedBlock =
            substantialBlocks.length > 0 ? substantialBlocks[substantialBlocks.length - 1] : blocks[blocks.length - 1];

        // Apply aggressive scrubbing
        const scrubbed = scrubConcatenation(selectedBlock.text);
        const repaired = jsonrepair(scrubbed);
        const parsed = JSON.parse(repaired);
        return { success: true, data: parsed };
    } catch (e) {
        // === Tier 5: Fatal Failure ===
        const error = new Error(`JSON parse failed at all tiers: ${e.message}`);
        const context = {
            tier: 5,
            originalLength,
            sanitizedString: text.slice(0, 500),
            error,
        };
        onError?.(context);
        return { success: false, error, errorContext: context };
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
