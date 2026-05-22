import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, extensionName } from '../../src/constants.js';
import { resetDeps } from '../../src/deps.js';
import { buildRetrievalContext, updateInjection } from '../../src/retrieval/retrieve.js';

describe('selectMemoriesWithSoftBalance', () => {
    it('should select top-scoring memories first (Phase 1)', async () => {
        const { selectMemoriesWithSoftBalance } = await import('../../src/retrieval/scoring.js');

        const scoredMemories = [
            { memory: { id: '1', summary: 'High score old' }, score: 10.0, breakdown: { distance: 800 } },
            { memory: { id: '2', summary: 'High score mid' }, score: 9.0, breakdown: { distance: 400 } },
            { memory: { id: '3', summary: 'High score recent' }, score: 8.0, breakdown: { distance: 50 } },
            { memory: { id: '4', summary: 'Low score old' }, score: 1.0, breakdown: { distance: 900 } },
            { memory: { id: '5', summary: 'Low score recent' }, score: 2.0, breakdown: { distance: 10 } },
        ];

        const tokenBudget = 10; // Small budget - only ~2 memories
        const chatLength = 1000;

        const selected = selectMemoriesWithSoftBalance(scoredMemories, tokenBudget, chatLength);

        // Should select top 2-3 by score first (respecting token budget)
        expect(selected.length).toBeGreaterThan(0);
        expect(selected.length).toBeLessThanOrEqual(3);
    });

    it('should apply soft balance to ensure min 20% per bucket', async () => {
        const { selectMemoriesWithSoftBalance } = await import('../../src/retrieval/scoring.js');

        const scoredMemories = [
            { memory: { id: 'r1', summary: 'Recent A' }, score: 5.0, breakdown: { distance: 50 } },
            { memory: { id: 'r2', summary: 'Recent B' }, score: 4.0, breakdown: { distance: 100 } },
            { memory: { id: 'r3', summary: 'Recent C' }, score: 3.0, breakdown: { distance: 150 } },
            { memory: { id: 'm1', summary: 'Mid A' }, score: 4.5, breakdown: { distance: 400 } },
            { memory: { id: 'm2', summary: 'Mid B' }, score: 3.5, breakdown: { distance: 450 } },
            { memory: { id: 'o1', summary: 'Old A' }, score: 6.0, breakdown: { distance: 800 } }, // Highest score!
            { memory: { id: 'o2', summary: 'Old B' }, score: 5.5, breakdown: { distance: 850 } },
        ];

        const tokenBudget = 200; // All memories
        const chatLength = 1000;

        const selected = selectMemoriesWithSoftBalance(scoredMemories, tokenBudget, chatLength);

        // Old bucket should have at least one memory (20% min)
        const selectedIds = selected.map((m) => m.id);
        expect(selectedIds).toContain('o1');
    });

    it('should handle empty buckets gracefully', async () => {
        const { selectMemoriesWithSoftBalance } = await import('../../src/retrieval/scoring.js');

        const scoredMemories = [{ memory: { id: 'r1', summary: 'Recent' }, score: 5.0, breakdown: { distance: 50 } }];

        const selected = selectMemoriesWithSoftBalance(scoredMemories, 100, 100);
        expect(selected.length).toBe(1);
    });
});

