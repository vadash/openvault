import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extensionName } from '../../src/constants.js';
import { resetDeps, setDeps } from '../../src/deps.js';
import { isExtensionEnabled, safeSetExtensionPrompt, withTimeout, yieldToMain } from '../../src/utils/st-helpers.js';

describe('st-helpers', () => {
    afterEach(() => resetDeps());

    describe('withTimeout', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('resolves when promise completes before timeout', async () => {
            const result = await withTimeout(Promise.resolve('success'), 1000, 'Test');
            expect(result).toBe('success');
        });

        it('rejects when promise exceeds timeout', async () => {
            const promise = new Promise((resolve) => setTimeout(resolve, 100));
            const resultPromise = withTimeout(promise, 10, 'Test');

            // Advance time past the timeout
            vi.advanceTimersByTime(10);

            await expect(resultPromise).rejects.toThrow('Test timed out after 10ms');
        });

        it('should clear timeout when promise resolves before timeout', async () => {
            const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

            const promise = Promise.resolve('success');
            const resultPromise = withTimeout(promise, 5000, 'Test');

            // Fast-forward but not enough to trigger timeout
            await vi.advanceTimersByTimeAsync(100);

            const result = await resultPromise;

            expect(result).toBe('success');
            expect(clearTimeoutSpy).toHaveBeenCalled();
        });

        it('should clear timeout when promise rejects before timeout', async () => {
            const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

            // Create a promise that rejects, but catch the rejection to prevent unhandled warning
            const error = new Error('test error');
            const rejectingPromise = new Promise((_, reject) => reject(error));
            rejectingPromise.catch(() => {}); // Prevent unhandled rejection

            const resultPromise = withTimeout(rejectingPromise, 5000, 'Test');

            // Fast-forward but not enough to trigger timeout
            await vi.advanceTimersByTimeAsync(100);

            await expect(resultPromise).rejects.toThrow('test error');
            expect(clearTimeoutSpy).toHaveBeenCalled();
        });

        it('should reject with timeout error when promise takes too long', async () => {
            const promise = new Promise(() => {}); // Never resolves
            const resultPromise = withTimeout(promise, 5000, 'Test Operation');

            vi.advanceTimersByTime(5000);

            await expect(resultPromise).rejects.toThrow('Test Operation timed out after 5000ms');
        });

        it('should resolve with promise value when it completes in time', async () => {
            const promise = Promise.resolve('completed');

            const result = await withTimeout(promise, 5000, 'Test');

            expect(result).toBe('completed');
        });
    });

    describe('safeSetExtensionPrompt', () => {
        it('calls setExtensionPrompt and returns true on success', () => {
            const mockSetPrompt = vi.fn();
            setDeps({
                console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
                setExtensionPrompt: mockSetPrompt,
                extension_prompt_types: { IN_PROMPT: 0 },
            });

            expect(safeSetExtensionPrompt('test content')).toBe(true);
            expect(mockSetPrompt).toHaveBeenCalledWith(extensionName, 'test content', 0, 0);
        });

        it('returns false on error', () => {
            setDeps({
                console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
                setExtensionPrompt: () => {
                    throw new Error('Prompt failed');
                },
                extension_prompt_types: { IN_PROMPT: 3 },
            });

            expect(safeSetExtensionPrompt('test content')).toBe(false);
        });

        it('passes custom name to setExtensionPrompt', () => {
            const mockSetPrompt = vi.fn();
            setDeps({
                console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
                setExtensionPrompt: mockSetPrompt,
                extension_prompt_types: { IN_PROMPT: 0 },
            });

            safeSetExtensionPrompt('test content', 'openvault_world');
            expect(mockSetPrompt).toHaveBeenCalledWith('openvault_world', 'test content', 0, 0);
        });

        it('defaults to extensionName when no name provided', () => {
            const mockSetPrompt = vi.fn();
            setDeps({
                console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
                setExtensionPrompt: mockSetPrompt,
                extension_prompt_types: { IN_PROMPT: 0 },
            });

            safeSetExtensionPrompt('test content');
            expect(mockSetPrompt).toHaveBeenCalledWith('openvault', 'test content', 0, 0);
        });
    });

    describe('isExtensionEnabled', () => {
        it('returns true when enabled is true', () => {
            setDeps({ getExtensionSettings: () => ({ [extensionName]: { enabled: true } }) });
            expect(isExtensionEnabled()).toBe(true);
        });

        it('returns false when enabled is false', () => {
            setDeps({ getExtensionSettings: () => ({ [extensionName]: { enabled: false } }) });
            expect(isExtensionEnabled()).toBe(false);
        });

        it('returns false when settings missing', () => {
            setDeps({ getExtensionSettings: () => ({}) });
            expect(isExtensionEnabled()).toBe(false);
        });
    });

    describe('yieldToMain', () => {
        it('returns a promise that resolves', async () => {
            await yieldToMain();
        });
    });
});
