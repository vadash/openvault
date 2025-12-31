/**
 * Tests for src/state.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import {
    operationState,
    setGenerationLock,
    clearGenerationLock,
    clearAllLocks,
    isChatLoadingCooldown,
    setChatLoadingCooldown,
    resetOperationStatesIfSafe,
} from '../src/state.js';
import { GENERATION_LOCK_TIMEOUT_MS } from '../src/constants.js';

describe('state', () => {
    let mockConsole;
    let mockSetTimeout;
    let mockClearTimeout;
    let timeoutCallbacks;
    let timeoutIdCounter;

    beforeEach(() => {
        // Reset all operation states before each test
        operationState.generationInProgress = false;
        operationState.extractionInProgress = false;
        operationState.retrievalInProgress = false;

        mockConsole = {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        // Track timeout callbacks so we can trigger them manually
        timeoutCallbacks = new Map();
        timeoutIdCounter = 1;

        mockSetTimeout = vi.fn((fn, ms) => {
            const id = timeoutIdCounter++;
            timeoutCallbacks.set(id, { fn, ms });
            return id;
        });

        mockClearTimeout = vi.fn((id) => {
            timeoutCallbacks.delete(id);
        });

        setDeps({
            console: mockConsole,
            setTimeout: mockSetTimeout,
            clearTimeout: mockClearTimeout,
        });
    });

    afterEach(() => {
        // Clean up locks between tests
        clearAllLocks();
        resetDeps();
    });

    describe('setGenerationLock', () => {
        it('sets generationInProgress to true', () => {
            expect(operationState.generationInProgress).toBe(false);
            setGenerationLock();
            expect(operationState.generationInProgress).toBe(true);
        });

        it('sets safety timeout with correct duration', () => {
            setGenerationLock();
            expect(mockSetTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                GENERATION_LOCK_TIMEOUT_MS
            );
        });

        it('clears previous timeout before setting new one', () => {
            setGenerationLock();
            const firstTimeoutId = mockSetTimeout.mock.results[0].value;

            setGenerationLock();
            expect(mockClearTimeout).toHaveBeenCalledWith(firstTimeoutId);
        });

        it('clears lock and logs warning when safety timeout fires', () => {
            setGenerationLock();
            expect(operationState.generationInProgress).toBe(true);

            // Trigger the timeout callback
            const timeoutId = mockSetTimeout.mock.results[0].value;
            const callback = timeoutCallbacks.get(timeoutId);
            callback.fn();

            expect(operationState.generationInProgress).toBe(false);
            expect(mockConsole.warn).toHaveBeenCalledWith(
                'OpenVault: Generation lock timeout - clearing stale lock'
            );
        });

        it('does not log warning if lock already cleared when timeout fires', () => {
            // Save the timeout callback before clearGenerationLock deletes it
            setGenerationLock();
            const timeoutId = mockSetTimeout.mock.results[0].value;
            const savedCallback = timeoutCallbacks.get(timeoutId);

            // Clear the lock (which also clears the timeout from our map)
            clearGenerationLock();
            expect(operationState.generationInProgress).toBe(false);

            // Manually trigger the saved callback to simulate a late timeout
            // The callback has a guard: only warns if generationInProgress is still true
            savedCallback.fn();

            // Should NOT warn because generationInProgress was already false
            expect(mockConsole.warn).not.toHaveBeenCalled();
        });
    });

    describe('clearGenerationLock', () => {
        it('sets generationInProgress to false', () => {
            operationState.generationInProgress = true;
            clearGenerationLock();
            expect(operationState.generationInProgress).toBe(false);
        });

        it('clears the safety timeout', () => {
            setGenerationLock();
            const timeoutId = mockSetTimeout.mock.results[0].value;

            clearGenerationLock();
            expect(mockClearTimeout).toHaveBeenCalledWith(timeoutId);
        });

        it('handles being called when no timeout exists', () => {
            // Should not throw
            clearGenerationLock();
            expect(operationState.generationInProgress).toBe(false);
        });
    });

    describe('clearAllLocks', () => {
        it('resets all operation states to false', () => {
            operationState.generationInProgress = true;
            operationState.extractionInProgress = true;
            operationState.retrievalInProgress = true;

            clearAllLocks();

            expect(operationState.generationInProgress).toBe(false);
            expect(operationState.extractionInProgress).toBe(false);
            expect(operationState.retrievalInProgress).toBe(false);
        });

        it('clears generation lock timeout', () => {
            setGenerationLock();
            const timeoutId = mockSetTimeout.mock.results[0].value;

            clearAllLocks();
            expect(mockClearTimeout).toHaveBeenCalledWith(timeoutId);
        });

        it('handles being called when no timeout exists', () => {
            // Should not throw
            clearAllLocks();
            expect(operationState.generationInProgress).toBe(false);
        });
    });

    describe('isChatLoadingCooldown', () => {
        it('returns true by default (initial state)', () => {
            // Note: chatLoadingCooldown starts as true in the module
            // But we need to test this through setChatLoadingCooldown
            setChatLoadingCooldown(1000);
            expect(isChatLoadingCooldown()).toBe(true);
        });

        it('returns false after cooldown expires', () => {
            setChatLoadingCooldown(1000);

            // Trigger the timeout callback
            const timeoutId = mockSetTimeout.mock.results[0].value;
            const callback = timeoutCallbacks.get(timeoutId);
            callback.fn();

            expect(isChatLoadingCooldown()).toBe(false);
        });
    });

    describe('setChatLoadingCooldown', () => {
        it('sets cooldown state to true', () => {
            setChatLoadingCooldown(2000);
            expect(isChatLoadingCooldown()).toBe(true);
        });

        it('uses default timeout of 2000ms', () => {
            setChatLoadingCooldown();
            expect(mockSetTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                2000
            );
        });

        it('uses provided timeout value', () => {
            setChatLoadingCooldown(5000);
            expect(mockSetTimeout).toHaveBeenCalledWith(
                expect.any(Function),
                5000
            );
        });

        it('clears cooldown after timeout', () => {
            setChatLoadingCooldown(1000);
            expect(isChatLoadingCooldown()).toBe(true);

            // Trigger the timeout callback
            const timeoutId = mockSetTimeout.mock.results[0].value;
            const callback = timeoutCallbacks.get(timeoutId);
            callback.fn();

            expect(isChatLoadingCooldown()).toBe(false);
        });

        it('clears previous cooldown timer when setting new one', () => {
            setChatLoadingCooldown(1000);
            const firstTimeoutId = mockSetTimeout.mock.results[0].value;

            setChatLoadingCooldown(2000);
            expect(mockClearTimeout).toHaveBeenCalledWith(firstTimeoutId);
        });

        it('calls optional log callback when cooldown clears', () => {
            const logFn = vi.fn();
            setChatLoadingCooldown(1000, logFn);

            // Trigger the timeout callback
            const timeoutId = mockSetTimeout.mock.results[0].value;
            const callback = timeoutCallbacks.get(timeoutId);
            callback.fn();

            expect(logFn).toHaveBeenCalledWith('Chat load cooldown cleared');
        });

        it('does not call log callback if not provided', () => {
            setChatLoadingCooldown(1000);

            // Trigger the timeout callback - should not throw
            const timeoutId = mockSetTimeout.mock.results[0].value;
            const callback = timeoutCallbacks.get(timeoutId);
            callback.fn();

            // Just verify no errors occurred
            expect(isChatLoadingCooldown()).toBe(false);
        });
    });

    describe('resetOperationStatesIfSafe', () => {
        it('resets extraction and retrieval when generation NOT in progress', () => {
            operationState.generationInProgress = false;
            operationState.extractionInProgress = true;
            operationState.retrievalInProgress = true;

            resetOperationStatesIfSafe();

            expect(operationState.extractionInProgress).toBe(false);
            expect(operationState.retrievalInProgress).toBe(false);
        });

        it('does NOT reset when generation is in progress', () => {
            operationState.generationInProgress = true;
            operationState.extractionInProgress = true;
            operationState.retrievalInProgress = true;

            resetOperationStatesIfSafe();

            expect(operationState.extractionInProgress).toBe(true);
            expect(operationState.retrievalInProgress).toBe(true);
        });

        it('does not affect generation state', () => {
            operationState.generationInProgress = true;
            operationState.extractionInProgress = true;

            resetOperationStatesIfSafe();

            expect(operationState.generationInProgress).toBe(true);
        });
    });
});
