import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/constants.js';
import { resetDeps } from '../../src/deps.js';
import {
    extractAllMessages,
    extractMemories,
    runPhase2Enrichment,
    synthesizeReflections,
    updateIDFCache,
} from '../../src/extraction/extract.js';

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
            schema_version: 2,
            memories: [],
            character_states: {},
            processed_message_ids: [],
            graph: { nodes: {}, edges: {} },
            communities: {},
            reflection_state: {},
            graph_message_count: 0,
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

        // Set up context metadata with test data so repository methods work correctly
        mockContext.chatMetadata = { openvault: mockDataWithState };

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

// ── extractAllMessages Emergency Cut support ──

describe('extractAllMessages Emergency Cut support', () => {
    let mockContext;

    beforeEach(() => {
        mockContext = {
            chat: [
                { mes: 'test message one', is_user: true, name: 'User', send_date: '1' },
                { mes: 'test message two', is_user: false, name: 'Char', send_date: '2' },
                { mes: 'test message three', is_user: true, name: 'User', send_date: '3' },
                { mes: 'test message four', is_user: false, name: 'Char', send_date: '4' },
            ],
            name1: 'User',
            name2: 'Char',
            chatId: 'test-chat',
            powerUserSettings: {},
        };
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('throws AbortError when signal is aborted during batch loop', async () => {
        const controller = new AbortController();

        setupTestContext({
            context: mockContext,
            settings: { ...getExtractionSettings(), extractionTokenBudget: 100 },
            deps: {
                connectionManager: getMockConnectionManager(mockSendRequest()),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        // Abort immediately - should throw AbortError
        controller.abort();

        await expect(
            extractAllMessages({
                isEmergencyCut: true,
                abortSignal: controller.signal,
            })
        ).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }));
    });
});

// ── synthesizeReflections accumulator reset (bugfix tests) ──

// Mock the reflection module to control generateReflections
// Default implementation passes through to original for other tests
vi.mock('../../src/reflection/reflect.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        generateReflections: vi.fn().mockImplementation(actual.generateReflections),
    };
});

import { generateReflections } from '../../src/reflection/reflect.js';

describe('synthesizeReflections accumulator reset', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        generateReflections.mockReset();
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('should reset importance_sum even when LLM fails', async () => {
        const data = {
            reflection_state: {
                TestCharacter: { importance_sum: 45 },
            },
            memories: [],
            characters: {},
        };
        const settings = {
            reflectionThreshold: 40,
            maxConcurrency: 1,
        };

        // Mock generateReflections to fail
        generateReflections.mockRejectedValue(new Error('LLM timeout'));

        // Mock setupTestContext to provide deps
        setupTestContext({
            context: {
                chat: [],
                chatMetadata: { openvault: data },
            },
            settings: { ...getExtractionSettings(), reflectionThreshold: 40 },
            deps: {
                connectionManager: getMockConnectionManager(vi.fn()),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        // Spy on console.error to suppress error output
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await synthesizeReflections(data, ['TestCharacter'], settings);

        // importance_sum should be reset even though LLM failed
        expect(data.reflection_state.TestCharacter.importance_sum).toBe(0);
    });

    it('should not retry failed reflection on next call', async () => {
        const data = {
            reflection_state: {
                TestCharacter: { importance_sum: 45 },
            },
            memories: [],
            characters: {},
        };
        const settings = {
            reflectionThreshold: 40,
            maxConcurrency: 1,
        };

        // Mock generateReflections to fail
        generateReflections.mockRejectedValue(new Error('LLM timeout'));

        setupTestContext({
            context: {
                chat: [],
                chatMetadata: { openvault: data },
            },
            settings: { ...getExtractionSettings(), reflectionThreshold: 40 },
            deps: {
                connectionManager: getMockConnectionManager(vi.fn()),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        vi.spyOn(console, 'error').mockImplementation(() => {});

        // First call - should attempt reflection and fail
        await synthesizeReflections(data, ['TestCharacter'], settings);
        expect(generateReflections).toHaveBeenCalledTimes(1);

        // Second call - importance_sum is now 0, should NOT attempt reflection
        await synthesizeReflections(data, ['TestCharacter'], settings);
        expect(generateReflections).toHaveBeenCalledTimes(1); // Still 1, not 2
    });
});

// ── updateIDFCache — archived memories (bugfix tests) ──

describe('updateIDFCache — archived memories', () => {
    it('counts only active memories, excluding archived', async () => {
        const data = {
            memories: [
                { id: 'm1', summary: 'Active memory one', tokens: ['active', 'memory', 'one'] },
                { id: 'm2', summary: 'Active memory two', tokens: ['active', 'memory', 'two'] },
                { id: 'm3', summary: 'Archived memory', tokens: ['archived', 'memory'], archived: true },
                { id: 'm4', summary: 'Another archived', tokens: ['another', 'archived'], archived: true },
            ],
        };

        updateIDFCache(data);

        // Should count 2 active memories, NOT 4 total
        expect(data.idf_cache.memoryCount).toBe(2);
    });

    it('produces cache that validates against active-only corpus', async () => {
        const data = {
            memories: [
                { id: 'm1', summary: 'Active one', tokens: ['active', 'one'] },
                { id: 'm2', summary: 'Active two', tokens: ['active', 'two'] },
                { id: 'm3', summary: 'Archived', tokens: ['archived'], archived: true },
            ],
        };

        updateIDFCache(data);

        // Simulate what scoreMemories validates:
        // activeMemories = memories.filter(m => !m.archived) → length = 2
        // hiddenMemories = [] → length = 0
        // totalCorpusSize = 2
        // cacheValid = idfCache.memoryCount === totalCorpusSize
        expect(data.idf_cache.memoryCount).toBe(2);
    });
});

// ── graph extraction with zero events (bugfix tests) ──

describe('graph extraction with zero events', () => {
    let mockContext;
    let mockData;

    beforeEach(() => {
        mockData = {
            schema_version: 2,
            memories: [],
            character_states: {},
            processed_message_ids: [],
            graph: { nodes: {}, edges: {} },
            communities: {},
            reflection_state: {},
            graph_message_count: 0,
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
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('runs graph extraction even when zero events are extracted', async () => {
        const zeroEventsResponse = JSON.stringify({
            reasoning: null,
            events: [],
        });

        const graphResponse = JSON.stringify({
            entities: [{ name: 'Shadow Guild', type: 'ORGANIZATION', description: 'A secret thieves guild' }],
            relationships: [],
        });

        const sendRequest = vi
            .fn()
            .mockResolvedValueOnce({ content: zeroEventsResponse })
            .mockResolvedValueOnce({ content: graphResponse });

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

        const _result = await extractMemories([0, 1]);

        // Graph extraction should have been called (2 LLM calls, not 1)
        expect(sendRequest).toHaveBeenCalledTimes(2);

        // Entity should exist in the graph
        expect(mockData.graph.nodes['shadow guild']).toBeDefined();
        expect(mockData.graph.nodes['shadow guild'].type).toBe('ORGANIZATION');
    });
});
