import { beforeEach, describe, expect, it } from 'vitest';

describe('countTurns', () => {
    it('returns 0 for empty message list', async () => {
        const { countTurns } = await import('../../src/utils/tokens.js');
        const chat = [{ mes: 'hi', is_user: true }];
        expect(countTurns(chat, [])).toBe(0);
    });

    it('returns 0 for single User message (incomplete turn)', async () => {
        const { countTurns } = await import('../../src/utils/tokens.js');
        const chat = [{ mes: 'hi', is_user: true, is_system: false }];
        expect(countTurns(chat, [0])).toBe(0);
    });

    it('returns 1 for one full User+Bot pair', async () => {
        const { countTurns } = await import('../../src/utils/tokens.js');
        const chat = [
            { mes: 'hi', is_user: true, is_system: false },
            { mes: 'hello', is_user: false, is_system: false },
        ];
        expect(countTurns(chat, [0, 1])).toBe(1);
    });

    it('skips interleaved system messages', async () => {
        const { countTurns } = await import('../../src/utils/tokens.js');
        const chat = [
            { mes: 'hi', is_user: true, is_system: false },
            { mes: 'sys', is_user: false, is_system: true },
            { mes: 'hello', is_user: false, is_system: false },
        ];
        // System message at index 1 is skipped, Bot at index 2 completes 1 turn
        expect(countTurns(chat, [0, 1, 2])).toBe(1);
    });

    it('counts multiple turns correctly', async () => {
        const { countTurns } = await import('../../src/utils/tokens.js');
        const chat = [
            { mes: 'u0', is_user: true, is_system: false },
            { mes: 'b1', is_user: false, is_system: false },
            { mes: 'u2', is_user: true, is_system: false },
            { mes: 'b3', is_user: false, is_system: false },
            { mes: 'u4', is_user: true, is_system: false },
            { mes: 'b5', is_user: false, is_system: false },
        ];
        expect(countTurns(chat, [0, 1, 2, 3, 4, 5])).toBe(3);
    });

    it('counts turns correctly with trailing user message (incomplete turn)', async () => {
        const { countTurns } = await import('../../src/utils/tokens.js');
        const chat = [
            { mes: 'u0', is_user: true, is_system: false },
            { mes: 'b1', is_user: false, is_system: false },
            { mes: 'u2', is_user: true, is_system: false },
        ];
        // One complete turn (U+B), then trailing User with no Bot reply
        expect(countTurns(chat, [0, 1, 2])).toBe(1);
    });

    it('counts only Bot messages that follow a User in the filtered list', async () => {
        const { countTurns } = await import('../../src/utils/tokens.js');
        const chat = [
            { mes: 'b0', is_user: false, is_system: false },
            { mes: 'u1', is_user: true, is_system: false },
            { mes: 'b2', is_user: false, is_system: false },
        ];
        // Only the Bot at index 2 counts as a turn (follows User)
        expect(countTurns(chat, [0, 1, 2])).toBe(1);
    });
});

describe('countTokens', () => {
    it('exports countTokens function', async () => {
        const { countTokens } = await import('../../src/utils/tokens.js');
        expect(typeof countTokens).toBe('function');
        expect(countTokens('hello world')).toBeGreaterThan(0);
    });
});

describe('getMessageTokenCount', () => {
    beforeEach(async () => {
        const { clearTokenCache } = await import('../../src/utils/tokens.js');
        clearTokenCache();
    });

    it('computes token count for a message', async () => {
        const { getMessageTokenCount } = await import('../../src/utils/tokens.js');
        const chat = [{ mes: 'Hello, how are you today?', is_user: true }];
        const count = getMessageTokenCount(chat, 0);
        expect(count).toBeGreaterThan(0);
        expect(Number.isInteger(count)).toBe(true);
    });

    it('returns cached count on second call', async () => {
        const { getMessageTokenCount } = await import('../../src/utils/tokens.js');
        const chat = [{ mes: 'Test message for caching', is_user: true }];
        const count1 = getMessageTokenCount(chat, 0);
        const count2 = getMessageTokenCount(chat, 0);
        expect(count1).toBe(count2);
    });

    it('handles empty or missing message text', async () => {
        const { getMessageTokenCount } = await import('../../src/utils/tokens.js');
        const chat = [{ mes: '', is_user: true }, { is_user: false }];
        expect(getMessageTokenCount(chat, 0)).toBe(0);
        expect(getMessageTokenCount(chat, 1)).toBe(0);
    });
});

