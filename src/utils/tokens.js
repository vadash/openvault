import { countTokens } from 'https://esm.sh/gpt-tokenizer/encoding/o200k_base';

const MESSAGE_TOKENS_KEY = 'message_tokens';

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
    const count = text.length === 0 ? 0 : countTokens(text);
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
