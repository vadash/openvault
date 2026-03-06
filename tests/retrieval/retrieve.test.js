import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, extensionName } from '../../src/constants.js';
import { resetDeps, setDeps } from '../../src/deps.js';

// Mock embeddings
vi.mock('../../src/embeddings.js', () => ({
    getQueryEmbedding: vi.fn(async () => [0.5, 0.5]),
    isEmbeddingsEnabled: () => true,
}));

// Mock embeddings strategies
vi.mock('../../src/embeddings/strategies.js', () => ({
    getOptimalChunkSize: () => 500,
}));

// Mock scoring
vi.mock('../../src/retrieval/scoring.js', () => ({
    selectRelevantMemories: vi.fn(async (memories) => memories.slice(0, 2)),
    getScoringParams: vi.fn(),
}));

// Mock formatting
vi.mock('../../src/retrieval/formatting.js', () => ({
    formatContextForInjection: vi.fn(() => 'formatted memories'),
}));

// Mock world context
vi.mock('../../src/retrieval/world-context.js', () => ({
    retrieveWorldContext: vi.fn(() => ({
        text: '<world_context>Royal Court Summary</world_context>',
        communityIds: ['C0'],
    })),
}));

import { updateInjection } from '../../src/retrieval/retrieve.js';
import { retrieveWorldContext } from '../../src/retrieval/world-context.js';

describe('reflection retrieval', () => {
    it('includes reflections in memories passed to scoring', async () => {
        const { selectRelevantMemories } = await import('../../src/retrieval/scoring.js');
        const localMockSetPrompt = vi.fn();

        setDeps({
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
                                summary: 'Event memory',
                                importance: 3,
                                message_ids: [0],
                                characters_involved: ['Alice'],
                                witnesses: ['Alice'],
                                is_secret: false,
                            },
                            {
                                id: 'ref1',
                                type: 'reflection',
                                summary: 'Alice fears abandonment',
                                importance: 4,
                                characters_involved: ['Alice'],
                                witnesses: ['Alice'],
                                is_secret: false,
                                source_ids: ['ev1'],
                                // NO message_ids — this is the key
                            },
                        ],
                        graph: { nodes: {}, edges: {} },
                        communities: {},
                    },
                },
            }),
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings, autoMode: true },
            }),
            setExtensionPrompt: localMockSetPrompt,
        });

        await updateInjection();

        // selectRelevantMemories should have received BOTH the event and the reflection
        const calledWith = selectRelevantMemories.mock.calls[0]?.[0];
        expect(calledWith).toBeDefined();
        const ids = calledWith.map((m) => m.id);
        expect(ids).toContain('ev1');
        expect(ids).toContain('ref1');
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
                                summary: 'Test memory',
                                importance: 3,
                                message_ids: [0],
                                characters_involved: ['Alice'],
                                witnesses: ['Alice'],
                                embedding: [0.5, 0.5],
                            },
                        ],
                        character_states: { Alice: { name: 'Alice', known_events: ['ev1'] } },
                        communities: {
                            C0: {
                                title: 'Test Community',
                                summary: 'A summary',
                                findings: ['Finding'],
                                embedding: [0.5, 0.5],
                                nodeKeys: ['alice'],
                            },
                        },
                    },
                },
                chatId: 'test',
            },
            settings: { automaticMode: true },
            deps: {
                setExtensionPrompt: mockSetPrompt,
                extension_prompt_types: { IN_PROMPT: 0 },
            },
        });
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('calls retrieveWorldContext when communities exist', async () => {
        await updateInjection();
        expect(retrieveWorldContext).toHaveBeenCalled();
    });

    it('injects world context via openvault_world named slot', async () => {
        await updateInjection();
        const worldCall = mockSetPrompt.mock.calls.find((c) => c[0] === 'openvault_world');
        expect(worldCall).toBeDefined();
        expect(worldCall[1]).toContain('world_context');
    });
});
