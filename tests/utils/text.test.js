import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDeps } from '../../src/deps.js';
import { safeParseJSON, sliceToTokenBudget, sortMemoriesBySequence, stripThinkingTags } from '../../src/utils/text.js';

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

        it('extracts first JSON object when multiple present', () => {
            const input = '{"result": {"data": [1]}} some text {"other": "value"}';
            expect(safeParseJSON(input)).toEqual({ result: { data: [1] } });
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
});
