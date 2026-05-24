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
// ST's valid positions: NONE=-1, IN_PROMPT=0, IN_CHAT=1, BEFORE_PROMPT=2
const POSITION_MAP = {
    0: 0, // BEFORE_MAIN -> IN_PROMPT
    1: 0, // AFTER_MAIN -> IN_PROMPT (same slot, different ordering)
    2: 2, // BEFORE_AN -> BEFORE_PROMPT
    3: 0, // AFTER_AN -> IN_PROMPT (ST has no "after AN" position, fallback to IN_PROMPT)
    4: 1, // IN_CHAT -> IN_CHAT (ST uses 1, not 4)
};

/**
 * Safe wrapper for setExtensionPrompt with error handling and position support
 * @param {string} content - Content to inject
 * @param {string} [name] - Named slot (defaults to extensionName for backwards compatibility)
 * @param {number} [position] - Position code (0-4, -1 for custom)
 * @param {number} [depth] - Message depth for IN_CHAT position
 * @returns {boolean} True if successful, false if skipped (CUSTOM position)
 */
export function safeSetExtensionPrompt(content, name = extensionName, position = 0, depth = 0) {
    // Custom position (-1) = macro-only, clear slot and skip auto-injection
    if (position === -1) {
        try {
            getDeps().setExtensionPrompt(name, '', 0, 0);
        } catch {
            /* best-effort clear */
        }
        return false;
    }

    // Disabled position (-2) = clear any existing injection, don't inject new content
    if (position === -2) {
        try {
            getDeps().setExtensionPrompt(name, '', 0, 0);
        } catch {
            /* best-effort clear */
        }
        return false;
    }

    try {
        const deps = getDeps();
        const promptType = POSITION_MAP[position] ?? 0;
        deps.setExtensionPrompt(name, content, promptType, depth);
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
