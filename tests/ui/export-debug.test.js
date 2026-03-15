import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import defaultSettings to use as template for mock
const { defaultSettings } = await import('../../src/constants.js');

// Mock deps before import
vi.mock('../../src/deps.js', () => ({
    getDeps: () => ({
        getExtensionSettings: () => ({
            openvault: {
                ...defaultSettings,
                // Override a few for testing
                alpha: 0.7,
                enabled: true,
                debugMode: false,
            },
        }),
        getContext: () => ({
            chat: [{ mes: 'hello', is_system: false, is_user: true }],
            name2: 'Alice',
            chatMetadata: {
                openvault: {
                    memories: [
                        {
                            id: '1',
                            type: 'event',
                            summary: 'Test',
                            importance: 3,
                            characters_involved: ['Alice'],
                            embedding: new Float32Array(384),
                        },
                        {
                            id: '2',
                            type: 'reflection',
                            summary: 'Insight',
                            importance: 4,
                            characters_involved: ['Alice'],
                        },
                    ],
                    character_states: {
                        Alice: { name: 'Alice', current_emotion: 'happy', emotion_intensity: 5, known_events: ['1'] },
                    },
                    graph: {
                        nodes: {
                            alice: { name: 'Alice', type: 'PERSON', description: 'Main char', mentions: 10 },
                            garden: { name: 'Garden', type: 'PLACE', description: 'A garden', mentions: 5 },
                        },
                        edges: {
                            alice__garden: { source: 'alice', target: 'garden', description: 'visits', weight: 3 },
                        },
                    },
                    communities: {
                        c1: {
                            title: 'Alice World',
                            summary: 'Summary',
                            findings: ['f1'],
                            nodes: ['alice', 'garden'],
                            embedding: new Float32Array(384),
                        },
                    },
                },
            },
        }),
    }),
}));

vi.mock('../../src/embeddings.js', () => ({
    isEmbeddingsEnabled: () => true,
}));

vi.mock('../../src/perf/store.js', () => ({
    getAll: () => ({}),
}));

// Must import after mocks
const { buildExportPayload } = await import('../../src/ui/export-debug.js');
const { cacheRetrievalDebug, clearRetrievalDebug, cacheScoringDetails } = await import(
    '../../src/retrieval/debug-cache.js'
);

