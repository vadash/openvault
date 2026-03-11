import { describe, expect, it } from 'vitest';
import { defaultSettings, PAYLOAD_CALC, UI_DEFAULT_HINTS } from '../src/constants.js';

describe('PAYLOAD_CALC', () => {
    it('exports all required fields', () => {
        expect(PAYLOAD_CALC.LLM_OUTPUT_TOKENS).toBe(8000);
        expect(PAYLOAD_CALC.PROMPT_ESTIMATE).toBe(2000);
        expect(PAYLOAD_CALC.SAFETY_BUFFER).toBe(2000);
        expect(PAYLOAD_CALC.OVERHEAD).toBe(12000);
        expect(PAYLOAD_CALC.THRESHOLD_GREEN).toBe(32000);
        expect(PAYLOAD_CALC.THRESHOLD_YELLOW).toBe(48000);
        expect(PAYLOAD_CALC.THRESHOLD_ORANGE).toBe(64000);
    });
});

describe('defaultSettings', () => {
    it('has backupProfile in defaultSettings', () => {
        expect(defaultSettings.backupProfile).toBe('');
    });
});

describe('CONSOLIDATION', () => {
    it('defines CONSOLIDATION constants', async () => {
        const { CONSOLIDATION } = await import('../src/constants.js');
        expect(CONSOLIDATION).toBeDefined();
        expect(CONSOLIDATION.TOKEN_THRESHOLD).toBe(500);
        expect(CONSOLIDATION.MAX_CONSOLIDATION_BATCH).toBe(10);
        expect(CONSOLIDATION.CONSOLIDATED_DESCRIPTION_CAP).toBe(2);
    });
});

describe('Exact Phrase Boost Settings', () => {
    it('should have exactPhraseBoostWeight in defaultSettings', () => {
        expect(defaultSettings.exactPhraseBoostWeight).toBeDefined();
        expect(defaultSettings.exactPhraseBoostWeight).toBe(10.0);
    });

    it('should have exactPhraseBoostWeight in UI_DEFAULT_HINTS', () => {
        expect(UI_DEFAULT_HINTS.exactPhraseBoostWeight).toBeDefined();
    });
});

describe('Reflection Level Settings', () => {
    it('should have maxReflectionLevel in defaultSettings', async () => {
        const { defaultSettings } = await import('../src/constants.js');
        expect(defaultSettings.maxReflectionLevel).toBe(3);
    });

    it('should have reflectionLevelMultiplier in defaultSettings', async () => {
        const { defaultSettings } = await import('../src/constants.js');
        expect(defaultSettings.reflectionLevelMultiplier).toBe(2.0);
    });

    it('should have maxReflectionLevel in UI_DEFAULT_HINTS', async () => {
        const { UI_DEFAULT_HINTS } = await import('../src/constants.js');
        expect(UI_DEFAULT_HINTS.maxReflectionLevel).toBeDefined();
    });

    it('should have reflectionLevelMultiplier in UI_DEFAULT_HINTS', async () => {
        const { UI_DEFAULT_HINTS } = await import('../src/constants.js');
        expect(UI_DEFAULT_HINTS.reflectionLevelMultiplier).toBeDefined();
    });
});

describe('Bucket Balance Settings', () => {
    it('should have bucketMinRepresentation in defaultSettings', async () => {
        const { defaultSettings } = await import('../src/constants.js');
        expect(defaultSettings.bucketMinRepresentation).toBe(0.20);
    });

    it('should have bucketSoftBalanceBudget in defaultSettings', async () => {
        const { defaultSettings } = await import('../src/constants.js');
        expect(defaultSettings.bucketSoftBalanceBudget).toBe(0.05);
    });

    it('should have bucketMinRepresentation in UI_DEFAULT_HINTS', async () => {
        const { UI_DEFAULT_HINTS } = await import('../src/constants.js');
        expect(UI_DEFAULT_HINTS.bucketMinRepresentation).toBeDefined();
    });

    it('should have bucketSoftBalanceBudget in UI_DEFAULT_HINTS', async () => {
        const { UI_DEFAULT_HINTS } = await import('../src/constants.js');
        expect(UI_DEFAULT_HINTS.bucketSoftBalanceBudget).toBeDefined();
    });
});
