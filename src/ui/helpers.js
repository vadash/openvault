/**
 * OpenVault UI Helper Functions
 *
 * Pure functions for data processing, calculations, and formatting.
 * No DOM dependencies - fully testable.
 */

import { getUnextractedMessageIds } from '../extraction/scheduler.js';

// =============================================================================
// Calculation Functions
// =============================================================================

/**
 * Filter memories by type and character
 * @param {Array} memories - Array of memory objects
 * @param {string} typeFilter - Event type filter ('event' = exclude reflections, 'reflection' = only reflections, empty = all)
 * @param {string} characterFilter - Character filter (empty = all)
 * @returns {Array} Filtered memories
 */
export function filterMemories(memories, typeFilter, characterFilter) {
    return memories.filter((m) => {
        // Type filter
        if (typeFilter === 'event' && m.type === 'reflection') return false;
        if (typeFilter === 'reflection' && m.type !== 'reflection') return false;

        // Character filter
        if (characterFilter && !m.characters_involved?.includes(characterFilter)) return false;

        return true;
    });
}

/**
 * Filter entities based on search query and type filter
 * @param {Object} graph - Graph object with nodes (from data.graph)
 * @param {string} query - Search query
 * @param {string} typeFilter - Entity type to filter by (or empty for all)
 * @returns {Array<[string, Object]>} Array of [key, entity] tuples
 */
export function filterEntities(graph, query, typeFilter) {
    const normalizedQuery = query.toLowerCase().trim();

    return Object.entries(graph?.nodes || {})
        .filter(([, entity]) => {
            // Type filter
            if (typeFilter && entity.type !== typeFilter) {
                return false;
            }

            // Search query - check name, description, and aliases
            if (!normalizedQuery) {
                return true;
            }

            const name = (entity.name || '').toLowerCase();
            const desc = (entity.description || '').toLowerCase();
            const aliases = (entity.aliases || []).join(' ').toLowerCase();

            return (
                name.includes(normalizedQuery) || desc.includes(normalizedQuery) || aliases.includes(normalizedQuery)
            );
        })
        .sort((a, b) => (b[1].mentions || 0) - (a[1].mentions || 0));
}

/**
 * Sort memories by creation date (newest first)
 * @param {Array} memories - Array of memory objects
 * @returns {Array} New sorted array
 */
export function sortMemoriesByDate(memories) {
    return [...memories].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

/**
 * Calculate pagination info
 * @param {number} totalItems - Total number of items
 * @param {number} currentPage - Current page (0-indexed)
 * @param {number} itemsPerPage - Items per page
 * @returns {Object} Pagination info
 */
export function getPaginationInfo(totalItems, currentPage, itemsPerPage) {
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const validPage = Math.min(currentPage, totalPages - 1);
    const startIdx = validPage * itemsPerPage;
    const endIdx = startIdx + itemsPerPage;

    return {
        totalPages,
        currentPage: validPage,
        startIdx,
        endIdx,
        hasPrev: validPage > 0,
        hasNext: validPage < totalPages - 1,
    };
}

/**
 * Extract unique character names from memories
 * @param {Array} memories - Array of memory objects
 * @returns {string[]} Sorted array of unique character names
 */
export function extractCharactersSet(memories) {
    const characters = new Set();
    for (const memory of memories) {
        for (const char of memory.characters_involved || []) {
            characters.add(char);
        }
    }
    return Array.from(characters).sort();
}

/**
 * Build character state display data
 * @param {string} name - Character name
 * @param {Object} charData - Character state data
 * @returns {Object} Display-ready character data
 */
export function buildCharacterStateData(name, charData) {
    const emotion = charData.current_emotion || 'neutral';
    const intensity = charData.emotion_intensity || 5;
    const knownCount = charData.known_events?.length || 0;

    let emotionSource = '';
    if (charData.emotion_from_messages) {
        const { min, max } = charData.emotion_from_messages;
        emotionSource = min === max ? ` (msg ${min})` : ` (msgs ${min}-${max})`;
    }

    return {
        name,
        emotion,
        emotionSource,
        intensity,
        intensityPercent: intensity * 10,
        knownCount,
    };
}

/**
 * Calculate extraction statistics
 * @param {Array} chat - Chat messages array
 * @param {Set} processedFps - Set of processed fingerprints
 * @param {number} messageCount - Messages per extraction setting
 * @param {number} bufferSize - Recent messages excluded from extraction
 * @returns {Object} Extraction statistics
 */
export function calculateExtractionStats(chat, processedFps, messageCount, bufferSize = 0) {
    const totalMessages = chat.length;
    const hiddenMessages = chat.filter((m) => m.is_system).length;

    // Fix: Derive extracted count from unextracted pool instead of dead-fingerprint-inflated Set size
    const unextractedIds = getUnextractedMessageIds(chat, processedFps);
    const nonSystemCount = totalMessages - hiddenMessages;
    const extractedCount = Math.max(0, nonSystemCount - unextractedIds.length);

    // Calculate extractable messages (total minus buffer)
    const extractableMessages = Math.max(0, totalMessages - bufferSize);

    // Calculate unextracted messages (only from extractable pool)
    const unextractedCount = Math.max(0, extractableMessages - extractedCount);

    // Batch progress: how many messages in current partial batch
    const batchProgress = unextractedCount % messageCount;
    const messagesNeeded = batchProgress === 0 && unextractedCount > 0 ? 0 : messageCount - batchProgress;

    return {
        totalMessages,
        hiddenMessages,
        extractedCount,
        extractableMessages,
        unextractedCount,
        batchProgress,
        messagesNeeded,
        messageCount,
        bufferSize,
    };
}

/**
 * Get batch progress info for display
 * @param {Object} stats - Stats from calculateExtractionStats
 * @returns {Object} { current, total, percentage, label }
 */
export function getBatchProgressInfo(stats) {
    const { batchProgress, messagesNeeded, messageCount, unextractedCount, bufferSize = 0 } = stats;

    const bufferLabel = bufferSize > 0 ? ` [${bufferSize} buffered]` : '';

    // If all extracted, show full bar
    if (unextractedCount === 0) {
        return {
            current: messageCount,
            total: messageCount,
            percentage: 100,
            label: `Up to date${bufferLabel}`,
        };
    }

    // If ready to extract (full batch waiting), show full bar
    if (messagesNeeded === 0) {
        return {
            current: messageCount,
            total: messageCount,
            percentage: 100,
            label: `Ready!${bufferLabel}`,
        };
    }

    return {
        current: batchProgress,
        total: messageCount,
        percentage: Math.round((batchProgress / messageCount) * 100),
        label: `${batchProgress}/${messageCount} (+${messagesNeeded})${bufferLabel}`,
    };
}

/**
 * Validate and clamp RPM value
 * @param {*} value - Input value
 * @param {number} defaultValue - Default if invalid
 * @returns {number} Clamped value between 1-30
 */
export function validateRPM(value, defaultValue = 10) {
    const parsed = parseInt(value, 10);
    const num = Number.isNaN(parsed) ? defaultValue : parsed;
    return Math.max(1, Math.min(30, num));
}

/**
 * Build profile options array for dropdown
 * @param {Array} profiles - Available connection profiles
 * @param {string} currentValue - Currently selected profile ID
 * @returns {Array} Array of option objects {id, name, selected}
 */
export function buildProfileOptions(profiles, currentValue) {
    return profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        selected: profile.id === currentValue,
    }));
}

