import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
    renderEntityCard,
    renderMemoryItem,
    renderReflectionProgress,
    renderWorldStateCard,
} from '../../src/ui/templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read settings panel HTML for template validation
const settingsPanelHtml = readFileSync(join(__dirname, '../../templates/settings_panel.html'), 'utf-8');

describe('ui/templates', () => {
    describe('renderMemoryItem', () => {
        it('includes reflection badge for reflection memories', () => {
            const memory = {
                id: 'ref_001',
                type: 'reflection',
                summary: 'Alice has grown suspicious',
                importance: 4,
                characters_involved: ['Alice'],
                source_ids: ['ev_001', 'ev_002', 'ev_003'],
                created_at: Date.now(),
            };
            const html = renderMemoryItem(memory);
            expect(html).toContain('fa-lightbulb');
            expect(html).toContain('Reflection');
        });

        it('includes evidence count for reflection with source_ids', () => {
            const memory = {
                id: 'ref_001',
                type: 'reflection',
                summary: 'Alice has grown suspicious',
                importance: 4,
                characters_involved: ['Alice'],
                source_ids: ['ev_001', 'ev_002', 'ev_003'],
                created_at: Date.now(),
            };
            const html = renderMemoryItem(memory);
            expect(html).toContain('3 evidence');
        });

        it('does not include reflection badge for regular events', () => {
            const memory = {
                id: 'ev_001',
                summary: 'Alice entered the room',
                importance: 3,
                characters_involved: ['Alice'],
                created_at: Date.now(),
            };
            const html = renderMemoryItem(memory);
            expect(html).not.toContain('fa-lightbulb');
            expect(html).not.toContain('Reflection');
        });
    });

    describe('renderReflectionProgress', () => {
        it('renders counters for each character', () => {
            const state = {
                'King Aldric': { importance_sum: 22 },
                'Royal Guard': { importance_sum: 8 },
            };
            const html = renderReflectionProgress(state, 30);
            expect(html).toContain('King Aldric: 22/30');
            expect(html).toContain('Royal Guard: 8/30');
        });

        it('sorts characters alphabetically', () => {
            const state = {
                Zelda: { importance_sum: 10 },
                Alice: { importance_sum: 5 },
            };
            const html = renderReflectionProgress(state, 30);
            const aliceIdx = html.indexOf('Alice');
            const zeldaIdx = html.indexOf('Zelda');
            expect(aliceIdx).toBeLessThan(zeldaIdx);
        });

        it('returns placeholder for empty state', () => {
            const html = renderReflectionProgress({}, 30);
            expect(html).toContain('No reflection data yet');
        });

        it('returns placeholder for null state', () => {
            const html = renderReflectionProgress(null, 30);
            expect(html).toContain('No reflection data yet');
        });

        it('defaults importance_sum to 0', () => {
            const state = { Alice: {} };
            const html = renderReflectionProgress(state, 30);
            expect(html).toContain('Alice: 0/30');
        });
    });

    describe('renderWorldStateCard', () => {
        it('renders world state summary', () => {
            const worldState = {
                summary: 'The kingdom is ruled by King Aldric from the Castle.',
                last_updated: Date.now(),
            };
            const html = renderWorldStateCard(worldState);
            expect(html).toContain('The kingdom is ruled by King Aldric from the Castle.');
        });

        it('renders timestamp', () => {
            const now = Date.now();
            const worldState = {
                summary: 'Test summary',
                last_updated: now,
            };
            const html = renderWorldStateCard(worldState);
            expect(html).toContain('Last updated:');
        });

        it('handles missing timestamp', () => {
            const worldState = {
                summary: 'Test summary',
            };
            const html = renderWorldStateCard(worldState);
            expect(html).toContain('Last updated: Unknown');
        });
    });

    describe('renderEntityCard', () => {
        it('renders entity name and type badge', () => {
            const entity = { name: 'King Aldric', type: 'PERSON', description: 'The aging ruler', mentions: 7 };
            const html = renderEntityCard(entity, 'king_aldric');
            expect(html).toContain('King Aldric');
            expect(html).toContain('person'); // lowercase class
            expect(html).toContain('data-key="king_aldric"');
        });

        it('renders mention count', () => {
            const entity = { name: 'Castle', type: 'PLACE', description: 'Ancient fortress', mentions: 3 };
            const html = renderEntityCard(entity, 'castle');
            expect(html).toContain('3 mentions');
        });

        it('renders description', () => {
            const entity = { name: 'Castle', type: 'PLACE', description: 'Ancient fortress', mentions: 1 };
            const html = renderEntityCard(entity, 'castle');
            expect(html).toContain('Ancient fortress');
        });

        it('handles missing description', () => {
            const entity = { name: 'Castle', type: 'PLACE', mentions: 1 };
            const html = renderEntityCard(entity, 'castle');
            expect(html).toContain('Castle');
        });

        it('defaults mentions to 0', () => {
            const entity = { name: 'Castle', type: 'PLACE', description: '' };
            const html = renderEntityCard(entity, 'castle');
            expect(html).toContain('0 mentions');
        });
    });
});

describe('settings panel template', () => {
    it('contains backup profile dropdown', () => {
        expect(settingsPanelHtml).toContain('id="openvault_backup_profile"');
        expect(settingsPanelHtml).toContain('None (no failover)');
    });
});
