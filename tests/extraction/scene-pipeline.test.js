/**
 * Integration tests for scene state pipeline integration.
 * Tests Stage 7 (scene state extraction) and scene_counter management.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/constants.js';
import { resetDeps } from '../../src/deps.js';

// Mock state module BEFORE any imports
vi.mock('../../src/state.js', async () => {
    const actual = await vi.importActual('../../src/state.js');
    return {
        ...actual,
        isWorkerRunning: vi.fn(() => false),
    };
});

// Mock extractSceneState before importing extract.js
vi.mock('../../src/extraction/scene-state.js', () => ({
    extractSceneState: vi.fn(),
}));

import { extractMemories } from '../../src/extraction/extract.js';
import { extractSceneState } from '../../src/extraction/scene-state.js';

/**
 * Standard LLM response data for extraction tests.
 */
const EXTRACTION_RESPONSES = {
    events: JSON.stringify({
        reasoning: null,
        events: [
            {
                summary: 'User and Alice talked in the room',
                importance: 3,
                characters_involved: ['Alice'],
                witnesses: ['Alice'],
                location: 'Room',
                is_secret: false,
                emotional_impact: {},
                relationship_impact: {},
            },
        ],
    }),
    graph: JSON.stringify({
        entities: [{ name: 'Alice', type: 'PERSON', description: 'A character' }],
        relationships: [],
    }),
};

function mockSendRequest() {
    return vi
        .fn()
        .mockResolvedValueOnce({ content: EXTRACTION_RESPONSES.events })
        .mockResolvedValueOnce({ content: EXTRACTION_RESPONSES.graph });
}

function getExtractionSettings(overrides = {}) {
    return {
        ...defaultSettings,
        extractionProfile: 'test-profile',
        embeddingSource: 'ollama',
        ollamaUrl: 'http://test:11434',
        embeddingModel: 'test-model',
        backfillMaxRPM: 99999,
        // Ensure all injection positions are defined to avoid getSettings fallback
        injection: {
            memory: { position: 1, depth: 4 },
            reflections: { position: 1, depth: 4 },
            world: { position: 1, depth: 4 },
            scene: { position: 4, depth: 4 },
        },
        ...overrides,
    };
}

function getMockConnectionManager(sendRequest) {
    return {
        selectedProfile: 'test-profile',
        profiles: [{ id: 'test-profile', name: 'Test' }],
        sendRequest,
    };
}

describe('Scene State Pipeline Integration', () => {
    let mockData;
    let mockContext;

    beforeEach(() => {
        vi.clearAllMocks();

        mockData = {
            schema_version: 8,
            memories: [],
            character_states: {},
            processed_message_ids: [],
            graph: { nodes: {}, edges: {} },
            reflection_state: {},
            graph_message_count: 0,
            scene_states: {},
            scene_ledger: [],
            scene_counter: 0,
        };

        mockContext = {
            chat: [
                { mes: 'User message', is_user: true, name: 'User', send_date: '100' },
                { mes: 'Bot message', is_user: false, name: 'Alice', send_date: '101' },
                { mes: 'System note', is_system: true, send_date: '102' },
                { mes: 'User message 2', is_user: true, name: 'User', send_date: '103' },
                { mes: 'Bot message 2', is_user: false, name: 'Alice', send_date: '104' },
            ],
            name1: 'User',
            name2: 'Alice',
            chatMetadata: { openvault: mockData },
            chatId: 'test-chat-123',
        };

        // Reset extractSceneState mock
        extractSceneState.mockReset();
        extractSceneState.mockResolvedValue({
            location: 'Living room',
            time: 'Afternoon',
            source_fp: '104',
        });
    });

    afterEach(() => {
        resetDeps();
    });

    it('does NOT increment scene_counter during backfill (counter stays 0)', async () => {
        global.setupTestContext({
            context: mockContext,
            settings: getExtractionSettings({
                sceneStateInterval: 10,
                injection: {
                    memory: { position: 1, depth: 4 },
                    reflections: { position: 1, depth: 4 },
                    world: { position: 1, depth: 4 },
                    scene: { position: 4, depth: 4 },
                },
            }),
            deps: {
                connectionManager: getMockConnectionManager(mockSendRequest()),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        // Process messages 0, 1, 3, 4 (skip system at index 2) with isBackfill=true
        const result = await extractMemories([0, 1, 3, 4], 'test-chat-123', { silent: true, isBackfill: true });

        expect(result.status).toBe('success');

        // scene_counter should NOT be incremented during backfill (stays 0)
        expect(mockData.scene_counter).toBe(0);
        // extractSceneState should NOT be called (Phase 2 skipped during backfill)
        expect(extractSceneState).not.toHaveBeenCalled();
    });

    it('increments scene_counter by real message count on normal extraction', async () => {
        global.setupTestContext({
            context: mockContext,
            settings: getExtractionSettings({
                sceneStateInterval: 10,
                injection: {
                    memory: { position: 1, depth: 4 },
                    reflections: { position: 1, depth: 4 },
                    world: { position: 1, depth: 4 },
                    scene: { position: 4, depth: 4 },
                },
            }),
            deps: {
                connectionManager: getMockConnectionManager(mockSendRequest()),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        // Process messages 0, 1, 3, 4 (skip system at index 2) - NO isBackfill
        const result = await extractMemories([0, 1, 3, 4], 'test-chat-123', { silent: true });

        expect(result.status).toBe('success');

        // scene_counter should be incremented by 4 (real messages, not system)
        expect(mockData.scene_counter).toBe(4);
        // extractSceneState should NOT be called (counter < interval)
        expect(extractSceneState).not.toHaveBeenCalled();
    });

    it('triggers scene extraction when scene_counter >= sceneStateInterval', async () => {
        mockData.scene_counter = 2; // Pre-set counter to 2

        global.setupTestContext({
            context: mockContext,
            settings: getExtractionSettings({
                sceneStateInterval: 3, // Trigger after 3 messages
                injection: {
                    memory: { position: 1, depth: 4 },
                    reflections: { position: 1, depth: 4 },
                    world: { position: 1, depth: 4 },
                    scene: { position: 4, depth: 4 },
                },
            }),
            deps: {
                connectionManager: getMockConnectionManager(mockSendRequest()),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        // Process messages 0, 1, 2, 3 (counter goes 2 + 4 = 6)
        const result = await extractMemories([0, 1, 2, 3], 'test-chat-123', { silent: true });

        expect(result.status).toBe('success');

        // scene_counter should reset to 0 after extraction
        expect(mockData.scene_counter).toBe(0);
        // extractSceneState should be called once
        expect(extractSceneState).toHaveBeenCalledTimes(1);
    });

    it('skips scene extraction when injection.scene.position === -2', async () => {
        mockData.scene_counter = 5; // Already above threshold

        global.setupTestContext({
            context: mockContext,
            settings: getExtractionSettings({
                sceneStateInterval: 1, // Would trigger every message
                injection: {
                    memory: { position: 1, depth: 4 },
                    reflections: { position: 1, depth: 4 },
                    world: { position: 1, depth: 4 },
                    scene: { position: -2, depth: 4 }, // Disabled
                },
            }),
            deps: {
                connectionManager: getMockConnectionManager(mockSendRequest()),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        const result = await extractMemories([0, 1, 2], 'test-chat-123', { silent: true, isBackfill: true });

        expect(result.status).toBe('success');

        // scene_counter should NOT increment when disabled
        expect(mockData.scene_counter).toBe(5);
        // extractSceneState should NOT be called
        expect(extractSceneState).not.toHaveBeenCalled();
    });
});
