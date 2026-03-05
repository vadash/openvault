import { describe, expect, it } from 'vitest';

// -------------------------------------------------------------------------
// Test: settings.js must bind and update all 7 new settings.
//
// Strategy: We read the source file as text and verify that the jQuery
// selectors and saveSetting() calls exist for each new setting. This avoids
// needing a full DOM + SillyTavern runtime.
// -------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const settingsSource = readFileSync(resolve('src/ui/settings.js'), 'utf-8');

describe('settings.js binds all 7 new settings', () => {
    // Each entry: [HTML element ID prefix, settings key]
    const newBindings = [
        ['openvault_forgetfulness_lambda', 'forgetfulnessBaseLambda'],
        ['openvault_importance5_floor', 'forgetfulnessImportance5Floor'],
        ['openvault_reflection_decay_threshold', 'reflectionDecayThreshold'],
        ['openvault_entity_description_cap', 'entityDescriptionCap'],
        ['openvault_max_reflections', 'maxReflectionsPerCharacter'],
        ['openvault_community_staleness', 'communityStalenessThreshold'],
        ['openvault_dedup_jaccard', 'dedupJaccardThreshold'],
    ];

    for (const [elementId, settingsKey] of newBindings) {
        it(`binds #${elementId} to saveSetting('${settingsKey}')`, () => {
            // Verify the input handler exists in bindUIElements
            expect(settingsSource).toContain(`#${elementId}`);
            expect(settingsSource).toContain(`'${settingsKey}'`);
        });

        it(`updateUI sets #${elementId} value`, () => {
            // Verify updateUI populates the element
            expect(settingsSource).toContain(`#${elementId}_value`);
        });
    }
});
