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
    });
});
