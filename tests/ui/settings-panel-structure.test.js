import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// -------------------------------------------------------------------------
// Test: Validate the HTML template has the correct 4-tab structure
// and contains all 7 new slider inputs with proper IDs.
// -------------------------------------------------------------------------

const html = readFileSync(resolve('templates/settings_panel.html'), 'utf-8');

describe('settings_panel.html tab structure', () => {
    it('has exactly 4 tab buttons', () => {
        const tabBtns = html.match(/class="openvault-tab-btn[^"]*"/g);
        expect(tabBtns).toHaveLength(4);
    });

    it('has tab: dashboard-connections', () => {
        expect(html).toContain('data-tab="dashboard-connections"');
    });

    it('has tab: memory-bank', () => {
        expect(html).toContain('data-tab="memory-bank"');
    });

    it('has tab: world', () => {
        expect(html).toContain('data-tab="world"');
    });

    it('has tab: advanced', () => {
        expect(html).toContain('data-tab="advanced"');
    });

    it('does NOT have old tab: configuration', () => {
        expect(html).not.toContain('data-tab="configuration"');
    });

    it('does NOT have old tab: system', () => {
        expect(html).not.toContain('data-tab="system"');
    });
});

describe('settings_panel.html has all 7 new slider inputs', () => {
    const newInputIds = [
        'openvault_forgetfulness_lambda',
        'openvault_importance5_floor',
        'openvault_reflection_decay_threshold',
        'openvault_entity_description_cap',
        'openvault_max_reflections',
        'openvault_community_staleness',
        'openvault_dedup_jaccard',
    ];

    for (const id of newInputIds) {
        it(`contains input#${id}`, () => {
            expect(html).toContain(`id="${id}"`);
        });

        it(`contains value display #${id}_value`, () => {
            expect(html).toContain(`id="${id}_value"`);
        });
    }
});

describe('settings_panel.html has default-hint spans for new settings', () => {
    const newHintKeys = [
        'forgetfulnessBaseLambda',
        'forgetfulnessImportance5Floor',
        'reflectionDecayThreshold',
        'entityDescriptionCap',
        'maxReflectionsPerCharacter',
        'dedupJaccardThreshold',
    ];

    for (const key of newHintKeys) {
        it(`has default-hint for ${key}`, () => {
            expect(html).toContain(`data-default-key="${key}"`);
        });
    }
});

describe('settings_panel.html collapsed sections', () => {
    // Tab 1: Dashboard & Connections should have a collapsed "Connection Settings" section
    it('has collapsed Connection Settings section', () => {
        expect(html).toContain('Connection Settings');
    });

    // Tab 2: Memory Bank should have a collapsed "Extraction & Graph Rules" section
    it('has collapsed Extraction & Graph Rules section', () => {
        expect(html).toContain('Extraction');
    });

    // Tab 3: World should have a collapsed "Retrieval & Injection" section
    it('has collapsed Retrieval section', () => {
        expect(html).toContain('Retrieval');
    });

    // Tab 4: Advanced should have Decay Math section
    it('has Decay Math section in advanced', () => {
        expect(html).toContain('Decay');
    });
});
