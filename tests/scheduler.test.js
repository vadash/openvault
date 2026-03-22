import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROCESSED_MESSAGES_KEY, MEMORIES_KEY } from '../src/constants.js';
import { getBackfillMessageIds, getBackfillStats, getNextBatch, isBatchReady, getFingerprint, migrateProcessedMessages } from '../src/extraction/scheduler.js';

// Timestamp counter for test messages
let testTimestamp = 1000000;

// Helper: build chat with messages
function makeMessage(isUser, text, overrides = {}) {
    return {
        mes: text,
        is_user: isUser,
        send_date: String(testTimestamp++),
        ...overrides
    };
}

// Helper: create chat with messages
function makeChat(messages) {
    return messages.map(([text, isUser]) => makeMessage(isUser, text));
}

beforeEach(async () => {
    const { clearTokenCache } = await import('../src/utils/tokens.js');
    clearTokenCache();
    testTimestamp = 1000000; // Reset timestamp for each test
});

describe('getFingerprint', () => {
    it('returns send_date as string when present', () => {
        const msg = makeMessage(true, 'Hello', { send_date: '1710928374823' });
        const result = getFingerprint(msg);
        expect(result).toBe('1710928374823');
    });

    it('returns content hash when send_date is missing', () => {
        const msg = makeMessage(true, 'Test message', { send_date: undefined, name: 'TestUser' });
        const result = getFingerprint(msg);
        expect(result).toMatch(/^hash_\d+$/);
    });

    it('returns consistent hash for same content', () => {
        const msg1 = makeMessage(true, 'Hello', { send_date: undefined, name: 'User' });
        testTimestamp = 1000000; // Reset for second message
        const msg2 = makeMessage(true, 'Hello', { send_date: undefined, name: 'User' });
        expect(getFingerprint(msg1)).toBe(getFingerprint(msg2));
    });

    it('returns different hashes for different content', () => {
        const msg1 = makeMessage(true, 'Hello', { send_date: undefined, name: 'User1' });
        const msg2 = makeMessage(true, 'Hello', { send_date: undefined, name: 'User2' });
        expect(getFingerprint(msg1)).not.toBe(getFingerprint(msg2));
    });
});

describe('migrateProcessedMessages', () => {
    let chat;
    let data;

    beforeEach(() => {
        testTimestamp = 1000000;  // Reset timestamp counter
        chat = [
            makeMessage(true, 'Hello', { send_date: '1000000', name: 'User1' }),
            makeMessage(false, 'Hi there', { send_date: '1000001', name: 'Bot' }),
            makeMessage(true, 'How are you?', { send_date: '1000002', name: 'User1' }),
            makeMessage(false, 'Doing well!', { send_date: '1000003', name: 'Bot' }),
        ];
        data = {
            [PROCESSED_MESSAGES_KEY]: [0, 2],  // Old format: indices
            [MEMORIES_KEY]: [
                { created_at: 1000002, message_ids: [0] },
                { created_at: 1000003, message_ids: [2] },
            ],
        };
    });

    it('returns false when already migrated (fingerprints)', () => {
        data[PROCESSED_MESSAGES_KEY] = ['1000000', '1000002'];
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(false);
    });

    it('returns false when no processed messages exist', () => {
        data[PROCESSED_MESSAGES_KEY] = [];
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(false);
    });

    it('migrates indices to fingerprints', () => {
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000000');
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000002');
        expect(data[PROCESSED_MESSAGES_KEY]).not.toContain(0);
        expect(data[PROCESSED_MESSAGES_KEY]).not.toContain(2);
    });

    it('includes fingerprints from memory.message_ids', () => {
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        // Should include both processed indices and memory indices
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000000');
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000002');
    });

    it('handles out-of-bounds indices gracefully', () => {
        data[PROCESSED_MESSAGES_KEY] = [0, 5, 10];  // 5 and 10 out of bounds
        data[MEMORIES_KEY] = [{ created_at: 1000002, message_ids: [0] }];  // Only index 0 valid
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000000');
        expect(data[PROCESSED_MESSAGES_KEY].length).toBe(1);
    });

    it('applies temporal guard - skips messages sent after last memory', () => {
        // Message at index 3 was sent at 1000003, but last memory was at 1000002
        data[PROCESSED_MESSAGES_KEY] = [0, 3];  // 3 should be skipped due to temporal guard
        data[MEMORIES_KEY] = [{ created_at: 1000002, message_ids: [0] }];  // Last memory at 1000002
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000000');
        expect(data[PROCESSED_MESSAGES_KEY]).not.toContain('1000003');
    });

    it('deletes last_processed_message_id key', () => {
        data['last_processed_message_id'] = 2;
        migrateProcessedMessages(chat, data);
        expect(data['last_processed_message_id']).toBeUndefined();
    });

    it('handles messages without send_date using hash fallback', () => {
        chat[0].send_date = undefined;
        const expectedHash = getFingerprint(chat[0]);
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        expect(data[PROCESSED_MESSAGES_KEY]).toContain(expectedHash);
    });

    it('handles empty memories array', () => {
        data[MEMORIES_KEY] = [];
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        // Should still migrate processed indices
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000000');
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000002');
    });

    it('handles memories without message_ids', () => {
        data[MEMORIES_KEY] = [{ created_at: 1000002 }];
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000000');
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000002');
    });
});

