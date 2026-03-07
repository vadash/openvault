import { countTokens as _countTokens } from 'https://esm.sh/gpt-tokenizer/encoding/o200k_base';

const MESSAGE_TOKENS_KEY = 'message_tokens';

/**
 * Count tokens for any text string using gpt-tokenizer (o200k_base).
 * @param {string} text - Text to count
 * @returns {number} Token count
 */
export function countTokens(text) {
    return (text || '').length === 0 ? 0 : _countTokens(text);
}

/**
 * Get token count for a single message. Uses cache, falls back to computation.
 * @param {Object[]} chat - Chat array
 * @param {number} index - Message index
 * @param {Object} data - OpenVault data (for cache read/write)
 * @returns {number} Token count
 */
export function getMessageTokenCount(chat, index, data) {
    if (!data[MESSAGE_TOKENS_KEY]) {
        data[MESSAGE_TOKENS_KEY] = {};
    }

    const key = String(index);
    if (data[MESSAGE_TOKENS_KEY][key] !== undefined) {
        return data[MESSAGE_TOKENS_KEY][key];
    }

    const text = chat[index]?.mes || '';
    const count = text.length === 0 ? 0 : _countTokens(text);
    data[MESSAGE_TOKENS_KEY][key] = count;
    return count;
}

/**
 * Sum token counts for a list of message indices.
 * @param {Object[]} chat - Chat array
 * @param {number[]} indices - Message indices
 * @param {Object} data - OpenVault data
 * @returns {number} Total tokens
 */
export function getTokenSum(chat, indices, data) {
    let total = 0;
    for (const i of indices) {
        total += getMessageTokenCount(chat, i, data);
    }
    return total;
}

/**
 * Snap a message index list to a valid turn boundary.
 * A split is valid when the last message is from Bot and the next message is from User,
 * or at end-of-chat. This prevents orphaning User messages from their Bot responses.
 * Trims backward until a valid boundary is found. Returns [] if none found.
 * @param {Object[]} chat - Full chat array
 * @param {number[]} messageIds - Ordered message indices to snap
 * @returns {number[]} Snapped message indices
 */
export function snapToTurnBoundary(chat, messageIds) {
    if (messageIds.length === 0) return [];

    // Walk backward from the end of the list
    for (let i = messageIds.length - 1; i >= 0; i--) {
        const lastId = messageIds[i];
        const lastMsg = chat[lastId];
        const nextInChat = chat[lastId + 1];

        // Valid: last message is from bot AND (end of chat OR next message is from user)
        // This ensures we split at B→U boundaries, not mid-turn (U→U or U→B)
        if (lastMsg && !lastMsg.is_user && (!nextInChat || nextInChat.is_user)) {
            return messageIds.slice(0, i + 1);
        }
    }

    return [];
}
