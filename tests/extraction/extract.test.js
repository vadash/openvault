import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, extensionName } from '../../src/constants.js';
import { resetDeps, setDeps } from '../../src/deps.js';

// Mock embeddings
vi.mock('../../src/embeddings.js', () => ({
    enrichEventsWithEmbeddings: vi.fn(async (events) => {
        events.forEach((e) => {
            e.embedding = [0.1, 0.2];
        });
    }),
    isEmbeddingsEnabled: () => true,
    getQueryEmbedding: vi.fn(async () => [0.1, 0.2]),
}));

// Mock LLM to return entities/relationships
vi.mock('../../src/llm.js', () => ({
    callLLM: vi.fn(async (_prompt, config) => {
        if (config?.errorContext === 'Event Extraction') {
            return JSON.stringify({
                reasoning: null,
                events: [
                    { summary: 'King Aldric entered the Castle', importance: 3, characters_involved: ['King Aldric'] },
                ],
            });
        }
        if (config?.errorContext === 'Graph Extraction') {
            return JSON.stringify({
                entities: [
                    { name: 'King Aldric', type: 'PERSON', description: 'The aging ruler' },
                    { name: 'Castle', type: 'PLACE', description: 'An ancient fortress' },
                ],
                relationships: [{ source: 'King Aldric', target: 'Castle', description: 'Rules from' }],
            });
        }
        return JSON.stringify({});
    }),
    LLM_CONFIGS: {
        extraction_events: {
            profileSettingKey: 'extractionProfile',
            maxTokens: 4000,
            errorContext: 'Event Extraction',
            timeoutMs: 120000,
        },
        extraction_graph: {
            profileSettingKey: 'extractionProfile',
            maxTokens: 2000,
            errorContext: 'Graph Extraction',
            timeoutMs: 90000,
        },
    },
}));

// Mock UI
vi.mock('../../src/ui/render.js', () => ({ refreshAllUI: vi.fn() }));
vi.mock('../../src/ui/status.js', () => ({ setStatus: vi.fn() }));

// Mock reflection module
vi.mock('../../src/reflection/reflect.js', () => ({
    accumulateImportance: vi.fn(),
    shouldReflect: vi.fn(() => false),
    generateReflections: vi.fn(async () => []),
}));

import { accumulateImportance, generateReflections, shouldReflect } from '../../src/reflection/reflect.js';

// Mock communities module
vi.mock('../../src/graph/communities.js', () => ({
    detectCommunities: vi.fn(() => null),
    buildCommunityGroups: vi.fn(() => ({})),
    updateCommunitySummaries: vi.fn(async () => ({})),
}));

