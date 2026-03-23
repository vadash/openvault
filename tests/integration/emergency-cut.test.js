import { describe, expect, it } from 'vitest';

// =============================================================================
// Emergency Cut Integration Tests
//
// Tests the Emergency Cut wiring and component exports.
// Unit tests in extraction/emergency-cut.test.js cover edge cases and detailed behavior.
// Full flow tests require SillyTavern runtime context.
// =============================================================================

describe('Emergency Cut Integration', () => {
    describe('Domain exports from extract.js', () => {
        it('exports executeEmergencyCut function', async () => {
            const { executeEmergencyCut } = await import('../../src/extraction/extract.js');
            expect(typeof executeEmergencyCut).toBe('function');
        });

        it('exports hideExtractedMessages function', async () => {
            const { hideExtractedMessages } = await import('../../src/extraction/extract.js');
            expect(typeof hideExtractedMessages).toBe('function');
        });
    });

    describe('UI exports from settings.js', () => {
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

    describe('extractAllMessages accepts emergencyCut options', () => {
        it('extractAllMessages accepts options object', async () => {
            const { extractAllMessages } = await import('../../src/extraction/extract.js');
            expect(typeof extractAllMessages).toBe('function');
            expect(extractAllMessages.length).toBe(1);
        });
    });
});
