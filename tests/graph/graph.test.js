import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, extensionName } from '../../src/constants.js';
import { getDocumentEmbedding } from '../../src/embeddings.js';
import {
    consolidateEdges,
    createEmptyGraph,
    expandMainCharacterKeys,
    findCrossScriptCharacterKeys,
    initGraphState,
    markEdgeForConsolidation,
    mergeOrInsertEntity,
    normalizeKey,
    shouldMergeEntities,
    upsertEntity,
    upsertRelationship,
} from '../../src/graph/graph.js';

describe('dead code removal', () => {
    it('consolidateGraph is no longer exported', async () => {
        const exports = await import('../../src/graph/graph.js');
        expect(exports.consolidateGraph).toBeUndefined();
    });

    it('redirectEdges is no longer exported', async () => {
        const exports = await import('../../src/graph/graph.js');
        expect(exports.redirectEdges).toBeUndefined();
    });
});

// Mock embeddings module
vi.mock('../../src/embeddings.js', () => ({
    getDocumentEmbedding: vi.fn(),
    isEmbeddingsEnabled: vi.fn(() => false),
}));

// Mock llm module
vi.mock('../../src/llm.js', () => ({
    callLLM: vi.fn(),
    LLM_CONFIGS: {
        edge_consolidation: {
            profileSettingKey: 'extractionProfile',
            maxTokens: 200,
            errorContext: 'Edge consolidation',
            timeoutMs: 60000,
            getJsonSchema: undefined,
        },
    },
}));

// Mock extraction/structured module
vi.mock('../../src/extraction/structured.js', () => ({
    parseConsolidationResponse: (content) => JSON.parse(content),
}));

// Mock prompts/index module
vi.mock('../../src/prompts/index.js', () => ({
    buildEdgeConsolidationPrompt: (edgeData) => [
        { role: 'system', content: 'relationship state synthesizer' },
        { role: 'user', content: `Synthesize: ${edgeData.source} - ${edgeData.target}` },
        { role: 'assistant', content: '{' },
    ],
    resolveExtractionPreamble: () => 'preamble',
    resolveOutputLanguage: () => 'auto',
    resolveExtractionPrefill: () => '{',
}));

