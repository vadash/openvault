import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/constants.js';
import { resetDeps } from '../../src/deps.js';
import { extractMemories, runPhase2Enrichment } from '../../src/extraction/extract.js';

/**
 * Standard LLM response data for extraction tests.
 * Events stage returns 1 event; Graph stage returns 2 entities + 1 relationship.
 */
const EXTRACTION_RESPONSES = {
    events: JSON.stringify({
        reasoning: null,
        events: [
            {
                summary: 'King Aldric entered the Castle and surveyed the hall',
                importance: 3,
                characters_involved: ['King Aldric'],
                witnesses: ['King Aldric'],
                location: 'Castle',
                is_secret: false,
                emotional_impact: {},
                relationship_impact: {},
            },
        ],
    }),
    graph: JSON.stringify({
        entities: [
            { name: 'King Aldric', type: 'PERSON', description: 'The aging ruler' },
            { name: 'Castle', type: 'PLACE', description: 'An ancient fortress' },
        ],
        relationships: [{ source: 'King Aldric', target: 'Castle', description: 'Rules from' }],
    }),
};

/**
 * Create a sendRequest mock with sequential LLM responses.
 * @param  {...{content: string}} extraResponses - Additional responses after events+graph
 */
function mockSendRequest(...extraResponses) {
    const fn = vi
        .fn()
        .mockResolvedValueOnce({ content: EXTRACTION_RESPONSES.events })
        .mockResolvedValueOnce({ content: EXTRACTION_RESPONSES.graph });
    for (const resp of extraResponses) {
        fn.mockResolvedValueOnce(resp);
    }
    return fn;
}

/**
 * Standard test settings for extraction tests.
 */
function getExtractionSettings() {
    return {
        ...defaultSettings,
        extractionProfile: 'test-profile',
        embeddingSource: 'ollama',
        ollamaUrl: 'http://test:11434',
        embeddingModel: 'test-model',
        backfillMaxRPM: 99999,
    };
}

/**
 * Standard connection manager mock for extraction tests.
 */
function getMockConnectionManager(sendRequest) {
    return {
        selectedProfile: 'test-profile',
        profiles: [{ id: 'test-profile', name: 'Test' }],
        sendRequest,
    };
}

// ── extractMemories pipeline integration (3 tests) ──

