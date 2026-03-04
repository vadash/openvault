import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyGraph, initGraphState, upsertEntity, upsertRelationship } from '../../src/graph/graph.js';

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
        expect(graphData.nodes.castle).toBeDefined();
        expect(graphData.nodes.castle.name).toBe('Castle');
    });

    it('merges descriptions on duplicate by appending with pipe', () => {
        upsertEntity(graphData, 'Castle', 'PLACE', 'An ancient fortress');
        upsertEntity(graphData, 'castle', 'PLACE', 'Seat of power');
        expect(graphData.nodes.castle.description).toBe('An ancient fortress | Seat of power');
        expect(graphData.nodes.castle.mentions).toBe(2);
    });

    it('preserves original name casing from first insertion', () => {
        upsertEntity(graphData, 'King Aldric', 'PERSON', 'First');
        upsertEntity(graphData, 'king aldric', 'PERSON', 'Second');
        expect(graphData.nodes['king aldric'].name).toBe('King Aldric');
    });

    it('caps description segments at configured limit', () => {
        const cap = 3;
        upsertEntity(graphData, 'Castle', 'PLACE', 'First desc', cap);
        upsertEntity(graphData, 'Castle', 'PLACE', 'Second desc', cap);
        upsertEntity(graphData, 'Castle', 'PLACE', 'Third desc', cap);
        upsertEntity(graphData, 'Castle', 'PLACE', 'Fourth desc', cap);
        upsertEntity(graphData, 'Castle', 'PLACE', 'Fifth desc', cap);

        expect(graphData.nodes.castle.description).toBe('Third desc | Fourth desc | Fifth desc');
        expect(graphData.nodes.castle.mentions).toBe(5);
    });

    it('uses default cap of 3 when not specified', () => {
        upsertEntity(graphData, 'Castle', 'PLACE', 'First');
        upsertEntity(graphData, 'Castle', 'PLACE', 'Second');
        upsertEntity(graphData, 'Castle', 'PLACE', 'Third');
        upsertEntity(graphData, 'Castle', 'PLACE', 'Fourth');
        upsertEntity(graphData, 'Castle', 'PLACE', 'Fifth');

        expect(graphData.nodes.castle.description).toBe('Third | Fourth | Fifth');
        expect(graphData.nodes.castle.mentions).toBe(5);
    });

    it('does not add duplicate descriptions before capping', () => {
        const cap = 3;
        upsertEntity(graphData, 'Castle', 'PLACE', 'Same desc', cap);
        upsertEntity(graphData, 'Castle', 'PLACE', 'Same desc', cap);
        upsertEntity(graphData, 'Castle', 'PLACE', 'Different', cap);

        // "Same desc" appears only once, "Different" added once, so only 2 segments total
        expect(graphData.nodes.castle.description).toBe('Same desc | Different');
        expect(graphData.nodes.castle.mentions).toBe(3);
    });

    it('strips possessives from entity keys', () => {
        upsertEntity(graphData, "Vova's Apartment", 'PLACE', 'Home base');
        upsertEntity(graphData, "Vova's apartment", 'PLACE', 'Updated description');

        // Both should map to the same key (possessive stripped, lowercased)
        expect(graphData.nodes['vova apartment']).toBeDefined();
        expect(graphData.nodes['vova apartment'].name).toBe("Vova's Apartment");
        expect(graphData.nodes['vova apartment'].mentions).toBe(2);
    });

    it('collapses whitespace in entity keys', () => {
        upsertEntity(graphData, 'The   Great   Hall', 'PLACE', 'Throne room');
        expect(graphData.nodes['the great hall']).toBeDefined();
        expect(graphData.nodes['the great hall'].name).toBe('The   Great   Hall');
    });

    it('handles curly apostrophe in possessives', () => {
        // Unicode right single quotation mark (U+2019)
        const nameWithCurlyApostrophe = 'Vova\u2019s Place';
        upsertEntity(graphData, nameWithCurlyApostrophe, 'PLACE', 'Home');
        expect(graphData.nodes['vova place']).toBeDefined();
    });
});