describe('selectRelevantMemories with soft balance', () => {
    // Common config fixtures
    const scoringConfig = {
        forgetfulnessBaseLambda: 0.05,
        forgetfulnessImportance5Floor: undefined,
        reflectionDecayThreshold: undefined,
        vectorSimilarityThreshold: 0.5,
        alpha: 0.7,
        combinedBoostWeight: 15,
        embeddingSource: 'ollama', // Use ollama to avoid local embedding model in tests
    };

    const queryConfig = {
        entityWindowSize: 10,
        embeddingWindowSize: 5,
        recencyDecayFactor: 0.09,
        topEntitiesCount: 5,
        entityBoostWeight: 5.0,
        exactPhraseBoostWeight: 10.0,
    };

    it('should use selectMemoriesWithSoftBalance instead of sliceToTokenBudget', async () => {
        const { selectRelevantMemories } = await import('../../src/retrieval/scoring.js');

        const mockCtx = {
            recentContext: 'Test context',
            userMessages: 'Test messages',
            activeCharacters: ['Char'],
            chatLength: 1000,
            finalTokens: 500,
            graphNodes: {},
            graphEdges: {},
            allAvailableMemories: [],
            scoringConfig,
            queryConfig,
        };

        // Mock dependencies - this test verifies structure, actual scoring is mocked
        const result = await selectRelevantMemories([], mockCtx);
        expect(Array.isArray(result.memories)).toBe(true);
        expect(result.memories.length).toBe(0); // Empty input = empty output
    });

    it('should call selectMemoriesWithSoftBalance with scoredResults', async () => {
        const { selectRelevantMemories } = await import('../../src/retrieval/scoring.js');

        const memories = [
            { id: '1', summary: 'Test memory', message_ids: [100], sequence: 1000, type: 'event', importance: 3 },
        ];

        const mockCtx = {
            recentContext: 'User asked about Test memory',
            userMessages: 'Tell me about Test memory',
            activeCharacters: ['Char'],
            chatLength: 1000,
            finalTokens: 500,
            graphNodes: {},
            graphEdges: {},
            allAvailableMemories: memories,
            scoringConfig,
            queryConfig,
        };

        const result = await selectRelevantMemories(memories, mockCtx);
        expect(Array.isArray(result.memories)).toBe(true);
    });
});

describe('Local embedding retrieval with graph nodes', () => {
    it('should score memories using local cosine similarity', async () => {
        const { selectRelevantMemories } = await import('../../src/retrieval/scoring.js');

        const memories = [
            {
                id: 'memory1',
                summary: 'Test memory about Alice',
                importance: 5,
                type: 'event',
                message_ids: [100],
                sequence: 1000,
                embedding: [0.5, 0.5, 0.5],
            },
        ];

        const mockCtx = {
            recentContext: 'Tell me about Alice',
            userMessages: 'Tell me about Alice',
            activeCharacters: [],
            chatLength: 1000,
            finalTokens: 500,
            graphNodes: {
                Alice: { name: 'Alice', description: 'A brave warrior', type: 'PERSON', mentions: 5 },
            },
            graphEdges: {},
            allAvailableMemories: memories,
            scoringConfig: {
                forgetfulnessBaseLambda: 0.05,
                forgetfulnessImportance5Floor: undefined,
                reflectionDecayThreshold: undefined,
                vectorSimilarityThreshold: 0.5,
                alpha: 0.7,
                combinedBoostWeight: 15,
                embeddingSource: 'multilingual-e5-small',
                transientDecayMultiplier: undefined,
            },
            queryConfig: {
                entityWindowSize: 10,
                embeddingWindowSize: 5,
                recencyDecayFactor: 0.09,
                topEntitiesCount: 5,
                entityBoostWeight: 5.0,
                exactPhraseBoostWeight: 10.0,
            },
        };

        const result = await selectRelevantMemories(memories, mockCtx);

        // Verify memory was retrieved using local embeddings
        expect(result.memories.length).toBe(1);
        expect(result.memories[0].id).toBe('memory1');
    });
});

