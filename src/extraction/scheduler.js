/**
 * OpenVault Extraction Scheduler
 *
 * Centralizes message selection logic for extraction batching.
 * Determines which messages need extracting and whether batches are ready.
 */

import { PROCESSED_MESSAGES_KEY, SWIPE_PROTECTION_TAIL_MESSAGES } from '../constants.js';
import { cyrb53 } from '../utils/embedding-codec.js';
import { logDebug } from '../utils/logging.js';
import { getMessageTokenCount, getTokenSum, snapToTurnBoundary } from '../utils/tokens.js';

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
 * Get set of message fingerprints that have been processed.
 * Replaces getExtractedMessageIds (index-based tracking).
 * @param {Object} data - OpenVault data object
 * @returns {Set<string>} Set of processed fingerprint strings
 */
export function getProcessedFingerprints(data) {
    return new Set(data[PROCESSED_MESSAGES_KEY] || []);
}

/**
 * Get array of message indices that have not been extracted yet.
 * Now uses fingerprint matching and filters out system messages.
 * @param {Object[]} chat - Chat messages array
 * @param {Set<string>} processedFps - Set of already processed fingerprint strings
 * @returns {number[]} Array of unextracted message indices
 */
export function getUnextractedMessageIds(chat, processedFps) {
    const unextractedIds = [];
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (msg.is_system) continue;
        if (!processedFps.has(getFingerprint(msg))) {
            unextractedIds.push(i);
        }
    }
    return unextractedIds;
}

/**
 * Get extraction budget progress data for UI display
 * @param {Object[]} chat - Chat messages array
 * @param {Object} data - OpenVault data object
 * @param {number} tokenBudget - Token budget for extraction
 * @returns {Object} Progress data: { unextractedTokens, extractionPct, extractionBudget }
 */
export function getExtractionBudgetProgress(chat, data, tokenBudget) {
    const processedFps = getProcessedFingerprints(data);
    const unextractedIds = getUnextractedMessageIds(chat, processedFps);
    const unextractedTokens = getTokenSum(chat, unextractedIds);
    const extractionPct = Math.min((unextractedTokens / tokenBudget) * 100, 100);
    return { unextractedTokens, extractionPct, extractionBudget: tokenBudget };
}

/**
 * Check if a complete batch of messages is ready for extraction
 * @param {Object[]} chat - Chat messages array
 * @param {Object} data - OpenVault data object
 * @param {number} tokenBudget - Token budget for extraction
 * @returns {boolean} True if at least one complete batch is ready
 */
export function isBatchReady(chat, data, tokenBudget) {
    const processedFps = getProcessedFingerprints(data);
    const unextractedIds = getUnextractedMessageIds(chat, processedFps);
    return getTokenSum(chat, unextractedIds) >= tokenBudget;
}

/**
 * Trim N complete turns from the tail of a snapped batch.
 * A "turn" ends at a Bot→User boundary (bot message followed by user message or end of chat).
 * Returns the trimmed array, or the original if trimming would empty it.
 * @param {Object[]} chat - Full chat messages array
 * @param {number[]} messageIds - Ordered message indices to trim
 * @param {number} turnsToTrim - Number of complete turns to remove from tail
 * @returns {number[]} Trimmed message IDs, or original if trim would empty it
 */
export function trimTailTurns(chat, messageIds, turnsToTrim) {
    if (turnsToTrim <= 0 || messageIds.length === 0) return messageIds;

    let cutIndex = messageIds.length;
    let turnsFound = 0;

    for (let i = messageIds.length - 1; i >= 0; i--) {
        const id = messageIds[i];
        const msg = chat[id];

        // Skip system messages — they aren't real conversation turns
        if (msg?.is_system) continue;

        // Walk forward past system messages to find the next real message
        let nextIdx = id + 1;
        while (chat[nextIdx]?.is_system) nextIdx++;
        const nextInChat = chat[nextIdx];

        // Bot→User boundary (same logic as snapToTurnBoundary)
        if (msg && !msg.is_user && (!nextInChat || nextInChat.is_user)) {
            turnsFound++;
            if (turnsFound === turnsToTrim) {
                // Walk back to find the start of this turn (first user message in the sequence)
                cutIndex = i;
                for (let j = i - 1; j >= 0; j--) {
                    const prevMsg = chat[messageIds[j]];
                    if (prevMsg?.is_user) {
                        cutIndex = j;
                    } else {
                        break;
                    }
                }
                break;
            }
        }
    }

    // If no boundaries found, return original
    if (turnsFound === 0) return messageIds;

    // If trimming would empty the batch, return original (protect start-of-chat)
    const trimmed = messageIds.slice(0, cutIndex);
    return trimmed.length > 0 ? trimmed : messageIds;
}

