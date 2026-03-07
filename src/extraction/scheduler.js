/**
 * OpenVault Extraction Scheduler
 *
 * Centralizes message selection logic for extraction batching.
 * Determines which messages need extracting and whether batches are ready.
 */

import { MEMORIES_KEY, PROCESSED_MESSAGES_KEY } from '../constants.js';
import { getMessageTokenCount, getTokenSum, snapToTurnBoundary } from '../utils/tokens.js';

/**
 * Get set of message IDs that have been processed (extracted or attempted)
 * @param {Object} data - OpenVault data object
 * @returns {Set<number>} Set of processed message IDs
 */
export function getExtractedMessageIds(data) {
    const extractedIds = new Set();
    if (!data) return extractedIds;

    // From memories (legacy tracking)
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
 * @param {number} excludeLastN - Number of recent messages to exclude (unused in token-based mode)
 * @returns {number[]} Array of unextracted message indices
 */
export function getUnextractedMessageIds(chat, extractedIds, excludeLastN = 0) {
    const unextractedIds = [];
    for (let i = 0; i < chat.length; i++) {
        if (!extractedIds.has(i)) {
            unextractedIds.push(i);
        }
    }
    return excludeLastN > 0 ? unextractedIds.slice(0, -excludeLastN) : unextractedIds;
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
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds, 0);
    return getTokenSum(chat, unextractedIds, data) >= tokenBudget;
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
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds, 0);

    const totalTokens = getTokenSum(chat, unextractedIds, data);
    if (totalTokens < tokenBudget) {
        return null;
    }

    // Accumulate oldest messages until token budget met
    const accumulated = [];
    let currentSum = 0;

    for (const id of unextractedIds) {
        accumulated.push(id);
        currentSum += getMessageTokenCount(chat, id, data);

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
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds, 0);
    const totalTokens = getTokenSum(chat, unextractedIds, data);

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
    const allUnextracted = getUnextractedMessageIds(chat, extractedIds, 0);
    const totalTokens = getTokenSum(chat, allUnextracted, data);

    if (totalTokens < tokenBudget) {
        return { messageIds: [], batchCount: 0 };
    }

    // Accumulate complete batches
    const messageIds = [];
    let currentSum = 0;
    let batchCount = 0;

    for (const id of allUnextracted) {
        currentSum += getMessageTokenCount(chat, id, data);
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
            currentSum -= getMessageTokenCount(chat, removed, data);
        }
    }

    return { messageIds, batchCount };
}
