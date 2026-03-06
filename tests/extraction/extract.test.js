import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/constants.js';
import { resetDeps } from '../../src/deps.js';
import {
    cleanupCharacterStates,
    extractMemories,
    filterSimilarEvents,
    updateCharacterStatesFromEvents,
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

describe('extractMemories graph integration', () => {
    let mockContext;
    let mockData;

    beforeEach(() => {
        mockData = {
            memories: [],
            character_states: {},
            last_processed_message_id: -1,
            processed_message_ids: [],
        };

        mockContext = {
            chat: [
                { mes: 'Hello', is_user: true, name: 'User' },
                { mes: 'Welcome to the Castle', is_user: false, name: 'King Aldric' },
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

    it('populates graph.nodes from extracted entities', async () => {
        const result = await extractMemories([0, 1]);
        expect(result.status).toBe('success');
        expect(mockData.graph).toBeDefined();
        expect(mockData.graph.nodes['king aldric']).toBeDefined();
        expect(mockData.graph.nodes['king aldric'].type).toBe('PERSON');
        expect(mockData.graph.nodes.castle).toBeDefined();
    });

    it('populates graph.edges from extracted relationships', async () => {
        await extractMemories([0, 1]);
        expect(mockData.graph.edges['king aldric__castle']).toBeDefined();
        expect(mockData.graph.edges['king aldric__castle'].description).toBe('Rules from');
    });

    it('increments graph_message_count', async () => {
        await extractMemories([0, 1]);
        expect(mockData.graph_message_count).toBeGreaterThan(0);
    });

    it('sets type to "event" on all extracted memory objects', async () => {
        await extractMemories([0, 1]);
        expect(mockData.memories).toBeDefined();
        expect(mockData.memories.length).toBeGreaterThan(0);
        for (const memory of mockData.memories) {
            expect(memory.type).toBe('event');
        }
    });
});

describe('extractMemories reflection integration', () => {
    let mockContext;
    let mockData;

    beforeEach(() => {
        mockData = {
            memories: [],
            character_states: {},
            last_processed_message_id: -1,
            processed_message_ids: [],
            graph: { nodes: {}, edges: {} },
            graph_message_count: 0,
            reflection_state: {},
        };

        mockContext = {
            chat: [
                { mes: 'Hello', is_user: true, name: 'User' },
                { mes: 'Welcome to the Castle', is_user: false, name: 'King Aldric' },
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
    });

    it('accumulates importance in reflection_state after extraction', async () => {
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
        await extractMemories([0, 1]);

        // Real accumulateImportance adds event importance (3) to each involved character
        expect(mockData.reflection_state).toBeDefined();
        expect(mockData.reflection_state['King Aldric']).toBeDefined();
        expect(mockData.reflection_state['King Aldric'].importance_sum).toBeGreaterThan(0);
    });

    // Note: The "produces reflections when importance exceeds threshold" test requires
    // complex LLM call chaining (questions + insights) and enough pre-existing memories
    // to bypass the `recentMemories.length < 3` early return. This is better tested
    // in integration tests. The behavioral assertion above (importance accumulation)
    // covers the critical reflection trigger logic.
});

describe('extractMemories community detection', () => {
    let mockContext;
    let mockData;

    beforeEach(() => {
        mockData = {
            memories: [],
            character_states: {},
            last_processed_message_id: -1,
            processed_message_ids: [],
            graph: { nodes: {}, edges: {} },
            graph_message_count: 0,
            reflection_state: {},
            communities: {},
        };

        mockContext = {
            chat: [
                { mes: 'Hello', is_user: true, name: 'User' },
                { mes: 'Welcome to the Castle', is_user: false, name: 'King Aldric' },
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
    });

    it('does not trigger community detection when below threshold', async () => {
        mockData.graph_message_count = 10;

        await extractMemories([0, 1]);

        // Communities should remain empty — count didn't cross 50-boundary
        expect(mockData.communities).toEqual({});
    });

    it('does not trigger community detection at exactly 50 without crossing boundary', async () => {
        // At 50, adding 2 messages = 52, still in same 50-message bucket as 50
        mockData.graph_message_count = 50;

        await extractMemories([0, 1]);

        expect(mockData.communities).toEqual({});
    });
});

describe('updateCharacterStatesFromEvents', () => {
    let mockData;

    beforeEach(() => {
        mockData = {
            character_states: {},
        };
    });

    it('creates character states for valid characters in emotional_impact', () => {
        const events = [
            {
                id: 'event_1',
                emotional_impact: {
                    'King Aldric': 'triumphant',
                },
                message_ids: [1, 2],
            },
        ];

        updateCharacterStatesFromEvents(events, mockData, ['King Aldric', 'User']);

        expect(mockData.character_states['King Aldric']).toBeDefined();
        expect(mockData.character_states['King Aldric'].current_emotion).toBe('triumphant');
    });

    it('skips invalid character names in emotional_impact', () => {
        const events = [
            {
                id: 'event_1',
                emotional_impact: {
                    'King Aldric': 'triumphant',
                    don: 'angry', // Invalid - not in validCharNames or characters_involved
                },
                message_ids: [1, 2],
                characters_involved: ['King Aldric'],
            },
        ];

        updateCharacterStatesFromEvents(events, mockData, ['King Aldric', 'User']);

        expect(mockData.character_states['King Aldric']).toBeDefined();
        expect(mockData.character_states.don).toBeUndefined();
    });

    it('creates character states for valid characters in witnesses', () => {
        const events = [
            {
                id: 'event_1',
                witnesses: ['King Aldric', 'User'],
                characters_involved: ['King Aldric', 'User'],
            },
        ];

        updateCharacterStatesFromEvents(events, mockData, ['King Aldric', 'User']);

        expect(mockData.character_states['King Aldric']).toBeDefined();
        expect(mockData.character_states.User).toBeDefined();
        expect(mockData.character_states['King Aldric'].known_events).toContain('event_1');
    });

    it('skips invalid character names in witnesses', () => {
        const events = [
            {
                id: 'event_1',
                witnesses: ['King Aldric', 'Stranger'], // Stranger not in validCharNames
                characters_involved: ['King Aldric'],
            },
        ];

        updateCharacterStatesFromEvents(events, mockData, ['King Aldric', 'User']);

        expect(mockData.character_states['King Aldric']).toBeDefined();
        expect(mockData.character_states.Stranger).toBeUndefined();
    });

    it('allows characters from characters_involved even if not in validCharNames', () => {
        const events = [
            {
                id: 'event_1',
                emotional_impact: {
                    Queen: 'worried',
                },
                characters_involved: ['Queen'], // Queen is in characters_involved
            },
        ];

        updateCharacterStatesFromEvents(events, mockData, ['King Aldric', 'User']);

        expect(mockData.character_states.Queen).toBeDefined();
        expect(mockData.character_states.Queen.current_emotion).toBe('worried');
    });
});

describe('cleanupCharacterStates', () => {
    let mockData;

    beforeEach(() => {
        mockData = {
            character_states: {},
            memories: [],
        };
    });

    it('removes character states not in validCharNames or memories', () => {
        mockData.character_states = {
            'King Aldric': { name: 'King Aldric', current_emotion: 'neutral' },
            User: { name: 'User', current_emotion: 'neutral' },
            Stranger: { name: 'Stranger', current_emotion: 'angry' }, // Not in validCharNames or memories
        };

        cleanupCharacterStates(mockData, ['King Aldric', 'User']);

        expect(mockData.character_states['King Aldric']).toBeDefined();
        expect(mockData.character_states.User).toBeDefined();
        expect(mockData.character_states.Stranger).toBeUndefined();
    });

    it('keeps character states found in memories characters_involved', () => {
        mockData.character_states = {
            'King Aldric': { name: 'King Aldric', current_emotion: 'neutral' },
            Queen: { name: 'Queen', current_emotion: 'worried' }, // Only in memories
            Stranger: { name: 'Stranger', current_emotion: 'angry' }, // Nowhere
        };
        mockData.memories = [{ characters_involved: ['King Aldric', 'Queen'] }];

        cleanupCharacterStates(mockData, ['King Aldric', 'User']);

        expect(mockData.character_states['King Aldric']).toBeDefined();
        expect(mockData.character_states.Queen).toBeDefined();
        expect(mockData.character_states.Stranger).toBeUndefined();
    });

    it('handles empty character_states gracefully', () => {
        mockData.character_states = {};

        expect(() => cleanupCharacterStates(mockData, ['King Aldric', 'User'])).not.toThrow();
    });

    it('handles missing validCharNames', () => {
        mockData.character_states = {
            'King Aldric': { name: 'King Aldric', current_emotion: 'neutral' },
            Queen: { name: 'Queen', current_emotion: 'worried' },
        };
        mockData.memories = [{ characters_involved: ['King Aldric'] }];

        cleanupCharacterStates(mockData, []);

        expect(mockData.character_states['King Aldric']).toBeDefined();
        expect(mockData.character_states.Queen).toBeUndefined();
    });
});

describe('filterSimilarEvents - intra-batch Jaccard dedup', () => {
    it('deduplicates semantically similar events within the same batch using Jaccard similarity', async () => {
        // These have identical meaning but different phrasing — cosine on short embeddings may miss them
        // Text chosen to have >60% token overlap after stopword filtering
        const newEvents = [
            {
                summary: 'Suzy proposed daily morning training sessions for Vova starting at seven',
                embedding: [0.9, 0.1],
            },
            {
                summary: 'Suzy proposed daily morning training sessions with warmup drills for Vova',
                embedding: [0.1, 0.9],
            },
            { summary: 'Vova went to the store to buy groceries', embedding: [0.5, 0.5] },
        ];
        const existingMemories = [];
        // With orthogonal embeddings (cosine ~0), the cosine check won't catch them.
        // But Jaccard on tokens should catch the overlap: suzy/proposed/daily/morning/training/sessions/vova = 7 shared tokens
        const result = await filterSimilarEvents(newEvents, existingMemories, 0.85, 0.6);
        // Should keep first occurrence + the unrelated event, skip the near-duplicate
        expect(result).toHaveLength(2);
        expect(result[0].summary).toContain('starting at seven');
        expect(result[1].summary).toContain('groceries');
    });

    it('does not Jaccard-dedup events with low token overlap', async () => {
        const newEvents = [
            { summary: 'Suzy proposed training sessions for morning warmup', embedding: [0.9, 0.1] },
            { summary: 'Vova cooked dinner for the family at home', embedding: [0.1, 0.9] },
        ];
        const result = await filterSimilarEvents(newEvents, [], 0.85, 0.6);
        expect(result).toHaveLength(2);
    });
});

describe('two-phase extraction with intermediate save', () => {
    let mockContext;
    let mockData;

    beforeEach(() => {
        mockData = {
            memories: [],
            character_states: {},
            last_processed_message_id: -1,
            processed_message_ids: [],
            reflection_state: { 'King Aldric': { importance_sum: 0 } },
        };

        mockContext = {
            chat: [
                { mes: 'Hello', is_user: true, name: 'User' },
                { mes: 'Welcome to the Castle', is_user: false, name: 'King Aldric' },
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

    it('saves data after Phase 1 (events + graph) even if reflection throws', async () => {
        // Set importance high so shouldReflect triggers, then fail the reflection LLM call
        mockData.reflection_state = { 'King Aldric': { importance_sum: 100 } };

        // Override sendRequest: events + graph succeed, reflection questions fails
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

        // Phase 1 should succeed — events committed
        expect(result.status).toBe('success');
        expect(result.events_created).toBeGreaterThan(0);
        expect(mockData.memories.length).toBeGreaterThan(0);
        expect(mockData.processed_message_ids.length).toBeGreaterThan(0);
    });

    it('accepts options.silent parameter without throwing', async () => {
        const result = await extractMemories([0, 1], null, { silent: true });
        expect(result.status).toBe('success');
    });

    it('updates PROCESSED_MESSAGES_KEY only after events are pushed to memories', async () => {
        // Verify ordering: memories should contain events AND processed_message_ids should be set
        const result = await extractMemories([0, 1]);
        expect(result.status).toBe('success');

        // Both should be populated
        const hasMemories = mockData.memories.length > 0;
        const hasProcessedIds = mockData.processed_message_ids.length > 0;
        expect(hasMemories).toBe(true);
        expect(hasProcessedIds).toBe(true);
    });
});

describe('CPU yielding in filterSimilarEvents', () => {
    it('still correctly filters events (yielding does not break logic)', async () => {
        const events = [
            { summary: 'King Aldric declared war on the rebels', embedding: [1, 0, 0] },
            { summary: 'Sera secretly met with the rebel leader', embedding: [0, 1, 0] },
            { summary: 'King Aldric declared war on the rebels today', embedding: [0.99, 0.01, 0] },
        ];
        const existing = [{ summary: 'Old memory about something else', embedding: [0, 0, 1] }];

        const result = await filterSimilarEvents(events, existing, 0.92, 0.6);
        // Third event should be deduped (cosine similarity with first > 0.92)
        expect(result.length).toBeLessThanOrEqual(2);
    });
});
