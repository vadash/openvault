import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, extensionName } from '../../src/constants.js';
import { resetDeps } from '../../src/deps.js';
import { updateInjection } from '../../src/retrieval/retrieve.js';

// Mock getSettings to avoid initialization requirement
// Must use vi.hoisted for mock factory variables
const { mockGetSettings } = vi.hoisted(() => ({
    mockGetSettings: vi.fn((path) => {
        if (!path) return defaultSettings;
        const keys = path.split('.');
        let value = defaultSettings;
        for (const key of keys) {
            value = value?.[key];
        }
        return value;
    }),
}));

vi.mock('../../src/settings.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getSettings: mockGetSettings,
    };
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

    it('graceful degradation: empty state produces empty injection', async () => {
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
});
