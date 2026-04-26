import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { logError } from './logging.js';

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {string} operation - Name for error message
 * @returns {Promise} Promise that rejects on timeout
 */
export function withTimeout(promise, ms, operation = 'Operation') {
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${operation} timed out after ${ms}ms`));
        }, ms);
    });

    return Promise.race([
        promise.finally(() => {
            clearTimeout(timeoutId);
        }),
        timeoutPromise,
    ]);
}

// Position code mapping to ST extension_prompt_types
// ST only has: NONE=-1, IN_PROMPT=0 (end of main), IN_CHAT=1 (at depth), BEFORE_PROMPT=2 (start of main)
const POSITION_MAP = {
    0: 2, // BEFORE_MAIN  -> BEFORE_PROMPT (before system prompt)
    1: 0, // AFTER_MAIN   -> IN_PROMPT     (after system prompt, before char defs)
    2: 0, // Legacy BEFORE_AN — no ST equivalent, fall back to IN_PROMPT
    3: 0, // Legacy AFTER_AN  — no ST equivalent, fall back to IN_PROMPT
    4: 1, // IN_CHAT      -> IN_CHAT       (in chat at specified depth)
    5: 1, // TOP_OF_CHAT  -> IN_CHAT       (depth forced to 10000 = top of chat = after char defs)
};

const TOP_OF_CHAT_DEPTH = 10000;

/**
 * Safe wrapper for setExtensionPrompt with error handling and position support
 * @param {string} content - Content to inject
 * @param {string} [name] - Named slot (defaults to extensionName for backwards compatibility)
 * @param {number} [position] - Position code (0-5, -1 for custom)
 * @param {number} [depth] - Message depth for IN_CHAT position
 * @returns {boolean} True if successful, false if skipped (CUSTOM position)
 */
export function safeSetExtensionPrompt(content, name = extensionName, position = 0, depth = 0) {
    // Custom position (-1) = macro-only, skip auto-injection
    if (position === -1) {
        return false;
    }

    try {
        const deps = getDeps();
        const promptType = POSITION_MAP[position] ?? 0;
        // TOP_OF_CHAT (5): use IN_CHAT at max depth to place at the start of chat messages
        const finalDepth = position === 5 ? TOP_OF_CHAT_DEPTH : depth;
        deps.setExtensionPrompt(name, content, promptType, finalDepth);
        return true;
    } catch (error) {
        logError('Failed to set extension prompt', error);
        return false;
    }
}

/**
 * Check if OpenVault extension is enabled
 * @returns {boolean}
 */
export function isExtensionEnabled() {
    return getDeps().getExtensionSettings()[extensionName]?.enabled === true;
}

/**
 * Yield to the browser's main thread.
 * Use inside heavy for-loops to prevent UI freezing.
 * scheduler.yield() yields to the browser without artificial delay.
 * @returns {Promise<void>}
 */
export function yieldToMain() {
    if (typeof scheduler !== 'undefined' && scheduler.yield) {
        return scheduler.yield();
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
}
