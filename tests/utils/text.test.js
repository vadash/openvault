import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetDeps } from '../../src/deps.js';
import {
    extractJsonBlocks,
    mergeDescriptions,
    normalizeText,
    safeParseJSON,
    scrubConcatenation,
    sliceToTokenBudget,
    sortMemoriesBySequence,
    stripMarkdownFences,
    stripThinkingTags,
} from '../../src/utils/text.js';

describe('text', () => {
    afterEach(() => resetDeps());

    describe('sliceToTokenBudget', () => {
        it('slices to budget', () => {
            // Use the same string repeatedly for consistent token counting
            // "summary" is 1 token in o200k
            const text = 'summary';
            const memories = [
                { summary: text }, // 1 token
                { summary: text }, // 1 token
                { summary: text }, // 1 token
            ];
            const result = sliceToTokenBudget(memories, 2);
            expect(result).toHaveLength(2);
        });

        it('returns empty for zero budget', () => {
            expect(sliceToTokenBudget([{ summary: 'x' }], 0)).toEqual([]);
        });

        it('returns empty for null input', () => {
            expect(sliceToTokenBudget(null, 100)).toEqual([]);
        });
    });

    describe('stripThinkingTags', () => {
        describe('paired tags', () => {
            it.each([
                ['<thinking> tags', '<thinking>analysis</thinking>{"data": [1,2]}', '{"data": [1,2]}'],
                ['<reasoning> tags', '<reasoning>my thoughts</reasoning>[1,2,3]', '[1,2,3]'],
                ['case-insensitive', '<THINK>loud</THINK><Thinking>mixed</Thinking>{"done": true}', '{"done": true}'],
            ])('strips $name', (_, input, expected) => {
                expect(stripThinkingTags(input)).toBe(expected);
            });
        });

        describe('orphaned closing tags', () => {
            it.each([
                ['orphaned </thinking> closing tag', 'reasoning about the scene\n</thinking>\n[1,2,3]', '[1,2,3]'],
                ['orphaned </thought> closing tag', 'analysis\n</thought>{"ok": true}', '{"ok": true}'],
                ['orphaned </reasoning> closing tag', 'my reasoning here\n</reasoning>\n{"data": 1}', '{"data": 1}'],
                [
                    'orphaned </ideal_output> closing tag',
                    '{"events": [{"summary": "test"}]}\n</ideal_output>',
                    '{"events": [{"summary": "test"}]}',
                ],
                [
                    'orphaned </ideal_output> with trailing whitespace',
                    '{"events": []}\n</ideal_output>\n\n',
                    '{"events": []}',
                ],
            ])('strips $name', (_, input, expected) => {
                expect(stripThinkingTags(input)).toBe(expected);
            });
        });

        describe('edge cases', () => {
            it.each([
                ['null input', null, null],
                ['undefined input', undefined, undefined],
                ['number input', 123, 123],
                ['string with no tags', '{"pure": "json"}', '{"pure": "json"}'],
            ])('handles $name', (_, input, expected) => {
                expect(stripThinkingTags(input)).toBe(expected);
            });
        });

        describe('tool_call and search tags NOT stripped', () => {
            it.each([
                [
                    '<tool_call> paired tags preserve inner JSON',
                    '<tool_call>{"name":"extract"}</tool_call>{"events": []}',
                    '<tool_call>{"name":"extract"}</tool_call>{"events": []}',
                ],
                [
                    '<tool_call> with attributes preserves inner JSON',
                    '<tool_call name="extract_events">{"name":"extract"}</tool_call>{"events": []}',
                    '<tool_call name="extract_events">{"name":"extract"}</tool_call>{"events": []}',
                ],
                [
                    '<search> paired tags preserve inner JSON',
                    '<search>{"events": []}</search>',
                    '<search>{"events": []}</search>',
                ],
                [
                    'orphaned </tool_call> closing tag NOT stripped',
                    'calling the tool now\n</tool_call>\n{"events": []}',
                    'calling the tool now\n</tool_call>\n{"events": []}',
                ],
                [
                    '[TOOL_CALL] bracket tags NOT stripped',
                    '[TOOL_CALL]function call here[/TOOL_CALL]{"result": true}',
                    '[TOOL_CALL]function call here[/TOOL_CALL]{"result": true}',
                ],
            ])('$name', (_, input, expected) => {
                expect(stripThinkingTags(input)).toBe(expected);
            });
        });

        describe('bracket tags', () => {
            it('strips [THINK] bracket tags', () => {
                expect(stripThinkingTags('[THINK]thinking here[/THINK]{"result": true}')).toBe('{"result": true}');
            });
        });

        describe('draft tags', () => {
            it('strips <draft> paired tags', () => {
                expect(stripThinkingTags('<draft>concise notes</draft>{"events": []}')).toBe('{"events": []}');
            });

            it('strips <draft_process> paired tags', () => {
                expect(stripThinkingTags('<draft_process>step1->step2</draft_process>{"result": true}')).toBe(
                    '{"result": true}'
                );
            });

            it('strips mixed <think/> and <draft> tags', () => {
                expect(stripThinkingTags('<thinking>reasoning</thinking><draft>notes</draft>{"data": 1}')).toBe(
                    '{"data": 1}'
                );
            });

            it('strips [DRAFT] bracket tags', () => {
                expect(stripThinkingTags('[DRAFT]draft notes[/DRAFT]{"ok": true}')).toBe('{"ok": true}');
            });

            it('strips [DRAFT_PROCESS] bracket tags', () => {
                expect(stripThinkingTags('[DRAFT_PROCESS]step notes[/DRAFT_PROCESS][1,2,3]')).toBe('[1,2,3]');
            });
        });
    });

    describe('sortMemoriesBySequence', () => {
        it('sorts by sequence ascending by default', () => {
            const memories = [
                { id: '1', sequence: 30 },
                { id: '2', sequence: 10 },
                { id: '3', sequence: 20 },
            ];
            expect(sortMemoriesBySequence(memories).map((m) => m.id)).toEqual(['2', '3', '1']);
        });

        it('sorts by sequence descending when specified', () => {
            const memories = [
                { id: '1', sequence: 30 },
                { id: '2', sequence: 10 },
                { id: '3', sequence: 20 },
            ];
            expect(sortMemoriesBySequence(memories, false).map((m) => m.id)).toEqual(['1', '3', '2']);
        });

        it('falls back to created_at when sequence missing', () => {
            const memories = [
                { id: '1', created_at: 300 },
                { id: '2', created_at: 100 },
                { id: '3', sequence: 200 },
            ];
            expect(sortMemoriesBySequence(memories).map((m) => m.id)).toEqual(['2', '3', '1']);
        });

        it('does not mutate original array', () => {
            const memories = [
                { id: '1', sequence: 30 },
                { id: '2', sequence: 10 },
            ];
            const sorted = sortMemoriesBySequence(memories);
            expect(memories[0].id).toBe('1');
            expect(sorted).not.toBe(memories);
        });

        it('handles empty array', () => {
            expect(sortMemoriesBySequence([])).toEqual([]);
        });
    });

    describe('assignMemoriesToBuckets (moved from formatting.js)', () => {
        it('should be exported from text.js', async () => {
            const { assignMemoriesToBuckets } = await import('../../src/utils/text.js');
            expect(typeof assignMemoriesToBuckets).toBe('function');
        });

        it('should assign memories to old/mid/recent buckets correctly', async () => {
            const { assignMemoriesToBuckets } = await import('../../src/utils/text.js');

            const memories = [
                { id: '1', message_ids: [50], sequence: 50000 }, // Old (pos < 500)
                { id: '2', message_ids: [600], sequence: 30000 }, // Mid (500 <= pos < 900)
                { id: '3', message_ids: [900], sequence: 9000 }, // Recent (pos >= 900)
            ];
            const chatLength = 1000;

            const buckets = assignMemoriesToBuckets(memories, chatLength);

            expect(buckets.old.length).toBe(1);
            expect(buckets.mid.length).toBe(1);
            expect(buckets.recent.length).toBe(1);
            expect(buckets.old[0].id).toBe('1');
            expect(buckets.mid[0].id).toBe('2');
            expect(buckets.recent[0].id).toBe('3');
        });
    });

    describe('getMemoryPosition (moved from formatting.js)', () => {
        const POSITION_CALC_CASES = [
            { messageIds: [100, 200, 300], expected: 200, desc: 'simple average' },
            { messageIds: [50, 150], expected: 100, desc: 'two values average' },
            { messageIds: [500], expected: 500, desc: 'single value' },
            { messageIds: [], expected: 0, desc: 'empty message_ids defaults to 0' },
            { messageIds: [10, 20, 30, 40], expected: 25, desc: 'multiple values average' },
            { messageIds: [1000, 2000, 3000, 4000, 5000], expected: 3000, desc: 'five values average' },
        ];

        it.each(POSITION_CALC_CASES)('calculates $desc', async ({ messageIds, expected }) => {
            const { getMemoryPosition } = await import('../../src/utils/text.js');
            const memory = { message_ids: messageIds };
            expect(getMemoryPosition(memory)).toBe(expected);
        });

        it('should be exported from text.js', async () => {
            const { getMemoryPosition } = await import('../../src/utils/text.js');
            expect(typeof getMemoryPosition).toBe('function');
        });

        const SEQUENCE_FALLBACK_CASES = [
            { sequence: 5000, expected: 5, desc: 'sequence divided by 1000' },
            { sequence: 12345, expected: 12, desc: 'sequence floor division' },
            { sequence: 999, expected: 0, desc: 'sequence less than 1000' },
        ];

        it.each(SEQUENCE_FALLBACK_CASES)('falls back to sequence: $desc', async ({ sequence, expected }) => {
            const { getMemoryPosition } = await import('../../src/utils/text.js');
            const memory = { sequence };
            expect(getMemoryPosition(memory)).toBe(expected);
        });
    });

    describe('normalizeText', () => {
        it.each([
            ['preserves valid text unchanged', '{"key": "value"}', '{"key": "value"}'],
            ['replaces smart double quotes', '{"key": "value"}', '{"key": "value"}'],
            ['replaces smart single quotes', "{'key': 'value'}", "{'key': 'value'}"],
            ['strips Unicode line separator (U+2028)', '{"key": "value\u2028more"}', '{"key": "valuemore"}'],
            ['strips Unicode paragraph separator (U+2029)', '{"key": "value\u2029more"}', '{"key": "valuemore"}'],
            [
                'preserves valid escape sequences (\\n, \\r, \\t)',
                '{"key": "line1\\nline2"}',
                '{"key": "line1\\nline2"}',
            ],
            ['strips unescaped control characters', '{"key": "value\x00\x01\x02"}', '{"key": "value"}'],
            ['handles empty string', '', ''],
        ])('$desc', (_, input, expected) => {
            expect(normalizeText(input)).toBe(expected);
        });
    });

    describe('stripMarkdownFences', () => {
        it.each([
            ['strips complete ```json fence', '```json\n{"key": "value"}\n```', '{"key": "value"}'],
            ['strips complete ``` fence without language', '```\n{"key": "value"}\n```', '{"key": "value"}'],
            ['strips unclosed opening fence', '```json\n{"key": "value"}', '{"key": "value"}'],
            ['strips orphan closing fence', '{"key": "value"}\n```', '{"key": "value"}'],
            ['handles fence with uppercase JSON', '```JSON\n{"key": "value"}\n```', '{"key": "value"}'],
            [
                'handles fence with leading/trailing whitespace',
                '  ```json  \n  {"key": "value"}  \n  ```  ',
                '{"key": "value"}',
            ],
            ['returns unchanged text without fences', '{"key": "value"}', '{"key": "value"}'],
            ['handles tilde fences (~~~)', '~~~json\n{"key": "value"}\n~~~', '{"key": "value"}'],
            ['handles empty string', '', ''],
        ])('$desc', (_, input, expected) => {
            expect(stripMarkdownFences(input)).toBe(expected);
        });
    });

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

        it('ignores brackets inside backtick template literals', () => {
            // Some LLMs hallucinate template literals instead of standard quotes
            const blocks = extractJsonBlocks('{"summary": `They walked into the {dark} room`}');
            expect(blocks).toHaveLength(1);
            expect(blocks[0].text).toBe('{"summary": `They walked into the {dark} room`}');
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
            expect(blocks[0].end).toBe(22);
        });
    });

    describe('scrubConcatenation', () => {
        it.each([
            ['fixes simple string concatenation', '{"a": "hello" + "world"}', '{"a": "helloworld"}'],
            ['fixes concatenation with spaces', '{"a": "hello" + "world"}', '{"a": "helloworld"}'],
            ['fixes concatenation across newlines', '{"a": "hello"\n+\n"world"}', '{"a": "helloworld"}'],
            ['fixes concatenation with CRLF', '{"a": "hello"\r\n+\r\n"world"}', '{"a": "helloworld"}'],
            ['fixes dangling plus before punctuation', '{"a": "text" + , "b": 1}', '{"a": "text", "b": 1}'],
            ['fixes dangling plus at EOF', '{"a": "text" +', '{"a": "text"'],
            ['fixes full-width plus (＋)', '{"a": "hello"＋"world"}', '{"a": "helloworld"}'],
            ['preserves plus signs inside strings', '{"math": "1 + 2 = 3"}', '{"math": "1 + 2 = 3"}'],
            ['handles multiple concatenations', '{"a": "x" + "y", "b": "p" + "q"}', '{"a": "xy", "b": "pq"}'],
            ['handles empty string', '', ''],
            [
                'does not match variable interpolations',
                '{"a": "hello" + var + "world"}',
                '{"a": "hello" + var + "world"}',
            ],
        ])('$desc', (_, input, expected) => {
            expect(scrubConcatenation(input)).toBe(expected);
        });
    });

    describe('safeParseJSON (refactored)', () => {
        // === Tier 0: Input Validation ===
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
                const result = safeParseJSON(
                    '{"tiny": 1}{"events": [{"summary": "A very long summary that makes this block larger than 50 chars"}]}'
                );
                expect(result.success).toBe(true);
                expect(result.data.events).toBeDefined();
            });

            it('filters out tiny trailing blocks', () => {
                const result = safeParseJSON(
                    '{"events": [{"summary": "A very long summary that makes this block larger than 50 chars"}]}{"status": "done"}'
                );
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
            it('includes tier in errorContext on null input', () => {
                const result = safeParseJSON(null);
                expect(result.success).toBe(false);
                expect(result.errorContext.tier).toBe(0);
            });

            it('includes originalLength in errorContext on empty string', () => {
                const result = safeParseJSON('');
                expect(result.success).toBe(false);
                expect(result.errorContext.originalLength).toBe(0);
            });

            it('repairs unclosed brackets via jsonrepair', () => {
                // jsonrepair is very robust and can fix this
                const result = safeParseJSON('{"key": "value"');
                expect(result.success).toBe(true);
                expect(result.data).toEqual({ key: 'value' });
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
                // Use null input which fails at Tier 0
                const result = safeParseJSON(null, { onError });
                expect(result.success).toBe(false);
                expect(onError).toHaveBeenCalledWith(expect.objectContaining({ tier: 0 }));
            });

            it('does not call onError on success', () => {
                const onError = vi.fn();
                const result = safeParseJSON('{"key": "value"}', { onError });
                expect(result.success).toBe(true);
                expect(onError).not.toHaveBeenCalled();
            });
        });
    });

    describe('mergeDescriptions', () => {
        it('returns source when target is empty', () => {
            expect(mergeDescriptions('', 'hello world', 0.6)).toBe('hello world');
        });

        it('returns target when source is empty', () => {
            expect(mergeDescriptions('hello world', '', 0.6)).toBe('hello world');
        });

        it('appends non-duplicate segments', () => {
            const target = 'Loves apples';
            const source = 'Hates dogs';
            expect(mergeDescriptions(target, source, 0.6)).toBe('Loves apples | Hates dogs');
        });

        it('skips duplicate segments based on threshold', () => {
            const target = 'Loves apples';
            const source = 'Loves apples | Fears heights';
            expect(mergeDescriptions(target, source, 0.6)).toBe('Loves apples | Fears heights');
        });

        it('handles multiple source segments', () => {
            const target = 'A | B';
            const source = 'C | D | E';
            expect(mergeDescriptions(target, source, 0.6)).toBe('A | B | C | D | E');
        });
    });
});