describe('getTokenSum', () => {
    beforeEach(async () => {
        const { clearTokenCache } = await import('../../src/utils/tokens.js');
        clearTokenCache();
    });

    it('sums token counts for specified indices', async () => {
        const { getTokenSum } = await import('../../src/utils/tokens.js');
        const chat = [
            { mes: 'Hello world', is_user: true },
            { mes: 'How are you doing today?', is_user: false },
            { mes: 'Great thanks', is_user: true },
        ];
        const total = getTokenSum(chat, [0, 1, 2]);
        expect(total).toBeGreaterThan(0);
        expect(Number.isInteger(total)).toBe(true);
    });

    it('returns 0 for empty index list', async () => {
        const { getTokenSum } = await import('../../src/utils/tokens.js');
        expect(getTokenSum([], [])).toBe(0);
    });
});

describe('clearTokenCache', () => {
    it('clears the cache so counts are recomputed', async () => {
        const { getMessageTokenCount, clearTokenCache } = await import('../../src/utils/tokens.js');
        const chat = [{ mes: 'Cached message', is_user: true }];
        getMessageTokenCount(chat, 0);
        clearTokenCache();
        // After clear, should recompute (same result, but from scratch)
        const count = getMessageTokenCount(chat, 0);
        expect(count).toBeGreaterThan(0);
    });
});

describe('snapToTurnBoundary', () => {
    it('keeps split valid when next message is User', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) U(2) B(3)
        const chat = [
            { mes: 'hi', is_user: true },
            { mes: 'hello', is_user: false },
            { mes: 'how are you', is_user: true },
            { mes: 'fine', is_user: false },
        ];

        // Split after index 1 -> next is U(2) ✓
        const result = snapToTurnBoundary(chat, [0, 1]);
        expect(result).toEqual([0, 1]);
    });

    it('keeps split valid at end of chat', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        const chat = [
            { mes: 'hi', is_user: true },
            { mes: 'hello', is_user: false },
        ];

        // Split after index 1 -> end of chat ✓
        const result = snapToTurnBoundary(chat, [0, 1]);
        expect(result).toEqual([0, 1]);
    });

    it('snaps back when next message is Bot', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) U(2) B(3) U(4) U(5) B(6) B(7)
        const chat = [
            { mes: 'u0', is_user: true },
            { mes: 'b1', is_user: false },
            { mes: 'u2', is_user: true },
            { mes: 'b3', is_user: false },
            { mes: 'u4', is_user: true },
            { mes: 'u5', is_user: true },
            { mes: 'b6', is_user: false },
            { mes: 'b7', is_user: false },
        ];

        // Split after index 5 -> next is B(6) ✗ -> snap back to index 3 (next is U(4) ✓)
        const result = snapToTurnBoundary(chat, [0, 1, 2, 3, 4, 5]);
        expect(result).toEqual([0, 1, 2, 3]);
    });

    it('handles consecutive user messages correctly', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) U(2) U(3) B(4)
        const chat = [
            { mes: 'u0', is_user: true },
            { mes: 'b1', is_user: false },
            { mes: 'u2', is_user: true },
            { mes: 'u3', is_user: true },
            { mes: 'b4', is_user: false },
        ];

        // Split after index 3 -> next is B(4) ✗ -> snap back to index 1 (next is U(2) ✓)
        const result = snapToTurnBoundary(chat, [0, 1, 2, 3]);
        expect(result).toEqual([0, 1]);
    });

    it('returns empty array if no valid boundary found', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // B(0) B(1)
        const chat = [
            { mes: 'b0', is_user: false },
            { mes: 'b1', is_user: false },
            { mes: 'b2', is_user: false },
        ];

        // [0, 1] -> next is B(2) ✗ -> snap back, but no index has a User next -> []
        const result = snapToTurnBoundary(chat, [0, 1]);
        expect(result).toEqual([]);
    });

    it('returns empty array for empty input', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        const chat = [{ mes: 'hi', is_user: true }];
        expect(snapToTurnBoundary(chat, [])).toEqual([]);
    });

    it('handles non-contiguous indices', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) U(2) B(3) U(4) B(5)
        const chat = [
            { mes: 'u0', is_user: true },
            { mes: 'b1', is_user: false },
            { mes: 'u2', is_user: true },
            { mes: 'b3', is_user: false },
            { mes: 'u4', is_user: true },
            { mes: 'b5', is_user: false },
        ];

        // Non-contiguous: indices [0, 1, 4, 5]
        // Split after index 5 -> end of chat ✓
        const result = snapToTurnBoundary(chat, [0, 1, 4, 5]);
        expect(result).toEqual([0, 1, 4, 5]);
    });

    it('snaps back non-contiguous to valid boundary', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) U(2) B(3) U(4) B(5) B(6)
        const chat = [
            { mes: 'u0', is_user: true },
            { mes: 'b1', is_user: false },
            { mes: 'u2', is_user: true },
            { mes: 'b3', is_user: false },
            { mes: 'u4', is_user: true },
            { mes: 'b5', is_user: false },
            { mes: 'b6', is_user: false },
        ];

        // Non-contiguous: indices [2, 3, 4, 5]
        // Split after index 5 -> next is B(6) ✗ -> snap back to index 3 (next is U(4) ✓)
        const result = snapToTurnBoundary(chat, [2, 3, 4, 5]);
        expect(result).toEqual([2, 3]);
    });
});