describe('buildExportPayload', () => {
    beforeEach(() => {
        clearRetrievalDebug();
    });

    it('returns payload with marker and timestamp', () => {
        const payload = buildExportPayload();
        expect(payload.openvault_debug_export).toBe(true);
        expect(payload.exportedAt).toBeTypeOf('string');
    });

    it('includes memory stats', () => {
        const payload = buildExportPayload();
        expect(payload.state.memories.total).toBe(2);
        expect(payload.state.memories.byType.event).toBe(1);
        expect(payload.state.memories.byType.reflection).toBe(1);
    });

    it('includes character states without known_events array', () => {
        const payload = buildExportPayload();
        expect(payload.state.characterStates.Alice.emotion).toBe('happy');
        expect(payload.state.characterStates.Alice.knownEvents).toBe(1); // count, not array
    });

    it('includes graph summary with top entities', () => {
        const payload = buildExportPayload();
        expect(payload.state.graph.summary.nodeCount).toBe(2);
        expect(payload.state.graph.summary.edgeCount).toBe(1);
        expect(payload.state.graph.summary.topEntitiesByMentions[0].name).toBe('Alice');
    });

    it('excludes embeddings from relevant graph nodes', () => {
        cacheRetrievalDebug({
            queryContext: {
                entities: ['Alice'],
                embeddingQuery: '',
                bm25Tokens: { total: 0, entityStems: 0, grounded: 0, nonGrounded: 0 },
            },
        });
        const payload = buildExportPayload();
        expect(payload.state.graph.relevant.nodes.alice).toBeDefined();
        expect(payload.state.graph.relevant.nodes.alice.embedding).toBeUndefined();
    });

    it('strips embeddings from community details', () => {
        const payload = buildExportPayload();
        expect(payload.state.communities.details.c1.title).toBe('Alice World');
        expect(payload.state.communities.details.c1.embedding).toBeUndefined();
    });

    it('settings contains only non-default values', () => {
        const payload = buildExportPayload();
        // All mock settings match defaults → empty diff
        expect(Object.keys(payload.settings).length).toBe(0);
    });

    it('includes runtime computed values', () => {
        const payload = buildExportPayload();
        expect(payload.runtime.embeddingsEnabled).toBe(true);
    });

    it('includes lastRetrieval when cached', () => {
        cacheRetrievalDebug({
            filters: { totalMemories: 10, hiddenMemories: 5, afterPOVFilter: 4 },
            injectedContext: '<scene_memory>test</scene_memory>',
        });
        const payload = buildExportPayload();
        expect(payload.lastRetrieval.filters.totalMemories).toBe(10);
        expect(payload.lastRetrieval.injectedContext).toBe('<scene_memory>test</scene_memory>');
    });

    it('sets lastRetrieval to null when no cache', () => {
        const payload = buildExportPayload();
        expect(payload.lastRetrieval).toBeNull();
    });

    it('settings contains only values that differ from defaults', () => {
        const payload = buildExportPayload();
        // Mock has alpha: 0.7 and enabled: true which match defaults
        // debugMode: false also matches default
        // So settings should be empty (or contain only truly different values)
        // Since all mock values match defaultSettings, settings should be {}
        expect(payload.settings).toEqual({});
    });

    describe('graph filtering', () => {
        it('shows relevant section with matched entities when retrieval cached', () => {
            cacheRetrievalDebug({
                queryContext: {
                    entities: ['Alice'],
                    embeddingQuery: 'test',
                    bm25Tokens: { total: 0, entityStems: 0, grounded: 0, nonGrounded: 0 },
                },
            });
            const payload = buildExportPayload();
            expect(payload.state.graph.relevant).toBeDefined();
            expect(payload.state.graph.relevant.matchedEntities).toEqual(['Alice']);
            expect(payload.state.graph.relevant.nodes.alice).toBeDefined();
            expect(payload.state.graph.relevant.nodes.alice.name).toBe('Alice');
            // alice__garden edge involves alice, so should be included
            expect(payload.state.graph.relevant.edges.alice__garden).toBeDefined();
        });

        it('omits graph.raw (replaced by relevant)', () => {
            cacheRetrievalDebug({
                queryContext: {
                    entities: ['Alice'],
                    embeddingQuery: 'test',
                    bm25Tokens: { total: 0, entityStems: 0, grounded: 0, nonGrounded: 0 },
                },
            });
            const payload = buildExportPayload();
            expect(payload.state.graph.raw).toBeUndefined();
        });

        it('falls back to summary-only when no retrieval cached', () => {
            const payload = buildExportPayload();
            expect(payload.state.graph.summary.nodeCount).toBe(2);
            expect(payload.state.graph.relevant).toBeUndefined();
        });
    });

    describe('scoring section', () => {
        beforeEach(() => {
            clearRetrievalDebug();
        });

        function setupScoringCache() {
            const results = [
                {
                    memory: {
                        id: 's1',
                        type: 'event',
                        summary: 'Selected memory one',
                        retrieval_hits: 3,
                        mentions: 2,
                        characters_involved: ['Alice'],
                    },
                    score: 5.12345,
                    breakdown: {
                        base: 2.34567,
                        baseAfterFloor: 2.34567,
                        recencyPenalty: 0,
                        vectorSimilarity: 0.71234,
                        vectorBonus: 1.56789,
                        bm25Score: 0.45678,
                        bm25Bonus: 1.23456,
                        hitDamping: 0.67,
                        frequencyFactor: 1.035,
                        total: 5.12345,
                        distance: 42,
                        importance: 4,
                    },
                },
                {
                    memory: {
                        id: 'r1',
                        type: 'event',
                        summary: 'Rejected memory',
                        retrieval_hits: 0,
                        mentions: 1,
                        characters_involved: ['Bob'],
                    },
                    score: 1.0,
                    breakdown: {
                        base: 0.98765,
                        baseAfterFloor: 0.98765,
                        recencyPenalty: 0,
                        vectorSimilarity: 0,
                        vectorBonus: 0,
                        bm25Score: 0,
                        bm25Bonus: 0,
                        hitDamping: 1,
                        frequencyFactor: 1,
                        total: 1.0,
                        distance: 150,
                        importance: 2,
                    },
                },
            ];
            cacheScoringDetails(results, new Set(['s1']));
        }

        it('rounds all floats to 2 decimal places', () => {
            setupScoringCache();
            const payload = buildExportPayload();
            const selected = payload.scoring.selected[0];
            expect(selected.total).toBe(5.12);
            expect(selected.base).toBe(2.35);
        });

        it('omits zero/default scoring fields', () => {
            setupScoringCache();
            const payload = buildExportPayload();
            const rejected = payload.scoring.rejected[0];
            // Zero fields should be omitted
            expect(rejected.vectorSimilarity).toBeUndefined();
            expect(rejected.vectorBonus).toBeUndefined();
            expect(rejected.bm25Score).toBeUndefined();
            expect(rejected.bm25Bonus).toBeUndefined();
            expect(rejected.recencyPenalty).toBeUndefined();
            expect(rejected.hitDamping).toBeUndefined();
            expect(rejected.frequencyFactor).toBeUndefined();
            // Non-default fields should be present
            expect(rejected.total).toBeDefined();
            expect(rejected.base).toBeDefined();
            expect(rejected.distance).toBeDefined();
        });

        it('includes non-zero optional fields', () => {
            setupScoringCache();
            const payload = buildExportPayload();
            const selected = payload.scoring.selected[0];
            expect(selected.vectorSimilarity).toBe(0.71);
            expect(selected.vectorBonus).toBe(1.57);
            expect(selected.hitDamping).toBe(0.67);
            expect(selected.frequencyFactor).toBe(1.03); // r2(1.035)
        });

        it('includes decayPct on all entries', () => {
            setupScoringCache();
            const payload = buildExportPayload();
            const selected = payload.scoring.selected[0];
            // decayPct = base / importance = 2.34567 / 4 ≈ 0.59
            expect(selected.decayPct).toBe(0.59);
            const rejected = payload.scoring.rejected[0];
            // decayPct = 0.98765 / 2 ≈ 0.49
            expect(rejected.decayPct).toBe(0.49);
        });

        it('includes retrieval_hits, mentions, characters_involved', () => {
            setupScoringCache();
            const payload = buildExportPayload();
            const selected = payload.scoring.selected[0];
            expect(selected.retrieval_hits).toBe(3);
            expect(selected.mentions).toBe(2);
            expect(selected.characters_involved).toEqual(['Alice']);
        });

        it('splits into selected and rejected arrays', () => {
            setupScoringCache();
            const payload = buildExportPayload();
            expect(payload.scoring.selected).toHaveLength(1);
            expect(payload.scoring.rejected).toHaveLength(1);
            expect(payload.scoring.selected[0].id).toBe('s1');
            expect(payload.scoring.rejected[0].id).toBe('r1');
        });

        it('includes _note about omitted fields', () => {
            setupScoringCache();
            const payload = buildExportPayload();
            expect(payload.scoring._note).toContain('Default-value');
        });
    });

    it('includes extended runtime info', () => {
        const payload = buildExportPayload();
        expect(payload.runtime.embeddingsEnabled).toBe(true);
        expect(payload.runtime.embeddingModelId).toBeDefined();
        expect(payload.runtime.extractionProgress).toBeDefined();
        expect(payload.runtime.extractionProgress).toHaveProperty('processed');
        expect(payload.runtime.extractionProgress).toHaveProperty('chatLength');
    });

    it('includes perf section', () => {
        const payload = buildExportPayload();
        expect(payload.perf).toBeDefined();
        expect(payload.perf).toBeTypeOf('object');
    });
});
