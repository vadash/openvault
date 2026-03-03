import { describe, expect, it } from 'vitest';
import { defaultSettings, UI_DEFAULT_HINTS } from '../src/constants.js';

describe('defaultSettings after smart retrieval removal', () => {
    it('does not contain smartRetrievalEnabled', () => {
        expect(defaultSettings).not.toHaveProperty('smartRetrievalEnabled');
    });

    it('does not contain retrievalProfile', () => {
        expect(defaultSettings).not.toHaveProperty('retrievalProfile');
    });
});

describe('new feature settings', () => {
    it('has reflectionThreshold default', () => {
        expect(defaultSettings.reflectionThreshold).toBe(30);
    });

    it('has worldContextBudget default', () => {
        expect(defaultSettings.worldContextBudget).toBe(2000);
    });

    it('has communityDetectionInterval default', () => {
        expect(defaultSettings.communityDetectionInterval).toBe(50);
    });
});

describe('UI_DEFAULT_HINTS for features', () => {
    it('has reflectionThreshold hint', () => {
        expect(UI_DEFAULT_HINTS.reflectionThreshold).toBe(30);
    });

    it('has worldContextBudget hint', () => {
        expect(UI_DEFAULT_HINTS.worldContextBudget).toBe(2000);
    });

    it('has communityDetectionInterval hint', () => {
        expect(UI_DEFAULT_HINTS.communityDetectionInterval).toBe(50);
    });
});