describe('snapToTurnBoundary — system messages', () => {
    it('finds boundary when system message sits between Bot and User', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) SYS(2) U(3)
        const chat = [
            { mes: 'u0', is_user: true, is_system: false },
            { mes: 'b1', is_user: false, is_system: false },
            { mes: 'note', is_user: false, is_system: true }, // Author's Note
            { mes: 'u3', is_user: true, is_system: false },
        ];

        // After index 1 (Bot), next non-system is U(3) → valid boundary
        const result = snapToTurnBoundary(chat, [0, 1]);
        expect(result).toEqual([0, 1]);
    });

    it('finds boundary when multiple system messages sit between Bot and User', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) SYS(2) SYS(3) U(4)
        const chat = [
            { mes: 'u0', is_user: true, is_system: false },
            { mes: 'b1', is_user: false, is_system: false },
            { mes: 'sys1', is_user: false, is_system: true },
            { mes: 'sys2', is_user: true, is_system: true },
            { mes: 'u4', is_user: true, is_system: false },
        ];

        const result = snapToTurnBoundary(chat, [0, 1]);
        expect(result).toEqual([0, 1]);
    });

    it('returns empty when system message blocks boundary from reaching User', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // B(0) SYS(1) B(2)
        const chat = [
            { mes: 'b0', is_user: false, is_system: false },
            { mes: 'sys', is_user: false, is_system: true },
            { mes: 'b2', is_user: false, is_system: false },
        ];

        const result = snapToTurnBoundary(chat, [0]);
        expect(result).toEqual([]);
    });

    it('finds boundary when system message has is_user true', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) SYS(is_user:true)(2) U(3)
        const chat = [
            { mes: 'u0', is_user: true, is_system: false },
            { mes: 'b1', is_user: false, is_system: false },
            { mes: 'note', is_user: true, is_system: true }, // ST hidden with is_user
            { mes: 'u3', is_user: true, is_system: false },
        ];

        const result = snapToTurnBoundary(chat, [0, 1]);
        expect(result).toEqual([0, 1]);
    });
});
