import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, extensionName } from '../../src/constants.js';
import { resetDeps } from '../../src/deps.js';
import { updateInjection } from '../../src/retrieval/retrieve.js';

describe('reflection retrieval', () => {
    it('includes both events and reflections in injected context', async () => {
        const mockSetPrompt = vi.fn();

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

        // The memory injection slot should contain BOTH event and reflection text
        const memoryCall = mockSetPrompt.mock.calls.find((c) => c[0] === extensionName);
        expect(memoryCall).toBeDefined();
        const injectedText = memoryCall[1];
        expect(injectedText).toContain('ancient library');
        expect(injectedText).toContain('abandonment');
    });
});

describe('updateInjection world context', () => {
    let mockSetPrompt;

    beforeEach(() => {
        mockSetPrompt = vi.fn();

        setupTestContext({
            context: {
                chat: [
                    { mes: 'Hello', is_user: true, is_system: true },
                    { mes: 'Hi', is_user: false, is_system: false },
                ],
                chatMetadata: {
                    openvault: {
                        memories: [
                            {
                                id: 'ev1',
                                type: 'event',
                                summary: 'Test memory about the kingdom',
                                importance: 3,
                                message_ids: [0],
                                characters_involved: ['Alice'],
                                witnesses: ['Alice'],
                                is_secret: false,
                                embedding: [0.5, 0.5],
                            },
                        ],
                        character_states: { Alice: { name: 'Alice', known_events: ['ev1'] } },
                        communities: {
                            C0: {
                                title: 'Royal Court',
                                summary: 'The seat of power in the kingdom',
                                findings: ['The king rules wisely'],
                                embedding: [0.5, 0.5],
                                nodeKeys: ['alice'],
                            },
                        },
                    },
                },
                chatId: 'test',
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
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('injects world context when communities exist', async () => {
        await updateInjection();

        const worldCall = mockSetPrompt.mock.calls.find((c) => c[0] === 'openvault_world');
        expect(worldCall).toBeDefined();
        expect(worldCall[1]).toContain('world_context');
    });

    it('includes community title in world context', async () => {
        await updateInjection();

        const worldCall = mockSetPrompt.mock.calls.find((c) => c[0] === 'openvault_world');
        expect(worldCall).toBeDefined();
        expect(worldCall[1]).toContain('Royal Court');
    });
});

describe('retrieveAndInjectContext with global state', () => {
    let mockSetPrompt;

    beforeEach(() => {
        mockSetPrompt = vi.fn();

        setupTestContext({
            context: {
                chat: [
                    { mes: 'Previous context', is_user: true, is_system: true }, // Hidden message with memory source
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
                                message_ids: [0], // References hidden message at index 0
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
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('should pass global state and user messages to retrieveWorldContext for macro intent', async () => {
        const { retrieveAndInjectContext } = await import('../../src/retrieval/retrieve.js');

        await retrieveAndInjectContext();

        // Verify world context was injected with global state (macro intent triggers global summary)
        const worldCall = mockSetPrompt.mock.calls.find((c) => c[0] === 'openvault_world');
        expect(worldCall).toBeDefined();
        expect(worldCall[1]).toContain('world_context');
        // Global state should be injected due to macro-intent message "Summarize the story so far"
        expect(worldCall[1]).toContain('Test global state');
    });

    it('should pass user messages for intent detection', async () => {
        const { retrieveAndInjectContext } = await import('../../src/retrieval/retrieve.js');

        await retrieveAndInjectContext();

        // The user message "Summarize the story so far" contains macro-intent keywords
        // Should trigger global state injection
        const worldCall = mockSetPrompt.mock.calls.find((c) => c[0] === 'openvault_world');
        expect(worldCall).toBeDefined();
        // Should use global state summary, not local community summaries
        expect(worldCall[1]).toContain('Test global state - the story has progressed');
    });

    it('should fall back to vector search for non-macro queries', async () => {
        // Setup test with non-macro message
        mockSetPrompt = vi.fn();
        setupTestContext({
            context: {
                chat: [
                    { mes: 'Previous context', is_user: true, is_system: true },
                    { mes: "Let's go to the kitchen", is_user: true, is_system: false },
                ],
                chatMetadata: {
                    openvault: {
                        memories: [
                            {
                                id: 'ev1',
                                type: 'event',
                                summary: 'Test memory about kitchen',
                                importance: 3,
                                message_ids: [0],
                                characters_involved: ['Alice'],
                                witnesses: ['Alice'],
                                is_secret: false,
                                embedding: [0.5, 0.5],
                            },
                        ],
                        character_states: { Alice: { name: 'Alice' } },
                        global_world_state: {
                            summary: 'Test global state that should not be used',
                            last_updated: Date.now(),
                            community_count: 1,
                        },
                        communities: {
                            C0: {
                                title: 'Kitchen Location',
                                summary: 'The kitchen is a cozy place',
                                findings: ['Has a stove'],
                                embedding: [0.5, 0.5],
                                nodeKeys: ['alice'],
                            },
                        },
                        graph: { nodes: {}, edges: {} },
                    },
                },
                chatId: 'test',
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

        // "Let's go to the kitchen" is NOT a macro-intent query
        // Should use vector search, not global state
        const worldCall = mockSetPrompt.mock.calls.find((c) => c[0] === 'openvault_world');
        expect(worldCall).toBeDefined();
        // Should contain community-based results (Kitchen), not global state
        expect(worldCall[1]).toContain('Kitchen Location');
        expect(worldCall[1]).not.toContain('Test global state that should not be used');
    });
});
