import { describe, expect, it } from 'vitest';
import { PROCESSED_MESSAGES_KEY } from '../src/constants.js';
import { getBackfillMessageIds, getBackfillStats, getNextBatch, isBatchReady } from '../src/extraction/scheduler.js';

// Helper: build chat with known token sizes.
// Each 'x'.repeat(N) ≈ N/3.5 tokens with estimateTokens, but with gpt-tokenizer
// we need actual text. Use repeated words for predictable counts.
// "word " is 1 token in o200k. We'll use a helper that creates N-token messages.
function makeMessage(isUser, text) {
    return { mes: text, is_user: isUser };
}

// o200k tokenizes "hello " as roughly 1 token per word.
// For predictable tests, use pre-cached data instead.
function makeChatWithCachedTokens(messages, tokenCounts) {
    const chat = messages.map(([text, isUser]) => makeMessage(isUser, text));
    const data = {
        message_tokens: Object.fromEntries(tokenCounts.map((count, i) => [String(i), count])),
    };
    return { chat, data };
}

describe('isBatchReady (token-based)', () => {
    it('returns true when unextracted tokens >= budget', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['u0', true],
                ['b1', false],
                ['u2', true],
                ['b3', false],
            ],
            [500, 500, 500, 500] // total: 2000
        );

        expect(isBatchReady(chat, data, 2000)).toBe(true);
        expect(isBatchReady(chat, data, 1999)).toBe(true);
    });

    it('returns false when unextracted tokens < budget', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['u0', true],
                ['b1', false],
            ],
            [500, 500] // total: 1000
        );

        expect(isBatchReady(chat, data, 1001)).toBe(false);
    });

    it('excludes already-extracted messages', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['u0', true],
                ['b1', false],
                ['u2', true],
                ['b3', false],
            ],
            [500, 500, 500, 500]
        );
        data[PROCESSED_MESSAGES_KEY] = [0, 1]; // 1000 tokens extracted

        expect(isBatchReady(chat, data, 1000)).toBe(true); // 1000 unextracted
        expect(isBatchReady(chat, data, 1001)).toBe(false);
    });
});

describe('getNextBatch (token-based)', () => {
    it('accumulates messages until token budget met, then snaps to turn boundary', () => {
        // U(0):500 B(1):500 U(2):500 B(3):500 U(4):500 B(5):500
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['u0', true],
                ['b1', false],
                ['u2', true],
                ['b3', false],
                ['u4', true],
                ['b5', false],
            ],
            [500, 500, 500, 500, 500, 500]
        );

        // Budget 1000: accumulate [0,1] (1000 tokens) → next is U(2) ✓
        const batch = getNextBatch(chat, data, 1000);
        expect(batch).toEqual([0, 1]);
    });

    it('returns null when total unextracted < budget', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['u0', true],
                ['b1', false],
            ],
            [400, 400] // total 800
        );

        expect(getNextBatch(chat, data, 1000)).toBeNull();
    });

    it('always includes at least 1 message even if it exceeds budget', () => {
        // Single huge message
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['huge', true],
                ['reply', false],
                ['next', true],
            ],
            [50000, 100, 100] // total > 1000
        );

        const batch = getNextBatch(chat, data, 1000);
        // Should include at least message 0, then snap
        // After 0: next is B(1) ✗ → but we can't snap further back → []
        // Actually, accumulate: [0] = 50000 ≥ 1000 → snap [0]
        // After index 0: next is B(1) ✗ → snap back → []
        // Since batch would be empty, include the full turn: [0, 1]
        // After index 1: next is U(2) ✓
        expect(batch).not.toBeNull();
        expect(batch.length).toBeGreaterThan(0);
    });

    it('skips already-extracted messages', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['u0', true],
                ['b1', false],
                ['u2', true],
                ['b3', false],
                ['u4', true],
                ['b5', false],
            ],
            [500, 500, 500, 500, 500, 500]
        );
        data[PROCESSED_MESSAGES_KEY] = [0, 1];

        // Budget 1000: accumulate from unextracted [2,3] (1000) → next is U(4) ✓
        const batch = getNextBatch(chat, data, 1000);
        expect(batch).toEqual([2, 3]);
    });

    it('snaps back when boundary lands mid-turn', () => {
        // U(0):100 B(1):100 U(2):100 B(3):100 U(4):100 B(5):100 B(6):100
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['u0', true],
                ['b1', false],
                ['u2', true],
                ['b3', false],
                ['u4', true],
                ['b5', false],
                ['b6', false],
            ],
            [100, 100, 100, 100, 100, 100, 100]
        );

        // Budget 500: accumulate [0,1,2,3,4] (500 tokens)
        // After index 4: next is B(5) ✗ → snap back to index 3 (next is U(4) ✓)
        const batch = getNextBatch(chat, data, 500);
        expect(batch).toEqual([0, 1, 2, 3]);
    });
});

describe('getBackfillStats (token-based)', () => {
    it('counts complete batches by token budget', () => {
        // 6 messages × 500 tokens = 3000 total
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['u0', true],
                ['b1', false],
                ['u2', true],
                ['b3', false],
                ['u4', true],
                ['b5', false],
            ],
            [500, 500, 500, 500, 500, 500]
        );

        const stats = getBackfillStats(chat, data, 1000);
        expect(stats.totalUnextracted).toBe(6);
        expect(stats.extractedCount).toBe(0);
        // At least 1 complete batch of 1000 tokens
        expect(stats.completeBatches).toBeGreaterThanOrEqual(1);
    });

    it('excludes already-extracted from count', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['u0', true],
                ['b1', false],
                ['u2', true],
                ['b3', false],
            ],
            [500, 500, 500, 500]
        );
        data[PROCESSED_MESSAGES_KEY] = [0, 1];

        const stats = getBackfillStats(chat, data, 1000);
        expect(stats.extractedCount).toBe(2);
        expect(stats.totalUnextracted).toBe(2);
    });
});

describe('getBackfillMessageIds (token-based)', () => {
    it('returns complete batches worth of message IDs', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['u0', true],
                ['b1', false],
                ['u2', true],
                ['b3', false],
                ['u4', true],
                ['b5', false],
            ],
            [500, 500, 500, 500, 500, 500]
        );

        const result = getBackfillMessageIds(chat, data, 1000);
        expect(result.batchCount).toBeGreaterThanOrEqual(1);
        expect(result.messageIds.length).toBeGreaterThan(0);
    });

    it('returns empty for insufficient tokens', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['u0', true],
                ['b1', false],
            ],
            [100, 100] // 200 total
        );

        const result = getBackfillMessageIds(chat, data, 1000);
        expect(result.batchCount).toBe(0);
        expect(result.messageIds).toEqual([]);
    });
});
