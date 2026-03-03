import { describe, expect, it } from 'vitest';
import { renderMemoryItem, renderReflectionProgress, renderCommunityAccordion } from '../src/ui/templates.js';

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
                'Zelda': { importance_sum: 10 },
                'Alice': { importance_sum: 5 },
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
            const state = { 'Alice': {} };
            const html = renderReflectionProgress(state, 30);
            expect(html).toContain('Alice: 0/30');
        });
    });

    describe('renderCommunityAccordion', () => {
        it('renders community title and member count', () => {
            const community = {
                title: 'The Royal Court',
                summary: 'King Aldric rules from the Castle.',
                findings: ['The King is powerful', 'The Guard is loyal'],
                nodeKeys: ['king aldric', 'castle', 'royal guard'],
            };
            const html = renderCommunityAccordion('C0', community);
            expect(html).toContain('The Royal Court');
            expect(html).toContain('3 entities');
        });

        it('renders summary and findings', () => {
            const community = {
                title: 'Court',
                summary: 'A powerful court.',
                findings: ['Finding one', 'Finding two'],
                nodeKeys: ['a'],
            };
            const html = renderCommunityAccordion('C0', community);
            expect(html).toContain('A powerful court.');
            expect(html).toContain('Finding one');
            expect(html).toContain('Finding two');
            expect(html).toContain('<li>');
        });

        it('renders member list', () => {
            const community = {
                title: 'Test',
                summary: 'Test',
                findings: [],
                nodeKeys: ['alice', 'bob'],
            };
            const html = renderCommunityAccordion('C0', community);
            expect(html).toContain('alice');
            expect(html).toContain('bob');
        });

        it('uses community ID as fallback title', () => {
            const community = { summary: 'No title', findings: [], nodeKeys: [] };
            const html = renderCommunityAccordion('C5', community);
            expect(html).toContain('C5');
        });

        it('handles empty findings', () => {
            const community = { title: 'Test', summary: 'Test', findings: [], nodeKeys: [] };
            const html = renderCommunityAccordion('C0', community);
            expect(html).not.toContain('<ul');
        });

        it('shows 0 entities for empty nodeKeys', () => {
            const community = { title: 'Test', summary: 'Test', findings: [], nodeKeys: [] };
            const html = renderCommunityAccordion('C0', community);
            expect(html).toContain('0 entities');
        });
    });
});