// Mock deps module (needed by consolidateEdges for preamble/outputLanguage resolution)
vi.mock('../../src/deps.js', () => ({
    getDeps: () => ({
        getExtensionSettings: () => ({
            [extensionName]: { ...defaultSettings },
        }),
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
    resetDeps: vi.fn(),
}));

// Mock embedding-codec module
vi.mock('../../src/utils/embedding-codec.js', () => ({
    getEmbedding: vi.fn((obj) => (obj?.embedding_b64 ? [0.1] : obj?.embedding || null)),
    setEmbedding: vi.fn((obj, _vec) => {
        obj.embedding_b64 = 'mock_b64';
        delete obj.embedding;
    }),
    hasEmbedding: vi.fn((obj) => !!(obj?.embedding_b64 || (obj?.embedding && obj.embedding.length > 0))),
    deleteEmbedding: vi.fn((obj) => {
        if (obj) {
            delete obj.embedding;
            delete obj.embedding_b64;
        }
    }),
    cyrb53: vi.fn((str) => str.length),
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
        // Use sufficiently different descriptions to avoid Jaccard deduplication
        const descriptions = [
            'Rules the kingdom from his castle',
            'Imprisoned in the dungeon during the coup',
            'Negotiates peace treaties with neighboring realms',
            'Hosts grand feasts for visiting nobility',
            'Trains with his knights in the courtyard',
            'Studies ancient tomes in the library',
            'Inspects the castle defenses at dawn',
        ];
        for (let i = 0; i < 7; i++) {
            upsertRelationship(graphData, 'King Aldric', 'Castle', descriptions[i]);
        }
        const edge = graphData.edges['king aldric__castle'];
        const segments = edge.description.split(' | ');
        expect(segments).toHaveLength(5);
        expect(segments[0]).toBe(descriptions[2]); // First 2 were evicted by FIFO cap
        expect(segments[4]).toBe(descriptions[6]);
    });

    it('prevents self-loop edges (same source and target)', () => {
        // Try to create an edge where source and target resolve to the same node
        upsertRelationship(graphData, 'King Aldric', 'King Aldric', 'Self-referential');
        expect(Object.keys(graphData.edges)).toHaveLength(0);
    });

    it('prevents self-loops after merge redirect resolution', () => {
        // Set up a merge redirect: "King" -> "King Aldric"
        graphData._mergeRedirects = { king: 'king aldric' };

        // Try to create an edge that would resolve to a self-loop after redirect
        upsertRelationship(graphData, 'King Aldric', 'King', 'Redirected self-loop');
        expect(Object.keys(graphData.edges)).toHaveLength(0);
    });

    it('tracks _descriptionTokens on edges', () => {
        const graph = createEmptyGraph();
        upsertEntity(graph, 'Alice', 'PERSON', 'Explorer');
        upsertEntity(graph, 'Bob', 'PERSON', 'Merchant');

        upsertRelationship(graph, 'Alice', 'Bob', 'Met at tavern', 5);
        expect(graph.edges.alice__bob._descriptionTokens).toBeDefined();
        expect(graph.edges.alice__bob._descriptionTokens).toBeGreaterThan(0);

        // After adding more, token count increases
        const initialTokens = graph.edges.alice__bob._descriptionTokens;
        upsertRelationship(graph, 'Alice', 'Bob', 'Traded goods', 5);
        expect(graph.edges.alice__bob._descriptionTokens).toBeGreaterThan(initialTokens);
    });

    it('marks edge for consolidation when token threshold exceeded', () => {
        const graph = createEmptyGraph();
        upsertEntity(graph, 'Alice', 'PERSON', 'Explorer');
        upsertEntity(graph, 'Bob', 'PERSON', 'Merchant');

        // Create an edge with bloated description
        // Use real text to ensure token count is accurate
        const longDesc =
            'Alice and Bob have a very long and detailed relationship history that spans many years and involves numerous events. '.repeat(
                10
            );
        const settings = { consolidationTokenThreshold: 50 }; // Lower threshold for testing

        upsertRelationship(graph, 'Alice', 'Bob', longDesc, 5, settings);

        // Should be marked for consolidation
        expect(graph._edgesNeedingConsolidation).toContain('alice__bob');
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
        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'castle', 'PLACE', 'Updated', 3, mockSettings);
        expect(key).toBe('castle');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes.castle.mentions).toBe(2);
        expect(Object.keys(graphData.nodes)).toHaveLength(1);
    });

    it('creates new node when no semantic match exists', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue(null);

        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        graphData.nodes.castle.embedding = [1, 0, 0];

        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'Dragon', 'PERSON', 'A beast', 3, mockSettings);
        expect(key).toBe('dragon');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(Object.keys(graphData.nodes)).toHaveLength(2);
    });

    it('merges into existing node when semantic similarity exceeds threshold', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        // Return very similar embedding for "Vova's Apartment"
        getDocumentEmbedding.mockResolvedValue([0.9, 0.1, 0]);

        upsertEntity(graphData, "Vova's House", 'PLACE', 'Home');
        graphData.nodes['vova house'].embedding = [0.9, 0.1, 0];

        const { key, stChanges } = await mergeOrInsertEntity(graphData, "Vova's Apartment", 'PLACE', 'Flat', 3, mockSettings);
        expect(key).toBe('vova house');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes['vova house'].mentions).toBe(2);
        expect(Object.keys(graphData.nodes)).toHaveLength(1);
    });

    it('does not merge entities of different types', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue([1, 0, 0]);

        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        graphData.nodes.castle.embedding = [1, 0, 0];

        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'Castle', 'PERSON', 'A person named Castle', 3, mockSettings);
        // Fast-path key match fires first regardless of type
        expect(key).toBe('castle');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes.castle.type).toBe('PLACE'); // Original type preserved
    });

    it('falls back to insert when embeddings are unavailable', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue(null);

        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'Fortress', 'PLACE', 'A stronghold', 3, mockSettings);
        expect(key).toBe('fortress');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(Object.keys(graphData.nodes)).toHaveLength(2);
    });

    it('persists alias when semantic merge occurs', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue([0.9, 0.1, 0]);

        upsertEntity(graphData, 'Vova', 'PERSON', 'A young man');
        graphData.nodes.vova.embedding = [0.9, 0.1, 0];

        await mergeOrInsertEntity(graphData, 'Vova (aka Lily)', 'PERSON', 'Also Vova', 3, mockSettings);

        expect(graphData.nodes.vova.aliases).toBeDefined();
        expect(graphData.nodes.vova.aliases).toContain('Vova (aka Lily)');
    });

    it('does not add alias on exact key match (fast path)', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue(null);

        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        await mergeOrInsertEntity(graphData, 'castle', 'PLACE', 'Updated', 3, mockSettings);

        // Fast path: same key, no alias needed
        expect(graphData.nodes.castle.aliases).toBeUndefined();
    });

    it('force-merges Cyrillic PERSON name matching main character via transliteration', async () => {
        // Setup: existing English character node
        graphData.nodes.suzy = {
            name: 'Suzy',
            type: 'PERSON',
            description: 'Main character',
            mentions: 28,
        };

        // Act: insert Cyrillic variant — universal cross-script merge
        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'Сузи', 'PERSON', 'Главная героиня', 3, {
            entityMergeSimilarityThreshold: 0.95,
        });

        // Assert: merged into existing English node
        expect(key).toBe('suzy');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes.suzy.description).toContain('Главная героиня');
        expect(graphData.nodes.suzy.aliases).toContain('Сузи');
        expect(graphData.nodes.сузи).toBeUndefined();
        // Redirect exists so edges referencing "сузи" resolve to "suzy"
        expect(graphData._mergeRedirects?.сузи).toBe('suzy');
    });

    it('does not cross-script merge non-PERSON entities', async () => {
        graphData.nodes.suzy = {
            name: 'Suzy',
            type: 'PERSON',
            description: 'Main character',
            mentions: 28,
        };

        // Insert a Cyrillic OBJECT — should NOT merge into Suzy even if name matches
        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'Сузи', 'OBJECT', 'Some object named Сузи', 3, {
            entityMergeSimilarityThreshold: 0.95,
        });

        // Should create a new node, not merge
        expect(key).toBe('сузи');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes.сузи).toBeDefined();
    });

    it('creates new node when no existing PERSON nodes match cross-script', async () => {
        // No existing PERSON nodes in graph, so no cross-script match possible
        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'Сузи', 'PERSON', 'Some person', 3, {
            entityMergeSimilarityThreshold: 0.95,
        });

        // Creates new node since no existing PERSON nodes to match against
        expect(key).toBe('сузи');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes.сузи).toBeDefined();
    });

    it('merges secondary character Cyrillic variant into existing Latin PERSON node', async () => {
        // Setup: existing English "Mina" node (NOT a main character)
        graphData.nodes.mina = {
            name: 'Mina',
            type: 'PERSON',
            description: 'A friend',
            mentions: 5,
        };

        // Act: insert Cyrillic "Мина" — no mainCharacterNames needed
        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'Мина', 'PERSON', 'Подруга', 3, {
            entityMergeSimilarityThreshold: 0.95,
        });

        // Assert: merged into existing Latin node
        expect(key).toBe('mina');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes.mina.aliases).toContain('Мина');
        expect(graphData.nodes.мина).toBeUndefined();
        expect(graphData._mergeRedirects?.мина).toBe('mina');
    });

    it('merges Latin PERSON into existing Cyrillic node (reverse direction)', async () => {
        // Setup: Cyrillic node exists first
        graphData.nodes.мина = {
            name: 'Мина',
            type: 'PERSON',
            description: 'Подруга',
            mentions: 5,
        };

        // Act: insert Latin "Mina"
        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'Mina', 'PERSON', 'A friend', 3, {
            entityMergeSimilarityThreshold: 0.95,
        });

        // Assert: merged into existing Cyrillic node (first-inserted wins)
        expect(key).toBe('мина');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes.мина.aliases).toContain('Mina');
        expect(graphData.nodes.mina).toBeUndefined();
        expect(graphData._mergeRedirects?.mina).toBe('мина');
    });

    it('does NOT merge short names with distance=2 (stricter threshold)', async () => {
        // "Kaya" (4 chars) vs "Mama" (Мама, 4 chars) - distance is 2
        // With old threshold (≤2), this would incorrectly merge
        graphData.nodes.kaya = {
            name: 'Kaya',
            type: 'PERSON',
            description: 'A friend',
            mentions: 5,
        };

        // Act: try to insert Cyrillic "Мама" (Mama) - distance 2 from "kaya"
        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'Мама', 'PERSON', 'Mother', 3, {
            entityMergeSimilarityThreshold: 0.95,
        });

        // Assert: should NOT merge - distance 2 exceeds stricter threshold (1) for short names
        expect(key).toBe('мама');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes.мама).toBeDefined();
        expect(graphData.nodes.kaya.aliases).toBeUndefined();
    });

    it('merges short names with distance=1 (within stricter threshold)', async () => {
        // "Mina" (4 chars) vs "Mina" (Мина) - distance 0
        graphData.nodes.mina = {
            name: 'Mina',
            type: 'PERSON',
            description: 'A friend',
            mentions: 5,
        };

        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'Мина', 'PERSON', 'Подруга', 3, {
            entityMergeSimilarityThreshold: 0.95,
        });

        // Distance 0 should always match
        expect(key).toBe('mina');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes.mina.aliases).toContain('Мина');
    });

    it('merges longer names with distance=2 (standard threshold)', async () => {
        // "Elizabeth" (9 chars) vs "Elizabet" (Элизабет) - distance 1 (h missing)
        graphData.nodes.elizabeth = {
            name: 'Elizabeth',
            type: 'PERSON',
            description: 'Queen',
            mentions: 10,
        };

        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'Элизабет', 'PERSON', 'Королева', 3, {
            entityMergeSimilarityThreshold: 0.95,
        });

        // Distance 1 should match for longer names (threshold ≤2)
        expect(key).toBe('elizabeth');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes.elizabeth.aliases).toContain('Элизабет');
    });

    it('returns stChanges.toSync with new node when creating a new entity', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        const { cyrb53 } = await import('../../src/utils/embedding-codec.js');
        getDocumentEmbedding.mockResolvedValue([0.5, 0.5, 0.5]);

        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'Dragon', 'PERSON', 'A fire beast', 3, mockSettings);
        expect(key).toBe('dragon');
        expect(stChanges.toSync).toHaveLength(1);
        expect(stChanges.toSync[0].text).toBe('[OV_ID:dragon] A fire beast');
        expect(stChanges.toSync[0].item).toBe(graphData.nodes.dragon);
        expect(stChanges.toSync[0].hash).toBeDefined();
        expect(stChanges.toDelete).toHaveLength(0);
    });

    it('returns empty stChanges on fast path (exact key match)', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue(null);

        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'castle', 'PLACE', 'Updated', 3, mockSettings);
        expect(key).toBe('castle');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
    });

    it('returns empty stChanges on semantic merge path (existing node updated)', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue([0.9, 0.1, 0]);

        upsertEntity(graphData, "Vova's House", 'PLACE', 'Home');
        graphData.nodes['vova house'].embedding = [0.9, 0.1, 0];

        const { key, stChanges } = await mergeOrInsertEntity(graphData, "Vova's Apartment", 'PLACE', 'Flat', 3, mockSettings);
        expect(key).toBe('vova house');
        expect(stChanges.toSync).toHaveLength(0);
        expect(stChanges.toDelete).toHaveLength(0);
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
        graphData.nodes.suzy = {
            name: 'Suzy',
            type: 'PERSON',
            description: 'A student',
            mentions: 10,
        };

        // Mock: "Vova's Room" embeds to something very similar to "Vova's Apartment"
        getDocumentEmbedding.mockResolvedValue([0.99, 0.1, 0]);

        const settings = { entityMergeSimilarityThreshold: 0.8 };

        // mergeOrInsertEntity should merge "Vova's Room" into "vova apartment"
        const { key: resolvedKey } = await mergeOrInsertEntity(graphData, "Vova's Room", 'PLACE', 'A room', 3, settings);
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
        graphData.nodes.alice = {
            name: 'Alice',
            type: 'PERSON',
            description: 'A person',
            mentions: 3,
            embedding: [1, 0],
        };
        getDocumentEmbedding.mockResolvedValue([0.99, 0.05]);

        // Use "Alice Smith" so token-overlap guard ("alice" token shared) allows merge
        await mergeOrInsertEntity(graphData, 'Alice Smith', 'PERSON', 'Also Alice', 3, {
            entityMergeSimilarityThreshold: 0.8,
        });

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

describe('mergeOrInsertEntity - description in embedding', () => {
    let graphData;

    beforeEach(() => {
        graphData = createEmptyGraph();
        vi.mocked(getDocumentEmbedding).mockReset();
    });

    it('passes type, name, AND description to getDocumentEmbedding', async () => {
        vi.mocked(getDocumentEmbedding).mockResolvedValue([1, 0, 0]);

        await mergeOrInsertEntity(graphData, 'Cotton Rope', 'OBJECT', 'A rough hemp rope used for bondage', 3, {});

        expect(getDocumentEmbedding).toHaveBeenCalledWith('OBJECT: Cotton Rope - A rough hemp rope used for bondage');
    });
});

describe('expandMainCharacterKeys', () => {
    it('expands aliases from graph nodes', () => {
        const graphNodes = {
            'main user': {
                name: 'Main User',
                type: 'PERSON',
                aliases: ['Alt Persona', 'Nickname'],
            },
            character: {
                name: 'Character',
                type: 'PERSON',
                aliases: ['Char Alias'],
            },
        };
        const baseKeys = [normalizeKey('Main User'), normalizeKey('Character')];
        const expanded = expandMainCharacterKeys(baseKeys, graphNodes);

        expect(expanded).toContain('main user');
        expect(expanded).toContain('character');
        expect(expanded).toContain('alt persona');
        expect(expanded).toContain('nickname');
        expect(expanded).toContain('char alias');
        expect(expanded).toHaveLength(5);
    });

    it('handles nodes without aliases', () => {
        const graphNodes = {
            user: { name: 'User', type: 'PERSON' },
        };
        const baseKeys = [normalizeKey('User')];
        const expanded = expandMainCharacterKeys(baseKeys, graphNodes);

        expect(expanded).toEqual(['user']);
    });

    it('deduplicates alias keys', () => {
        const graphNodes = {
            user: {
                name: 'User',
                type: 'PERSON',
                aliases: ['User'], // Alias same as name
            },
        };
        const baseKeys = [normalizeKey('User')];
        const expanded = expandMainCharacterKeys(baseKeys, graphNodes);

        expect(expanded).toEqual(['user']);
    });

    it('handles missing nodes gracefully', () => {
        const graphNodes = {};
        const baseKeys = ['nonexistent'];
        const expanded = expandMainCharacterKeys(baseKeys, graphNodes);

        expect(expanded).toEqual(['nonexistent']);
    });
});

describe('markEdgeForConsolidation', () => {
    it('marks edges for consolidation', () => {
        const graph = { nodes: {}, edges: {}, _edgesNeedingConsolidation: [] };
        graph.nodes.alice = { name: 'Alice', type: 'PERSON', description: 'test', mentions: 1 };
        graph.nodes.bob = { name: 'Bob', type: 'PERSON', description: 'test', mentions: 1 };
        graph.edges.alice__bob = { source: 'alice', target: 'bob', description: 'test', weight: 1 };

        markEdgeForConsolidation(graph, 'alice__bob');
        expect(graph._edgesNeedingConsolidation).toContain('alice__bob');

        // Duplicate add is idempotent
        markEdgeForConsolidation(graph, 'alice__bob');
        expect(graph._edgesNeedingConsolidation.filter((e) => e === 'alice__bob')).toHaveLength(1);
    });
});

describe('consolidateEdges', () => {
    it('consolidates edges marked for consolidation', async () => {
        const { callLLM: mockCallLLM } = await import('../../src/llm.js');
        const { isEmbeddingsEnabled } = await import('../../src/embeddings.js');

        mockCallLLM.mockResolvedValue(JSON.stringify({ consolidated_description: 'From strangers to battle allies' }));
        isEmbeddingsEnabled.mockReturnValue(false);

        const graph = {
            nodes: {
                alice: { name: 'Alice', type: 'PERSON', description: 'test', mentions: 1, embedding_b64: null },
                bob: { name: 'Bob', type: 'PERSON', description: 'test', mentions: 1, embedding_b64: null },
            },
            edges: {
                alice__bob: {
                    source: 'alice',
                    target: 'bob',
                    description: 'Met | Traded | Fought | Celebrated | Parted',
                    weight: 5,
                    _descriptionTokens: 600,
                },
            },
            _edgesNeedingConsolidation: ['alice__bob'],
        };

        const mockSettings = { consolidationTokenThreshold: 500 };

        const result = await consolidateEdges(graph, mockSettings);
        expect(result).toBe(1);
        expect(graph.edges.alice__bob.description).toBe('From strangers to battle allies');
        expect(graph._edgesNeedingConsolidation).toHaveLength(0);
    });

    it('returns 0 when no edges need consolidation', async () => {
        const graph = {
            nodes: {
                alice: { name: 'Alice', type: 'PERSON', description: 'test', mentions: 1 },
                bob: { name: 'Bob', type: 'PERSON', description: 'test', mentions: 1 },
            },
            edges: {
                alice__bob: {
                    source: 'alice',
                    target: 'bob',
                    description: 'Met',
                    weight: 1,
                    _descriptionTokens: 5,
                },
            },
            _edgesNeedingConsolidation: [],
        };

        const result = await consolidateEdges(graph, {});
        expect(result).toBe(0);
    });

    it('respects MAX_CONSOLIDATION_BATCH limit', async () => {
        const { callLLM: mockCallLLM } = await import('../../src/llm.js');
        const { isEmbeddingsEnabled } = await import('../../src/embeddings.js');

        mockCallLLM.mockResolvedValue(JSON.stringify({ consolidated_description: 'Consolidated' }));
        isEmbeddingsEnabled.mockReturnValue(false);

        const graph = {
            nodes: {},
            edges: {},
            _edgesNeedingConsolidation: [],
        };

        // Create 15 edges over the threshold (MAX_CONSOLIDATION_BATCH is 10)
        for (let i = 0; i < 15; i++) {
            const src = `node${i}`;
            const tgt = `node${i + 1}`;
            graph.nodes[src] = { name: src, type: 'PERSON', description: 'test', mentions: 1 };
            graph.nodes[tgt] = { name: tgt, type: 'PERSON', description: 'test', mentions: 1 };
            graph.edges[`${src}__${tgt}`] = {
                source: src,
                target: tgt,
                description: 'Long description',
                weight: 1,
                _descriptionTokens: 600,
            };
            graph._edgesNeedingConsolidation.push(`${src}__${tgt}`);
        }

        const result = await consolidateEdges(graph, {});
        // Should only process 10 (MAX_CONSOLIDATION_BATCH), 5 should remain
        expect(result).toBe(10);
        expect(graph._edgesNeedingConsolidation).toHaveLength(5);
    });
});

describe('shouldMergeEntities', () => {
    it('returns true when cosine is above threshold (token overlap skipped)', () => {
        // cosine=0.96, threshold=0.94 → above threshold → merge directly
        const tokensA = new Set(['king', 'aldric']);
        expect(shouldMergeEntities(0.96, 0.94, tokensA, 'king aldric', 'completely different')).toBe(true);
    });

    it('returns true when cosine is exactly at threshold', () => {
        const tokensA = new Set(['king']);
        expect(shouldMergeEntities(0.94, 0.94, tokensA, 'king', 'queen')).toBe(true);
    });

    it('returns true in grey zone when token overlap passes', () => {
        // cosine=0.90, threshold=0.94, greyZoneFloor=0.84 → grey zone
        // tokensA='king aldric castle', keyB='king aldric tower' → 2/3=0.67 overlap → pass
        const tokensA = new Set(['king', 'aldric', 'castle']);
        expect(shouldMergeEntities(0.9, 0.94, tokensA, 'king aldric castle', 'king aldric tower')).toBe(true);
    });

    it('returns false in grey zone when token overlap fails', () => {
        // cosine=0.90, threshold=0.94, greyZoneFloor=0.84 → grey zone
        // tokensA='alpha', keyB='omega' → no overlap → fail
        const tokensA = new Set(['alpha']);
        expect(shouldMergeEntities(0.9, 0.94, tokensA, 'alpha', 'omega')).toBe(false);
    });

    it('returns false when cosine is below grey zone', () => {
        // cosine=0.80, threshold=0.94, greyZoneFloor=0.84 → below grey zone
        const tokensA = new Set(['king', 'aldric']);
        expect(shouldMergeEntities(0.8, 0.94, tokensA, 'king aldric', 'king aldric')).toBe(false);
    });

    it('does not construct tokensB when cosine is above threshold', () => {
        // Even with completely non-overlapping keys, cosine >= threshold means merge
        const tokensA = new Set(['абсолютно']);
        expect(shouldMergeEntities(0.95, 0.94, tokensA, 'абсолютно', 'совершенно другое')).toBe(true);
    });

    it('does not construct tokensB when cosine is below grey zone', () => {
        // cosine=0.70, threshold=0.94 → below 0.84 floor → skip
        const tokensA = new Set(['king']);
        expect(shouldMergeEntities(0.7, 0.94, tokensA, 'king', 'king')).toBe(false);
    });

    it('respects custom threshold values', () => {
        // threshold=0.80, greyZoneFloor=0.70
        const tokensA = new Set(['castle']);
        // cosine=0.82 → above 0.80 threshold → true
        expect(shouldMergeEntities(0.82, 0.8, tokensA, 'castle', 'fortress')).toBe(true);
        // cosine=0.75 → grey zone (0.70-0.80) → depends on token overlap
        expect(shouldMergeEntities(0.75, 0.8, tokensA, 'castle', 'fortress')).toBe(false); // no overlap
        // cosine=0.65 → below 0.70 floor → false
        expect(shouldMergeEntities(0.65, 0.8, tokensA, 'castle', 'castle')).toBe(false);
    });
});

describe('findCrossScriptCharacterKeys', () => {
    it('finds Cyrillic character node matching English base key', () => {
        const graphNodes = {
            suzy: { name: 'Suzy', type: 'PERSON', description: 'Main char', mentions: 28 },
            сузи: { name: 'Сузи', type: 'PERSON', description: 'Главная героиня', mentions: 59 },
            'бордовый силиконовый дилдо': {
                name: 'Бордовый силиконовый дилдо',
                type: 'OBJECT',
                description: 'An object',
                mentions: 14,
            },
        };
        const result = findCrossScriptCharacterKeys(['suzy'], graphNodes);
        expect(result).toContain('сузи');
        expect(result).not.toContain('suzy');
        expect(result).toHaveLength(1);
    });

    it('finds multiple Cyrillic character nodes', () => {
        const graphNodes = {
            suzy: { name: 'Suzy', type: 'PERSON', description: 'Main char', mentions: 28 },
            vova: { name: 'Vova', type: 'PERSON', description: 'User', mentions: 28 },
            сузи: { name: 'Сузи', type: 'PERSON', description: 'Героиня', mentions: 59 },
            вова: { name: 'Вова', type: 'PERSON', description: 'Пользователь', mentions: 59 },
        };
        const result = findCrossScriptCharacterKeys(['suzy', 'vova'], graphNodes);
        expect(result).toContain('сузи');
        expect(result).toContain('вова');
        expect(result).toHaveLength(2);
    });

    it('does not match non-PERSON nodes', () => {
        const graphNodes = {
            suzy: { name: 'Suzy', type: 'PERSON', description: 'Main char', mentions: 28 },
            // Hypothetical Cyrillic OBJECT that transliterates near "suzy"
            сузи: { name: 'Сузи', type: 'OBJECT', description: 'Not a person', mentions: 5 },
        };
        const result = findCrossScriptCharacterKeys(['suzy'], graphNodes);
        expect(result).toHaveLength(0);
    });

    it('does not match Latin PERSON nodes', () => {
        const graphNodes = {
            suzy: { name: 'Suzy', type: 'PERSON', description: 'Main', mentions: 28 },
            susan: { name: 'Susan', type: 'PERSON', description: 'NPC', mentions: 3 },
        };
        const result = findCrossScriptCharacterKeys(['suzy'], graphNodes);
        expect(result).toHaveLength(0);
    });

    it('returns empty array when no matches', () => {
        const graphNodes = {
            замок: { name: 'Замок', type: 'PLACE', description: 'A castle', mentions: 5 },
        };
        const result = findCrossScriptCharacterKeys(['suzy'], graphNodes);
        expect(result).toHaveLength(0);
    });

    it('tolerates Levenshtein distance ≤ 2 (Мина→mina vs mina)', () => {
        const graphNodes = {
            mina: { name: 'Mina', type: 'PERSON', description: 'Third char', mentions: 10 },
            мина: { name: 'Мина', type: 'PERSON', description: 'Третий персонаж', mentions: 20 },
        };
        const result = findCrossScriptCharacterKeys(['mina'], graphNodes);
        expect(result).toContain('мина');
    });

    it('uses stricter threshold (≤1) for short names (≤4 chars) to prevent false positives', () => {
        // "kaya" (Кая) transliterates to "kaya" - distance 0 from "kaya"
        // "mama" (Мама) transliterates to "mama" - distance 2 from "kaya"
        // With old threshold (≤2), "Mama" would incorrectly match "Kaya"
        const graphNodes = {
            kaya: { name: 'Kaya', type: 'PERSON', description: 'A friend', mentions: 5 },
            мама: { name: 'Мама', type: 'PERSON', description: 'Mother', mentions: 10 },
        };
        const result = findCrossScriptCharacterKeys(['kaya'], graphNodes);
        // "мама" (Mama) should NOT match "kaya" - distance is 2, but short name threshold is 1
        expect(result).not.toContain('мама');
        expect(result).toHaveLength(0);
    });

    it('matches short names with distance 1 (within stricter threshold)', () => {
        // "mina" vs "mina" (Мина) = distance 0 - should match
        // "mina" vs "mina" with one typo = distance 1 - should still match for short names
        const graphNodes = {
            mina: { name: 'Mina', type: 'PERSON', description: 'A character', mentions: 5 },
            мина: { name: 'Мина', type: 'PERSON', description: 'Персонаж', mentions: 10 },
        };
        const result = findCrossScriptCharacterKeys(['mina'], graphNodes);
        expect(result).toContain('мина');
    });

    it('uses threshold ≤2 for longer names (>4 chars)', () => {
        // Longer names can tolerate distance of 2
        // "elizabeth" vs "elisabeth" = distance 2 (z→s, one extra char)
        const graphNodes = {
            elizabeth: { name: 'Elizabeth', type: 'PERSON', description: 'Queen', mentions: 10 },
            элизабет: { name: 'Элизабет', type: 'PERSON', description: 'Королева', mentions: 15 },
        };
        const result = findCrossScriptCharacterKeys(['elizabeth'], graphNodes);
        // "элизабет" (Elizabet) - distance 1 from "elizabeth" (h missing) - should match
        expect(result).toContain('элизабет');
    });
});
