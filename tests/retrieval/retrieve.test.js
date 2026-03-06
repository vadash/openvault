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
