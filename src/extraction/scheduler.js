/**
 * OpenVault Extraction Scheduler
 *
 * Centralizes message selection logic for extraction batching.
 * Determines which messages need extracting and whether batches are ready.
 */

import { MEMORIES_KEY } from '../constants.js';

/**
 * Get set of message IDs that have been extracted into memories
 * @param {Object} data - OpenVault data object
 * @returns {Set<number>} Set of extracted message IDs
 */
export function getExtractedMessageIds(data) {
    const extractedIds = new Set();
    if (!data) return extractedIds;

    for (const memory of (data[MEMORIES_KEY] || [])) {
        for (const msgId of (memory.message_ids || [])) {
            extractedIds.add(msgId);
        }
    }
    return extractedIds;
}

/**
 * Get array of message indices that have not been extracted yet
 * @param {Object[]} chat - Chat messages array
 * @param {Set<number>} extractedIds - Set of already extracted message IDs
 * @param {number} excludeLastN - Number of recent messages to exclude
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
 * @param {number} batchSize - Number of messages per batch
 * @returns {boolean} True if at least one complete batch is ready
 */
export function isBatchReady(chat, data, batchSize) {
    const extractedIds = getExtractedMessageIds(data);
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds, 0);
    return unextractedIds.length >= batchSize;
}

/**
 * Get the next batch of message IDs to extract
 * @param {Object[]} chat - Chat messages array
 * @param {Object} data - OpenVault data object
 * @param {number} batchSize - Number of messages per batch
 * @param {number} bufferSize - Number of recent messages to exclude (default 0)
 * @returns {number[]|null} Array of message IDs for next batch, or null if no complete batch ready
 */
export function getNextBatch(chat, data, batchSize, bufferSize = 0) {
    const extractedIds = getExtractedMessageIds(data);
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds, bufferSize);

    if (unextractedIds.length < batchSize) {
        return null;
    }

    // Return the oldest complete batch (first N unextracted messages)
    return unextractedIds.slice(0, batchSize);
}

/**
 * Get count of complete batches available for backfill
 * @param {Object[]} chat - Chat messages array
 * @param {Object} data - OpenVault data object
 * @param {number} batchSize - Number of messages per batch
 * @param {number} excludeLastN - Number of recent messages to exclude (default: batchSize)
 * @returns {{completeBatches: number, totalUnextracted: number, extractedCount: number}}
 */
export function getBackfillStats(chat, data, batchSize, excludeLastN = null) {
    const extractedIds = getExtractedMessageIds(data);
    const excludeCount = excludeLastN !== null ? excludeLastN : batchSize;
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds, excludeCount);

    return {
        completeBatches: Math.floor(unextractedIds.length / batchSize),
        totalUnextracted: unextractedIds.length,
        extractedCount: extractedIds.size,
    };
}

/**
 * Get all message IDs for backfill extraction (complete batches only)
 * @param {Object[]} chat - Chat messages array
 * @param {Object} data - OpenVault data object
 * @param {number} batchSize - Number of messages per batch
 * @returns {{messageIds: number[], batchCount: number}}
 */
export function getBackfillMessageIds(chat, data, batchSize) {
    const extractedIds = getExtractedMessageIds(data);

    // Get all unextracted message indices
    const allUnextracted = [];
    for (let i = 0; i < chat.length; i++) {
        if (!extractedIds.has(i)) {
            allUnextracted.push(i);
        }
    }

    // Only return complete batches worth of messages
    const completeBatches = Math.floor(allUnextracted.length / batchSize);
    const completeMessageCount = completeBatches * batchSize;

    return {
        messageIds: allUnextracted.slice(0, completeMessageCount),
        batchCount: completeBatches,
    };
}
