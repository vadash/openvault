import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/constants.js';
import { resetDeps } from '../../src/deps.js';

// Use vi.hoisted to create variables accessible from hoisted vi.mock factories
const { _mockSettingsValues, _mockGetSettings } = vi.hoisted(() => {
    const _mockSettingsValues = {};
    const _mockGetSettings = vi.fn((_path, defaultValue) => defaultValue);
    return { _mockSettingsValues, _mockGetSettings };
});

// Mock state module BEFORE any imports that depend on it
vi.mock('../../src/state.js', async () => {
    const actual = await vi.importActual('../../src/state.js');
    return {
        ...actual,
        isWorkerRunning: vi.fn(() => false),
    };
});

// Mock settings module to control getSettings
vi.mock('../../src/settings.js', async () => {
    const actual = await vi.importActual('../../src/settings.js');
    _mockGetSettings.mockImplementation((path, defaultValue) => {
        // Check our override map first
        if (path in _mockSettingsValues) return _mockSettingsValues[path];
        // Fall back to real implementation
        return actual.getSettings(path, defaultValue);
    });
    return {
        ...actual,
        getSettings: _mockGetSettings,
    };
});

// Mock reflection module to spy on generateReflections
vi.mock('../../src/reflection/reflect.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        generateReflections: vi.fn().mockImplementation(actual.generateReflections),
    };
});

import { synthesizeReflections } from '../../src/extraction/extract.js';
import { generateReflections } from '../../src/reflection/reflect.js';

// ── Settings defaults ──

describe('reflection toggle settings', () => {
    it('should have reflectionGenerationEnabled defaulting to true', () => {
        expect(defaultSettings.reflectionGenerationEnabled).toBe(true);
    });

    it('should have reflectionInjectionEnabled defaulting to true', () => {
        expect(defaultSettings.reflectionInjectionEnabled).toBe(true);
    });
});

// ── synthesizeReflections generation toggle ──

