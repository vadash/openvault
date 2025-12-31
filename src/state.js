/**
 * OpenVault State Management
 *
 * Handles operation state machine, generation locks, and chat loading cooldown.
 */

import { getDeps } from './deps.js';
import { GENERATION_LOCK_TIMEOUT_MS } from './constants.js';

// Operation state machine to prevent concurrent operations
export const operationState = {
    generationInProgress: false,
    extractionInProgress: false,
    retrievalInProgress: false,
};

// Generation lock timeout handle
let generationLockTimeout = null;

// Chat loading state - prevents operations during initial chat load
// Start with cooldown active to prevent any operations before APP_READY completes
let chatLoadingCooldown = true;
let chatLoadingTimeout = null;

/**
 * Set generation lock with safety timeout
 */
export function setGenerationLock() {
    operationState.generationInProgress = true;

    // Clear any existing safety timeout
    if (generationLockTimeout) {
        getDeps().clearTimeout(generationLockTimeout);
    }

    // Set safety timeout - if GENERATION_ENDED doesn't fire, clear the lock anyway
    generationLockTimeout = getDeps().setTimeout(() => {
        if (operationState.generationInProgress) {
            getDeps().console.warn('OpenVault: Generation lock timeout - clearing stale lock');
            operationState.generationInProgress = false;
        }
    }, GENERATION_LOCK_TIMEOUT_MS);
}

/**
 * Clear generation lock and cancel safety timeout
 */
export function clearGenerationLock() {
    operationState.generationInProgress = false;
    if (generationLockTimeout) {
        getDeps().clearTimeout(generationLockTimeout);
        generationLockTimeout = null;
    }
}

/**
 * Clear all generation lock state (for backfill completion)
 */
export function clearAllLocks() {
    operationState.generationInProgress = false;
    operationState.extractionInProgress = false;
    operationState.retrievalInProgress = false;
    if (generationLockTimeout) {
        getDeps().clearTimeout(generationLockTimeout);
        generationLockTimeout = null;
    }
}

/**
 * Check if chat loading cooldown is active
 * @returns {boolean}
 */
export function isChatLoadingCooldown() {
    return chatLoadingCooldown;
}

/**
 * Set chat loading cooldown with automatic clear after timeout
 * @param {number} timeoutMs - Timeout in milliseconds (default 2000)
 * @param {function} logFn - Optional logging function
 */
export function setChatLoadingCooldown(timeoutMs = 2000, logFn = null) {
    chatLoadingCooldown = true;
    if (chatLoadingTimeout) {
        getDeps().clearTimeout(chatLoadingTimeout);
    }
    chatLoadingTimeout = getDeps().setTimeout(() => {
        chatLoadingCooldown = false;
        if (logFn) logFn('Chat load cooldown cleared');
    }, timeoutMs);
}

/**
 * Reset operation states on chat change (only if safe)
 */
export function resetOperationStatesIfSafe() {
    if (!operationState.generationInProgress) {
        operationState.extractionInProgress = false;
        operationState.retrievalInProgress = false;
    }
}
