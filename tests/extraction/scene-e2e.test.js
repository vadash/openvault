/**
 * End-to-End integration tests for scene state lifecycle.
 * Tests: extraction → storage → injection → macro content → disable wipe.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/constants.js';
import { resetDeps } from '../../src/deps.js';

// Mock getSettings to avoid initialization requirement
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

// Mock state module BEFORE any imports
vi.mock('../../src/state.js', async () => {
    const actual = await vi.importActual('../../src/state.js');
    return {
        ...actual,
        isWorkerRunning: vi.fn(() => false),
    };
});

// Mock LLM for both event/graph extraction and scene state extraction
const mockCallLLM = vi.fn();
vi.mock('../../src/llm.js', () => ({
    callLLM: (...args) => mockCallLLM(...args),
    LLM_CONFIGS: {
        extraction_events: { profileSettingKey: 'extractionProfile' },
        extraction_graph: { profileSettingKey: 'extractionProfile' },
        sceneState: { profileSettingKey: 'extractionProfile' },
    },
}));

import { extractMemories } from '../../src/extraction/extract.js';
import { findCurrentSceneState } from '../../src/extraction/scene-state.js';
import { cachedContent } from '../../src/injection/macros.js';
import { buildRetrievalContext, selectFormatAndInject } from '../../src/retrieval/retrieve.js';

/**
 * Standard LLM response data for extraction tests.
 */
