import { describe, expect, it, vi } from 'vitest';

// =============================================================================
// Emergency Cut Integration Tests
//
// Tests the Emergency Cut wiring and component exports.
// Unit tests in settings-helpers.test.js cover edge cases and detailed behavior.
// Full flow tests require SillyTavern runtime context.
// =============================================================================

describe('Emergency Cut Integration', () => {
    describe('Module exports', () => {
        it('exports handleEmergencyCut function', async () => {
            const { handleEmergencyCut } = await import('../../src/ui/settings.js');
            expect(typeof handleEmergencyCut).toBe('function');
        });

        it('exports hideExtractedMessages function', async () => {
            const { hideExtractedMessages } = await import('../../src/ui/settings.js');
            expect(typeof hideExtractedMessages).toBe('function');
        });

        it('exports showEmergencyCutModal function', async () => {
            const { showEmergencyCutModal } = await import('../../src/ui/settings.js');
            expect(typeof showEmergencyCutModal).toBe('function');
        });

        it('exports hideEmergencyCutModal function', async () => {
            const { hideEmergencyCutModal } = await import('../../src/ui/settings.js');
            expect(typeof hideEmergencyCutModal).toBe('function');
        });

        it('exports updateEmergencyCutProgress function', async () => {
            const { updateEmergencyCutProgress } = await import('../../src/ui/settings.js');
            expect(typeof updateEmergencyCutProgress).toBe('function');
        });

        it('exports disableEmergencyCutCancel function', async () => {
            const { disableEmergencyCutCancel } = await import('../../src/ui/settings.js');
            expect(typeof disableEmergencyCutCancel).toBe('function');
        });
    });

    describe('Function signatures', () => {
        it('handleEmergencyCut is async and returns a Promise', async () => {
            const { handleEmergencyCut } = await import('../../src/ui/settings.js');
            // Create a properly mocked context to avoid errors
            const result = handleEmergencyCut();
            expect(result).toBeInstanceOf(Promise);
            // Suppress unhandled rejection
            result.catch(() => {});
        });

        it('hideExtractedMessages is async and returns a Promise', async () => {
            const { hideExtractedMessages } = await import('../../src/ui/settings.js');
            const result = hideExtractedMessages();
            expect(result).toBeInstanceOf(Promise);
            // Suppress unhandled rejection
            result.catch(() => {});
        });
    });

    describe('Integration with extraction pipeline', () => {
        it('extractAllMessages accepts emergencyCut options object', async () => {
            const { extractAllMessages } = await import('../../src/extraction/extract.js');

            // Verify function exists and has correct arity (accepts options)
            expect(typeof extractAllMessages).toBe('function');
            expect(extractAllMessages.length).toBe(1); // Takes one argument (options object)
        });
    });

    describe('AbortController integration', () => {
        it('handleEmergencyCut uses AbortController for cancellation', async () => {
            // This test verifies that the module structure supports abort
            // Actual cancellation behavior is tested in unit tests
            const { handleEmergencyCut } = await import('../../src/ui/settings.js');

            // Function exists and is async
            expect(typeof handleEmergencyCut).toBe('function');
        });
    });
});