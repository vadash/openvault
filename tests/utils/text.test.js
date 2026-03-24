import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDeps } from '../../src/deps.js';
import {
    safeParseJSON,
    sliceToTokenBudget,
    sortMemoriesBySequence,
    stripThinkingTags,
    normalizeText,
    stripMarkdownFences,
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
        it('strips <think> tags', () => {
            expect(stripThinkingTags('<think>reasoning here</think>{"result": true}')).toBe('{"result": true}');
        });

        it('strips <thinking> tags', () => {
            expect(stripThinkingTags('<thinking>analysis</thinking>{"data": [1,2]}')).toBe('{"data": [1,2]}');
        });

        it('strips <reasoning> tags', () => {
            expect(stripThinkingTags('<reasoning>my thoughts</reasoning>[1,2,3]')).toBe('[1,2,3]');
        });

        it('handles multiline thinking', () => {
            expect(stripThinkingTags('<think>\nline1\nline2\n</think>{"ok": true}')).toBe('{"ok": true}');
        });

        it('handles multiple tags', () => {
            expect(stripThinkingTags('<think>a</think><reasoning>b</reasoning>{"x": 1}')).toBe('{"x": 1}');
        });

        it('returns original if no tags', () => {
            expect(stripThinkingTags('{"pure": "json"}')).toBe('{"pure": "json"}');
        });

        it('handles non-string input', () => {
            expect(stripThinkingTags(null)).toBe(null);
            expect(stripThinkingTags(undefined)).toBe(undefined);
            expect(stripThinkingTags(123)).toBe(123);
        });

        it('is case-insensitive', () => {
            expect(stripThinkingTags('<THINK>loud</THINK><Thinking>mixed</Thinking>{"done": true}')).toBe(
                '{"done": true}'
            );
        });

        it('strips orphaned </think> closing tag from prefill continuation', () => {
            const input = 'Step 1: analysis of events...\n</think>{"events": []}';
            expect(stripThinkingTags(input)).toBe('{"events": []}');
        });

        it('strips orphaned </thinking> closing tag', () => {
            const input = 'reasoning about the scene\n</thinking>\n[1,2,3]';
            expect(stripThinkingTags(input)).toBe('[1,2,3]');
        });

        it('strips orphaned </thought> closing tag', () => {
            const input = 'analysis\n</thought>{"ok": true}';
            expect(stripThinkingTags(input)).toBe('{"ok": true}');
        });

        it('strips orphaned </reasoning> closing tag', () => {
            const input = 'my reasoning here\n</reasoning>\n{"data": 1}';
            expect(stripThinkingTags(input)).toBe('{"data": 1}');
        });

        it('does not strip content when no orphaned closing tag exists', () => {
            expect(stripThinkingTags('{"pure": "json"}')).toBe('{"pure": "json"}');
        });

        it('strips <tool_call> paired tags', () => {
            const input = '<tool_call>{"name":"extract"}</tool_call>{"events": []}';
            expect(stripThinkingTags(input)).toBe('{"events": []}');
        });

        it('strips <tool_call> tags with attributes', () => {
            const input = '<tool_call name="extract_events">{"name":"extract"}</tool_call>{"events": []}';
            expect(stripThinkingTags(input)).toBe('{"events": []}');
        });

        it('strips orphaned </tool_call> closing tag', () => {
            const input = 'calling the tool now\n</tool_call>\n{"events": []}';
            expect(stripThinkingTags(input)).toBe('{"events": []}');
        });

        it('strips [TOOL_CALL] bracket tags', () => {
            const input = '[TOOL_CALL]function call here[/TOOL_CALL]{"result": true}';
            expect(stripThinkingTags(input)).toBe('{"result": true}');
        });

        it('strips orphaned </ideal_output> closing tag (few-shot example wrapper)', () => {
            // ideal_output appears AFTER the JSON, not before like thinking tags
            const input = '{"events": [{"summary": "test"}]}\n</ideal_output>';
            expect(stripThinkingTags(input)).toBe('{"events": [{"summary": "test"}]}');
        });

        it('strips </ideal_output> with trailing whitespace', () => {
            const input = '{"events": []}\n</ideal_output>\n\n';
            expect(stripThinkingTags(input)).toBe('{"events": []}');
        });
    });

    describe('safeParseJSON', () => {
        beforeEach(() => {
            setupTestContext({ settings: { debugMode: true } });
        });

        it('parses valid JSON', () => {
            expect(safeParseJSON('{"key": "value"}')).toEqual({ key: 'value' });
        });

        it('extracts JSON from markdown code block', () => {
            expect(safeParseJSON('```json\n{"key": "value"}\n```')).toEqual({ key: 'value' });
        });

        it('handles arrays with recovery wrapper', () => {
            expect(safeParseJSON('[1, 2, 3]')).toEqual({
                events: [1, 2, 3],
                entities: [],
                relationships: [],
                reasoning: null,
            });
        });

        it('repairs malformed JSON with trailing comma', () => {
            expect(safeParseJSON('{"key": "value",}')).toEqual({ key: 'value' });
        });

        it('repairs JSON with unquoted keys', () => {
            expect(safeParseJSON('{key: "value"}')).toEqual({ key: 'value' });
        });

        it('repairs JSON with single quotes', () => {
            expect(safeParseJSON("{'key': 'value'}")).toEqual({ key: 'value' });
        });

        it('returns null on completely invalid input', () => {
            expect(safeParseJSON('not json at all')).toBeNull();
        });

        it('handles nested objects', () => {
            expect(safeParseJSON('{"outer": {"inner": "value"}}')).toEqual({ outer: { inner: 'value' } });
        });

        it('parses JSON after stripping think tags', () => {
            expect(safeParseJSON('<think>analyzing...</think>{"selected": [1, 2]}')).toEqual({ selected: [1, 2] });
        });

        it('handles thinking tags with markdown code block', () => {
            expect(safeParseJSON('<think>hmm</think>```json\n{"value": 42}\n```')).toEqual({ value: 42 });
        });

        it('extracts JSON from conversational response', () => {
            const input = 'Here is the result:\n\n{"selected": [1, 2, 3]}\n\nHope this helps!';
            expect(safeParseJSON(input)).toEqual({ selected: [1, 2, 3] });
        });

        it('extracts last JSON object when multiple present', () => {
            const input = '{"noise": "before"} some text {"result": "value"}';
            expect(safeParseJSON(input)).toEqual({ result: 'value' });
        });

        it('returns last block when tool_call noise is larger than payload', () => {
            const input =
                '<tool_call>{"name": "extract_events", "arguments": {"query": "test"}}</tool_call>{"events": []}';
            expect(safeParseJSON(input)).toEqual({ events: [] });
        });

        it('returns last block when tool_call noise is smaller than payload', () => {
            const input =
                '<tool_call>{"name": "x"}</tool_call>{"events": [{"summary": "Alice fought Bob", "importance": 3, "characters_involved": ["Alice", "Bob"]}]}';
            const result = safeParseJSON(input);
            expect(result.events).toHaveLength(1);
            expect(result.events[0].summary).toBe('Alice fought Bob');
        });

        it('returns single block unchanged (common case)', () => {
            const input = '{"events": [{"summary": "test"}]}';
            expect(safeParseJSON(input)).toEqual({ events: [{ summary: 'test' }] });
        });

        it('fixes string concatenation hallucination', () => {
            const input = '{"events": [{"summary": "Alice walked " + "to the garden"}]}';
            const result = safeParseJSON(input);
            expect(result.events[0].summary).toBe('Alice walked to the garden');
        });

        it('fixes multiple concatenations in one input', () => {
            const input = '{"a": "hello " + "world", "b": "foo " + "bar"}';
            const result = safeParseJSON(input);
            expect(result.a).toBe('hello world');
            expect(result.b).toBe('foo bar');
        });

        it('does not break normal JSON without concatenation', () => {
            const input = '{"summary": "no plus signs here"}';
            expect(safeParseJSON(input)).toEqual({ summary: 'no plus signs here' });
        });

        // === TASK 3: Multi-line concatenation tests ===

        it('fixes string concatenation across multiple newlines with + on separate line', () => {
            const input = '{"events": [{"summary": "Alice walked "\n+\n"to the garden"}]}';
            const result = safeParseJSON(input);
            expect(result.events[0].summary).toBe('Alice walked to the garden');
        });

        it('fixes string concatenation with + stranded between multiple blank lines', () => {
            const input = '{"text": "start"\n\n+\n\n"end"}';
            const result = safeParseJSON(input);
            expect(result.text).toBe('startend');
        });

        it('fixes concatenation with CRLF line endings', () => {
            const input = '{"text": "hello"\r\n+\r\n"world"}';
            const result = safeParseJSON(input);
            expect(result.text).toBe('helloworld');
        });

        it('handles mixed concatenation patterns in same input', () => {
            const input = '{"a": "simple " + "case", "b": "multi"\n+\n"line"}';
            const result = safeParseJSON(input);
            expect(result.a).toBe('simple case');
            expect(result.b).toBe('multiline');
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
});
