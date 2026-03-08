import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDeps } from '../src/deps.js';

describe('autoHideOldMessages (token-based)', () => {
    let mockChat;
    let mockData;
    let saveFn;

    beforeEach(() => {
        saveFn = vi.fn(async () => true);

        // 8 messages: U B U B U B U B
        // Each with 500 cached tokens = 4000 total visible
        mockChat = [
            { mes: 'u0', is_user: true, is_system: false },
            { mes: 'b1', is_user: false, is_system: false },
            { mes: 'u2', is_user: true, is_system: false },
            { mes: 'b3', is_user: false, is_system: false },
            { mes: 'u4', is_user: true, is_system: false },
            { mes: 'b5', is_user: false, is_system: false },
            { mes: 'u6', is_user: true, is_system: false },
            { mes: 'b7', is_user: false, is_system: false },
        ];

        mockData = {
            memories: [],
            processed_message_ids: [0, 1, 2, 3, 4, 5, 6, 7], // All extracted
            // Cache key format: `${index}_${textLength}`
            message_tokens: {
                '0_2': 500,
                '1_2': 500,
                '2_2': 500,
                '3_2': 500,
                '4_2': 500,
                '5_2': 500,
                '6_2': 500,
                '7_2': 500,
            },
        };

        setupTestContext({
            context: {
                chat: mockChat,
                chatMetadata: { openvault: mockData },
                name1: 'User',
                name2: 'Bot',
                chatId: 'test',
            },
            settings: {
                enabled: true,
                autoHideEnabled: true,
                visibleChatBudget: 2000, // 4 messages worth (2000 of 4000)
            },
            deps: {
                saveChatConditional: saveFn,
            },
        });
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('hides oldest extracted messages to bring visible tokens under budget', async () => {
        // Import after setup so deps are injected
        const { autoHideOldMessages } = await import('../src/events.js');

        await autoHideOldMessages();

        // 4000 total, budget 2000 → excess 2000 → hide first 4 messages (2000 tokens)
        // Snap: after index 3, next is U(4) ✓
        expect(mockChat[0].is_system).toBe(true);
        expect(mockChat[1].is_system).toBe(true);
        expect(mockChat[2].is_system).toBe(true);
        expect(mockChat[3].is_system).toBe(true);
        // Rest stay visible
        expect(mockChat[4].is_system).toBe(false);
        expect(mockChat[5].is_system).toBe(false);
        expect(mockChat[6].is_system).toBe(false);
        expect(mockChat[7].is_system).toBe(false);

        expect(saveFn).toHaveBeenCalled();
    });

    it('does not hide when under budget', async () => {
        // Re-setup with budget higher than total (4000)
        setupTestContext({
            context: {
                chat: mockChat,
                chatMetadata: { openvault: mockData },
                name1: 'User',
                name2: 'Bot',
                chatId: 'test',
            },
            settings: {
                enabled: true,
                autoHideEnabled: true,
                visibleChatBudget: 5000,
            },
            deps: {
                saveChatConditional: saveFn,
            },
        });

        const { autoHideOldMessages } = await import('../src/events.js');
        await autoHideOldMessages();

        // Nothing hidden
        for (const msg of mockChat) {
            expect(msg.is_system).toBe(false);
        }
        expect(saveFn).not.toHaveBeenCalled();
    });

    it('skips unextracted messages and continues past them', async () => {
        // Mark messages 2,3 as NOT extracted
        mockData.processed_message_ids = [0, 1, 4, 5, 6, 7];
        mockData.memories = [];

        const { autoHideOldMessages } = await import('../src/events.js');
        await autoHideOldMessages();

        // excess = 2000 tokens. Hide 0,1 (extracted, 1000 tokens), skip 2,3 (unextracted),
        // continue with 4,5 (extracted, 1000 tokens) → total hidden = 2000
        // Snap after 1: next is U(2) ✓. Snap after 5: next is U(6) ✓.
        expect(mockChat[0].is_system).toBe(true);
        expect(mockChat[1].is_system).toBe(true);
        expect(mockChat[2].is_system).toBe(false); // Unextracted, skipped
        expect(mockChat[3].is_system).toBe(false); // Unextracted, skipped
        expect(mockChat[4].is_system).toBe(true);
        expect(mockChat[5].is_system).toBe(true);
    });

    it('respects turn boundaries — does not split mid-turn', async () => {
        // Budget 2500: excess = 1500. Accumulate oldest: 0(500), 1(500), 2(500) = 1500
        // But after index 2 (User), next is B(3) ✗ → snap back to index 1 (next is U(2) ✓)
        // So only 0,1 hidden (1000 tokens)
        setupTestContext({
            context: {
                chat: mockChat,
                chatMetadata: { openvault: mockData },
                name1: 'User',
                name2: 'Bot',
                chatId: 'test',
            },
            settings: {
                enabled: true,
                autoHideEnabled: true,
                visibleChatBudget: 2500,
            },
            deps: {
                saveChatConditional: saveFn,
            },
        });

        const { autoHideOldMessages } = await import('../src/events.js');
        await autoHideOldMessages();

        expect(mockChat[0].is_system).toBe(true);
        expect(mockChat[1].is_system).toBe(true);
        expect(mockChat[2].is_system).toBe(false); // Not hidden (would break turn)
    });
});
