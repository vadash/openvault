import { describe, expect, it } from 'vitest';
import {
    defaultSettings,
    INJECTION_POSITIONS,
    PAYLOAD_CALC,
    POSITION_LABELS,
    UI_DEFAULT_HINTS,
} from '../src/constants.js';

describe('PAYLOAD_CALC', () => {
    it('exports all required fields', () => {
        expect(PAYLOAD_CALC.PROMPT_ESTIMATE).toBe(2000);
        expect(PAYLOAD_CALC.OVERHEAD).toBe(2000);
        expect(PAYLOAD_CALC.THRESHOLD_GREEN).toBe(32000);
        expect(PAYLOAD_CALC.THRESHOLD_YELLOW).toBe(48000);
        expect(PAYLOAD_CALC.THRESHOLD_ORANGE).toBe(64000);
    });
});

describe('defaultSettings', () => {
    it('has backupProfile in defaultSettings', () => {
        expect(defaultSettings.backupProfile).toBe('');
    });

    it('should have transientDecayMultiplier defined', () => {
        expect(defaultSettings.transientDecayMultiplier).toBeDefined();
        expect(defaultSettings.transientDecayMultiplier).toBe(5.0);
    });
});

describe('CONSOLIDATION', () => {
    it('defines CONSOLIDATION constants', async () => {
        const { CONSOLIDATION } = await import('../src/constants.js');
        expect(CONSOLIDATION).toBeDefined();
        expect(CONSOLIDATION.TOKEN_THRESHOLD).toBe(150);
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
        expect(defaultSettings.bucketMinRepresentation).toBe(0.2);
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

describe('Concurrency Settings', () => {
    it('should have maxConcurrency in defaultSettings with default of 1', () => {
        expect(defaultSettings.maxConcurrency).toBe(1);
    });

    it('should have maxConcurrency in UI_DEFAULT_HINTS', () => {
        expect(UI_DEFAULT_HINTS.maxConcurrency).toBeDefined();
        expect(UI_DEFAULT_HINTS.maxConcurrency).toBe(1);
    });
});

describe('INJECTION_POSITIONS', () => {
    it('should have all position codes with correct labels', () => {
        expect(INJECTION_POSITIONS).toEqual({
            BEFORE_MAIN: 0,
            AFTER_MAIN: 1,
            BEFORE_AN: 2,
            AFTER_AN: 3,
            IN_CHAT: 4,
            CUSTOM: -1,
        });
    });
});

describe('POSITION_LABELS', () => {
    it('should have position labels array with correct structure', () => {
        expect(POSITION_LABELS).toBeDefined();
        expect(POSITION_LABELS).toHaveLength(6);
        expect(POSITION_LABELS[0]).toEqual({ value: 0, label: '↑Char', description: 'Before character definitions' });
        expect(POSITION_LABELS[1]).toEqual({ value: 1, label: '↓Char', description: 'After character definitions' });
        expect(POSITION_LABELS[2]).toEqual({ value: 2, label: '↑AN', description: "Before author's note" });
        expect(POSITION_LABELS[3]).toEqual({ value: 3, label: '↓AN', description: "After author's note" });
        expect(POSITION_LABELS[4]).toEqual({ value: 4, label: 'In-chat', description: 'At specified message depth' });
        expect(POSITION_LABELS[5]).toEqual({ value: -1, label: 'Custom', description: 'Use macro manually' });
    });
});

describe('defaultSettings injection config', () => {
    it('should have injection defaults for memory and world', () => {
        expect(defaultSettings.injection).toBeDefined();
        expect(defaultSettings.injection.memory).toEqual({
            position: 1,
            depth: 4,
        });
        expect(defaultSettings.injection.world).toEqual({
            position: 1,
            depth: 4,
        });
    });
});