const EXTRACTION_RESPONSES = {
    events: JSON.stringify({
        reasoning: null,
        events: [
            {
                summary: 'Alice and User spoke in the garden',
                importance: 3,
                characters_involved: ['Alice'],
                witnesses: ['Alice'],
                location: 'Garden',
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
    sceneState: JSON.stringify({
        location: 'Ancient Library',
        time: 'Late Afternoon',
        environment: 'Dusty shelves, dim candlelight',
        characters: {
            Alice: {
                posture: 'Standing by a bookshelf',
                clothing: ['Blue dress', 'Silver necklace'],
                physical_status: ['Tired'],
            },
        },
        active_props: ['Open book', 'Candle'],
    }),
};

function getExtractionSettings(overrides = {}) {
    return {
        ...defaultSettings,
        extractionProfile: 'test-profile',
        embeddingSource: 'ollama',
        ollamaUrl: 'http://test:11434',
        embeddingModel: 'test-model',
        backfillMaxRPM: 99999,
        injection: {
            memory: { position: 1, depth: 4 },
            reflections: { position: 1, depth: 4 },
            world: { position: 1, depth: 4 },
            scene: { position: 4, depth: 4 },
        },
        ...overrides,
    };
}

function getMockConnectionManager() {
    return {
        selectedProfile: 'test-profile',
        profiles: [{ id: 'test-profile', name: 'Test' }],
        sendRequest: vi.fn(),
    };
}

describe('Scene State E2E Integration', () => {
    let mockData;
    let mockContext;
    let mockSetPrompt;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSetPrompt = vi.fn();

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

        // Build 6 real messages with send_date for fingerprints
        mockContext = {
            chat: [
                { mes: 'Hello there', is_user: true, name: 'User', send_date: 'fp_1', is_system: false },
                { mes: 'Greetings', is_user: false, name: 'Alice', send_date: 'fp_2', is_system: false },
                { mes: 'How are you?', is_user: true, name: 'User', send_date: 'fp_3', is_system: false },
                { mes: 'I am well', is_user: false, name: 'Alice', send_date: 'fp_4', is_system: false },
                { mes: 'Let us talk', is_user: true, name: 'User', send_date: 'fp_5', is_system: false },
                { mes: 'Indeed', is_user: false, name: 'Alice', send_date: 'fp_6', is_system: false },
            ],
            name1: 'User',
            name2: 'Alice',
            chatMetadata: { openvault: mockData },
            chatId: 'test-chat-123',
        };

        // Reset cachedContent
        cachedContent.memory = '';
        cachedContent.reflections = '';
        cachedContent.world = '';
        cachedContent.scene = '';

        // Reset mockCallLLM - setup default responses for events + graph + sceneState
        mockCallLLM.mockReset();
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('happy path: extraction → storage → injection → macro', async () => {
        // Setup mockCallLLM to return events, graph, and sceneState responses
        // 6 messages processed: events + graph extraction, then scene state extraction (triggered twice)
        mockCallLLM
            .mockResolvedValueOnce(EXTRACTION_RESPONSES.events) // events extraction
            .mockResolvedValueOnce(EXTRACTION_RESPONSES.graph) // graph extraction
            .mockResolvedValueOnce(EXTRACTION_RESPONSES.sceneState) // scene extraction (trigger 1)
            .mockResolvedValueOnce(EXTRACTION_RESPONSES.sceneState); // scene extraction (trigger 2)

        // Setup test context with sceneStateInterval=3
        setupTestContext({
            context: mockContext,
            settings: getExtractionSettings({
                sceneStateInterval: 3,
            }),
            deps: {
                connectionManager: getMockConnectionManager(),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
                setExtensionPrompt: mockSetPrompt,
                extension_prompt_types: { IN_PROMPT: 0 },
            },
        });

        // Run extraction pipeline - 6 messages, should trigger scene extraction twice
        const result = await extractMemories([0, 1, 2, 3, 4, 5], 'test-chat-123', { silent: true });

        expect(result.status).toBe('success');

        // Verify scene_states has an entry keyed by the last message's fingerprint
        expect(mockData.scene_states).toBeDefined();
        expect(Object.keys(mockData.scene_states).length).toBeGreaterThan(0);

        // The last fingerprint should be in the state map
        const lastFp = 'fp_6';
        expect(mockData.scene_states[lastFp]).toBeDefined();
        expect(mockData.scene_states[lastFp].location).toBe('Ancient Library');
        expect(mockData.scene_states[lastFp].time).toBe('Late Afternoon');

        // Verify scene_counter reset to 0 after extraction
        expect(mockData.scene_counter).toBe(0);

        // Add a memory so selectFormatAndInject has content
        mockData.memories.push({
            id: 'mem_1',
            type: 'event',
            summary: 'Alice and User spoke in the garden',
            importance: 3,
            characters_involved: ['Alice'],
            witnesses: ['Alice'],
            message_ids: [0],
            message_fingerprints: ['fp_1'],
            is_secret: false,
        });

        // Mark first message as system (hidden) so memory is injectable
        mockContext.chat[0].is_system = true;

        // Call selectFormatAndInject
        const ctx = buildRetrievalContext();
        const injectionResult = await selectFormatAndInject(mockData.memories, mockData, ctx);

        expect(injectionResult).not.toBeNull();

        // Verify scene XML is injected
        expect(cachedContent.scene).not.toBe('');
        expect(cachedContent.scene).toContain('<scene_status>');
        expect(cachedContent.scene).toContain('Ancient Library');
        expect(cachedContent.scene).toContain('Late Afternoon');

        // Verify macro returns non-empty content (cachedContent.scene)
        expect(cachedContent.scene.length).toBeGreaterThan(0);
    });

    it('graceful degradation: empty chat produces no scene state', async () => {
        // Empty chat
        mockContext.chat = [];

        setupTestContext({
            context: mockContext,
            settings: getExtractionSettings({
                sceneStateInterval: 3,
            }),
            deps: {
                connectionManager: getMockConnectionManager(),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        // No extraction should fire (no messages)
        const result = await extractMemories([], 'test-chat-123', { silent: true });

        // With empty chat, extraction returns 'skipped' status
        expect(result.status).toBe('skipped');

        // No scene state extraction should fire
        expect(mockData.scene_states).toEqual({});
        expect(mockCallLLM).not.toHaveBeenCalled();

        // Verify backward scan returns null
        const currentScene = findCurrentSceneState(mockContext.chat, mockData.scene_states);
        expect(currentScene).toBeNull();

        // Verify no scene text injected
        expect(cachedContent.scene).toBe('');
    });

    it('fast-fail: scene disabled (-2) prevents extraction and counter increment', async () => {
        // Pre-set counter to demonstrate no increment
        mockData.scene_counter = 5;

        // Setup mockCallLLM for events + graph (no scene state calls expected)
        mockCallLLM
            .mockResolvedValueOnce(EXTRACTION_RESPONSES.events)
            .mockResolvedValueOnce(EXTRACTION_RESPONSES.graph);

        setupTestContext({
            context: mockContext,
            settings: getExtractionSettings({
                sceneStateInterval: 1, // Would trigger every message if enabled
                injection: {
                    memory: { position: 1, depth: 4 },
                    reflections: { position: 1, depth: 4 },
                    world: { position: 1, depth: 4 },
                    scene: { position: -2, depth: 4 }, // Disabled
                },
            }),
            deps: {
                connectionManager: getMockConnectionManager(),
                fetch: vi.fn(async () => ({
                    ok: true,
                    json: async () => ({ embedding: [0.1, 0.2] }),
                })),
                saveChatConditional: vi.fn(async () => true),
            },
        });

        // Run extraction with scene disabled
        const result = await extractMemories([0, 1, 2], 'test-chat-123', { silent: true, isBackfill: true });

        expect(result.status).toBe('success');

        // Verify no scene extraction fired (only events + graph calls)
        expect(mockCallLLM).toHaveBeenCalledTimes(2);
        expect(Object.keys(mockData.scene_states).length).toBe(0);

        // Verify scene_counter NOT incremented when disabled (stays at 5)
        expect(mockData.scene_counter).toBe(5);

        // Verify scene_ledger empty
        expect(mockData.scene_ledger).toEqual([]);
    });
});
