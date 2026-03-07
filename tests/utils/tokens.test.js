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
