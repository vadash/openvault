/**
 * OpenVault Extraction Scheduler
 *
 * Centralizes message selection logic for extraction batching.
 * Determines which messages need extracting and whether batches are ready.
 */

import { MEMORIES_KEY, PROCESSED_MESSAGES_KEY } from '../constants.js';
import { getMessageTokenCount, getTokenSum, snapToTurnBoundary } from '../utils/tokens.js';
import { cyrb53 } from '../utils/embedding-codec.js';

/**
 * Get a stable fingerprint for a message.
 * Uses send_date (timestamp) when available, falls back to content hash.
 * @param {object} msg - Message object
 * @returns {string} Fingerprint string
 */
export function getFingerprint(msg) {
    if (msg.send_date) return String(msg.send_date);
    // Fallback: content hash for imported chats without send_date
    return `hash_${cyrb53((msg.name || '') + (msg.mes || ''))}`;
}

/**
 * Parse ST's send_date (ISO, localized, numeric string, or Number) into ms.
 * @param {string|number} sendDate
 * @returns {number}
 */
function parseSendDate(sendDate) {
    const val = String(sendDate);
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    return Date.parse(val) || 0;
}

/**
 * Migrate index-based processed messages to fingerprint-based.
 * Called once per chat when old format is detected.
 * Includes temporal guard to skip indices that point to messages
 * sent after the last memory was created (indicates index shift).
 * @param {Array} chat - Chat array
 * @param {Object} data - OpenVault data object
 * @returns {boolean} True if migration occurred
 */
export function migrateProcessedMessages(chat, data) {
    const processed = data[PROCESSED_MESSAGES_KEY];
    if (!processed?.length || typeof processed[0] !== 'number') return false;

    const fps = new Set();

    // Temporal boundary: messages sent after our last extraction are definitely new
    const lastMemoryTime = Math.max(0, ...(data[MEMORIES_KEY] || []).map(m => m.created_at || 0));

    // 1. Map PROCESSED_MESSAGES_KEY indices to fingerprints
    for (const idx of processed) {
        const msg = chat[idx];
        if (!msg) continue;
        // Safety: if this message was sent after our last memory, the index
        // has shifted onto a NEW message. Skip it to force extraction.
        if (lastMemoryTime > 0 && msg.send_date) {
            const sendTime = parseSendDate(msg.send_date);
            if (sendTime && sendTime > lastMemoryTime) continue;
        }
        fps.add(getFingerprint(msg));
    }

    // 2. Map memory.message_ids indices as safety net (same temporal guard)
    for (const memory of data[MEMORIES_KEY] || []) {
        for (const idx of memory.message_ids || []) {
            const msg = chat[idx];
            if (!msg) continue;
            if (lastMemoryTime > 0 && msg.send_date) {
                const sendTime = parseSendDate(msg.send_date);
                if (sendTime && sendTime > lastMemoryTime) continue;
            }
            fps.add(getFingerprint(msg));
        }
    }

    data[PROCESSED_MESSAGES_KEY] = Array.from(fps);
    delete data['last_processed_message_id'];
    return true;
}

/**
 * Get set of message IDs that have been processed (extracted or attempted)
 * @param {Object} data - OpenVault data object
 * @returns {Set<number>} Set of processed message IDs
 */
export function getExtractedMessageIds(data) {
    const extractedIds = new Set();
    if (!data) return extractedIds;

    // From memories (tracks which messages produced events)
    for (const memory of data[MEMORIES_KEY] || []) {
        for (const msgId of memory.message_ids || []) {
            extractedIds.add(msgId);
        }
    }
    // From processed message tracking (includes messages with no events)
    for (const msgId of data[PROCESSED_MESSAGES_KEY] || []) {
        extractedIds.add(msgId);
    }
    return extractedIds;
}

/**
 * Get array of message indices that have not been extracted yet
 * @param {Object[]} chat - Chat messages array
 * @param {Set<number>} extractedIds - Set of already extracted message IDs
 * @returns {number[]} Array of unextracted message indices
 */
export function getUnextractedMessageIds(chat, extractedIds) {
    const unextractedIds = [];
    for (let i = 0; i < chat.length; i++) {
        if (!extractedIds.has(i)) {
            unextractedIds.push(i);
        }
    }
    return unextractedIds;
}