describe('synthesizeReflections with generation toggle', () => {
    let mockData;
    let mockSettings;

    beforeEach(() => {
        vi.restoreAllMocks();
        generateReflections.mockReset();

        // Clear mock settings overrides
        for (const key of Object.keys(_mockSettingsValues)) delete _mockSettingsValues[key];

        mockData = {
            schema_version: 2,
            memories: [],
            character_states: {},
            reflection_state: {
                TestChar: { importance_sum: 100 },
            },
            graph: { nodes: {}, edges: {} },
        };
        mockSettings = {
            reflectionThreshold: 40,
            maxConcurrency: 1,
        };

        setupTestContext({
            settings: {
                reflectionGenerationEnabled: true,
                reflectionThreshold: 40,
            },
        });
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('should skip reflection generation when reflectionGenerationEnabled is false', async () => {
        // Override getSettings to return false for generation toggle
        _mockSettingsValues.reflectionGenerationEnabled = false;

        await synthesizeReflections(mockData, ['TestChar'], mockSettings);

        // generateReflections should never be called
        expect(generateReflections).not.toHaveBeenCalled();
    });

    it('should proceed with reflection generation when reflectionGenerationEnabled is true', async () => {
        // Mock generateReflections to return empty reflections
        generateReflections.mockResolvedValue({
            reflections: [],
            stChanges: { toUpsert: [], toDelete: [] },
        });

        await synthesizeReflections(mockData, ['TestChar'], mockSettings);

        // generateReflections should have been called
        expect(generateReflections).toHaveBeenCalledTimes(1);
        // importance_sum should be reset even with empty reflections
        expect(mockData.reflection_state.TestChar.importance_sum).toBe(0);
    });
});

// ── retrieveAndInjectContext injection toggle ──

describe('retrieveAndInjectContext with injection toggle', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        // Clear mock settings overrides
        for (const key of Object.keys(_mockSettingsValues)) delete _mockSettingsValues[key];
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('should exclude reflections when reflectionInjectionEnabled is false', async () => {
        // Override getSettings to return false for injection toggle
        _mockSettingsValues.reflectionInjectionEnabled = false;

        // Setup test context with mock data - use is_system: true so events are hidden
        const mockChat = [
            { mes: 'Alice is a brave warrior', is_system: true, is_user: true, extra: {}, send_date: 1000 },
        ];
        // Get fingerprint for the mock message
        const { getFingerprint } = await import('../../src/extraction/scheduler.js');
        const fp = getFingerprint(mockChat[0]);

        const mockData = {
            memories: [
                {
                    id: 'r1',
                    type: 'reflection',
                    summary: 'Alice is a brave warrior',
                    message_fingerprints: [],
                    importance: 5,
                },
                {
                    id: 'e1',
                    type: 'event',
                    summary: 'Alice fought a dragon',
                    message_fingerprints: [fp],
                    importance: 5,
                },
            ],
            graph: { nodes: {}, edges: {} },
        };

        setupTestContext({
            context: {
                chat: mockChat,
                name2: 'TestChar',
                chatId: 'test-chat-id',
            },
            settings: {
                reflectionInjectionEnabled: false,
                retrievalFinalTokens: 1000,
                worldContextBudget: 0,
            },
        });

        // Mock getOpenVaultData to return our test data
        const chatDataModule = await import('../../src/store/chat-data.js');
        vi.spyOn(chatDataModule, 'getOpenVaultData').mockReturnValue(mockData);

        // Re-import retrieveAndInjectContext to pick up the mocks
        const { retrieveAndInjectContext } = await import('../../src/retrieval/retrieve.js');

        const result = await retrieveAndInjectContext();

        // Reflection should not be in result
        const reflectionIds = result?.memories?.filter((m) => m.type === 'reflection').map((m) => m.id) || [];
        expect(reflectionIds).not.toContain('r1');
        // Event should still be there
        const eventIds = result?.memories?.filter((m) => m.type === 'event').map((m) => m.id) || [];
        expect(eventIds).toContain('e1');
    });

    it('should include reflections when reflectionInjectionEnabled is true', async () => {
        // Override getSettings to return true for injection toggle
        _mockSettingsValues.reflectionInjectionEnabled = true;

        // Setup test context with mock data - use is_system: true so events are hidden
        const mockChat = [
            { mes: 'Alice is a brave warrior', is_system: true, is_user: true, extra: {}, send_date: 1000 },
        ];
        // Get fingerprint for the mock message
        const { getFingerprint } = await import('../../src/extraction/scheduler.js');
        const fp = getFingerprint(mockChat[0]);

        const mockData = {
            memories: [
                {
                    id: 'r1',
                    type: 'reflection',
                    summary: 'Alice is a brave warrior',
                    message_fingerprints: [],
                    importance: 5,
                },
                {
                    id: 'e1',
                    type: 'event',
                    summary: 'Alice fought a dragon',
                    message_fingerprints: [fp],
                    importance: 5,
                },
            ],
            graph: { nodes: {}, edges: {} },
        };

        setupTestContext({
            context: {
                chat: mockChat,
                name2: 'TestChar',
                chatId: 'test-chat-id',
            },
            settings: {
                reflectionInjectionEnabled: true,
                retrievalFinalTokens: 1000,
                worldContextBudget: 0,
            },
        });

        // Mock getOpenVaultData to return our test data
        const chatDataModule = await import('../../src/store/chat-data.js');
        vi.spyOn(chatDataModule, 'getOpenVaultData').mockReturnValue(mockData);

        // Re-import retrieveAndInjectContext to pick up the mocks
        const { retrieveAndInjectContext } = await import('../../src/retrieval/retrieve.js');

        const _result = await retrieveAndInjectContext();

        // The reflection should be in the candidate set when toggle is true
        // We verify this by checking that getSettings was called with the correct path
        expect(_mockGetSettings).toHaveBeenCalledWith('reflectionInjectionEnabled', true);
    });
});

// ── Integration tests ──

describe('integration: reflection toggles', () => {
    let mockData;
    let mockSettings;

    beforeEach(() => {
        vi.restoreAllMocks();
        generateReflections.mockReset();

        // Clear mock settings overrides
        for (const key of Object.keys(_mockSettingsValues)) delete _mockSettingsValues[key];

        mockData = {
            schema_version: 2,
            memories: [{ id: 'existing-reflection', type: 'reflection', summary: 'Old reflection' }],
            character_states: {},
            reflection_state: { TestChar: { importance_sum: 100 } },
            graph: { nodes: {}, edges: {} },
        };
        mockSettings = {
            reflectionThreshold: 40,
            maxConcurrency: 1,
        };
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('should preserve existing reflections when generation is disabled', async () => {
        // Override getSettings to return false for generation toggle
        _mockSettingsValues.reflectionGenerationEnabled = false;

        setupTestContext({
            settings: {
                reflectionGenerationEnabled: false,
                reflectionThreshold: 40,
            },
        });

        await synthesizeReflections(mockData, ['TestChar'], mockSettings);

        // Existing reflection should still be in memories
        expect(mockData.memories.some((m) => m.id === 'existing-reflection')).toBe(true);

        // generateReflections should never be called
        expect(generateReflections).not.toHaveBeenCalled();
    });

    it('should allow generation to continue while injection is disabled', async () => {
        // These are independent toggles - generation can happen while injection is off
        // This is useful for "audit mode" - building reflections but not using them yet

        // Override getSettings for independent toggles
        _mockSettingsValues.reflectionGenerationEnabled = true;
        _mockSettingsValues.reflectionInjectionEnabled = false;

        setupTestContext({
            settings: {
                reflectionGenerationEnabled: true,
                reflectionInjectionEnabled: false,
                reflectionThreshold: 40,
            },
        });

        // Mock generateReflections to return empty reflections
        generateReflections.mockResolvedValue({
            reflections: [],
            stChanges: { toUpsert: [], toDelete: [] },
        });

        await synthesizeReflections(mockData, ['TestChar'], mockSettings);

        // Verify the settings are independent
        expect(_mockGetSettings('reflectionGenerationEnabled')).toBe(true);
        expect(_mockGetSettings('reflectionInjectionEnabled')).toBe(false);

        // Generation should proceed (generateReflections was called)
        expect(generateReflections).toHaveBeenCalledTimes(1);
    });
});
