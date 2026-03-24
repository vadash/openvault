# safeParseJSON Refactor Implementation Plan

**Goal:** Transform `safeParseJSON` into a bulletproof, general-purpose JSON parser with Zod-style result objects and a 5-tier progressive fallback waterfall.

**Architecture:** Happy Path First — try native parse before any mutation. Domain-agnostic — no OpenVault-specific logic in the utility. Last Substantial Block extraction — immune to trailing hallucinations.

**Tech Stack:** JavaScript (ESM), jsonrepair, Vitest

---

## File Structure

| File | Action |
|------|--------|
| `src/utils/text.js` | Add `normalizeText`, `extractJsonBlocks`, `scrubConcatenation`, `stripMarkdownFences`; replace `safeParseJSON`; delete `extractBalancedJSON` |
| `src/extraction/structured.js` | Update `parseStructuredResponse` to handle new `{ success, data, error }` return type; update `parseEventExtractionResponse` and `parseGraphExtractionResponse` for bare array handling |
| `tests/utils/text.test.js` | Add comprehensive tests for new helpers and waterfall tiers |

---

## Task 1: Implement `normalizeText` Helper

**Files:**
- Modify: `src/utils/text.js`
- Test: `tests/utils/text.test.js`

- [ ] Step 1: Write failing tests for `normalizeText`

```javascript
describe('normalizeText', () => {
    it('returns unchanged valid text', () => {
        expect(normalizeText('{"key": "value"}')).toBe('{"key": "value"}');
    });

    it('replaces smart double quotes with standard quotes', () => {
        expect(normalizeText('{"key": "value"}')).toBe('{"key": "value"}');
    });

    it('replaces smart single quotes with standard single quotes', () => {
        expect(normalizeText("{'key': 'value'}")).toBe("{'key': 'value'}");
    });

    it('strips Unicode line separator (U+2028)', () => {
        expect(normalizeText('{"key": "value\u2028more"}')).toBe('{"key": "valuemore"}');
    });

    it('strips Unicode paragraph separator (U+2029)', () => {
        expect(normalizeText('{"key": "value\u2029more"}')).toBe('{"key": "valuemore"}');
    });

    it('preserves valid escape sequences (\\n, \\r, \\t)', () => {
        expect(normalizeText('{"key": "line1\\nline2"}')).toBe('{"key": "line1\\nline2"}');
    });

    it('strips unescaped control characters (\\x00-\\x1F) except \\n \\r \\t', () => {
        expect(normalizeText('{"key": "value\x00\x01\x02"}')).toBe('{"key": "value"}');
    });

    it('handles empty string', () => {
        expect(normalizeText('')).toBe('');
    });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest tests/utils/text.test.js -t normalizeText`
Expected: FAIL - `normalizeText is not defined`

- [ ] Step 3: Implement `normalizeText`

```javascript
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

    return text
        // Replace smart double quotes
        .replace(/[""]/g, '"')
        // Replace smart single quotes
        .replace(/['']/g, "'")
        // Strip Unicode line/paragraph separators
        .replace(/[\u2028\u2029]/g, '')
        // Strip unescaped control characters (preserve \n \r \t)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest tests/utils/text.test.js -t normalizeText`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(text): add normalizeText helper for invisible char fixes"