// =============================================================================
// Formatting Functions
// =============================================================================

/**
 * Format importance as star string
 * @param {number} importance - Importance level 1-5
 * @returns {string} Star string (filled + empty)
 */
export function formatMemoryImportance(importance) {
    const value = importance ?? 3;
    const level = Math.max(1, Math.min(5, value));
    return '\u2605'.repeat(level) + '\u2606'.repeat(5 - level);
}

/**
 * Format timestamp as localized date string
 * @param {number|null} timestamp - Unix timestamp
 * @returns {string} Formatted date or 'Unknown'
 */
export function formatMemoryDate(timestamp) {
    return timestamp ? new Date(timestamp).toLocaleDateString() : 'Unknown';
}

/**
 * Format witnesses array as display string
 * @param {string[]|undefined} witnesses - Array of witness names
 * @returns {string} Formatted witnesses string or empty
 */
export function formatWitnesses(witnesses) {
    if (!witnesses || witnesses.length === 0) return '';
    return `Witnesses: ${witnesses.join(', ')}`;
}

/**
 * Get status display text
 * @param {string} status - Status key ('ready', 'extracting', 'retrieving', 'error')
 * @returns {string} Human-readable status text
 */
export function getStatusText(status) {
    const statusText = {
        ready: 'Ready',
        extracting: 'Extracting...',
        retrieving: 'Retrieving...',
        error: 'Error',
    };
    return statusText[status] || status;
}

/**
 * Format emotion source message range
 * @param {Object|undefined} emotionFromMessages - Object with min/max message indices
 * @returns {string} Formatted source string or empty
 */
export function formatEmotionSource(emotionFromMessages) {
    if (!emotionFromMessages) return '';
    const { min, max } = emotionFromMessages;
    return min === max ? ` (msg ${min})` : ` (msgs ${min}-${max})`;
}

/**
 * Format hidden messages count text
 * @param {number} hiddenMessages - Count of hidden/system messages
 * @returns {string} Formatted text or empty string
 */
export function formatHiddenMessagesText(hiddenMessages) {
    return hiddenMessages > 0 ? ` (${hiddenMessages} hidden)` : '';
}

/**
 * Format memory context count for display
 * @param {number} count - Memory context count (-1 means all)
 * @returns {string} Display text
 */
export function formatMemoryContextCount(count) {
    return count < 0 ? 'All' : String(count);
}
