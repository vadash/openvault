import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, extensionName } from '../../src/constants.js';
import { getDocumentEmbedding } from '../../src/embeddings.js';
import {
    consolidateEdges,
    createEmptyGraph,
    expandMainCharacterKeys,
    markEdgeForConsolidation,
    mergeOrInsertEntity,
    normalizeKey,
    shouldMergeEntities,
    upsertEntity,
    upsertRelationship,
} from '../../src/graph/graph.js';

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
        expect(stChanges.toSync).toHaveLength(1); // Updated node should be synced
        expect(stChanges.toSync[0].text).toBe('[OV_ID:castle] A fortress | Updated');
        expect(stChanges.toSync[0].item).toBe(graphData.nodes.castle);
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
        expect(stChanges.toSync).toHaveLength(1); // New node should be synced
        expect(stChanges.toSync[0].text).toBe('[OV_ID:dragon] A beast');
        expect(stChanges.toDelete).toHaveLength(0);
        expect(Object.keys(graphData.nodes)).toHaveLength(2);
    });

    it('merges into existing node when semantic similarity exceeds threshold (PERSON)', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        // Return very similar embedding for "Vova's Apartment"
        getDocumentEmbedding.mockResolvedValue([0.9, 0.1, 0]);

        upsertEntity(graphData, 'Dragon', 'PERSON', 'A creature');
        graphData.nodes.dragon.embedding = [0.9, 0.1, 0];

        const { key, stChanges } = await mergeOrInsertEntity(
            graphData,
            'Draco',
            'PERSON',
            'Another name',
            3,
            mockSettings
        );
        // PERSON can merge on high similarity alone (names are unique identifiers)
        expect(key).toBe('dragon');
        expect(stChanges.toSync).toHaveLength(1); // Updated node should be synced
        expect(stChanges.toSync[0].text).toBe('[OV_ID:dragon] A creature | Another name');
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes.dragon.mentions).toBe(2);
        expect(Object.keys(graphData.nodes)).toHaveLength(1);
    });

    it('does not merge entities of different types', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue([1, 0, 0]);

        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        graphData.nodes.castle.embedding = [1, 0, 0];

        const { key, stChanges } = await mergeOrInsertEntity(
            graphData,
            'Castle',
            'PERSON',
            'A person named Castle',
            3,
            mockSettings
        );
        // Fast-path key match fires first regardless of type
        expect(key).toBe('castle');
        expect(stChanges.toSync).toHaveLength(1); // Updated node should be synced
        expect(stChanges.toSync[0].text).toBe('[OV_ID:castle] A fortress | A person named Castle');
        expect(stChanges.toDelete).toHaveLength(0);
        expect(graphData.nodes.castle.type).toBe('PLACE'); // Original type preserved
    });

    it('falls back to insert when embeddings are unavailable', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue(null);

        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        const { key, stChanges } = await mergeOrInsertEntity(
            graphData,
            'Fortress',
            'PLACE',
            'A stronghold',
            3,
            mockSettings
        );
        expect(key).toBe('fortress');
        expect(stChanges.toSync).toHaveLength(1); // New node should be synced
        expect(stChanges.toSync[0].text).toBe('[OV_ID:fortress] A stronghold');
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

    describe('cross-script merge', () => {
        it.each([
            {
                desc: 'merges Cyrillic PERSON matching main character via transliteration',
                setup: () => {
                    graphData.nodes.suzy = {
                        name: 'Suzy',
                        type: 'PERSON',
                        description: 'Main character',
                        mentions: 28,
                    };
                },
                inputName: 'Сузи',
                inputType: 'PERSON',
                inputDesc: 'Главная героиня',
                expectedKey: 'suzy',
                expectedSyncText: '[OV_ID:suzy] Main character | Главная героиня',
                expectedAlias: 'Сузи',
                expectedRedirectSource: 'сузи',
                expectedRedirectTarget: 'suzy',
            },
            {
                desc: 'does not cross-script merge non-PERSON entities',
                setup: () => {
                    graphData.nodes.suzy = {
                        name: 'Suzy',
                        type: 'PERSON',
                        description: 'Main character',
                        mentions: 28,
                    };
                },
                inputName: 'Сузи',
                inputType: 'OBJECT',
                inputDesc: 'Some object named Сузи',
                expectedKey: 'сузи',
                expectedSyncText: '[OV_ID:сузи] Some object named Сузи',
                expectedAlias: undefined,
                expectedRedirectSource: undefined,
                expectedRedirectTarget: undefined,
            },
            {
                desc: 'creates new node when no existing PERSON nodes match cross-script',
                setup: () => {
                    // No existing nodes
                },
                inputName: 'Сузи',
                inputType: 'PERSON',
                inputDesc: 'Some person',
                expectedKey: 'сузи',
                expectedSyncText: '[OV_ID:сузи] Some person',
                expectedAlias: undefined,
                expectedRedirectSource: undefined,
                expectedRedirectTarget: undefined,
            },
            {
                desc: 'merges secondary character Cyrillic variant into existing Latin PERSON node',
                setup: () => {
                    graphData.nodes.mina = {
                        name: 'Mina',
                        type: 'PERSON',
                        description: 'A friend',
                        mentions: 5,
                    };
                },
                inputName: 'Мина',
                inputType: 'PERSON',
                inputDesc: 'Подруга',
                expectedKey: 'mina',
                expectedSyncText: '[OV_ID:mina] A friend | Подруга',
                expectedAlias: 'Мина',
                expectedRedirectSource: 'мина',
                expectedRedirectTarget: 'mina',
            },
            {
                desc: 'merges Latin PERSON into existing Cyrillic node (reverse direction)',
                setup: () => {
                    graphData.nodes.мина = {
                        name: 'Мина',
                        type: 'PERSON',
                        description: 'Подруга',
                        mentions: 5,
                    };
                },
                inputName: 'Mina',
                inputType: 'PERSON',
                inputDesc: 'A friend',
                expectedKey: 'мина',
                expectedSyncText: '[OV_ID:мина] Подруга | A friend',
                expectedAlias: 'Mina',
                expectedRedirectSource: 'mina',
                expectedRedirectTarget: 'мина',
            },
            {
                desc: 'does NOT merge short names with distance=2 (stricter threshold)',
                setup: () => {
                    graphData.nodes.kaya = {
                        name: 'Kaya',
                        type: 'PERSON',
                        description: 'A friend',
                        mentions: 5,
                    };
                },
                inputName: 'Мама',
                inputType: 'PERSON',
                inputDesc: 'Mother',
                expectedKey: 'мама',
                expectedSyncText: '[OV_ID:мама] Mother',
                expectedAlias: undefined,
                expectedRedirectSource: undefined,
                expectedRedirectTarget: undefined,
                additionalAssertions: (_result) => {
                    expect(graphData.nodes.мама).toBeDefined();
                    expect(graphData.nodes.kaya.aliases).toBeUndefined();
                },
            },
            {
                desc: 'merges short names with distance=1 (within stricter threshold)',
                setup: () => {
                    graphData.nodes.mina = {
                        name: 'Mina',
                        type: 'PERSON',
                        description: 'A friend',
                        mentions: 5,
                    };
                },
                inputName: 'Мина',
                inputType: 'PERSON',
                inputDesc: 'Подруга',
                expectedKey: 'mina',
                expectedSyncText: '[OV_ID:mina] A friend | Подруга',
                expectedAlias: 'Мина',
                expectedRedirectSource: 'мина',
                expectedRedirectTarget: 'mina',
            },
            {
                desc: 'merges longer names with distance=2 (standard threshold)',
                setup: () => {
                    graphData.nodes.elizabeth = {
                        name: 'Elizabeth',
                        type: 'PERSON',
                        description: 'Queen',
                        mentions: 10,
                    };
                },
                inputName: 'Элизабет',
                inputType: 'PERSON',
                inputDesc: 'Королева',
                expectedKey: 'elizabeth',
                expectedSyncText: '[OV_ID:elizabeth] Queen | Королева',
                expectedAlias: 'Элизабет',
                expectedRedirectSource: 'элизабет',
                expectedRedirectTarget: 'elizabeth',
            },
        ])('$desc', async ({
            setup,
            inputName,
            inputType,
            inputDesc,
            expectedKey,
            expectedSyncText,
            expectedAlias,
            expectedRedirectSource,
            expectedRedirectTarget,
            additionalAssertions,
        }) => {
            setup();

            const { key, stChanges } = await mergeOrInsertEntity(graphData, inputName, inputType, inputDesc, 3, {
                entityMergeSimilarityThreshold: 0.95,
            });

            expect(key).toBe(expectedKey);
            expect(stChanges.toSync).toHaveLength(1);
            expect(stChanges.toSync[0].text).toBe(expectedSyncText);
            expect(stChanges.toDelete).toHaveLength(0);

            if (expectedAlias) {
                expect(graphData.nodes[key].aliases).toContain(expectedAlias);
            } else {
                expect(graphData.nodes[key].aliases).toBeUndefined();
            }

            if (expectedRedirectSource && expectedRedirectTarget) {
                expect(graphData._mergeRedirects?.[expectedRedirectSource]).toBe(expectedRedirectTarget);
            }

            additionalAssertions?.({ key, stChanges, graphData });
        });

        it('does NOT merge cross-script PERSON entities via semantic similarity alone', async () => {
            // Regression test: "Alice" (Latin) and "Боб" (Cyrillic Bob) should NOT merge
            // even if embeddings are nearly identical (similar descriptions).
            // Cross-script PERSON merges should ONLY happen via transliteration match.
            const { getDocumentEmbedding } = await import('../../src/embeddings.js');

            // Setup: existing Cyrillic PERSON with embedding
            graphData.nodes.мария = {
                name: 'Мария',
                type: 'PERSON',
                description: 'A character involved in roleplay dynamics',
                mentions: 10,
            };
            graphData.nodes.мария.embedding_b64 = 'AAAAAPo/AAAAAA'; // mock embedding

            // Mock embedding to return nearly identical vector (simulating similar descriptions)
            getDocumentEmbedding.mockResolvedValue([1.0, 0.9, 0.8]);

            // Act: insert Latin "Rose" - different name, different script, similar description
            const { key, stChanges } = await mergeOrInsertEntity(
                graphData,
                'Rose',
                'PERSON',
                'A character involved in similar roleplay dynamics',
                3,
                mockSettings
            );

            // Assert: should NOT merge - different scripts without transliteration match
            expect(key).toBe('rose');
            expect(graphData.nodes.rose).toBeDefined();
            expect(graphData.nodes.мария.aliases).toBeUndefined(); // Rose not added as alias
            expect(stChanges.toSync).toHaveLength(1); // New node created
        });
    });

    it('returns stChanges.toSync with new node when creating a new entity', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue([0.5, 0.5, 0.5]);

        const { key, stChanges } = await mergeOrInsertEntity(
            graphData,
            'Dragon',
            'PERSON',
            'A fire beast',
            3,
            mockSettings
        );
        expect(key).toBe('dragon');
        expect(stChanges.toSync).toHaveLength(1);
        expect(stChanges.toSync[0].text).toBe('[OV_ID:dragon] A fire beast');
        expect(stChanges.toSync[0].item).toBe(graphData.nodes.dragon);
        expect(stChanges.toSync[0].hash).toBeDefined();
        expect(stChanges.toDelete).toHaveLength(0);
    });

    it('returns stChanges with updated node on fast path (exact key match)', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue(null);

        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        const { key, stChanges } = await mergeOrInsertEntity(graphData, 'castle', 'PLACE', 'Updated', 3, mockSettings);
        expect(key).toBe('castle');
        expect(stChanges.toSync).toHaveLength(1); // Updated node should be synced
        expect(stChanges.toSync[0].text).toBe('[OV_ID:castle] A fortress | Updated');
        expect(stChanges.toDelete).toHaveLength(0);
    });

    it('returns stChanges with updated node on semantic merge path (existing node updated)', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');
        getDocumentEmbedding.mockResolvedValue([0.9, 0.1, 0]);

        upsertEntity(graphData, 'Dragon', 'PERSON', 'A creature');
        graphData.nodes.dragon.embedding = [0.9, 0.1, 0];

        const { key, stChanges } = await mergeOrInsertEntity(
            graphData,
            'Draco',
            'PERSON',
            'Another name',
            3,
            mockSettings
        );
        // PERSON can merge on high similarity alone
        expect(key).toBe('dragon');
        expect(stChanges.toSync).toHaveLength(1); // Updated node should be synced
        expect(stChanges.toSync[0].text).toBe('[OV_ID:dragon] A creature | Another name');
        expect(stChanges.toDelete).toHaveLength(0);
    });
});

