import { describe, expect, it } from 'vitest';
import { createUsageTracker } from '../../src/utils/usage-tracker.js';

describe('usage-tracker', () => {
    describe('record()', () => {
        it('accumulates full usage data', () => {
            const tracker = createUsageTracker();
            tracker.record({
                model: 'claude-opus-4-7',
                promptTokens: 1000,
                completionTokens: 500,
                cacheReadTokens: 100,
                cacheWriteTokens: 50,
            });

            const summary = tracker.getSummary();
            expect(summary).toContain('1 call');
            expect(summary).toContain('claude-opus-4-7');
            expect(summary).toContain('1.5K tokens');
        });

        it('defaults undefined tokens to 0', () => {
            const tracker = createUsageTracker();
            tracker.record({
                model: 'test-model',
                promptTokens: 100,
            });

            const summary = tracker.getSummary();
            expect(summary).toContain('1 call');
            expect(summary).toContain('100 tokens');
        });

        it('adds "unknown" model when no model provided', () => {
            const tracker = createUsageTracker();
            tracker.record({
                promptTokens: 100,
                completionTokens: 50,
            });

            const summary = tracker.getSummary();
            expect(summary).toContain('unknown');
        });

        it('accumulates across multiple calls', () => {
            const tracker = createUsageTracker();

            tracker.record({
                model: 'claude-opus-4-7',
                promptTokens: 1000,
                completionTokens: 500,
            });

            tracker.record({
                model: 'claude-sonnet-4-6',
                promptTokens: 2000,
                completionTokens: 1000,
            });

            tracker.record({
                model: 'claude-opus-4-7',
                promptTokens: 500,
                completionTokens: 250,
            });

            const summary = tracker.getSummary();
            expect(summary).toContain('3 calls');
            expect(summary).toContain('5.3K tokens');
            expect(summary).toContain('claude-opus-4-7');
            expect(summary).toContain('claude-sonnet-4-6');
        });
    });

    describe('formatTokens()', () => {
        const TOKEN_FORMAT_CASES = [
            { desc: 'zero tokens', input: 0, expected: '0' },
            { desc: 'single token', input: 1, expected: '1' },
            { desc: 'hundreds (<1000)', input: 999, expected: '999' },
            { desc: 'exactly 1000', input: 1000, expected: '1.0K' },
            { desc: '1500 tokens', input: 1500, expected: '1.5K' },
            { desc: '10K tokens', input: 10000, expected: '10K' },
            { desc: '12.3K tokens', input: 12300, expected: '12K' },
            { desc: 'undefined -> N/A', input: undefined, expected: 'N/A' },
            { desc: 'null -> N/A', input: null, expected: 'N/A' },
        ];

        it.each(TOKEN_FORMAT_CASES)('formats $desc', ({ input, expected }) => {
            const tracker = createUsageTracker();
            tracker.record({ model: 'test', promptTokens: input || 0 });
            const summary = tracker.getSummary();
            expect(summary).toContain(expected);
        });
    });

    describe('getSummary()', () => {
        it('shows N/A for missing cache tokens', () => {
            const tracker = createUsageTracker();
            tracker.record({
                model: 'test-model',
                promptTokens: 1000,
                completionTokens: 500,
            });

            const summary = tracker.getSummary();
            expect(summary).toContain('cache: N/A');
        });

        it('shows formatted cache tokens when present', () => {
            const tracker = createUsageTracker();
            tracker.record({
                model: 'test-model',
                promptTokens: 1000,
                completionTokens: 500,
                cacheReadTokens: 2000,
                cacheWriteTokens: 500,
            });

            const summary = tracker.getSummary();
            expect(summary).toContain('cache: 2.0K read / 500 write');
        });

        it('formats single model without comma', () => {
            const tracker = createUsageTracker();
            tracker.record({
                model: 'claude-opus-4-7',
                promptTokens: 1000,
            });

            const summary = tracker.getSummary();
            expect(summary).toContain('models: claude-opus-4-7');
            const modelsLine = summary.split('\n').find((line) => line.startsWith('models:'));
            expect(modelsLine).not.toContain(', ');
        });

        it('formats multiple models with comma separation, sorted alphabetically', () => {
            const tracker = createUsageTracker();

            tracker.record({ model: 'z-model', promptTokens: 100 });
            tracker.record({ model: 'a-model', promptTokens: 100 });
            tracker.record({ model: 'm-model', promptTokens: 100 });

            const summary = tracker.getSummary();
            expect(summary).toContain('a-model, m-model, z-model');
        });

        it('returns no calls message when empty', () => {
            const tracker = createUsageTracker();
            const summary = tracker.getSummary();
            expect(summary).toBe('No LLM calls tracked');
        });
    });
});
