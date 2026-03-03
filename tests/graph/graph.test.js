import { describe, it, expect, beforeEach } from 'vitest';
import { upsertEntity } from '../../src/graph/graph.js';

describe('upsertEntity', () => {
    let graphData;

    beforeEach(() => {
        graphData = { nodes: {}, edges: {} };
    });

    it('adds a new entity node', () => {
        upsertEntity(graphData, 'King Aldric', 'PERSON', 'The aging ruler');
        const key = 'king aldric';
        expect(graphData.nodes[key]).toBeDefined();
        expect(graphData.nodes[key].name).toBe('King Aldric');
        expect(graphData.nodes[key].type).toBe('PERSON');
        expect(graphData.nodes[key].description).toBe('The aging ruler');
        expect(graphData.nodes[key].mentions).toBe(1);
    });

    it('normalizes key to lowercase trimmed', () => {
        upsertEntity(graphData, '  Castle  ', 'PLACE', 'A fortress');
        expect(graphData.nodes['castle']).toBeDefined();
        expect(graphData.nodes['castle'].name).toBe('Castle');
    });

    it('merges descriptions on duplicate by appending with pipe', () => {
        upsertEntity(graphData, 'Castle', 'PLACE', 'An ancient fortress');
        upsertEntity(graphData, 'castle', 'PLACE', 'Seat of power');
        expect(graphData.nodes['castle'].description).toBe('An ancient fortress | Seat of power');
        expect(graphData.nodes['castle'].mentions).toBe(2);
    });

    it('preserves original name casing from first insertion', () => {
        upsertEntity(graphData, 'King Aldric', 'PERSON', 'First');
        upsertEntity(graphData, 'king aldric', 'PERSON', 'Second');
        expect(graphData.nodes['king aldric'].name).toBe('King Aldric');
    });
});
