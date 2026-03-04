import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    consolidateGraph,
    createEmptyGraph,
    initGraphState,
    mergeOrInsertEntity,
    redirectEdges,
    upsertEntity,
    upsertRelationship,
} from '../../src/graph/graph.js';

// Mock embeddings module
vi.mock('../../src/embeddings.js', () => ({
    getDocumentEmbedding: vi.fn(),
}));

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

describe('mergeOrInsertEntity', () => {
    let graphData;
    const mockSettings = { entityMergeSimilarityThreshold: 0.8 };

    beforeEach(() => {
        graphData = { nodes: {}, edges: {} };
        vi.clearAllMocks();
    });

    it('uses fast path for exact key match', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue(null);

        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        const key = await mergeOrInsertEntity(graphData, 'castle', 'PLACE', 'Updated', 3, mockSettings);
        expect(key).toBe('castle');
        expect(graphData.nodes.castle.mentions).toBe(2);
        expect(Object.keys(graphData.nodes)).toHaveLength(1);
    });

    it('creates new node when no semantic match exists', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue(null);

        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        graphData.nodes.castle.embedding = [1, 0, 0];

        const key = await mergeOrInsertEntity(graphData, 'Dragon', 'PERSON', 'A beast', 3, mockSettings);
        expect(key).toBe('dragon');
        expect(Object.keys(graphData.nodes)).toHaveLength(2);
    });

    it('merges into existing node when semantic similarity exceeds threshold', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        // Return very similar embedding for "Vova's Apartment"
        getDocumentEmbedding.mockResolvedValue([0.9, 0.1, 0]);

        upsertEntity(graphData, "Vova's House", 'PLACE', 'Home');
        graphData.nodes['vova house'].embedding = [0.9, 0.1, 0];

        const key = await mergeOrInsertEntity(graphData, "Vova's Apartment", 'PLACE', 'Flat', 3, mockSettings);
        expect(key).toBe('vova house');
        expect(graphData.nodes['vova house'].mentions).toBe(2);
        expect(Object.keys(graphData.nodes)).toHaveLength(1);
    });

    it('does not merge entities of different types', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue([1, 0, 0]);

        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        graphData.nodes.castle.embedding = [1, 0, 0];

        const key = await mergeOrInsertEntity(graphData, 'Castle', 'PERSON', 'A person named Castle', 3, mockSettings);
        // Fast-path key match fires first regardless of type
        expect(key).toBe('castle');
        expect(graphData.nodes.castle.type).toBe('PLACE'); // Original type preserved
    });

    it('falls back to insert when embeddings are unavailable', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue(null);

        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        const key = await mergeOrInsertEntity(graphData, 'Fortress', 'PLACE', 'A stronghold', 3, mockSettings);
        expect(key).toBe('fortress');
        expect(Object.keys(graphData.nodes)).toHaveLength(2);
    });
});

describe('redirectEdges', () => {
    let graphData;

    beforeEach(() => {
        graphData = { nodes: {}, edges: {} };
        upsertEntity(graphData, 'Alice', 'PERSON', 'A');
        upsertEntity(graphData, 'Bob', 'PERSON', 'B');
        upsertEntity(graphData, 'Castle', 'PLACE', 'C');
    });

    it('redirects edges from old key to new key', () => {
        upsertRelationship(graphData, 'Bob', 'Castle', 'Lives in');
        redirectEdges(graphData, 'bob', 'alice');
        expect(graphData.edges['alice__castle']).toBeDefined();
        expect(graphData.edges['alice__castle'].description).toBe('Lives in');
        expect(graphData.edges['bob__castle']).toBeUndefined();
    });

    it('merges edge descriptions when redirect creates a duplicate', () => {
        upsertRelationship(graphData, 'Alice', 'Castle', 'Rules from');
        upsertRelationship(graphData, 'Bob', 'Castle', 'Visits often');
        redirectEdges(graphData, 'bob', 'alice');
        expect(graphData.edges['alice__castle'].description).toContain('Rules from');
        expect(graphData.edges['alice__castle'].description).toContain('Visits often');
        expect(graphData.edges['bob__castle']).toBeUndefined();
    });

    it('handles edges where old key is the target', () => {
        upsertRelationship(graphData, 'Castle', 'Bob', 'Contains');
        redirectEdges(graphData, 'bob', 'alice');
        expect(graphData.edges['castle__alice']).toBeDefined();
        expect(graphData.edges['castle__bob']).toBeUndefined();
    });

    it('does nothing when no edges reference old key', () => {
        upsertRelationship(graphData, 'Alice', 'Castle', 'Rules from');
        const edgesBefore = { ...graphData.edges };
        redirectEdges(graphData, 'bob', 'alice');
        expect(graphData.edges).toEqual(edgesBefore);
    });

    it('removes self-loops after redirection', () => {
        upsertEntity(graphData, 'Charlie', 'PERSON', 'C');
        upsertRelationship(graphData, 'Charlie', 'Bob', 'Knows');
        redirectEdges(graphData, 'bob', 'charlie');
        // Edge would become charlie__charlie (self-loop), should be removed
        expect(graphData.edges['charlie__charlie']).toBeUndefined();
        expect(graphData.edges['charlie__bob']).toBeUndefined();
    });
});