import { extractMemories, updateCharacterStatesFromEvents } from '../../src/extraction/extract.js';
import { buildCommunityGroups, detectCommunities, updateCommunitySummaries } from '../../src/graph/communities.js';
import { callLLM, LLM_CONFIGS } from '../../src/llm.js';

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

        setDeps({
            getContext: () => mockContext,
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings, enabled: true },
            }),
            saveChatConditional: vi.fn(async () => true),
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            Date: { now: () => 1000000 },
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
        // Use a reference object that initGraphState can modify
        const dataRef = {
            memories: [],
            character_states: {},
            last_processed_message_id: -1,
            processed_message_ids: [],
            graph: { nodes: {}, edges: {} },
            graph_message_count: 0,
            reflection_state: {},
        };

        mockData = dataRef;

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

        setDeps({
            getContext: () => mockContext,
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings, enabled: true },
            }),
            saveChatConditional: vi.fn(async () => true),
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            Date: { now: () => 1000000 },
        });

        vi.clearAllMocks();
    });

    afterEach(() => {
        resetDeps();
    });

    it('calls accumulateImportance after extraction', async () => {
        await extractMemories([0, 1]);
        expect(accumulateImportance).toHaveBeenCalled();
    });

    it('calls generateReflections when shouldReflect returns true', async () => {
        shouldReflect.mockReturnValue(true);
        generateReflections.mockResolvedValue([
            { id: 'ref_1', type: 'reflection', summary: 'Test reflection', importance: 4, character: 'King Aldric' },
        ]);

        await extractMemories([0, 1]);

        expect(generateReflections).toHaveBeenCalled();
    });

    it('resets importance accumulator after generating reflections', async () => {
        shouldReflect.mockReturnValue(true);
        generateReflections.mockResolvedValue([]);

        // Initialize reflection_state with some accumulated importance
        mockData.reflection_state['King Aldric'] = { importance_sum: 30 };

        await extractMemories([0, 1]);

        // Verify the reflection_state for the character was reset
        const charState = mockData.reflection_state?.['King Aldric'];
        expect(charState?.importance_sum).toBe(0);
    });
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

        setDeps({
            getContext: () => mockContext,
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings, enabled: true },
            }),
            saveChatConditional: vi.fn(async () => true),
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            Date: { now: () => 1000000 },
        });

        vi.clearAllMocks();
    });

    afterEach(() => {
        resetDeps();
    });

    it('triggers community detection when graph_message_count reaches multiple of 50', async () => {
        // Set graph_message_count to 49 - processing 2 messages will reach 51
        mockData.graph_message_count = 49;
        detectCommunities.mockReturnValue({ communities: { a: 0, b: 0 }, count: 1 });
        buildCommunityGroups.mockReturnValue({ 0: { nodeKeys: ['a', 'b'], nodeLines: [], edgeLines: [] } });
        updateCommunitySummaries.mockResolvedValue({ C0: { title: 'Test Community' } });

        await extractMemories([0, 1]);

        expect(detectCommunities).toHaveBeenCalledWith(mockData.graph);
        expect(buildCommunityGroups).toHaveBeenCalled();
        expect(updateCommunitySummaries).toHaveBeenCalled();
    });

    it('does not trigger community detection when below threshold', async () => {
        mockData.graph_message_count = 10;

        await extractMemories([0, 1]);

        expect(detectCommunities).not.toHaveBeenCalled();
        expect(buildCommunityGroups).not.toHaveBeenCalled();
        expect(updateCommunitySummaries).not.toHaveBeenCalled();
    });

    it('does not trigger community detection when at exactly 50 but not crossing boundary', async () => {
        mockData.graph_message_count = 50;

        await extractMemories([0, 1]);

        // At 50, after adding 2 messages we'd be at 52, which is still in the same 50-message bucket
        expect(detectCommunities).not.toHaveBeenCalled();
    });

    it('handles community detection errors gracefully', async () => {
        mockData.graph_message_count = 49;
        detectCommunities.mockImplementation(() => {
            throw new Error('Detection failed');
        });

        const result = await extractMemories([0, 1]);

        // Should still complete extraction successfully
        expect(result.status).toBe('success');
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

import { cleanupCharacterStates } from '../../src/extraction/extract.js';

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

describe('two-stage extraction pipeline', () => {
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

        setDeps({
            getContext: () => mockContext,
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings, enabled: true },
            }),
            saveChatConditional: vi.fn(async () => true),
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            Date: { now: () => 1000000 },
        });

        // callLLM mock is already set up at module level with config-based dispatch
        callLLM.mockClear();
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('calls callLLM twice: once for events, once for graph', async () => {
        await extractMemories([0, 1]);
        expect(callLLM).toHaveBeenCalledTimes(2);
    });

    it('first call uses extraction_events config', async () => {
        await extractMemories([0, 1]);
        expect(callLLM.mock.calls[0][1]).toBe(LLM_CONFIGS.extraction_events);
    });

    it('second call uses extraction_graph config', async () => {
        await extractMemories([0, 1]);
        expect(callLLM.mock.calls[1][1]).toBe(LLM_CONFIGS.extraction_graph);
    });
});

describe('filterSimilarEvents - intra-batch Jaccard dedup', () => {
    it('deduplicates semantically similar events within the same batch using Jaccard similarity', async () => {
        // These have identical meaning but different phrasing — cosine on short embeddings may miss them
        // Text chosen to have >60% token overlap after stopword filtering
        const newEvents = [
            { summary: 'Suzy proposed daily morning training sessions for Vova starting at seven', embedding: [0.9, 0.1] },
            { summary: 'Suzy proposed daily morning training sessions with warmup drills for Vova', embedding: [0.1, 0.9] },
            { summary: 'Vova went to the store to buy groceries', embedding: [0.5, 0.5] },
        ];
        const existingMemories = [];
        // With orthogonal embeddings (cosine ~0), the cosine check won't catch them.
        // But Jaccard on tokens should catch the overlap: suzy/proposed/daily/morning/training/sessions/vova = 7 shared tokens
        const { filterSimilarEvents } = await import('../../src/extraction/extract.js');
        const result = filterSimilarEvents(newEvents, existingMemories, 0.85, 0.6);
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
        const { filterSimilarEvents } = await import('../../src/extraction/extract.js');
        const result = filterSimilarEvents(newEvents, [], 0.85, 0.6);
        expect(result).toHaveLength(2);
    });
});