describe('extractMemories pipeline', () => {
    let mockContext;
    let mockData;

    beforeEach(() => {
        mockData = {
            memories: [],
            character_states: {},
            processed_message_ids: [],
        };

        mockContext = {
            chat: [
                { mes: 'Hello', is_user: true, name: 'User', send_date: '1000000' },
                { mes: 'Welcome to the Castle', is_user: false, name: 'King Aldric', send_date: '1000001' },
            ],
            name1: 'User',
            name2: 'King Aldric',
            characterId: 'char1',
            characters: { char1: { description: '' } },
            chatMetadata: { openvault: mockData },
            chatId: 'test-chat',
            powerUserSettings: {},
        };

        setupTestContext({
            context: mockContext,
            settings: getExtractionSettings(),
            deps: {
                connectionManager: getMockConnectionManager(mockSendRequest()),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('happy path: events + graph + reflection state populated', async () => {
        const result = await extractMemories([0, 1]);

        expect(result.status).toBe('success');

        // Events created with correct type
        expect(mockData.memories.length).toBeGreaterThan(0);
        for (const memory of mockData.memories) {
            expect(memory.type).toBe('event');
        }

        // Graph populated
        expect(mockData.graph).toBeDefined();
        expect(mockData.graph.nodes['king aldric']).toBeDefined();
        expect(mockData.graph.nodes['king aldric'].type).toBe('PERSON');
        expect(mockData.graph.nodes.castle).toBeDefined();
        expect(mockData.graph.edges['king aldric__castle']).toBeDefined();
        expect(mockData.graph_message_count).toBeGreaterThan(0);

        // Reflection state accumulated
        expect(mockData.reflection_state).toBeDefined();
        expect(mockData.reflection_state['King Aldric']).toBeDefined();
        expect(mockData.reflection_state['King Aldric'].importance_sum).toBeGreaterThan(0);

        // Processed message IDs tracked
        expect(mockData.processed_message_ids.length).toBeGreaterThan(0);
    });

    it('graceful degradation: Phase 1 saves despite Phase 2 reflection failure', async () => {
        mockData.reflection_state = { 'King Aldric': { importance_sum: 100 } };

        const sendRequest = mockSendRequest();
        sendRequest.mockRejectedValueOnce(new Error('Reflection API down'));
        setupTestContext({
            context: mockContext,
            settings: getExtractionSettings(),
            deps: {
                connectionManager: getMockConnectionManager(sendRequest),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        const result = await extractMemories([0, 1]);

        expect(result.status).toBe('success');
        expect(result.events_created).toBeGreaterThan(0);
        expect(mockData.memories.length).toBeGreaterThan(0);
        expect(mockData.processed_message_ids.length).toBeGreaterThan(0);
    });

    it('fast-fail: Phase 1 AbortError propagates without saving', async () => {
        const sendRequest = vi.fn().mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
        setupTestContext({
            context: mockContext,
            settings: getExtractionSettings(),
            deps: {
                connectionManager: getMockConnectionManager(sendRequest),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        await expect(extractMemories([0, 1], 'test-chat')).rejects.toThrow(
            expect.objectContaining({ name: 'AbortError' })
        );
    });
});

// ── runPhase2Enrichment pipeline (2 tests) ──

describe('runPhase2Enrichment', () => {
    let mockContext;

    beforeEach(() => {
        mockContext = {
            chat: [
                { mes: 'Hello', is_user: true, name: 'User' },
                { mes: 'Welcome to the Castle', is_user: false, name: 'King Aldric' },
            ],
            name1: 'User',
            name2: 'King Aldric',
            characterId: 'char1',
            characters: { char1: { description: '' } },
            chatId: 'test-chat',
            powerUserSettings: {},
        };
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('processes characters with accumulated importance', async () => {
        const reflectionResponse = JSON.stringify({
            reflections: [
                {
                    question: 'What defines King Aldric?',
                    insight: 'King Aldric has been ruling with wisdom',
                    evidence_ids: ['event_1', 'event_2'],
                },
            ],
        });
        const communityResponse = JSON.stringify({ communities: [] });

        const sendRequest = vi
            .fn()
            .mockResolvedValueOnce({ content: reflectionResponse })
            .mockResolvedValueOnce({ content: communityResponse });

        setupTestContext({
            context: mockContext,
            settings: { ...getExtractionSettings(), reflectionThreshold: 40 },
            deps: {
                connectionManager: getMockConnectionManager(sendRequest),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        const mockDataWithState = {
            memories: [
                {
                    id: 'event_1',
                    type: 'event',
                    summary: 'Test event 1',
                    importance: 5,
                    tokens: ['test'],
                    message_ids: [0],
                    sequence: 0,
                    characters_involved: ['King Aldric'],
                    witnesses: ['King Aldric'],
                    embedding_b64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=',
                },
                {
                    id: 'event_2',
                    type: 'event',
                    summary: 'Test event 2',
                    importance: 5,
                    tokens: ['test'],
                    message_ids: [1],
                    sequence: 1,
                    characters_involved: ['King Aldric'],
                    witnesses: ['King Aldric'],
                    embedding_b64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=',
                },
                {
                    id: 'event_3',
                    type: 'event',
                    summary: 'Test event 3',
                    importance: 5,
                    tokens: ['test'],
                    message_ids: [2],
                    sequence: 2,
                    characters_involved: ['King Aldric'],
                    witnesses: ['King Aldric'],
                    embedding_b64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=',
                },
            ],
            reflection_state: { 'King Aldric': { importance_sum: 45 } },
            graph: { nodes: {}, edges: {}, _mergeRedirects: {} },
            graph_message_count: 100,
            character_states: {},
        };

        const initialLength = mockDataWithState.memories.length;
        await runPhase2Enrichment(mockDataWithState, getExtractionSettings(), null);

        expect(mockDataWithState.memories.length).toBeGreaterThan(initialLength);
        const reflection = mockDataWithState.memories.find((m) => m.type === 'reflection');
        expect(reflection).toBeDefined();
        expect(reflection.summary).toContain('King Aldric');
    });

    it('returns early if no memories exist', async () => {
        const sendRequest = vi.fn();
        setupTestContext({
            context: mockContext,
            settings: getExtractionSettings(),
            deps: {
                connectionManager: getMockConnectionManager(sendRequest),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        const emptyData = {
            memories: [],
            reflection_state: {},
            graph: { nodes: {}, edges: {} },
        };

        await runPhase2Enrichment(emptyData, getExtractionSettings(), null);

        expect(sendRequest).not.toHaveBeenCalled();
    });
});