```

---

## Task 2: Implement `stripMarkdownFences` Helper

**Files:**
- Modify: `src/utils/text.js`
- Test: `tests/utils/text.test.js`

- [ ] Step 1: Write failing tests for `stripMarkdownFences`

```javascript
describe('stripMarkdownFences', () => {
    it('strips complete ```json fence', () => {
        expect(stripMarkdownFences('```json\n{"key": "value"}\n```')).toBe('{"key": "value"}');
    });

    it('strips complete ``` fence without language', () => {
        expect(stripMarkdownFences('```\n{"key": "value"}\n```')).toBe('{"key": "value"}');
    });

    it('strips unclosed opening fence', () => {
        expect(stripMarkdownFences('```json\n{"key": "value"}')).toBe('{"key": "value"}');
    });

    it('strips orphan closing fence', () => {
        expect(stripMarkdownFences('{"key": "value"}\n```')).toBe('{"key": "value"}');
    });

    it('handles fence with uppercase JSON', () => {
        expect(stripMarkdownFences('```JSON\n{"key": "value"}\n```')).toBe('{"key": "value"}');
    });

    it('handles fence with leading/trailing whitespace', () => {
        expect(stripMarkdownFences('  ```json  \n  {"key": "value"}  \n  ```  ')).toBe('{"key": "value"}');
    });

    it('returns unchanged text without fences', () => {
        expect(stripMarkdownFences('{"key": "value"}')).toBe('{"key": "value"}');
    });

    it('handles tilde fences (~~~)', () => {
        expect(stripMarkdownFences('~~~json\n{"key": "value"}\n~~~')).toBe('{"key": "value"}');
    });

    it('handles empty string', () => {
        expect(stripMarkdownFences('')).toBe('');
    });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest tests/utils/text.test.js -t stripMarkdownFences`
Expected: FAIL - `stripMarkdownFences is not defined`

- [ ] Step 3: Implement `stripMarkdownFences`

```javascript
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
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest tests/utils/text.test.js -t stripMarkdownFences`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(text): add stripMarkdownFences helper"
```

---

## Task 3: Implement `extractJsonBlocks` Helper

**Files:**
- Modify: `src/utils/text.js`
- Test: `tests/utils/text.test.js`

**Common Pitfalls:**
- Remember that `\\` is an escaped backslash, meaning the next character is NOT escaped
- Handle both `"` and `'` string delimiters (Python-style JSON from some LLMs)
- Track depth correctly when brackets appear inside strings

- [ ] Step 1: Write failing tests for `extractJsonBlocks`

```javascript
describe('extractJsonBlocks', () => {
    it('extracts single object block', () => {
        const blocks = extractJsonBlocks('{"key": "value"}');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].text).toBe('{"key": "value"}');
        expect(blocks[0].isObject).toBe(true);
    });

    it('extracts single array block', () => {
        const blocks = extractJsonBlocks('[1, 2, 3]');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].text).toBe('[1, 2, 3]');
        expect(blocks[0].isObject).toBe(false);
    });

    it('extracts multiple blocks', () => {
        const blocks = extractJsonBlocks('{"a": 1} text {"b": 2}');
        expect(blocks).toHaveLength(2);
        expect(blocks[0].text).toBe('{"a": 1}');
        expect(blocks[1].text).toBe('{"b": 2}');
    });

    it('handles nested brackets', () => {
        const blocks = extractJsonBlocks('{"outer": {"inner": [1, 2, 3]}}');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].text).toBe('{"outer": {"inner": [1, 2, 3]}}');
    });

    it('ignores brackets inside double-quoted strings', () => {
        const blocks = extractJsonBlocks('{"key": "value with {brackets}"}');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].text).toBe('{"key": "value with {brackets}"}');
    });

    it('ignores brackets inside single-quoted strings', () => {
        const blocks = extractJsonBlocks("{'key': 'value with {brackets}'}");
        expect(blocks).toHaveLength(1);
        expect(blocks[0].text).toBe("{'key': 'value with {brackets}'}");
    });

    it('handles escaped quotes correctly', () => {
        const blocks = extractJsonBlocks('{"key": "value \\"with\\" quotes"}');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].text).toBe('{"key": "value \\"with\\" quotes"}');
    });

    it('handles escaped backslash before quote (\\\\")', () => {
        // \\" means escaped backslash followed by quote (string terminator)
        const blocks = extractJsonBlocks('{"key": "path\\\\", "next": "value"}');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].text).toBe('{"key": "path\\\\", "next": "value"}');
    });

    it('returns empty array for no blocks', () => {
        expect(extractJsonBlocks('no json here')).toEqual([]);
    });

    it('handles empty string', () => {
        expect(extractJsonBlocks('')).toEqual([]);
    });

    it('tracks start and end positions', () => {
        const blocks = extractJsonBlocks('prefix {"key": "value"} suffix');
        expect(blocks[0].start).toBe(7);
        expect(blocks[0].end).toBe(23);
    });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest tests/utils/text.test.js -t extractJsonBlocks`
Expected: FAIL - `extractJsonBlocks is not defined`

- [ ] Step 3: Implement `extractJsonBlocks`

```javascript
/**
 * Extract all balanced JSON blocks from a string.
 * Correctly handles strings, escape sequences, and nested structures.
 *
 * @param {string} text - Input text potentially containing JSON
 * @param {Object} options - Options
 * @param {number} options.minSize - Minimum block size (default: 0)
 * @returns {Array<{start: number, end: number, text: string, isObject: boolean}>}
 */
export function extractJsonBlocks(text, options = {}) {
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
            if ((ch === '"' || ch === "'") && !inString) {
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
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest tests/utils/text.test.js -t extractJsonBlocks`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(text): add extractJsonBlocks helper for robust block extraction"
```

---

## Task 4: Implement `scrubConcatenation` Helper

**Files:**
- Modify: `src/utils/text.js`
- Test: `tests/utils/text.test.js`

- [ ] Step 1: Write failing tests for `scrubConcatenation`

```javascript
describe('scrubConcatenation', () => {
    it('fixes simple string concatenation', () => {
        expect(scrubConcatenation('{"a": "hello" + "world"}')).toBe('{"a": "helloworld"}');
    });

    it('fixes concatenation with spaces', () => {
        expect(scrubConcatenation('{"a": "hello" + "world"}')).toBe('{"a": "helloworld"}');
    });

    it('fixes concatenation across newlines', () => {
        expect(scrubConcatenation('{"a": "hello"\n+\n"world"}')).toBe('{"a": "helloworld"}');
    });

    it('fixes concatenation with CRLF', () => {
        expect(scrubConcatenation('{"a": "hello"\r\n+\r\n"world"}')).toBe('{"a": "helloworld"}');
    });

    it('fixes dangling plus before punctuation', () => {
        expect(scrubConcatenation('{"a": "text" + , "b": 1}')).toBe('{"a": "text", "b": 1}');
    });

    it('fixes dangling plus at EOF', () => {
        expect(scrubConcatenation('{"a": "text" +')).toBe('{"a": "text"}');
    });

    it('fixes full-width plus (＋)', () => {
        expect(scrubConcatenation('{"a": "hello"＋"world"}')).toBe('{"a": "helloworld"}');
    });

    it('preserves plus signs inside strings', () => {
        expect(scrubConcatenation('{"math": "1 + 2 = 3"}')).toBe('{"math": "1 + 2 = 3"}');
    });

    it('handles multiple concatenations', () => {
        expect(scrubConcatenation('{"a": "x" + "y", "b": "p" + "q"}')).toBe('{"a": "xy", "b": "pq"}');
    });

    it('handles empty string', () => {
        expect(scrubConcatenation('')).toBe('');
    });

    it('does not match variable interpolations', () => {
        // Variable interpolations should NOT be fixed - they're a different error
        expect(scrubConcatenation('{"a": "hello" + var + "world"}')).toBe('{"a": "hello" + var + "world"}');
    });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest tests/utils/text.test.js -t scrubConcatenation`
Expected: FAIL - `scrubConcatenation is not defined`

- [ ] Step 3: Implement `scrubConcatenation`

```javascript
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
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest tests/utils/text.test.js -t scrubConcatenation`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(text): add scrubConcatenation helper for LLM hallucination fix"
```

---

## Task 5: Replace `safeParseJSON` with 5-Tier Waterfall

**Files:**
- Modify: `src/utils/text.js`
- Modify: `tests/utils/text.test.js`

**Critical Design Note from Review:**
> Hoist Markdown Stripping - Strip fences BEFORE Tier 1, not at Tier 3.
> Mid-tier LLMs output perfectly valid JSON *wrapped in markdown fences* 90% of the time.

**Revised Flow:**
```
Input Validation → stripThinkingTags → Strip Fences → Tier 1 (JSON.parse) → Tier 2 (jsonrepair) → Tier 3 (Normalize + Extract) → Tier 4 (Scrub) → Tier 5 (Failure)
```

- [ ] Step 1: Write failing tests for new `safeParseJSON` API

```javascript
describe('safeParseJSON (refactored)', () => {
    // === Input Validation (Tier 0) ===
    describe('Tier 0: Input Validation', () => {
        it('returns success for already-parsed object', () => {
            const result = safeParseJSON({ key: 'value' });
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ key: 'value' });
        });

        it('returns success for already-parsed array', () => {
            const result = safeParseJSON([1, 2, 3]);
            expect(result.success).toBe(true);
            expect(result.data).toEqual([1, 2, 3]);
        });

        it('returns failure for null', () => {
            const result = safeParseJSON(null);
            expect(result.success).toBe(false);
            expect(result.error).toBeInstanceOf(Error);
        });

        it('returns failure for undefined', () => {
            const result = safeParseJSON(undefined);
            expect(result.success).toBe(false);
        });

        it('returns failure for empty string', () => {
            const result = safeParseJSON('');
            expect(result.success).toBe(false);
        });

        it('returns failure for whitespace-only string', () => {
            const result = safeParseJSON('   \n\t  ');
            expect(result.success).toBe(false);
        });

        it('coerces number to string and parses', () => {
            const result = safeParseJSON(42);
            expect(result.success).toBe(true);
            expect(result.data).toBe(42);
        });

        it('coerces boolean to string and parses', () => {
            const result = safeParseJSON(true);
            expect(result.success).toBe(true);
            expect(result.data).toBe(true);
        });
    });

    // === Tier 1: Native Parse ===
    describe('Tier 1: Native Parse', () => {
        it('parses valid JSON object', () => {
            const result = safeParseJSON('{"key": "value"}');
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ key: 'value' });
        });

        it('parses valid JSON array', () => {
            const result = safeParseJSON('[1, 2, 3]');
            expect(result.success).toBe(true);
            expect(result.data).toEqual([1, 2, 3]);
        });

        it('parses fenced JSON (markdown hoisted)', () => {
            const result = safeParseJSON('```json\n{"key": "value"}\n```');
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ key: 'value' });
        });
    });

    // === Tier 2: JsonRepair ===
    describe('Tier 2: JsonRepair', () => {
        it('repairs trailing commas', () => {
            const result = safeParseJSON('{"key": "value",}');
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ key: 'value' });
        });

        it('repairs unquoted keys', () => {
            const result = safeParseJSON('{key: "value"}');
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ key: 'value' });
        });

        it('repairs single quotes', () => {
            const result = safeParseJSON("{'key': 'value'}");
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ key: 'value' });
        });
    });

    // === Tier 3: Normalize + Extract ===
    describe('Tier 3: Normalize + Extract', () => {
        it('normalizes smart quotes', () => {
            const result = safeParseJSON('{"key": "value"}');
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ key: 'value' });
        });

        it('extracts last substantial block', () => {
            const result = safeParseJSON('{"tiny": 1}{"events": [{"summary": "A very long summary that makes this block larger than 50 chars"}]}');
            expect(result.success).toBe(true);
            expect(result.data.events).toBeDefined();
        });

        it('filters out tiny trailing blocks', () => {
            const result = safeParseJSON('{"events": [{"summary": "A very long summary that makes this block larger than 50 chars"}]}{"status": "done"}');
            expect(result.success).toBe(true);
            expect(result.data.events).toBeDefined();
            expect(result.data.status).toBeUndefined();
        });

        it('keeps tiny block if only one exists', () => {
            const result = safeParseJSON('{"tiny": 1}');
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ tiny: 1 });
        });
    });

    // === Tier 4: Aggressive Scrub ===
    describe('Tier 4: Aggressive Scrub', () => {
        it('fixes string concatenation', () => {
            const result = safeParseJSON('{"key": "hello" + "world"}');
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ key: 'helloworld' });
        });
    });

    // === Error Context ===
    describe('Error Context', () => {
        it('includes tier in errorContext', () => {
            const result = safeParseJSON('not json at all');
            expect(result.success).toBe(false);
            expect(result.errorContext.tier).toBeDefined();
        });

        it('includes originalLength in errorContext', () => {
            const result = safeParseJSON('not json');
            expect(result.success).toBe(false);
            expect(result.errorContext.originalLength).toBe(8);
        });
    });

    // === Thinking Tags ===
    describe('Thinking Tags', () => {
        it('strips thinking tags before parsing', () => {
            const result = safeParseJSON('<thinking>reasoning here</thinking>{"key": "value"}');
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ key: 'value' });
        });

        it('strips multiple thinking tag variants', () => {
            const result = safeParseJSON('[THINK]reasoning[/THINK]{"key": "value"}');
            expect(result.success).toBe(true);
            expect(result.data).toEqual({ key: 'value' });
        });
    });

    // === Domain Decoupling ===
    describe('Domain Decoupling', () => {
        it('does NOT wrap bare arrays in events object', () => {
            const result = safeParseJSON('[{"name": "Alice"}]');
            expect(result.success).toBe(true);
            expect(Array.isArray(result.data)).toBe(true);
            expect(result.data[0].name).toBe('Alice');
            // Should NOT have events wrapper
            expect(result.data.events).toBeUndefined();
        });
    });

    // === Options ===
    describe('Options', () => {
        it('respects minimumBlockSize option', () => {
            const result = safeParseJSON('{"a": 1}{"b": 2}', { minimumBlockSize: 10 });
            // Both blocks are < 10 chars, but one must be returned
            expect(result.success).toBe(true);
        });

        it('calls onError callback on failure', () => {
            const onError = vi.fn();
            const result = safeParseJSON('not json', { onError });
            expect(result.success).toBe(false);
            expect(onError).toHaveBeenCalledWith(expect.objectContaining({ tier: expect.any(Number) }));
        });
    });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest tests/utils/text.test.js -t "safeParseJSON (refactored)"`
Expected: FAIL - multiple failures due to changed API

- [ ] Step 3: Replace `safeParseJSON` implementation

Delete `extractBalancedJSON` function and replace `safeParseJSON`:

```javascript
/**
 * Safely parse JSON with progressive fallback waterfall.
 * Returns Zod-style result object for maximum reusability.
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

    // === Tier 2: JsonRepair Only ===
    try {
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
        const substantialBlocks = blocks.filter(b => b.text.length >= minimumBlockSize);
        const selectedBlock = substantialBlocks.length > 0
            ? substantialBlocks[substantialBlocks.length - 1]
            : blocks[blocks.length - 1]; // Fallback to last (or largest if only tiny blocks)

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

        const substantialBlocks = blocks.filter(b => b.text.length >= minimumBlockSize);
        const selectedBlock = substantialBlocks.length > 0
            ? substantialBlocks[substantialBlocks.length - 1]
            : blocks[blocks.length - 1];

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
            error
        };
        onError?.(context);
        return { success: false, error, errorContext: context };
    }
}
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest tests/utils/text.test.js -t "safeParseJSON"`
Expected: PASS (both old and new tests)

- [ ] Step 5: Update existing tests that expect old API

The existing tests expect `safeParseJSON` to return `Object | null`. Update them:

```javascript
// OLD TESTS - Update to unwrap new API
describe('safeParseJSON (legacy compatibility)', () => {
    it('extracts JSON from markdown code block', () => {
        const result = safeParseJSON('```json\n{"value": 42}\n```');
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ value: 42 });
    });

    it('extracts JSON from conversational response', () => {
        const result = safeParseJSON('Here is the result:\n\n{"selected": [1, 2, 3]}\n\nHope this helps!');
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ selected: [1, 2, 3] });
    });

    // ... update all existing tests to use result.data
});
```

- [ ] Step 6: Run all text tests

Run: `npx vitest tests/utils/text.test.js`
Expected: PASS

- [ ] Step 7: Commit

```bash
git add -A && git commit -m "feat(text): replace safeParseJSON with 5-tier waterfall"
```

---

## Task 6: Update `structured.js` for New API Signature

**Files:**
- Modify: `src/extraction/structured.js`
- Test: `tests/extraction/structured.test.js`

**Critical Design Note from Review:**
> Graph Extraction "Bare Array" Ambiguity - If bare array, map to `entities` (primary output) or throw validation error.

- [ ] Step 1: Run existing structured tests to see failures

Run: `npx vitest tests/extraction/structured.test.js`
Expected: FAIL - tests expect `safeParseJSON` to return `Object | null`

- [ ] Step 2: Update `parseStructuredResponse` to unwrap new API

```javascript
/**
 * Parse LLM response with markdown stripping, thinking tag removal, and Zod validation
 */
function parseStructuredResponse(content, schema) {
    const cleanedContent = stripThinkingTags(content);
    const jsonContent = stripMarkdown(cleanedContent);

    // Use safeParseJSON with new API
    const result = safeParseJSON(jsonContent);
    if (!result.success) {
        const start = content.slice(0, 500);
        const end = content.slice(-500);
        logError('JSON parse failed in structured response', result.error, {
            rawContentStart: start,
            rawContentEnd: end,
            length: content.length,
        });
        throw new Error(`JSON parse failed: ${result.error.message}`);
    }

    let parsed = result.data;

    // Array recovery — unwrap bare arrays to first element
    if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
            throw new Error('LLM returned empty array');
        }
        logWarn(`LLM returned ${parsed.length}-element array instead of object — unwrapping first element`);
        parsed = parsed[0];
    }

    const schemaResult = schema.safeParse(parsed);
    if (!schemaResult.success) {
        throw new Error(`Schema validation failed: ${schemaResult.error.message}`);
    }

    return schemaResult.data;
}
```

- [ ] Step 3: Update `parseEventExtractionResponse` for bare array handling

```javascript
export function parseEventExtractionResponse(content) {
    const cleanedContent = stripThinkingTags(content);
    const jsonContent = stripMarkdown(cleanedContent);

    const result = safeParseJSON(jsonContent);
    if (!result.success) {
        const start = content.slice(0, 500);
        const end = content.slice(-500);
        logError('JSON parse failed in event extraction', result.error, {
            rawContentStart: start,
            rawContentEnd: end,
            length: content.length,
        });
        throw new Error(`JSON parse failed: ${result.error.message}`);
    }

    let parsed = result.data;

    // Domain-specific array recovery: wrap bare arrays in events object
    if (Array.isArray(parsed)) {
        logWarn('LLM returned bare array, wrapping in events object');
        parsed = { events: parsed };
    }

    // Per-event validation
    const rawEvents = parsed?.events;
    if (!Array.isArray(rawEvents)) {
        throw new Error('Schema validation failed: events array is missing');
    }

    if (rawEvents.length === 0) {
        return { events: [] };
    }

    const validEvents = [];
    for (const raw of rawEvents) {
        const eventResult = EventSchema.safeParse(raw);
        if (eventResult.success) {
            validEvents.push(eventResult.data);
        }
    }

    if (validEvents.length === 0) {
        return { events: [] };
    }

    return { events: validEvents };
}
```

- [ ] Step 4: Update `parseGraphExtractionResponse` for bare array handling

```javascript
export function parseGraphExtractionResponse(content) {
    const cleanedContent = stripThinkingTags(content);
    const jsonContent = stripMarkdown(cleanedContent);

    const result = safeParseJSON(jsonContent);
    if (!result.success) {
        const start = content.slice(0, 500);
        const end = content.slice(-500);
        logError('JSON parse failed in graph extraction', result.error, {
            rawContentStart: start,
            rawContentEnd: end,
            length: content.length,
        });
        throw new Error(`JSON parse failed: ${result.error.message}`);
    }

    let parsed = result.data;

    // Domain-specific array recovery: bare arrays are entities (primary output)
    if (Array.isArray(parsed)) {
        logWarn('LLM returned bare array, mapping to entities');
        parsed = { entities: parsed, relationships: [] };
    }

    // Per-item validation
    const validEntities = [];
    for (const raw of parsed?.entities || []) {
        const res = EntitySchema.safeParse(raw);
        if (res.success) validEntities.push(res.data);
    }

    const validRelationships = [];
    for (const raw of parsed?.relationships || []) {
        const res = RelationshipSchema.safeParse(raw);
        if (res.success) validRelationships.push(res.data);
    }

    return { entities: validEntities, relationships: validRelationships };
}
```

- [ ] Step 5: Run structured tests

Run: `npx vitest tests/extraction/structured.test.js`
Expected: PASS

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "feat(extraction): update parsers for new safeParseJSON API"
```

---

## Task 7: Verify Full Test Suite

**Files:**
- All test files

- [ ] Step 1: Run full test suite

Run: `npm run test:run`
Expected: PASS

- [ ] Step 2: Run extraction tests specifically

Run: `npx vitest tests/extraction/`
Expected: PASS

- [ ] Step 3: Commit any remaining changes

```bash
git add -A && git commit -m "test: verify all tests pass after safeParseJSON refactor"
```

---

## Task 8: Delete Legacy Code

**Files:**
- Modify: `src/utils/text.js`

- [ ] Step 1: Remove `extractBalancedJSON` function

Delete the entire `extractBalancedJSON` function (replaced by `extractJsonBlocks`).

- [ ] Step 2: Verify tests still pass

Run: `npm run test:run`
Expected: PASS

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "refactor(text): remove legacy extractBalancedJSON function"
```

---

## Task 9: Final Verification and Documentation

**Files:**
- All files

- [ ] Step 1: Run full test suite one more time

Run: `npm run test:run`
Expected: PASS

- [ ] Step 2: Verify lint passes

Run: `npm run lint`
Expected: PASS

- [ ] Step 3: Update design document status

Update `docs/designs/2026-03-24-safeparse-json-refactor.md`:
```markdown
**Status:** Implemented
```

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "docs: mark safeParseJSON design as implemented"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | `normalizeText` helper |
| 2 | `stripMarkdownFences` helper |
| 3 | `extractJsonBlocks` helper |
| 4 | `scrubConcatenation` helper |
| 5 | Replace `safeParseJSON` with 5-tier waterfall |
| 6 | Update `structured.js` parsers |
| 7 | Verify full test suite |
| 8 | Delete legacy `extractBalancedJSON` |
| 9 | Final verification and documentation |