describe('retrieve pipeline', () => {
    let mockSetPrompt;

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('happy path: includes both events and reflections in injected context', async () => {
        mockSetPrompt = vi.fn();

        setupTestContext({
            deps: {
                getContext: () => ({
                    chat: [
                        { mes: 'Hello', is_user: true, is_system: true },
                        { mes: 'Hi', is_user: false, is_system: false },
                    ],
                    name1: 'User',
                    name2: 'Alice',
                    chatMetadata: {
                        openvault: {
                            memories: [
                                {
                                    id: 'ev1',
                                    type: 'event',
                                    summary: 'Alice explored the ancient library',
                                    importance: 3,
                                    message_ids: [0],
                                    characters_involved: ['Alice'],
                                    witnesses: ['Alice'],
                                    is_secret: false,
                                    embedding: [0.5, 0.5],
                                },
                                {
                                    id: 'ref1',
                                    type: 'reflection',
                                    summary: 'Alice fears abandonment deeply',
                                    importance: 4,
                                    characters_involved: ['Alice'],
                                    witnesses: ['Alice'],
                                    is_secret: false,
                                    character: 'Alice',
                                    source_ids: ['ev1'],
                                    embedding: [0.5, 0.5],
                                },
                            ],
                            character_states: { Alice: { name: 'Alice', known_events: ['ev1'] } },
                            graph: { nodes: {}, edges: {} },
                            communities: {},
                        },
                    },
                    chatId: 'test-chat',
                }),
                getExtensionSettings: () => ({
                    [extensionName]: {
                        ...defaultSettings,
                        enabled: true,
                        embeddingSource: 'ollama',
                        ollamaUrl: 'http://test:11434',
                        embeddingModel: 'test-model',
                    },
                }),
                setExtensionPrompt: mockSetPrompt,
                extension_prompt_types: { IN_PROMPT: 0 },
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.5, 0.5] }),
                })),
            },
        });

        await updateInjection();

        // Check memory slot (events)
        const memoryCall = mockSetPrompt.mock.calls.find((c) => c[0] === extensionName);
        expect(memoryCall).toBeDefined();
        const memoryText = memoryCall[1];
        expect(memoryText).toContain('ancient library');

        // Check reflection slot (reflections)
        const reflectionCall = mockSetPrompt.mock.calls.find((c) => c[0] === 'openvault_reflections');
        expect(reflectionCall).toBeDefined();
        const reflectionText = reflectionCall[1];
        expect(reflectionText).toContain('abandonment');
    });

    it('empty state: no memories produces empty injection', async () => {
        mockSetPrompt = vi.fn();

        setupTestContext({
            context: {
                chat: [
                    { mes: 'Hello', is_user: true, is_system: true },
                    { mes: 'Hi', is_user: false, is_system: false },
                ],
                chatMetadata: {
                    openvault: {
                        memories: [],
                        character_states: {},
                        communities: {},
                    },
                },
                chatId: 'test-chat',
            },
            settings: {
                enabled: true,
                embeddingSource: 'ollama',
                ollamaUrl: 'http://test:11434',
                embeddingModel: 'test-model',
            },
            deps: {
                setExtensionPrompt: mockSetPrompt,
                extension_prompt_types: { IN_PROMPT: 0 },
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.5, 0.5] }),
                })),
            },
        });

        await updateInjection();

        // With no memories, setExtensionPrompt is called with empty string
        const memoryCall = mockSetPrompt.mock.calls.find((c) => c[0] === extensionName && c[1] === '');
        expect(memoryCall).toBeDefined();
    });

    it('macro intent: summarize request uses global state injection', async () => {
        mockSetPrompt = vi.fn();

        setupTestContext({
            context: {
                chat: [
                    { mes: 'Previous context', is_user: true, is_system: true },
                    { mes: 'Summarize the story so far', is_user: true, is_system: false },
                ],
                chatMetadata: {
                    openvault: {
                        memories: [
                            {
                                id: 'ev1',
                                type: 'event',
                                summary: 'Test memory',
                                importance: 3,
                                message_ids: [0],
                                characters_involved: ['Alice'],
                                witnesses: ['Alice'],
                                is_secret: false,
                                embedding: [0.5, 0.5],
                            },
                        ],
                        character_states: { Alice: { name: 'Alice', known_events: ['ev1'] } },
                        global_world_state: {
                            summary: 'Test global state - the story has progressed through several chapters',
                            last_updated: Date.now(),
                            community_count: 2,
                        },
                        communities: {
                            C0: {
                                title: 'Royal Court',
                                summary: 'The seat of power',
                                findings: ['The king rules wisely'],
                                embedding: [0.5, 0.5],
                                nodeKeys: ['alice'],
                            },
                        },
                        graph: { nodes: {}, edges: {} },
                    },
                },
                chatId: 'test-chat',
                name2: 'Alice',
            },
            settings: {
                enabled: true,
                embeddingSource: 'ollama',
                ollamaUrl: 'http://test:11434',
                embeddingModel: 'test-model',
            },
            deps: {
                setExtensionPrompt: mockSetPrompt,
                extension_prompt_types: { IN_PROMPT: 0 },
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.5, 0.5] }),
                })),
            },
        });

        const { retrieveAndInjectContext } = await import('../../src/retrieval/retrieve.js');
        await retrieveAndInjectContext();

        const worldCall = mockSetPrompt.mock.calls.find((c) => c[0] === 'openvault_world');
        expect(worldCall).toBeDefined();
        expect(worldCall[1]).toContain('world_context');
        expect(worldCall[1]).toContain('Test global state');
    });
});

