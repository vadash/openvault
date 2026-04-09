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
    // Handle both dot notation and array bracket notation
    const keys = String(path)
        .split(/[.[\]]+/)
        .filter(Boolean);
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        // Convert numeric keys to numbers for array access
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

describe('Centralized Settings Module', () => {
    let mockExtensionSettings;
    let mockLodash;
    let mockSaveSettingsDebounced;

    beforeEach(async () => {
        vi.resetModules();

        // Setup mocks - use mock implementations
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

        // Mock deps.js
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

        // Mock constants.js
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

    describe('getSettings', () => {
        it('should return entire settings object when no path provided', async () => {
            const { getSettings } = await import('../../src/settings.js');
            const result = getSettings();
            expect(result).toEqual(mockExtensionSettings.openvault);
        });

        it('should get nested value with dot notation', async () => {
            const { getSettings } = await import('../../src/settings.js');
            const result = getSettings('injection.memory.position');
            expect(result).toBe(1);
        });

        it('should return default value for missing paths', async () => {
            const { getSettings } = await import('../../src/settings.js');
            const result = getSettings('nonexistent.path', 42);
            expect(result).toBe(42);
        });

        it('should return default value when path is undefined', async () => {
            const { getSettings } = await import('../../src/settings.js');
            const result = getSettings('missing.nested.deep', 'default');
            expect(result).toBe('default');
        });
    });

    describe('setSetting', () => {
        it('should set nested value with dot notation', async () => {
            const { setSetting, getSettings } = await import('../../src/settings.js');
            setSetting('injection.memory.position', 0);
            expect(getSettings('injection.memory.position')).toBe(0);
            expect(mockSaveSettingsDebounced).toHaveBeenCalled();
        });

        it('should create intermediate objects when setting nested path', async () => {
            const { setSetting, getSettings } = await import('../../src/settings.js');
            setSetting('new.nested.path', 'value');
            expect(getSettings('new.nested.path')).toBe('value');
            expect(mockSaveSettingsDebounced).toHaveBeenCalled();
        });

        it('should overwrite existing values', async () => {
            const { setSetting, getSettings } = await import('../../src/settings.js');
            setSetting('extractionTokenBudget', 12000);
            expect(getSettings('extractionTokenBudget')).toBe(12000);
        });

        it('should work with array notation', async () => {
            const { setSetting, getSettings } = await import('../../src/settings.js');
            setSetting('testArray[0].name', 'first');
            expect(getSettings('testArray[0].name')).toBe('first');
        });

        it('should use setByPath fallback when lodash.set is unavailable', async () => {
            // Re-mock with lodash that has no .set
            const lodashNoSet = {
                get: mockLodash.get,
                has: mockLodash.has,
                merge: mockLodash.merge,
                // No .set property
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

            // Re-import to get fresh module
            const { setSetting, getSettings } = await import('../../src/settings.js');
            setSetting('fallback.test.value', 'works');
            expect(getSettings('fallback.test.value')).toBe('works');
        });
    });

    describe('Edge Cases', () => {
        it('should handle undefined path in getSettings', async () => {
            const { getSettings } = await import('../../src/settings.js');
            const result = getSettings();
            expect(result).toEqual(mockExtensionSettings.openvault);
        });

        it('should handle array notation in paths', async () => {
            mockExtensionSettings.openvault = {
                testArray: [{ name: 'first' }, { name: 'second' }],
            };

            const { getSettings } = await import('../../src/settings.js');
            expect(getSettings('testArray[0].name')).toBe('first');
        });

        it('should handle deeply nested paths', async () => {
            const { getSettings, setSetting } = await import('../../src/settings.js');
            setSetting('a.b.c.d.e', 'deep');
            expect(getSettings('a.b.c.d.e')).toBe('deep');
        });

        it('should return defaultValue for undefined settings object', async () => {
            mockExtensionSettings.openvault = undefined;
            const { getSettings } = await import('../../src/settings.js');
            expect(getSettings('any.path', 'default')).toBe('default');
        });
    });

    describe('hasSettings', () => {
        it('should return true for existing paths', async () => {
            const { hasSettings } = await import('../../src/settings.js');
            expect(hasSettings('injection.memory')).toBe(true);
            expect(hasSettings('enabled')).toBe(true);
        });

        it('should return false for missing paths', async () => {
            const { hasSettings } = await import('../../src/settings.js');
            expect(hasSettings('nonexistent.path')).toBe(false);
            expect(hasSettings('injection.nonexistent')).toBe(false);
        });

        it('should work with deeply nested paths', async () => {
            const { hasSettings } = await import('../../src/settings.js');
            expect(hasSettings('injection.memory.position')).toBe(true);
            expect(hasSettings('injection.memory.nonexistent')).toBe(false);
        });
    });
});
