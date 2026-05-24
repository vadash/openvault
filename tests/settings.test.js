import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMORIES_KEY } from '../src/constants.js';

// Mock UI dependencies
const refreshAllUIMock = vi.fn();
const saveOpenVaultDataMock = vi.fn().mockResolvedValue(true);

vi.mock('../src/ui/render.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        refreshAllUI: refreshAllUIMock,
    };
});

vi.mock('../src/store/chat-data.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        saveOpenVaultData: saveOpenVaultDataMock,
        getOpenVaultData: vi.fn(),
    };
});

// Helper to reset the settings module for testing initialization behavior
async function resetSettingsModule() {
    vi.resetModules();
    await global.registerCdnOverrides();
}

describe('handleSettingChangeSideEffects', () => {
    let mockExtensionSettings;
    let mockContext;
    let mockOpenVaultData;

    beforeEach(async () => {
        vi.resetModules();
        await global.registerCdnOverrides();

        mockOpenVaultData = {
            schema_version: 8,
            [MEMORIES_KEY]: [
                { id: 'mem1', type: 'event', summary: 'Event 1' },
                { id: 'mem2', type: 'reflection', summary: 'Reflection 1' },
                { id: 'mem3', type: 'reflection', summary: 'Reflection 2' },
                { id: 'mem4', type: 'global_synthesis', summary: 'Global 1' },
            ],
            reflection_state: {
                last_reflection_message: 100,
                accumulator: ['some', 'data'],
            },
            global_world_state: {
                summary: 'Test world state',
                timestamp: 123456,
            },
            graph: {
                nodes: {},
                edges: {},
                _edgesNeedingConsolidation: ['edge1__edge2', 'edge3__edge4'],
            },
            graph_message_count: 42,
            scene_states: {
                'scene-001': { location: 'Forest', timestamp: 100 },
                'scene-002': { location: 'Cabin', timestamp: 200 },
            },
            scene_ledger: [
                { message_id: 100, scene_id: 'scene-001' },
                { message_id: 200, scene_id: 'scene-002' },
            ],
            scene_counter: 5,
        };

        mockContext = {
            chatId: 'test-chat-123',
            chatMetadata: {
                openvault: mockOpenVaultData,
            },
        };

        mockExtensionSettings = {
            openvault: {
                enabled: true,
                injection: {
                    memory: { position: 1, depth: 4 },
                    reflections: { position: 1, depth: 4 },
                    world: { position: 1, depth: 4 },
                    scene: { position: 4, depth: 4 },
                },
            },
        };

        const { setDeps } = await import('../src/deps.js');
        setDeps({
            getExtensionSettings: () => mockExtensionSettings,
            getContext: () => mockContext,
            saveSettingsDebounced: vi.fn(),
        });

        // Mock getOpenVaultData to return our mock data
        const { getOpenVaultData } = await import('../src/store/chat-data.js');
        getOpenVaultData.mockReturnValue(mockOpenVaultData);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('reflections position = -2 (disabled)', () => {
        it('wipes reflection memories and clears reflection_state', async () => {
            const { setSetting } = await import('../src/settings.js');

            // Act: disable reflections
            await setSetting('injection.reflections.position', -2);

            // Assert: reflection memories removed, reflection_state cleared
            const memories = mockOpenVaultData[MEMORIES_KEY];
            expect(memories).toHaveLength(2); // event and global_synthesis should remain
            expect(memories.map((m) => m.type)).toEqual(['event', 'global_synthesis']);
            expect(mockOpenVaultData.reflection_state).toEqual({});
            expect(saveOpenVaultDataMock).toHaveBeenCalled();
            expect(refreshAllUIMock).toHaveBeenCalled();
        });

        it('keeps global_synthesis memories when disabling reflections', async () => {
            const { setSetting } = await import('../src/settings.js');

            mockOpenVaultData[MEMORIES_KEY] = [
                { id: 'mem1', type: 'event', summary: 'Event 1' },
                { id: 'mem2', type: 'reflection', summary: 'Reflection 1' },
                { id: 'mem3', type: 'global_synthesis', summary: 'Global 1' },
            ];

            await setSetting('injection.reflections.position', -2);

            const memories = mockOpenVaultData[MEMORIES_KEY];
            expect(memories).toHaveLength(2);
            expect(memories.map((m) => m.type)).toEqual(['event', 'global_synthesis']);
        });
    });

    describe('world position = -2 (disabled)', () => {
        it('deletes global_world_state and clears accumulators', async () => {
            const { setSetting } = await import('../src/settings.js');

            // Act: disable world
            await setSetting('injection.world.position', -2);

            // Assert: world state deleted, accumulators cleared
            expect(mockOpenVaultData.global_world_state).toBeUndefined();
            expect(mockOpenVaultData.graph._edgesNeedingConsolidation).toEqual([]);
            expect(mockOpenVaultData.graph_message_count).toBe(0);
            expect(saveOpenVaultDataMock).toHaveBeenCalled();
            expect(refreshAllUIMock).toHaveBeenCalled();
        });

        it('handles missing _edgesNeedingConsolidation gracefully', async () => {
            const { setSetting } = await import('../src/settings.js');

            // Remove _edgesNeedingConsolidation
            delete mockOpenVaultData.graph._edgesNeedingConsolidation;

            await setSetting('injection.world.position', -2);

            expect(mockOpenVaultData.global_world_state).toBeUndefined();
            expect(mockOpenVaultData.graph_message_count).toBe(0);
        });
    });

    describe('scene position = -2 (disabled)', () => {
        it('wipes scene_states, scene_ledger, and scene_counter', async () => {
            const { setSetting } = await import('../src/settings.js');

            // Act: disable scene
            await setSetting('injection.scene.position', -2);

            // Assert: scene data wiped
            expect(mockOpenVaultData.scene_states).toEqual({});
            expect(mockOpenVaultData.scene_ledger).toEqual([]);
            expect(mockOpenVaultData.scene_counter).toBe(0);
            expect(saveOpenVaultDataMock).toHaveBeenCalled();
            expect(refreshAllUIMock).toHaveBeenCalled();
        });

        it('handles missing scene_states gracefully', async () => {
            const { setSetting } = await import('../src/settings.js');

            // Remove scene_states
            delete mockOpenVaultData.scene_states;

            await setSetting('injection.scene.position', -2);

            expect(mockOpenVaultData.scene_ledger).toEqual([]);
            expect(mockOpenVaultData.scene_counter).toBe(0);
        });

        it('handles missing scene_ledger gracefully', async () => {
            const { setSetting } = await import('../src/settings.js');

            // Remove scene_ledger
            delete mockOpenVaultData.scene_ledger;

            await setSetting('injection.scene.position', -2);

            expect(mockOpenVaultData.scene_states).toEqual({});
            expect(mockOpenVaultData.scene_counter).toBe(0);
        });
    });

    describe('non-disable values do not trigger wipes', () => {
        it('does not wipe data when setting position to 0', async () => {
            const { setSetting } = await import('../src/settings.js');

            await setSetting('injection.reflections.position', 0);

            // Nothing should be wiped
            expect(mockOpenVaultData[MEMORIES_KEY]).toHaveLength(4);
            expect(mockOpenVaultData.reflection_state).toEqual({
                last_reflection_message: 100,
                accumulator: ['some', 'data'],
            });
            expect(saveOpenVaultDataMock).not.toHaveBeenCalled();
            expect(refreshAllUIMock).not.toHaveBeenCalled();
        });

        it('does not wipe data when setting position to 1', async () => {
            const { setSetting } = await import('../src/settings.js');

            await setSetting('injection.world.position', 1);

            // Nothing should be wiped
            expect(mockOpenVaultData.global_world_state).toBeDefined();
            expect(mockOpenVaultData.graph._edgesNeedingConsolidation).toHaveLength(2);
            expect(mockOpenVaultData.graph_message_count).toBe(42);
            expect(saveOpenVaultDataMock).not.toHaveBeenCalled();
            expect(refreshAllUIMock).not.toHaveBeenCalled();
        });

        it('does not wipe data for unrelated setting changes', async () => {
            const { setSetting } = await import('../src/settings.js');

            await setSetting('debugMode', true);

            // Nothing should be wiped
            expect(mockOpenVaultData[MEMORIES_KEY]).toHaveLength(4);
            expect(mockOpenVaultData.reflection_state).toEqual({
                last_reflection_message: 100,
                accumulator: ['some', 'data'],
            });
            expect(saveOpenVaultDataMock).not.toHaveBeenCalled();
            expect(refreshAllUIMock).not.toHaveBeenCalled();
        });

        it('does not wipe scene data when setting scene position to 4', async () => {
            const { setSetting } = await import('../src/settings.js');

            await setSetting('injection.scene.position', 4);

            // Scene data should remain intact
            expect(mockOpenVaultData.scene_states).toEqual({
                'scene-001': { location: 'Forest', timestamp: 100 },
                'scene-002': { location: 'Cabin', timestamp: 200 },
            });
            expect(mockOpenVaultData.scene_ledger).toHaveLength(2);
            expect(mockOpenVaultData.scene_counter).toBe(5);
            expect(saveOpenVaultDataMock).not.toHaveBeenCalled();
            expect(refreshAllUIMock).not.toHaveBeenCalled();
        });
    });
});

describe('initializeSettings and getSettings', () => {
    let mockExtensionSettings;
    let mockContext;

    beforeEach(async () => {
        await resetSettingsModule();

        mockContext = {
            chatId: 'test-chat-123',
            lodash: {
                get: vi.fn((obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)),
                set: vi.fn((obj, path, value) => {
                    const keys = path.split('.');
                    let current = obj;
                    for (let i = 0; i < keys.length - 1; i++) {
                        if (!(keys[i] in current)) current[keys[i]] = {};
                        current = current[keys[i]];
                    }
                    current[keys[keys.length - 1]] = value;
                }),
                merge: vi.fn((...args) => {
                    // Deep merge that mimics lodash.merge behavior
                    function deepMerge(target, source) {
                        if (source === null || typeof source !== 'object') {
                            return source;
                        }
                        if (target === null || typeof target !== 'object') {
                            return source;
                        }
                        const result = Array.isArray(target) ? [...target] : { ...target };
                        for (const key of Object.keys(source)) {
                            if (
                                typeof source[key] === 'object' &&
                                source[key] !== null &&
                                !Array.isArray(source[key]) &&
                                typeof result[key] === 'object' &&
                                result[key] !== null &&
                                !Array.isArray(result[key])
                            ) {
                                result[key] = deepMerge(result[key], source[key]);
                            } else {
                                result[key] = source[key];
                            }
                        }
                        return result;
                    }

                    let result = args[0];
                    for (let i = 1; i < args.length; i++) {
                        result = deepMerge(result, args[i]);
                    }
                    return result;
                }),
                has: vi.fn((obj, path) => {
                    const value = path.split('.').reduce((o, k) => o?.[k], obj);
                    return value !== undefined;
                }),
            },
        };

        mockExtensionSettings = {
            openvault: {
                enabled: true,
                injection: {
                    memory: { position: 1, depth: 4 },
                    reflections: { position: 1, depth: 4 },
                    world: { position: 1, depth: 4 },
                },
            },
        };

        const { setDeps } = await import('../src/deps.js');
        setDeps({
            getExtensionSettings: () => mockExtensionSettings,
            getContext: () => mockContext,
            saveSettingsDebounced: vi.fn(),
        });
    });

    describe('initializeSettings() with empty extension_settings', () => {
        it('validates with defaults', async () => {
            const { initializeSettings, getSettings } = await import('../src/settings.js');

            // Setup: empty extension_settings
            mockExtensionSettings.openvault = {};

            // Act: initialize settings
            initializeSettings();

            // Assert: default values are applied
            expect(getSettings('enabled')).toBe(true);
            expect(getSettings('injection.world.position')).toBe(1);
            expect(getSettings('injection.memory.depth')).toBe(4);
        });
    });

    describe('initializeSettings() idempotency', () => {
        it('no-op on second call', async () => {
            const { initializeSettings, getSettings, setSetting } = await import('../src/settings.js');

            // Setup: initialize with custom value
            mockExtensionSettings.openvault = {};
            initializeSettings();
            await setSetting('injection.world.position', 3);

            const firstCallValue = getSettings('injection.world.position');
            expect(firstCallValue).toBe(3);

            // Modify extension_settings directly to simulate external change
            // This would normally be overwritten if initializeSettings() ran again
            mockExtensionSettings.openvault.injection.world.position = 0;

            // Act: call initializeSettings again (should no-op due to idempotency gate)
            initializeSettings();

            // Assert: settings value remains what we set via setSetting (not reset to default)
            // The direct modification to 0 doesn't affect getSettings because it reads the same object
            // The key is that initializeSettings() doesn't re-merge defaults
            expect(getSettings('injection.world.position')).toBe(0);
        });
    });

    describe('getSettings() before initialization', () => {
        it('throws error', async () => {
            await resetSettingsModule();

            // Setup: deps but NO initializeSettings() call
            const { setDeps } = await import('../src/deps.js');
            setDeps({
                getExtensionSettings: () => mockExtensionSettings,
                getContext: () => mockContext,
                saveSettingsDebounced: vi.fn(),
            });

            const { getSettings } = await import('../src/settings.js');

            // Assert: throws before initialization
            expect(() => getSettings('any.path')).toThrow('Settings accessed before initialization');
        });
    });

    describe('getSettings() with bogus path', () => {
        it('throws error for undefined path', async () => {
            const { initializeSettings, getSettings } = await import('../src/settings.js');

            mockExtensionSettings.openvault = {};
            initializeSettings();

            // Assert: throws for undefined path
            expect(() => getSettings('this.does.not.exist')).toThrow('Setting "this.does.not.exist" is undefined');
        });
    });

    describe('initializeSettings() preserves user values', () => {
        it('merges defaults with existing user settings', async () => {
            const { initializeSettings, getSettings } = await import('../src/settings.js');

            // Setup: user has custom world position
            mockExtensionSettings.openvault = {
                injection: {
                    world: { position: -2 },
                },
            };

            // Act: initialize
            initializeSettings();

            // Assert: user value preserved, defaults filled in
            expect(getSettings('injection.world.position')).toBe(-2);
            expect(getSettings('injection.world.depth')).toBe(4); // default filled
            expect(getSettings('enabled')).toBe(true); // default filled
        });
    });
});