/**
 * Get the next batch of message IDs to extract
 * @param {Object[]} chat - Chat messages array
 * @param {Object} data - OpenVault data object
 * @param {number} tokenBudget - Token budget for extraction
 * @param {boolean} [isEmergencyCut=false] - If true, bypass token budget and extract all unextracted messages
 * @returns {number[]|null} Array of message IDs for next batch, or null if no complete batch ready
 */
export function getNextBatch(chat, data, tokenBudget, isEmergencyCut = false) {
    const processedFps = getProcessedFingerprints(data);
    const unextractedIds = getUnextractedMessageIds(chat, processedFps);

    const totalTokens = getTokenSum(chat, unextractedIds);
    // Emergency Cut bypasses token budget - extract all unextracted messages
    if (!isEmergencyCut && totalTokens < tokenBudget) {
        return null;
    }

    // Accumulate oldest messages until token budget met (or all messages if Emergency Cut)
    const accumulated = [];
    let currentSum = 0;

    for (const id of unextractedIds) {
        accumulated.push(id);
        currentSum += getMessageTokenCount(chat, id);

        if (!isEmergencyCut && currentSum >= tokenBudget) {
            break;
        }
    }

    // Snap to turn boundary
    let snapped = snapToTurnBoundary(chat, accumulated, isEmergencyCut);

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

        snapped = snapToTurnBoundary(chat, extended, isEmergencyCut);
    }

    // Swipe protection: exclude recent turns from extraction (bypassed for Emergency Cut)
    if (!isEmergencyCut) {
        snapped = trimTailTurns(chat, snapped, SWIPE_PROTECTION_TAIL_MESSAGES);
    }

    return snapped.length > 0 ? snapped : null;
}

/**
 * Get count of complete batches available for backfill.
 * Now returns fingerprint-based stats with proper dead fingerprint handling.
 * @param {Object[]} chat - Chat messages array
 * @param {Object} data - OpenVault data object
 * @param {number} tokenBudget - Token budget for extraction (optional, for backward compatibility)
 * @returns {{totalMessages: number, extractedCount: number, unextractedCount: number}}
 */
export function getBackfillStats(chat, data, _tokenBudget) {
    const processedFps = getProcessedFingerprints(data);
    const unextractedIds = getUnextractedMessageIds(chat, processedFps);
    const nonSystemCount = chat.filter((m) => !m.is_system).length;

    // Count visible processed messages (fingerprints that exist in current chat)
    let visibleExtracted = 0;
    for (const msg of chat) {
        if (!msg.is_system && processedFps.has(getFingerprint(msg))) {
            visibleExtracted++;
        }
    }

    return {
        totalMessages: nonSystemCount,
        extractedCount: visibleExtracted,
        unextractedCount: unextractedIds.length,
    };
}

/**
 * Get all message IDs for backfill extraction (complete batches only)
 * @param {Object[]} chat - Chat messages array
 * @param {Object} data - OpenVault data object
 * @param {number} tokenBudget - Token budget for extraction
 * @param {boolean} [isEmergencyCut=false] - If true, bypass token budget and extract all unextracted messages
 * @returns {{messageIds: number[], batchCount: number}}
 */
export function getBackfillMessageIds(chat, data, tokenBudget, isEmergencyCut = false) {
    const processedFps = getProcessedFingerprints(data);
    const allUnextracted = getUnextractedMessageIds(chat, processedFps);
    const totalTokens = getTokenSum(chat, allUnextracted);

    // Emergency Cut bypasses token budget - extract all unextracted messages
    if (!isEmergencyCut && totalTokens < tokenBudget) {
        logDebug('getBackfillMessageIds: no messages to extract (token budget not met)');
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

    // Trim incomplete last batch (skip for Emergency Cut - extract all messages)
    if (!isEmergencyCut && currentSum > 0 && currentSum < tokenBudget) {
        while (messageIds.length > 0 && currentSum > 0) {
            const removed = messageIds.pop();
            currentSum -= getMessageTokenCount(chat, removed);
        }
    }

    // Swipe protection: exclude recent turns (bypassed for Emergency Cut)
    if (!isEmergencyCut && messageIds.length > 0) {
        const before = messageIds.length;
        const trimmed = trimTailTurns(chat, messageIds, SWIPE_PROTECTION_TAIL_MESSAGES);
        messageIds.length = 0;
        messageIds.push(...trimmed);
        // If we trimmed messages, recalculate batchCount from the remaining messages
        if (messageIds.length < before) {
            let sum = 0;
            batchCount = 0;
            for (const id of messageIds) {
                sum += getMessageTokenCount(chat, id);
                if (sum >= tokenBudget) {
                    batchCount++;
                    sum = 0;
                }
            }
        }
    }

    // If we have extractable messages but no complete batches (e.g. after swipe
    // protection trimmed the tail), report at least 1 batch — getNextBatch uses
    // snap-to-turn-boundary logic and will still find a valid batch.
    if (messageIds.length > 0 && batchCount === 0) {
        batchCount = 1;
    }

    return { messageIds, batchCount };
}
