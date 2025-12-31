/**
 * OpenVault UI Formatting Functions
 *
 * Pure functions for formatting data for display.
 * No DOM dependencies - fully testable.
 */

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
    return min === max
        ? ` (msg ${min})`
        : ` (msgs ${min}-${max})`;
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
