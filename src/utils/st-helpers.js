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
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)),
    ]);
}

/**
 * Safe wrapper for setExtensionPrompt with error handling
 * @param {string} content - Content to inject
 * @param {string} [name] - Named slot (defaults to extensionName for backwards compatibility)
 * @returns {boolean} True if successful
 */
export function safeSetExtensionPrompt(content, name = extensionName) {
    try {
        const deps = getDeps();
        deps.setExtensionPrompt(name, content, deps.extension_prompt_types.IN_PROMPT, 0);
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