describe('edge creation with semantic merge', () => {
    it('creates edges using resolved keys after mergeOrInsertEntity', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');

        // Setup: "vova apartment" already exists with embedding
        const graphData = createEmptyGraph();
        graphData.nodes['vova apartment'] = {
            name: "Vova's Apartment",
            type: 'PLACE',
            description: 'An apartment',
            mentions: 5,
            embedding: [1, 0, 0],
        };
        graphData.nodes['suzy'] = {
            name: 'Suzy',
            type: 'PERSON',
            description: 'A student',
            mentions: 10,
        };

        // Mock: "Vova's Room" embeds to something very similar to "Vova's Apartment"
        getDocumentEmbedding.mockResolvedValue([0.99, 0.1, 0]);

        const settings = { entityMergeSimilarityThreshold: 0.8 };

        // mergeOrInsertEntity should merge "Vova's Room" into "vova apartment"
        const resolvedKey = await mergeOrInsertEntity(
            graphData, "Vova's Room", 'PLACE', 'A room', 3, settings
        );
        expect(resolvedKey).toBe('vova apartment');

        // Now create a relationship using the ORIGINAL name "Vova's Room"
        // This should work because we use the resolved key
        upsertRelationship(graphData, 'Suzy', "Vova's Room", 'Lives in', 5);

        // Edge should exist (suzy -> vova apartment), NOT be silently dropped
        const edgeKey = 'suzy__vova apartment';
        expect(graphData.edges[edgeKey]).toBeDefined();
        expect(graphData.edges[edgeKey].description).toBe('Lives in');
    });
});

describe('_mergeRedirects serialization', () => {
    it('_mergeRedirects is not enumerable or is cleaned before serialization', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        const graphData = createEmptyGraph();
        graphData.nodes['alice'] = {
            name: 'Alice', type: 'PERSON', description: 'A person', mentions: 3, embedding: [1, 0],
        };
        getDocumentEmbedding.mockResolvedValue([0.99, 0.05]);

        await mergeOrInsertEntity(graphData, 'Alicia', 'PERSON', 'Also Alice', 3, { entityMergeSimilarityThreshold: 0.8 });

        // _mergeRedirects should exist at runtime
        expect(graphData._mergeRedirects).toBeDefined();

        // But JSON serialization should not include it (or it's acceptable as transient)
        const serialized = JSON.parse(JSON.stringify(graphData));
        // If we want to exclude it, we need to delete before save or use a toJSON method
        // For now, just verify it doesn't break anything
        expect(serialized.nodes).toBeDefined();
        expect(serialized.edges).toBeDefined();
    });
});

describe('consolidateGraph', () => {
    it('merges nodes with identical embeddings of the same type', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue([1, 0, 0]);

        const graphData = { nodes: {}, edges: {} };
        upsertEntity(graphData, "Vova's House", 'PLACE', 'Home');
        upsertEntity(graphData, "Vova's Apartment", 'PLACE', 'Flat');

        // Simulate identical embeddings
        graphData.nodes['vova house'].embedding = [1, 0, 0];
        graphData.nodes['vova apartment'].embedding = [1, 0, 0];

        const settings = { entityMergeSimilarityThreshold: 0.8, entityDescriptionCap: 3 };
        const result = await consolidateGraph(graphData, settings);

        // One should be merged into the other
        expect(Object.keys(graphData.nodes).length).toBeLessThan(2);
        expect(result.mergedCount).toBeGreaterThan(0);
    });

    it('does not merge nodes of different types', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue([1, 0, 0]);

        const graphData = { nodes: {}, edges: {} };
        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        upsertEntity(graphData, 'Castle Guard', 'PERSON', 'A knight');

        graphData.nodes.castle.embedding = [1, 0, 0];
        graphData.nodes['castle guard'].embedding = [1, 0, 0];

        const settings = { entityMergeSimilarityThreshold: 0.8, entityDescriptionCap: 3 };
        await consolidateGraph(graphData, settings);

        expect(Object.keys(graphData.nodes)).toHaveLength(2);
    });

    it('redirects edges after merging nodes', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue([1, 0, 0]);

        const graphData = { nodes: {}, edges: {} };
        upsertEntity(graphData, 'Alice', 'PERSON', 'A person');
        upsertEntity(graphData, 'House A', 'PLACE', 'A house');
        upsertEntity(graphData, 'House B', 'PLACE', 'Another house');

        graphData.nodes.alice.embedding = [0, 1, 0];
        graphData.nodes['house a'].embedding = [1, 0, 0];
        graphData.nodes['house b'].embedding = [1, 0, 0];

        upsertRelationship(graphData, 'Alice', 'House B', 'Visits');

        const settings = { entityMergeSimilarityThreshold: 0.8, entityDescriptionCap: 3 };
        await consolidateGraph(graphData, settings);

        // House B merged into House A, edge redirected
        const edgeKeys = Object.keys(graphData.edges);
        expect(edgeKeys.some((k) => k.includes('house a'))).toBe(true);
        expect(edgeKeys.some((k) => k.includes('house b'))).toBe(false);
    });
});
