/**
 * OpenVault State Management
 *
 * Handles operation state machine, generation locks, and chat loading cooldown.
 */

import { GENERATION_LOCK_TIMEOUT_MS } from './constants.js';
import { getDeps } from './deps.js';
import { logWarn } from './utils/logging.js';

// Session-scoped AbortController — one per active chat session.
// On CHAT_CHANGED, the old controller is aborted and a new one is created.
let _sessionController = new AbortController();

// Session-scoped disable flag for migration failures
// Unlike global settings, this only affects the current chat session
let _sessionDisabled = false;

/**
 * Get the current session's AbortSignal.
 * Leaf I/O functions (callLLM, embedding) read this as their default signal.
 * @returns {AbortSignal}
 */
export function getSessionSignal() {
    return _sessionController.signal;
}

/**
 * Abort all in-flight operations and create a fresh controller.
 * Called on CHAT_CHANGED before any new work starts.
 */
export function resetSessionController() {
    _sessionController.abort();
    _sessionController = new AbortController();
    _sessionDisabled = false; // Reset kill-switch on chat change
}

/**
 * Check if OpenVault is disabled for the current session.
 * Used when schema migration fails to prevent further damage.
 * @returns {boolean}
 */
export function isSessionDisabled() {
    return _sessionDisabled;
}

/**
 * Set the session-scoped disabled flag.
 * @param {boolean} value
 */
export function setSessionDisabled(value) {
    _sessionDisabled = value;
}

// Tracks when the last LLM API call completed (or when rpmDelay last ran).
// Updated by callLLM after every response and by rpmDelay before each call,
// so that rate-limit spacing is based on actual API activity.
let _lastApiCallTime = 0;

/** @returns {number} */
export function getLastApiCallTime() {
    return _lastApiCallTime;
}

/** @param {number} t */
export function setLastApiCallTime(t) {
    _lastApiCallTime = t;
}

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

// Worker singleton state — moved from worker.js for concurrency visibility
let _workerRunning = false;
let _wakeGeneration = 0;

/**
 * Check if the background worker is currently processing.
 */
export function isWorkerRunning() {
    return _workerRunning;
}

/**
 * Set the background worker running state.
 * @param {boolean} value
 */
export function setWorkerRunning(value) {
    _workerRunning = value;
}

/**
 * Get current wake generation counter.
 * Used by interruptible sleep to detect new messages.
 * @returns {number}
 */
export function getWakeGeneration() {
    return _wakeGeneration;
}

/**
 * Increment wake generation to signal the worker to reset backoff.
 */
export function incrementWakeGeneration() {
    _wakeGeneration++;
}

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
            logWarn('Generation lock timeout - clearing stale lock');
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
    _workerRunning = false;
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