describe('upsertRelationship', () => {
    let graphData;

    beforeEach(() => {
        graphData = { nodes: {}, edges: {} };
        upsertEntity(graphData, 'King Aldric', 'PERSON', 'The ruler');
        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
    });

    it('adds a new edge between existing nodes', () => {
        upsertRelationship(graphData, 'King Aldric', 'Castle', 'Rules from the castle');
        const edgeKey = 'king aldric__castle';
        expect(graphData.edges[edgeKey]).toBeDefined();
        expect(graphData.edges[edgeKey].source).toBe('king aldric');
        expect(graphData.edges[edgeKey].target).toBe('castle');
        expect(graphData.edges[edgeKey].description).toBe('Rules from the castle');
        expect(graphData.edges[edgeKey].weight).toBe(1);
    });

    it('increments weight on duplicate edge', () => {
        upsertRelationship(graphData, 'King Aldric', 'Castle', 'Rules from the castle');
        upsertRelationship(graphData, 'king aldric', 'castle', 'Rules from the castle');
        expect(graphData.edges['king aldric__castle'].weight).toBe(2);
    });

    it('appends description on duplicate edge when description differs', () => {
        upsertRelationship(graphData, 'King Aldric', 'Castle', 'Rules from the castle');
        upsertRelationship(graphData, 'King Aldric', 'Castle', 'Imprisoned in the castle');
        const edge = graphData.edges['king aldric__castle'];
        expect(edge.weight).toBe(2);
        expect(edge.description).toContain('Rules from the castle');
        expect(edge.description).toContain('Imprisoned in the castle');
    });

    it('silently skips if source node does not exist', () => {
        upsertRelationship(graphData, 'Ghost', 'Castle', 'Haunts');
        expect(Object.keys(graphData.edges)).toHaveLength(0);
    });

    it('silently skips if target node does not exist', () => {
        upsertRelationship(graphData, 'King Aldric', 'Ghost', 'Fears');
        expect(Object.keys(graphData.edges)).toHaveLength(0);
    });

    it('normalizes source and target to lowercase trimmed', () => {
        upsertRelationship(graphData, '  King Aldric  ', '  Castle  ', 'Rules');
        expect(graphData.edges['king aldric__castle']).toBeDefined();
    });

    it('strips possessives from relationship source and target keys', () => {
        upsertEntity(graphData, "King's Guard", 'ORGANIZATION', 'Royal protectors');
        upsertRelationship(graphData, "King's Guard", 'Castle', 'Protects the castle');

        // Edge key should have possessives stripped
        expect(graphData.edges['king guard__castle']).toBeDefined();
    });

    it('caps edge description segments at configured limit', () => {
        const cap = 3;
        upsertRelationship(graphData, 'King Aldric', 'Castle', 'First desc', cap);
        upsertRelationship(graphData, 'King Aldric', 'Castle', 'Second desc', cap);
        upsertRelationship(graphData, 'King Aldric', 'Castle', 'Third desc', cap);
        upsertRelationship(graphData, 'King Aldric', 'Castle', 'Fourth desc', cap);
        upsertRelationship(graphData, 'King Aldric', 'Castle', 'Fifth desc', cap);

        const edge = graphData.edges['king aldric__castle'];
        expect(edge.description).toBe('Third desc | Fourth desc | Fifth desc');
        expect(edge.weight).toBe(5);
    });

    it('uses default cap of 5 for edge descriptions when not specified', () => {
        for (let i = 1; i <= 7; i++) {
            upsertRelationship(graphData, 'King Aldric', 'Castle', `Desc ${i}`);
        }
        const edge = graphData.edges['king aldric__castle'];
        const segments = edge.description.split(' | ');
        expect(segments).toHaveLength(5);
        expect(segments[0]).toBe('Desc 3');
        expect(segments[4]).toBe('Desc 7');
    });
});

describe('createEmptyGraph', () => {
    it('returns an object with empty nodes and edges', () => {
        const g = createEmptyGraph();
        expect(g).toEqual({ nodes: {}, edges: {} });
    });
});

describe('initGraphState', () => {
    it('initializes graph, communities, reflection_state, and graph_message_count on openvault data', () => {
        const data = { memories: [], character_states: {} };
        initGraphState(data);
        expect(data.graph).toEqual({ nodes: {}, edges: {} });
        expect(data.communities).toEqual({});
        expect(data.reflection_state).toEqual({});
        expect(data.graph_message_count).toBe(0);
    });

    it('does not overwrite existing graph data', () => {
        const data = {
            memories: [],
            graph: { nodes: { castle: { name: 'Castle' } }, edges: {} },
            communities: { C0: { title: 'Test' } },
            reflection_state: { 'King Aldric': { importance_sum: 15 } },
            graph_message_count: 42,
        };
        initGraphState(data);
        expect(data.graph.nodes.castle.name).toBe('Castle');
        expect(data.communities.C0.title).toBe('Test');
        expect(data.reflection_state['King Aldric'].importance_sum).toBe(15);
        expect(data.graph_message_count).toBe(42);
    });
});