// Helper: create a chat with enough content for token-based tests
// Each long message should have ~50-100 tokens
const LONG_USER_MESSAGE =
    'This is a very long user message with plenty of content. The user is describing something in great detail, providing context and background information. They continue to elaborate on various points, adding more substance to the conversation. This ensures we have enough tokens for testing the token-based batching logic. The message continues to expand with additional details and information.';

const LONG_BOT_MESSAGE =
    "The bot responds with an equally lengthy and detailed message. It provides comprehensive information in response to the user's query. The response includes multiple points, elaborates on various aspects, and ensures the user receives a thorough answer. The bot continues with more content, adding depth to the conversation. This detailed response helps maintain the token-based testing requirements.";

describe('isBatchReady (token-based)', () => {
    it('returns true when unextracted tokens >= budget', () => {
        const chat = makeChat([
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
        ]);

        // 4 long messages should be ~200-400 tokens total
        expect(isBatchReady(chat, {}, 100)).toBe(true);
    });

    it('returns false when unextracted tokens < budget', () => {
        const chat = makeChat([
            ['Hi', true],
            ['Hello', false],
        ]);

        // 2 short messages = ~3 tokens total
        expect(isBatchReady(chat, {}, 1000)).toBe(false);
    });

    it('excludes already-extracted messages', () => {
        const chat = makeChat([
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
        ]);
        const data = {};
        data[PROCESSED_MESSAGES_KEY] = [0, 1]; // First turn extracted

        // Remaining 2 messages should have enough tokens for a 100-token budget
        expect(isBatchReady(chat, data, 100)).toBe(true);
        // But not enough for a huge budget
        expect(isBatchReady(chat, data, 10000)).toBe(false);
    });
});

describe('getNextBatch (token-based)', () => {
    it('accumulates messages until token budget met, then snaps to turn boundary', () => {
        const chat = makeChat([
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
        ]);

        // Budget for ~1 message - should get [0, 1] as one complete turn
        const batch = getNextBatch(chat, {}, 50);
        expect(batch).not.toBeNull();
        expect(batch.length).toBeGreaterThan(0);
        // Should snap to turn boundary (Bot -> User transition means ending on bot)
        const lastIndex = batch[batch.length - 1];
        expect(chat[lastIndex].is_user).toBe(false);
    });

    it('returns null when total unextracted < budget', () => {
        const chat = makeChat([
            ['Hi', true],
            ['Hello', false],
        ]);

        // Huge budget that can't be met
        expect(getNextBatch(chat, {}, 1000)).toBeNull();
    });

    it('always includes at least 1 message even if it exceeds budget', () => {
        const chat = makeChat([
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            ['Next', true],
        ]);

        // Budget of 5 tokens - the first message exceeds this
        const batch = getNextBatch(chat, {}, 5);
        // Should include at least [0, 1] to complete the turn
        expect(batch).not.toBeNull();
        expect(batch.length).toBeGreaterThan(0);
        // Should end on bot (complete turn)
        expect(chat[batch[batch.length - 1]].is_user).toBe(false);
    });

    it('skips already-extracted messages', () => {
        const chat = makeChat([
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
        ]);
        const data = {};
        data[PROCESSED_MESSAGES_KEY] = [0, 1]; // First turn extracted

        const batch = getNextBatch(chat, data, 50);
        // Should start from index 2
        expect(batch).not.toBeNull();
        expect(batch[0]).toBeGreaterThanOrEqual(2);
        // Should end on bot (complete turn)
        expect(chat[batch[batch.length - 1]].is_user).toBe(false);
    });

    it('snaps back when boundary lands mid-turn', () => {
        const chat = makeChat([
            ['User zero', true],
            ['Bot one', false],
            ['User two', true],
            ['Bot three', false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
        ]);

        // Budget that gets us through the first 4 messages but needs to snap back
        const batch = getNextBatch(chat, {}, 30);
        expect(batch).not.toBeNull();
        // Batch should end on a bot message (complete turn)
        expect(chat[batch[batch.length - 1]].is_user).toBe(false);
    });
});

describe('getBackfillStats (token-based)', () => {
    it('counts complete batches by token budget', () => {
        const chat = makeChat([
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
        ]);

        const stats = getBackfillStats(chat, {}, 100);
        expect(stats.totalUnextracted).toBe(6);
        expect(stats.extractedCount).toBe(0);
        // Should have at least 1 complete batch with 100-token budget
        expect(stats.completeBatches).toBeGreaterThanOrEqual(1);
    });

    it('excludes already-extracted from count', () => {
        const chat = makeChat([
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
        ]);
        const data = {};
        data[PROCESSED_MESSAGES_KEY] = [0, 1];

        const stats = getBackfillStats(chat, data, 100);
        expect(stats.extractedCount).toBe(2);
        expect(stats.totalUnextracted).toBe(2);
    });
});

describe('getBackfillMessageIds (token-based)', () => {
    it('returns complete batches worth of message IDs', () => {
        const chat = makeChat([
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
        ]);

        const result = getBackfillMessageIds(chat, {}, 100);
        expect(result.batchCount).toBeGreaterThanOrEqual(1);
        expect(result.messageIds.length).toBeGreaterThan(0);
    });

    it('returns empty for insufficient tokens', () => {
        const chat = makeChat([
            ['Hi', true],
            ['Hello', false],
        ]);

        const result = getBackfillMessageIds(chat, {}, 10000);
        expect(result.batchCount).toBe(0);
        expect(result.messageIds).toEqual([]);
    });
});
