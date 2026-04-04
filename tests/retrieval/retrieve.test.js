import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, extensionName } from '../../src/constants.js';
import { resetDeps } from '../../src/deps.js';
import { buildRetrievalContext, updateInjection } from '../../src/retrieval/retrieve.js';

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

        const memoryCall = mockSetPrompt.mock.calls.find((c) => c[0] === extensionName);
        expect(memoryCall).toBeDefined();
        const injectedText = memoryCall[1];
        expect(injectedText).toContain('ancient library');
        expect(injectedText).toContain('abandonment');
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