/**
 * Check if a complete batch of messages is ready for extraction
 * @param {Object[]} chat - Chat messages array
 * @param {Object} data - OpenVault data object
 * @param {number} tokenBudget - Token budget for extraction
 * @returns {boolean} True if at least one complete batch is ready
 */
export function isBatchReady(chat, data, tokenBudget) {
    const extractedIds = getExtractedMessageIds(data);
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds);
    return getTokenSum(chat, unextractedIds) >= tokenBudget;
}

/**
 * Get the next batch of message IDs to extract
 * @param {Object[]} chat - Chat messages array
 * @param {Object} data - OpenVault data object
 * @param {number} tokenBudget - Token budget for extraction
 * @returns {number[]|null} Array of message IDs for next batch, or null if no complete batch ready
 */
export function getNextBatch(chat, data, tokenBudget) {
    const extractedIds = getExtractedMessageIds(data);
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds);

    const totalTokens = getTokenSum(chat, unextractedIds);
    if (totalTokens < tokenBudget) {
        return null;
    }

    // Accumulate oldest messages until token budget met
    const accumulated = [];
    let currentSum = 0;

    for (const id of unextractedIds) {
        accumulated.push(id);
        currentSum += getMessageTokenCount(chat, id);

        if (currentSum >= tokenBudget) {
            break;
        }
    }

    // Snap to turn boundary
    let snapped = snapToTurnBoundary(chat, accumulated);

    // If snapping resulted in empty, we need to extend forward through the full turn
    // then re-snap. This handles the edge case where a single huge user message
    // exceeds the budget and can't snap back.
    if (snapped.length === 0 && accumulated.length > 0) {
        // Extend forward to include the full turn (all messages until next User or end)
        const lastId = accumulated[accumulated.length - 1];
        const extended = [...accumulated];

        for (let i = lastId + 1; i < chat.length; i++) {
            extended.push(i);
            if (chat[i].is_user) break;
        }

        snapped = snapToTurnBoundary(chat, extended);
    }

    return snapped.length > 0 ? snapped : null;
}

/**
 * Get count of complete batches available for backfill
 * @param {Object[]} chat - Chat messages array
 * @param {Object} data - OpenVault data object
 * @param {number} tokenBudget - Token budget for extraction
 * @returns {{completeBatches: number, totalUnextracted: number, extractedCount: number}}
 */
export function getBackfillStats(chat, data, tokenBudget) {
    const extractedIds = getExtractedMessageIds(data);
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds);
    const totalTokens = getTokenSum(chat, unextractedIds);

    return {
        completeBatches: totalTokens >= tokenBudget ? Math.floor(totalTokens / tokenBudget) : 0,
        totalUnextracted: unextractedIds.length,
        extractedCount: extractedIds.size,
    };
}

/**
 * Get all message IDs for backfill extraction (complete batches only)
 * @param {Object[]} chat - Chat messages array
 * @param {Object} data - OpenVault data object
 * @param {number} tokenBudget - Token budget for extraction
 * @returns {{messageIds: number[], batchCount: number}}
 */
export function getBackfillMessageIds(chat, data, tokenBudget) {
    const extractedIds = getExtractedMessageIds(data);
    const allUnextracted = getUnextractedMessageIds(chat, extractedIds);
    const totalTokens = getTokenSum(chat, allUnextracted);

    if (totalTokens < tokenBudget) {
        return { messageIds: [], batchCount: 0 };
    }

    // Accumulate complete batches
    const messageIds = [];
    let currentSum = 0;
    let batchCount = 0;

    for (const id of allUnextracted) {
        currentSum += getMessageTokenCount(chat, id);
        messageIds.push(id);

        if (currentSum >= tokenBudget) {
            batchCount++;
            currentSum = 0;
        }
    }

    // Trim incomplete last batch
    if (currentSum > 0 && currentSum < tokenBudget) {
        while (messageIds.length > 0 && currentSum > 0) {
            const removed = messageIds.pop();
            currentSum -= getMessageTokenCount(chat, removed);
        }
    }

    return { messageIds, batchCount };
}
