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
