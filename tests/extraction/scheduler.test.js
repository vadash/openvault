import { beforeEach, describe, expect, it } from 'vitest';
import { MEMORIES_KEY, PROCESSED_MESSAGES_KEY } from '../../src/constants.js';
import {
    getBackfillMessageIds,
    getBackfillStats,
    getFingerprint,
    getNextBatch,
    getProcessedFingerprints,
    getUnextractedMessageIds,
    isBatchReady,
    trimTailTurns,
} from '../../src/extraction/scheduler.js';

// Timestamp counter for test messages
let testTimestamp = 1000000;

// Helper: build chat with messages
function makeMessage(isUser, text, overrides = {}) {
    return {
        mes: text,
        is_user: isUser,
        send_date: String(testTimestamp++),
        ...overrides,
    };
}

// Helper: create chat with messages
function makeChat(messages) {
    return messages.map(([text, isUser]) => makeMessage(isUser, text));
}

// Helper: create data object with processed messages
function makeData(overrides = {}) {
    return {
        [PROCESSED_MESSAGES_KEY]: [],
        [MEMORIES_KEY]: [],
        ...overrides,
    };
}

beforeEach(async () => {
    const { clearTokenCache } = await import('../../src/utils/tokens.js');
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

describe('scheduler with fingerprints', () => {
    let chat;
    let data;
    let settings;

    beforeEach(() => {
        testTimestamp = 1000000;
        chat = [
            makeMessage(true, 'Short', { send_date: '1000000' }),
            makeMessage(true, LONG_USER_MESSAGE, { send_date: '1000001' }),
            makeMessage(true, LONG_USER_MESSAGE, { send_date: '1000002' }),
            makeMessage(true, LONG_USER_MESSAGE, { send_date: '1000003' }),
        ];
        data = { [PROCESSED_MESSAGES_KEY]: [], [MEMORIES_KEY]: [] };
        settings = { extractionTokenBudget: 100 };
    });

    describe('getProcessedFingerprints', () => {
        it('returns set of fingerprint strings', () => {
            data[PROCESSED_MESSAGES_KEY] = ['1000000', '1000002'];
            const result = getProcessedFingerprints(data);
            expect(result.has('1000000')).toBe(true);
            expect(result.has('1000002')).toBe(true);
            expect(result.has('1000001')).toBe(false);
        });
    });

    describe('getUnextractedMessageIds', () => {
        it('returns all indices when no processed messages', () => {
            const fps = getProcessedFingerprints(data);
            const result = getUnextractedMessageIds(chat, fps);
            expect(result).toEqual([0, 1, 2, 3]);
        });

        it('excludes processed messages by fingerprint', () => {
            data[PROCESSED_MESSAGES_KEY] = [chat[0].send_date, chat[2].send_date];
            const fps = getProcessedFingerprints(data);
            const result = getUnextractedMessageIds(chat, fps);
            expect(result).toEqual([1, 3]);
        });

        it('excludes system messages', () => {
            chat[1].is_system = true;
            const fps = getProcessedFingerprints(data);
            const result = getUnextractedMessageIds(chat, fps);
            expect(result).toEqual([0, 2, 3]);
        });

        it('handles messages without send_date using hash', () => {
            chat[0].send_date = undefined;
            const fp = getFingerprint(chat[0]);
            data[PROCESSED_MESSAGES_KEY] = [fp];
            const fps = getProcessedFingerprints(data);
            const result = getUnextractedMessageIds(chat, fps);
            expect(result).toEqual([1, 2, 3]);
        });
    });

    describe('isBatchReady', () => {
        it('returns true when unextracted messages meet token budget', () => {
            const result = isBatchReady(chat, data, settings.extractionTokenBudget);
            expect(result).toBe(true);
        });

        it('returns false when processed messages reduce count below budget', () => {
            // Process first 3 messages, leaving only chat[3] (~50-100 tokens)
            // Use a higher budget (200) that remaining tokens won't meet
            data[PROCESSED_MESSAGES_KEY] = [chat[0].send_date, chat[1].send_date, chat[2].send_date];
            const result = isBatchReady(chat, data, 200);
            expect(result).toBe(false);
        });
    });

    describe('getNextBatch', () => {
        it('returns null when remaining messages do not meet budget', () => {
            data[PROCESSED_MESSAGES_KEY] = [chat[0].send_date, chat[1].send_date];
            // Use a high budget that remaining 2 messages won't meet
            const batch = getNextBatch(chat, data, 1000);
            expect(batch).toBeNull();
        });

        it('returns null when no unextracted messages', () => {
            data[PROCESSED_MESSAGES_KEY] = chat.map((m) => m.send_date);
            const batch = getNextBatch(chat, data, settings.extractionTokenBudget);
            expect(batch).toBeNull();
        });
    });

    describe('getBackfillStats', () => {
        it('calculates correct stats with no processed messages', () => {
            const stats = getBackfillStats(chat, data);
            expect(stats.totalMessages).toBe(4);
            expect(stats.extractedCount).toBe(0);
            expect(stats.unextractedCount).toBe(4);
        });

        it('calculates correct stats with some processed messages', () => {
            data[PROCESSED_MESSAGES_KEY] = [chat[0].send_date, chat[1].send_date];
            const stats = getBackfillStats(chat, data);
            expect(stats.totalMessages).toBe(4);
            expect(stats.extractedCount).toBe(2);
            expect(stats.unextractedCount).toBe(2);
        });

        it('excludes system messages from total', () => {
            chat[0].is_system = true;
            const stats = getBackfillStats(chat, data);
            expect(stats.totalMessages).toBe(3);
        });

        it('handles dead fingerprints (deleted messages)', () => {
            // Simulate dead fingerprint from deleted message
            data[PROCESSED_MESSAGES_KEY] = ['9999999', chat[0].send_date];
            const stats = getBackfillStats(chat, data);
            // extractedCount should be 1 (only chat[0] visible), not 2
            expect(stats.extractedCount).toBe(1);
            expect(stats.unextractedCount).toBe(3);
        });
    });
});

// Helper: create a chat with enough content for token-based tests
// Each long message should have ~50-100 tokens
const LONG_USER_MESSAGE =
    'This is a very long user message with plenty of content. The user is describing something in great detail, providing context and background information. They continue to elaborate on various points, adding more substance to the conversation. This ensures we have enough tokens for testing the token-based batching logic. The message continues to expand with additional details and information.';

const LONG_BOT_MESSAGE =
    "The bot responds with an equally lengthy and detailed message. It provides comprehensive information in response to the user's query. The response includes multiple points, elaborates on various aspects, and ensures the user receives a thorough answer. The bot continues with more content, adding depth to the conversation. This detailed response helps maintain the token-based testing requirements.";

describe('isBatchReady (token-based)', () => {
    let savedTimestamp;

    beforeEach(() => {
        savedTimestamp = testTimestamp;
        testTimestamp = 1000000;
    });

    afterEach(() => {
        testTimestamp = savedTimestamp;
    });

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
        // Use fingerprints (send_date strings) instead of indices
        data[PROCESSED_MESSAGES_KEY] = ['1000000', '1000001']; // First turn extracted

        // Remaining 2 messages should have enough tokens for a 100-token budget
        expect(isBatchReady(chat, data, 100)).toBe(true);
        // But not enough for a huge budget
        expect(isBatchReady(chat, data, 10000)).toBe(false);
    });
});

