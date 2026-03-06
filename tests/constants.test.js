import { describe, expect, it } from 'vitest';
import { defaultSettings, UI_DEFAULT_HINTS } from '../src/constants.js';

describe('all settings used in backend have UI hints', () => {
    const requiredHints = [
        'forgetfulnessBaseLambda',
        'forgetfulnessImportance5Floor',
        'reflectionDecayThreshold',
        'entityDescriptionCap',
        'maxReflectionsPerCharacter',
        'communityStalenessThreshold',
        'dedupJaccardThreshold',
    ];

    for (const key of requiredHints) {
        it(`has UI_DEFAULT_HINTS.${key}`, () => {
            expect(UI_DEFAULT_HINTS[key]).toBeDefined();
            expect(UI_DEFAULT_HINTS[key]).toBe(defaultSettings[key]);
        });
    }
});
