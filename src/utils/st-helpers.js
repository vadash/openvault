/**
 * OpenVault SillyTavern Helper Utilities
 *
 * Utilities specific to SillyTavern integration.
 */

import { getDeps } from '../deps.js';
import { extensionName } from '../constants.js';

/**
 * Safe wrapper for setExtensionPrompt with error handling
 * @param {string} content - Content to inject
 * @returns {boolean} True if successful
 */
export function safeSetExtensionPrompt(content) {
    try {
        const deps = getDeps();
        deps.setExtensionPrompt(
            extensionName,
            content,
            deps.extension_prompt_types.IN_PROMPT,
            0
        );
        return true;
    } catch (error) {
        getDeps().console.error('[OpenVault] Failed to set extension prompt:', error);
        return false;
    }
}
