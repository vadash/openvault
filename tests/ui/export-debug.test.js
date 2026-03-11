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

// Must import after mocks
const { buildExportPayload } = await import('../../src/ui/export-debug.js');
const { cacheRetrievalDebug, clearRetrievalDebug } = await import('../../src/retrieval/debug-cache.js');

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

    it('includes graph raw without embeddings', () => {
        const payload = buildExportPayload();
        expect(payload.state.graph.raw.nodes.alice).toBeDefined();
        expect(payload.state.graph.raw.nodes.alice.embedding).toBeUndefined();
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
});
