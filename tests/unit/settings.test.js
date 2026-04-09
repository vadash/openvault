import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock lodash implementations
const lodashGet = (obj, path, defaultValue) => {
    const travel = (regexp) =>
        String.prototype.split
            .call(path, regexp)
            .filter(Boolean)
            .reduce((res, key) => (res !== null && res !== undefined ? res[key] : res), obj);
    const result = travel(/[,[\]]+?/) || travel(/[,[\].]+?/);
    return result === undefined || result === null ? defaultValue : result;
};

const lodashSet = (obj, path, value) => {
    if (Object(obj) !== obj) return obj;
    const keys = String(path)
        .split(/[.[\]]+/)
        .filter(Boolean);
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        const numKey = /^\d+$/.test(key) ? parseInt(key, 10) : key;
        if (!(numKey in current)) {
            current[numKey] = /^\d+$/.test(keys[i + 1]) ? [] : {};
        }
        current = current[numKey];
    }
    const lastKey = keys[keys.length - 1];
    const numLastKey = /^\d+$/.test(lastKey) ? parseInt(lastKey, 10) : lastKey;
    current[numLastKey] = value;
    return obj;
};

const lodashHas = (obj, path) => {
    const travel = (regexp) =>
        String.prototype.split
            .call(path, regexp)
            .filter(Boolean)
            .reduce((res, key) => (res !== null && res !== undefined ? res[key] : res), obj);
    const result = travel(/[,[\]]+?/) || travel(/[,[\].]+?/);
    return result !== undefined && result !== null;
};

const lodashMerge = (target, source) => {
    const result = { ...target };
    for (const key in source) {
        if (Object.hasOwn(source, key)) {
            if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
                result[key] = lodashMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
    }
    return result;
};

describe('Centralized Settings Module — wiring checks', () => {
    let mockExtensionSettings;
    let mockLodash;
    let mockSaveSettingsDebounced;

    beforeEach(async () => {
        vi.resetModules();

        mockSaveSettingsDebounced = vi.fn();

        mockLodash = {
            get: vi.fn(lodashGet),
            set: vi.fn(lodashSet),
            has: vi.fn(lodashHas),
            merge: vi.fn(lodashMerge),
        };

        mockExtensionSettings = {
            openvault: {
                enabled: true,
                extractionTokenBudget: 8000,
                injection: {
                    memory: { position: 1, depth: 4 },
                    world: { position: 1, depth: 4 },
                },
            },
        };

        vi.doMock('../../src/deps.js', () => ({
            getDeps: () => ({
                getContext: () => ({
                    lodash: mockLodash,
                }),
                getExtensionSettings: () => mockExtensionSettings,
                saveSettingsDebounced: mockSaveSettingsDebounced,
            }),
            setDeps: vi.fn(),
            resetDeps: vi.fn(),
        }));

        vi.doMock('../../src/constants.js', () => ({
            extensionName: 'openvault',
            defaultSettings: {
                enabled: true,
                extractionTokenBudget: 8000,
                injection: {
                    memory: { position: 1, depth: 4 },
                    world: { position: 1, depth: 4 },
                },
            },
        }));
    });

    it('should set nested value with dot notation and trigger save', async () => {
        const { setSetting, getSettings } = await import('../../src/settings.js');
        setSetting('injection.memory.position', 0);
        expect(getSettings('injection.memory.position')).toBe(0);
        expect(mockSaveSettingsDebounced).toHaveBeenCalled();
    });

    it('should use setByPath fallback when lodash.set is unavailable', async () => {
        const lodashNoSet = {
            get: mockLodash.get,
            has: mockLodash.has,
            merge: mockLodash.merge,
        };

        vi.doMock('../../src/deps.js', () => ({
            getDeps: () => ({
                getContext: () => ({
                    lodash: lodashNoSet,
                }),
                getExtensionSettings: () => mockExtensionSettings,
                saveSettingsDebounced: mockSaveSettingsDebounced,
            }),
            setDeps: vi.fn(),
            resetDeps: vi.fn(),
        }));

        const { setSetting, getSettings } = await import('../../src/settings.js');
        setSetting('fallback.test.value', 'works');
        expect(getSettings('fallback.test.value')).toBe('works');
    });

    it('should return true for existing paths (hasSettings)', async () => {
        const { hasSettings } = await import('../../src/settings.js');
        expect(hasSettings('injection.memory')).toBe(true);
        expect(hasSettings('enabled')).toBe(true);
    });

    it('should return false for missing paths (hasSettings)', async () => {
        const { hasSettings } = await import('../../src/settings.js');
        expect(hasSettings('nonexistent.path')).toBe(false);
        expect(hasSettings('injection.nonexistent')).toBe(false);
    });
});