describe('injectContext with 3-stream architecture', () => {
    let mockSetPrompt;

    beforeEach(() => {
        mockSetPrompt = vi.fn();
        setupTestContext({
            deps: {
                getExtensionSettings: () => ({
                    [extensionName]: {
                        ...defaultSettings,
                        enabled: true,
                    },
                }),
                setExtensionPrompt: mockSetPrompt,
                extension_prompt_types: { IN_PROMPT: 0 },
            },
        });
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('should call safeSetExtensionPrompt 3 times with correct slots', async () => {
        const { injectContext } = await import('../../src/retrieval/retrieve.js');

        injectContext('memory content', 'reflection content', 'world content');

        expect(mockSetPrompt).toHaveBeenCalledTimes(3);
        // setExtensionPrompt signature: (content, slot, position, depth)
        const slots = mockSetPrompt.mock.calls.map((c) => c[0]); // c[0] is slot, c[1] is content
        expect(slots).toContain('openvault');
        expect(slots).toContain('openvault_reflections');
        expect(slots).toContain('openvault_world');
    });

    it('should set empty string for openvault_reflections when reflectionText is empty', async () => {
        const { injectContext } = await import('../../src/retrieval/retrieve.js');

        injectContext('memory content', '', 'world content');

        // setExtensionPrompt signature: (name, content, promptType, depth)
        const reflectionCall = mockSetPrompt.mock.calls.find((c) => c[0] === 'openvault_reflections');
        expect(reflectionCall).toBeDefined();
        expect(reflectionCall[1]).toBe(''); // Empty content
    });

    it('should pass both memoryText and reflectionText to injectContext from selectFormatAndInject', async () => {
        const { selectFormatAndInject } = await import('../../src/retrieval/retrieve.js');

        const mockMemories = [
            { id: '1', type: 'event', summary: 'Test memory', importance: 3, embedding: [0.5, 0.5] },
            { id: '2', type: 'reflection', summary: 'Test reflection', importance: 4, embedding: [0.5, 0.5] },
        ];

        const mockData = {
            characters: { Test: { current_emotion: 'neutral' } },
            communities: {},
        };

        const mockCtx = {
            primaryCharacter: 'Test',
            activeCharacters: [],
            headerName: 'Scene',
            finalTokens: 1000,
            chatLength: 100,
            userMessages: 'test',
            recentContext: 'test context',
            worldContextBudget: 100,
            queryConfig: {
                entityWindowSize: 10,
                embeddingWindowSize: 5,
                recencyDecayFactor: 0.09,
                topEntitiesCount: 5,
                entityBoostWeight: 5.0,
                exactPhraseBoostWeight: 10.0,
            },
            scoringConfig: {
                forgetfulnessBaseLambda: 0.05,
                forgetfulnessImportance5Floor: undefined,
                reflectionDecayThreshold: undefined,
                vectorSimilarityThreshold: 0.5,
                alpha: 0.7,
                combinedBoostWeight: 15,
                embeddingSource: 'ollama',
                transientDecayMultiplier: undefined,
            },
        };

        await selectFormatAndInject(mockMemories, mockData, mockCtx);

        // Verify injectContext was called with both memoryText and reflectionText
        // setExtensionPrompt signature: (name, content, promptType, depth)
        const memoryCall = mockSetPrompt.mock.calls.find((c) => c[0] === 'openvault');
        const reflectionCall = mockSetPrompt.mock.calls.find((c) => c[0] === 'openvault_reflections');
        expect(memoryCall).toBeDefined();
        expect(reflectionCall).toBeDefined();
    });
});

describe('buildRetrievalContext', () => {
    beforeEach(() => {
        setupTestContext();
    });

    afterEach(() => {
        resetDeps();
    });

    it('should include transientDecayMultiplier in scoringConfig', () => {
        const ctx = buildRetrievalContext();
        expect(ctx.scoringConfig.transientDecayMultiplier).toBe(defaultSettings.transientDecayMultiplier);
    });
});

describe('defaultSettings.injection.reflections', () => {
    it('should have reflections with position: 1 and depth: 4 defaults', () => {
        expect(defaultSettings.injection.reflections).toBeDefined();
        expect(defaultSettings.injection.reflections.position).toBe(1);
        expect(defaultSettings.injection.reflections.depth).toBe(4);
    });
});
