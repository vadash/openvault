/**
 * OpenVault UI Calculation Functions
 *
 * Pure functions for data processing and calculations.
 * No DOM dependencies - fully testable.
 */

/**
 * Filter memories by type and character
 * @param {Array} memories - Array of memory objects
 * @param {string} typeFilter - Event type filter (empty = all)
 * @param {string} characterFilter - Character filter (empty = all)
 * @returns {Array} Filtered memories
 */
export function filterMemories(memories, typeFilter, characterFilter) {
    return memories.filter(m => {
        if (typeFilter && m.event_type !== typeFilter) return false;
        if (characterFilter && !m.characters_involved?.includes(characterFilter)) return false;
        return true;
    });
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
        for (const char of (memory.characters_involved || [])) {
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
        emotionSource = min === max
            ? ` (msg ${min})`
            : ` (msgs ${min}-${max})`;
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
 * Build relationship display data
 * @param {string} key - Relationship key
 * @param {Object} relData - Relationship data
 * @returns {Object} Display-ready relationship data
 */
export function buildRelationshipData(key, relData) {
    return {
        key,
        characterA: relData.character_a || '?',
        characterB: relData.character_b || '?',
        type: relData.relationship_type || 'acquaintance',
        trust: relData.trust_level || 5,
        trustPercent: (relData.trust_level || 5) * 10,
        tension: relData.tension_level || 0,
        tensionPercent: (relData.tension_level || 0) * 10,
    };
}

/**
 * Calculate extraction statistics
 * @param {Array} chat - Chat messages array
 * @param {Set} extractedMessageIds - Set of extracted message indices
 * @param {number} messageCount - Messages per extraction setting
 * @returns {Object} Extraction statistics
 */
export function calculateExtractionStats(chat, extractedMessageIds, messageCount) {
    const totalMessages = chat.length;
    const hiddenMessages = chat.filter(m => m.is_system).length;
    const extractedCount = extractedMessageIds.size;

    // Buffer zone: last N messages reserved for automatic extraction
    const bufferSize = messageCount * 2;
    const bufferStart = Math.max(0, totalMessages - bufferSize);

    // Unprocessed: messages before buffer that haven't been extracted
    let unprocessedCount = 0;
    for (let i = 0; i < bufferStart; i++) {
        if (!extractedMessageIds.has(i)) {
            unprocessedCount++;
        }
    }

    return {
        totalMessages,
        hiddenMessages,
        extractedCount,
        bufferSize,
        bufferStart,
        unprocessedCount,
    };
}

/**
 * Get backfill status text
 * @param {number} totalMessages - Total message count
 * @param {number} bufferSize - Buffer zone size
 * @param {number} unprocessedCount - Unprocessed messages before buffer
 * @returns {string} Status text
 */
export function getBackfillStatusText(totalMessages, bufferSize, unprocessedCount) {
    if (totalMessages < bufferSize) {
        return 'Waiting for more messages';
    } else if (unprocessedCount > 0) {
        return `${unprocessedCount} msgs ready`;
    } else {
        return 'Up to date';
    }
}

/**
 * Calculate next auto-extraction text
 * @param {Object} params - Calculation parameters
 * @param {number} params.totalMessages - Total messages
 * @param {number} params.bufferSize - Buffer zone size
 * @param {number} params.bufferStart - Buffer start index
 * @param {number} params.extractedCount - Total extracted count
 * @param {Set} params.extractedMessageIds - Set of extracted message IDs
 * @param {number} params.messageCount - Messages per extraction
 * @returns {string} Next auto-extraction text
 */
export function getNextAutoExtractionText(params) {
    const { totalMessages, bufferSize, bufferStart, extractedCount, extractedMessageIds, messageCount } = params;

    if (totalMessages < bufferSize) {
        const needed = bufferSize - totalMessages;
        return `Need ${needed} more msgs`;
    }

    const messagesInBuffer = Math.min(totalMessages, bufferSize);
    const messagesBeforeBuffer = totalMessages - messagesInBuffer;

    if (messagesBeforeBuffer > extractedCount) {
        return 'Backfill pending';
    }

    const extractedInBuffer = [...extractedMessageIds].filter(id => id >= bufferStart).length;
    const remainder = extractedInBuffer % messageCount;
    const messagesUntilNextBatch = remainder === 0 ? 0 : messageCount - remainder;

    if (messagesUntilNextBatch === 0) {
        return 'Ready on next AI msg';
    }
    return `In ${messagesUntilNextBatch} msgs`;
}

/**
 * Validate and clamp RPM value
 * @param {*} value - Input value
 * @param {number} defaultValue - Default if invalid
 * @returns {number} Clamped value between 1-600
 */
export function validateRPM(value, defaultValue = 30) {
    const parsed = parseInt(value);
    const num = Number.isNaN(parsed) ? defaultValue : parsed;
    return Math.max(1, Math.min(600, num));
}

/**
 * Build profile options array for dropdown
 * @param {Array} profiles - Available connection profiles
 * @param {string} currentValue - Currently selected profile ID
 * @returns {Array} Array of option objects {id, name, selected}
 */
export function buildProfileOptions(profiles, currentValue) {
    return profiles.map(profile => ({
        id: profile.id,
        name: profile.name,
        selected: profile.id === currentValue,
    }));
}
