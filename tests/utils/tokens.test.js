import { describe, expect, it } from 'vitest';

const MESSAGE_TOKENS_KEY = 'message_tokens';

describe('getMessageTokenCount', () => {
    it('computes token count for a message and caches it in data', async () => {
        const { getMessageTokenCount } = await import('../../src/utils/tokens.js');

        const chat = [
            { mes: 'Hello, how are you today?', is_user: true },
            { mes: 'I am doing well, thank you for asking!', is_user: false },
        ];
        const data = {};

        const count = getMessageTokenCount(chat, 0, data);

        // Should be a positive integer
        expect(count).toBeGreaterThan(0);
        expect(Number.isInteger(count)).toBe(true);

        // Should cache the result
        expect(data[MESSAGE_TOKENS_KEY]).toBeDefined();
        expect(data[MESSAGE_TOKENS_KEY]['0']).toBe(count);
    });

    it('returns cached count on second call without recomputing', async () => {
        const { getMessageTokenCount } = await import('../../src/utils/tokens.js');

        const chat = [{ mes: 'Test message', is_user: true }];
        const data = { [MESSAGE_TOKENS_KEY]: { 0: 999 } };

        const count = getMessageTokenCount(chat, 0, data);

        // Should return the cached value, not recompute
        expect(count).toBe(999);
    });

    it('handles empty or missing message text', async () => {
        const { getMessageTokenCount } = await import('../../src/utils/tokens.js');

        const chat = [{ mes: '', is_user: true }, { is_user: false }];
        const data = {};

        expect(getMessageTokenCount(chat, 0, data)).toBe(0);
        expect(getMessageTokenCount(chat, 1, data)).toBe(0);
    });
});

describe('getTokenSum', () => {
    it('sums token counts for specified indices', async () => {
        const { getTokenSum } = await import('../../src/utils/tokens.js');

        const chat = [
            { mes: 'Hello world', is_user: true },
            { mes: 'How are you doing today my friend?', is_user: false },
            { mes: 'Great thanks', is_user: true },
        ];
        const data = {};

        const total = getTokenSum(chat, [0, 1, 2], data);

        expect(total).toBeGreaterThan(0);
        expect(Number.isInteger(total)).toBe(true);
    });

    it('returns 0 for empty index list', async () => {
        const { getTokenSum } = await import('../../src/utils/tokens.js');

        const chat = [{ mes: 'Hello', is_user: true }];
        const data = {};

        expect(getTokenSum(chat, [], data)).toBe(0);
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