describe('getNextBatch (token-based)', () => {
    let savedTimestamp;

    beforeEach(() => {
        savedTimestamp = testTimestamp;
        testTimestamp = 1000000;
    });

    afterEach(() => {
        testTimestamp = savedTimestamp;
    });

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
        // Use fingerprints (send_date strings) instead of indices
        data[PROCESSED_MESSAGES_KEY] = ['1000000', '1000001']; // First turn extracted

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

describe('trimTailTurns', () => {
    it('trims 1 turn from a 5-turn snapped batch', () => {
        // 5 turns: U,B, U,B, U,B, U,B, U,B
        const chat = makeChat([
            ['u1', true],
            ['b1', false],
            ['u2', true],
            ['b2', false],
            ['u3', true],
            ['b3', false],
            ['u4', true],
            ['b4', false],
            ['u5', true],
            ['b5', false],
        ]);
        const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        const result = trimTailTurns(chat, ids, 1);
        // Turn 5 (ids 8,9) trimmed → [0..7]
        expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it('returns original when trimming would empty the batch', () => {
        // Single turn: U, B — trimming 1 turn would empty it
        const chat = makeChat([
            ['u1', true],
            ['b1', false],
        ]);
        const ids = [0, 1];
        const result = trimTailTurns(chat, ids, 1);
        expect(result).toBe(ids); // Same reference, not trimmed
    });

    it('handles multi-message turns (U,U,B,B counts as 1 turn)', () => {
        // Turn 1: U, U, B, B
        // Turn 2: U, B
        const chat = makeChat([
            ['u1', true],
            ['u2', true],
            ['b1', false],
            ['b2', false],
            ['u3', true],
            ['b3', false],
        ]);
        const ids = [0, 1, 2, 3, 4, 5];
        const result = trimTailTurns(chat, ids, 1);
        // Turn 2 (ids 4,5) trimmed → [0..3]
        expect(result).toEqual([0, 1, 2, 3]);
    });

    it('trims 2 turns from a 4-turn batch', () => {
        const chat = makeChat([
            ['u1', true],
            ['b1', false],
            ['u2', true],
            ['b2', false],
            ['u3', true],
            ['b3', false],
            ['u4', true],
            ['b4', false],
        ]);
        const ids = [0, 1, 2, 3, 4, 5, 6, 7];
        const result = trimTailTurns(chat, ids, 2);
        // Turns 3+4 (ids 4..7) trimmed → [0..3]
        expect(result).toEqual([0, 1, 2, 3]);
    });

    it('returns original when chat has only user messages (no Bot→User boundary)', () => {
        const chat = makeChat([
            ['u1', true],
            ['u2', true],
            ['u3', true],
        ]);
        const ids = [0, 1, 2];
        const result = trimTailTurns(chat, ids, 1);
        // No bot message → no turn boundary found → can't trim → return original
        expect(result).toBe(ids);
    });
});

describe('getNextBatch swipe protection', () => {
    it('excludes the last turn from extraction', () => {
        const chat = makeChat([
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
        ]);
        // Budget = exact total tokens (402). Accumulation gathers all 6 msgs,
        // snaps to 3 complete turns. Trim removes last turn → turns 1+2 only.
        const batch = getNextBatch(chat, {}, 402);
        expect(batch).not.toBeNull();
        expect(batch).toEqual([0, 1, 2, 3]);
    });

    it('does not trim when isEmergencyCut is true', () => {
        const chat = makeChat([
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
        ]);
        const batch = getNextBatch(chat, {}, 1, true);
        // Emergency Cut: no trimming, should get all messages
        expect(batch).not.toBeNull();
        expect(batch).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('returns the single turn when only 1 turn exists (trimTailTurns protects it)', () => {
        const chat = makeChat([
            [LONG_USER_MESSAGE, true],
            [LONG_BOT_MESSAGE, false],
        ]);
        // Budget = exact total tokens for 1 turn. Accumulation gets both msgs,
        // snaps to 1 turn. Trim would empty → helper returns original.
        const batch = getNextBatch(chat, {}, 134);
        expect(batch).not.toBeNull();
        expect(batch).toEqual([0, 1]);
    });
});

describe('getNextBatch with all-User messages', () => {
    it('should extract User-only messages during Emergency Cut', () => {
        const chat = makeChat([
            ['u1', true], // User
            ['u2', true], // User
            ['u3', true], // User
        ]);
        const data = makeData();
        const tokenBudget = 100;
        const isEmergencyCut = true;

        const result = getNextBatch(chat, data, tokenBudget, isEmergencyCut);

        // Should return all messages during Emergency Cut, even without Bot messages
        expect(result).not.toBeNull();
        expect(result.length).toBe(3);
    });

    it('should handle queue with only User messages gracefully', () => {
        const chat = makeChat([
            ['u1', true], // User
            ['u2', true], // User
        ]);
        const data = makeData();
        // Set high token count to force extraction
        data.processedFingerprints = new Set();

        const result = getNextBatch(chat, data, 10, false);

        // Should not stall - either return messages or null, not empty array
        // that causes infinite loop
        expect(result === null || result.length > 0).toBe(true);
    });
});

describe('trimTailTurns — system messages', () => {
    it('finds Bot→User boundary with system message in between', async () => {
        const { trimTailTurns } = await import('../../src/extraction/scheduler.js');

        // U(0) B(1) SYS(2) U(3) B(4) SYS(5) U(6)
        const systemChat = [
            { mes: 'u0', is_user: true, is_system: false },
            { mes: 'b1', is_user: false, is_system: false },
            { mes: 'sys', is_user: false, is_system: true },
            { mes: 'u3', is_user: true, is_system: false },
            { mes: 'b4', is_user: false, is_system: false },
            { mes: 'sys2', is_user: false, is_system: true },
            { mes: 'u6', is_user: true, is_system: false },
        ];

        // Trim 1 turn from tail — should find B(4)→U(6) boundary past SYS(5)
        const result = trimTailTurns(systemChat, [0, 1, 2, 3, 4, 5, 6], 1);
        expect(result.length).toBeLessThan(7);
        expect(result.length).toBeGreaterThan(0);
    });

    it('trims correctly when system message blocks boundary detection', async () => {
        const { trimTailTurns } = await import('../../src/extraction/scheduler.js');

        // U(0) B(1) SYS(2) U(3) U(4) B(5)
        const systemChat = [
            { mes: 'u0', is_user: true, is_system: false },
            { mes: 'b1', is_user: false, is_system: false },
            { mes: 'sys', is_user: false, is_system: true },
            { mes: 'u3', is_user: true, is_system: false },
            { mes: 'u4', is_user: true, is_system: false },
            { mes: 'b5', is_user: false, is_system: false },
        ];

        // Without fix, B(1)→SYS(2) would fail boundary detection
        // With fix, B(1)→U(3) should be found past SYS(2)
        // However, B(5) is still found first (end of chat is a valid boundary)
        // So we trim from B(5), removing U(3) U(4) B(5) and leaving [0, 1]
        const result = trimTailTurns(systemChat, [0, 1, 3, 4, 5], 1);
        expect(result).toEqual([0, 1]);
    });
});