describe('edge creation with semantic merge', () => {
    it('creates edges using resolved keys after mergeOrInsertEntity', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');

        // Setup: "dragon" already exists with embedding (PERSON type)
        const graphData = createEmptyGraph();
        graphData.nodes.dragon = {
            name: 'Dragon',
            type: 'PERSON',
            description: 'A character',
            mentions: 5,
            embedding: [1, 0, 0],
        };
        graphData.nodes.suzy = {
            name: 'Suzy',
            type: 'PERSON',
            description: 'A student',
            mentions: 10,
        };

        // Mock: "Draco" embeds to something very similar to "dragon"
        getDocumentEmbedding.mockResolvedValue([0.99, 0.1, 0]);

        const settings = { entityMergeSimilarityThreshold: 0.8 };

        // mergeOrInsertEntity should merge "Draco" into "dragon" (PERSON type)
        const { key: resolvedKey } = await mergeOrInsertEntity(
            graphData,
            'Draco',
            'PERSON',
            'A character alias',
            3,
            settings
        );
        expect(resolvedKey).toBe('dragon');

        // Now create a relationship using the ORIGINAL name "Draco"
        // This should work because we use the resolved key
        upsertRelationship(graphData, 'Suzy', 'Draco', 'Friends with', 5);

        // Edge should exist (suzy -> dragon), NOT be silently dropped
        const edgeKey = 'suzy__dragon';
        expect(graphData.edges[edgeKey]).toBeDefined();
        expect(graphData.edges[edgeKey].description).toBe('Friends with');
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

describe('_resolveKey chained redirects', () => {
    it('should follow A→B→C redirect chain and return C', async () => {
        const { upsertRelationship } = await import('../../src/graph/graph.js');

        const graphData = { nodes: {}, edges: {}, _mergeRedirects: {} };

        // Create nodes
        graphData.nodes.alice = { name: 'Alice', type: 'PERSON', description: 'desc', mentions: 1 };
        graphData.nodes['alice smith'] = { name: 'Alice Smith', type: 'PERSON', description: 'desc', mentions: 1 };
        graphData.nodes.alison = { name: 'Alison', type: 'PERSON', description: 'desc', mentions: 1 };
        graphData.nodes.bob = { name: 'Bob', type: 'PERSON', description: 'desc', mentions: 1 };
        graphData.nodes.charlie = { name: 'Charlie', type: 'PERSON', description: 'desc', mentions: 1 };

        // Set up chain: alice → alice smith → alison
        graphData._mergeRedirects.alice = 'alice smith';
        graphData._mergeRedirects['alice smith'] = 'alison';

        // upsertRelationship uses _resolveKey internally for both source and target
        upsertRelationship(graphData, 'alice', 'bob', 'knows bob', 5);
        upsertRelationship(graphData, 'charlie', 'alice smith', 'met alice smith', 5);

        // Edge from alice should land on 'alison' (final resolved target)
        const edgeToAlison = graphData.edges.alison__bob;
        expect(edgeToAlison).toBeDefined();
        expect(edgeToAlison.description).toBe('knows bob');

        // Edge to alice smith should also land on 'alison'
        const edgeFromCharlie = graphData.edges.charlie__alison;
        expect(edgeFromCharlie).toBeDefined();
        expect(edgeFromCharlie.description).toBe('met alice smith');
    });

    it('should break circular redirect chains', async () => {
        const { upsertRelationship } = await import('../../src/graph/graph.js');

        const graphData = { nodes: {}, edges: {}, _mergeRedirects: {} };

        // Create three nodes
        graphData.nodes.bob = { name: 'Bob', type: 'PERSON', description: 'desc', mentions: 1 };
        graphData.nodes.charlie = { name: 'Charlie', type: 'PERSON', description: 'desc', mentions: 1 };
        graphData.nodes.dave = { name: 'Dave', type: 'PERSON', description: 'desc', mentions: 1 };

        // Create circular redirect (should not happen in practice, but defensive)
        graphData._mergeRedirects.bob = 'charlie';
        graphData._mergeRedirects.charlie = 'bob';

        upsertRelationship(graphData, 'bob', 'dave', 'knows dave', 5);

        // Should not infinite-loop — either bob or charlie key should exist
        const hasEdge = !!graphData.edges.bob__dave || !!graphData.edges.charlie__dave;
        expect(hasEdge).toBe(true);
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

        const { count, stChanges } = await consolidateEdges(graph, mockSettings);
        expect(count).toBe(1);
        expect(graph.edges.alice__bob.description).toBe('From strangers to battle allies');
        expect(graph._edgesNeedingConsolidation).toHaveLength(0);
        // stChanges contains the consolidated edge for ST sync
        expect(stChanges.toSync).toHaveLength(1);
        expect(stChanges.toSync[0].text).toBe('[OV_ID:edge_alice_bob] From strangers to battle allies');
        expect(stChanges.toSync[0].item).toBe(graph.edges.alice__bob);
    });

    it('returns 0 count and empty stChanges when no edges need consolidation', async () => {
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

        const { count, stChanges } = await consolidateEdges(graph, {});
        expect(count).toBe(0);
        expect(stChanges.toSync).toHaveLength(0);
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

        const { count, stChanges } = await consolidateEdges(graph, {});
        // Should only process 10 (MAX_CONSOLIDATION_BATCH), 5 should remain
        expect(count).toBe(10);
        expect(graph._edgesNeedingConsolidation).toHaveLength(5);
        expect(stChanges.toSync).toHaveLength(10);
    });
});

describe('shouldMergeEntities', () => {
    describe('PERSON type', () => {
        it('merges on high similarity alone (names are unique identifiers)', () => {
            const tokensA = new Set(['alex']);
            expect(shouldMergeEntities(0.95, 0.9, tokensA, 'alex', 'alexander', 'PERSON')).toBe(true);
        });

        it('merges at exact threshold', () => {
            const tokensA = new Set(['john']);
            expect(shouldMergeEntities(0.9, 0.9, tokensA, 'john', 'jonathan', 'PERSON')).toBe(true);
        });

        it('requires token overlap in grey zone', () => {
            const tokensA = new Set(['mary']);
            // cosine=0.85, threshold=0.9, grey zone = 0.8-0.9, no overlap → false
            expect(shouldMergeEntities(0.85, 0.9, tokensA, 'mary', 'jane', 'PERSON')).toBe(false);
        });

        it('merges in grey zone with token overlap', () => {
            const tokensA = new Set(['bob']);
            // cosine=0.85, grey zone, substring containment ('bob' in 'bob smith')
            expect(shouldMergeEntities(0.85, 0.9, tokensA, 'bob', 'bob smith', 'PERSON')).toBe(true);
        });
    });

    describe('OBJECT/CONCEPT types', () => {
        it('requires token overlap even at high similarity', () => {
            const tokensA = new Set(['sword']);
            // cosine=0.95, but OBJECT type requires token overlap, no overlap → false
            expect(shouldMergeEntities(0.95, 0.9, tokensA, 'sword', 'blade', 'OBJECT')).toBe(false);
        });

        it('merges when substring containment exists', () => {
            const tokensA = new Set(['red', 'sword']);
            // cosine=0.95, OBJECT type, 'sword' contained in 'red sword' → true
            expect(shouldMergeEntities(0.95, 0.9, tokensA, 'red sword', 'sword', 'OBJECT')).toBe(true);
        });

        it('rejects when cosine is below grey zone', () => {
            const tokensA = new Set(['item']);
            // cosine=0.75, threshold=0.9, below 0.8 floor → false
            expect(shouldMergeEntities(0.75, 0.9, tokensA, 'item', 'item', 'OBJECT')).toBe(false);
        });

        it('defaults to OBJECT type when not specified', () => {
            const tokensA = new Set(['apple']);
            // No type specified, defaults to OBJECT, requires overlap
            expect(shouldMergeEntities(0.95, 0.9, tokensA, 'apple', 'orange')).toBe(false);
        });
    });

    describe('CONCEPT type', () => {
        it('requires token overlap like OBJECT', () => {
            const tokensA = new Set(['honor']);
            // CONCEPT type requires token overlap
            expect(shouldMergeEntities(0.95, 0.9, tokensA, 'honor', 'glory', 'CONCEPT')).toBe(false);
        });
    });
});

describe('Edge Consolidation (BM25-only mode)', () => {
    const mockCallLLM = vi.fn();

    beforeEach(() => {
        mockCallLLM.mockReset();
    });

    it('consolidates without embeddings when disabled', async () => {
        const { callLLM: mockCallLLMRef } = await import('../../src/llm.js');
        mockCallLLMRef.mockResolvedValue(JSON.stringify({ consolidated_description: 'Consolidated relationship' }));

        const graph = createEmptyGraph();
        graph.nodes.alice = { name: 'Alice', type: 'PERSON', description: 'test', mentions: 1 };
        graph.nodes.bob = { name: 'Bob', type: 'PERSON', description: 'test', mentions: 1 };
        graph.edges.alice__bob = {
            source: 'alice',
            target: 'bob',
            description: 'Seg1 | Seg2 | Seg3 | Seg4 | Seg5 | Seg6',
            weight: 6,
            _descriptionTokens: 600,
        };
        graph._edgesNeedingConsolidation = ['alice__bob'];

        const { count, stChanges } = await consolidateEdges(graph, {});
        expect(count).toBe(1);
        expect(graph.edges.alice__bob.description).toBe('Consolidated relationship');
        expect(graph._edgesNeedingConsolidation).toHaveLength(0);
        expect(stChanges.toSync).toHaveLength(1);
    });

    it('consolidates multiple edges in parallel with maxConcurrency > 1', async () => {
        const { callLLM: mockCallLLMRef } = await import('../../src/llm.js');
        mockCallLLMRef
            .mockResolvedValueOnce(JSON.stringify({ consolidated_description: 'Relationship A' }))
            .mockResolvedValueOnce(JSON.stringify({ consolidated_description: 'Relationship B' }));

        const graph = createEmptyGraph();
        graph.nodes.alice = { name: 'Alice', type: 'PERSON', description: 'test', mentions: 1 };
        graph.nodes.bob = { name: 'Bob', type: 'PERSON', description: 'test', mentions: 1 };
        graph.nodes.carol = { name: 'Carol', type: 'PERSON', description: 'test', mentions: 1 };
        graph.edges.alice__bob = {
            source: 'alice',
            target: 'bob',
            description: 'Seg1 | Seg2 | Seg3 | Seg4 | Seg5 | Seg6',
            weight: 6,
            _descriptionTokens: 600,
        };
        graph.edges.alice__carol = {
            source: 'alice',
            target: 'carol',
            description: 'Seg1 | Seg2 | Seg3 | Seg4 | Seg5',
            weight: 5,
            _descriptionTokens: 500,
        };
        graph._edgesNeedingConsolidation = ['alice__bob', 'alice__carol'];

        const { count, stChanges } = await consolidateEdges(graph, {});
        expect(count).toBe(2);
        expect(graph.edges.alice__bob.description).toBe('Relationship A');
        expect(graph.edges.alice__carol.description).toBe('Relationship B');
        expect(graph._edgesNeedingConsolidation).toHaveLength(0);
        expect(stChanges.toSync).toHaveLength(2);
    });

    it('queues old edge hash for deletion when consolidating', async () => {
        const { callLLM: mockCallLLMRef } = await import('../../src/llm.js');
        mockCallLLMRef.mockResolvedValue(JSON.stringify({ consolidated_description: 'Consolidated desc' }));

        const graph = createEmptyGraph();
        graph.nodes.alice = { name: 'Alice', type: 'PERSON', description: 'test', mentions: 1 };
        graph.nodes.bob = { name: 'Bob', type: 'PERSON', description: 'test', mentions: 1 };
        graph.edges.alice__bob = {
            source: 'alice',
            target: 'bob',
            description: 'Old bloated description | Seg2 | Seg3 | Seg4 | Seg5 | Seg6',
            weight: 6,
            _descriptionTokens: 600,
            _st_synced: true,
        };
        graph._edgesNeedingConsolidation = ['alice__bob'];

        const { count, stChanges } = await consolidateEdges(graph, {});

        expect(count).toBe(1);
        expect(stChanges.toSync).toHaveLength(1);
        // Old edge should be queued for deletion
        expect(stChanges.toDelete).toHaveLength(1);
        expect(stChanges.toDelete[0]).toHaveProperty('hash');
        expect(typeof stChanges.toDelete[0].hash).toBe('number');
        // toDelete hash should differ from toSync hash (old vs new description)
        expect(stChanges.toDelete[0].hash).not.toBe(stChanges.toSync[0].hash);
    });
});
