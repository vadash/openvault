/**
 * Tests for src/extraction/scheduler.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { estimateTokens } from '../src/utils.js';
import {
    getExtractedMessageIds,
    getUnextractedMessageIds,
    isBatchReady,
    getNextBatch,
    getBackfillStats,
    getBackfillMessageIds,
} from '../src/extraction/scheduler.js';
import { MEMORIES_KEY, PROCESSED_MESSAGES_KEY } from '../src/constants.js';

describe('scheduler token-aware batching', () => {
    it('limits batch to maxTokens parameter', () => {
        // Create chat with very long messages
        const longMessage = 'x'.repeat(2000); // ~570 tokens
        const chat = [
            { mes: longMessage, is_user: true },   // ~570 tokens
            { mes: longMessage, is_user: false },  // ~570 tokens
            { mes: longMessage, is_user: true },   // ~570 tokens
            { mes: longMessage, is_user: false },  // ~570 tokens
            { mes: longMessage, is_user: true },   // ~570 tokens
            { mes: longMessage, is_user: false },  // ~570 tokens
            { mes: longMessage, is_user: true },   // ~570 tokens
            { mes: longMessage, is_user: false },  // ~570 tokens
            { mes: longMessage, is_user: true },   // ~570 tokens
            { mes: longMessage, is_user: false },  // ~570 tokens
            { mes: 'short', is_user: false },      // ~2 tokens
        ];

        const data = {};

        // Request batch with 1200 token limit
        const batch = getNextBatch(chat, data, 10, 0, 1200);

        // Should only include first 2 messages (1140 tokens) then stop before 3rd (1710 > 1200)
        expect(batch).not.toBeNull();
        expect(batch.length).toBe(2);

        // Verify tokens are within limit
        const totalTokens = batch.reduce((sum, id) => sum + estimateTokens(chat[id].mes), 0);
        expect(totalTokens).toBeLessThanOrEqual(1200);
    });

    it('handles all short messages within token limit', () => {
        const chat = [
            { mes: 'hi', is_user: true },
            { mes: 'hello', is_user: false },
            { mes: 'hey', is_user: true },
            { mes: 'hi there', is_user: false },
            { mes: 'howdy', is_user: true },
            { mes: 'greetings', is_user: false },
            { mes: 'salutations', is_user: true },
            { mes: 'yo', is_user: false },
            { mes: 'sup', is_user: true },
            { mes: 'bonjour', is_user: false },
            { mes: 'hola', is_user: true },
        ];

        const data = {};
        const batch = getNextBatch(chat, data, 10, 0, 6000);

        // All messages should be included
        expect(batch).not.toBeNull();
        expect(batch.length).toBe(10);
    });

    it('returns null if no complete batch available', () => {
        const chat = [
            { mes: 'message 1', is_user: true },
            { mes: 'message 2', is_user: false },
        ];

        const data = {};
        const batch = getNextBatch(chat, data, 5, 0, 6000);

        // Less than batchSize (5), should return null
        expect(batch).toBeNull();
    });

    it('excludes bufferSize messages from batch', () => {
        const chat = [
            { mes: 'msg1', is_user: true },
            { mes: 'msg2', is_user: false },
            { mes: 'msg3', is_user: true },
            { mes: 'msg4', is_user: false },
            { mes: 'msg5', is_user: true },
        ];

        const data = {};
        const batch = getNextBatch(chat, data, 2, 2, 6000); // batchSize=2, bufferSize=2

        // Should exclude last 2 messages (3 and 4), return first 2 (0 and 1)
        expect(batch).not.toBeNull();
        expect(batch).toEqual([0, 1]);
    });

    it('respects extracted message tracking', () => {
        const chat = [
            { mes: 'msg1', is_user: true },
            { mes: 'msg2', is_user: false },
            { mes: 'msg3', is_user: true },
            { mes: 'msg4', is_user: false },
        ];

        const data = {
            [PROCESSED_MESSAGES_KEY]: [0, 1] // Already extracted
        };

        const batch = getNextBatch(chat, data, 2, 0, 6000);

        // Should only return unextracted messages
        expect(batch).not.toBeNull();
        expect(batch).toEqual([2, 3]);
    });

    it('without maxTokens parameter, uses count-based batching', () => {
        const chat = [
            { mes: 'msg1', is_user: true },
            { mes: 'msg2', is_user: false },
            { mes: 'msg3', is_user: true },
            { mes: 'msg4', is_user: false },
            { mes: 'msg5', is_user: true },
            { mes: 'msg6', is_user: false },
            { mes: 'msg7', is_user: true },
            { mes: 'msg8', is_user: false },
            { mes: 'msg9', is_user: true },
            { mes: 'msg10', is_user: false },
        ];

        const data = {};
        const batch = getNextBatch(chat, data, 3, 0); // No maxTokens

        // Should return exactly batchSize messages
        expect(batch).not.toBeNull();
        expect(batch).toEqual([0, 1, 2]);
    });
});
