import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS_KEY, extensionName, MEMORIES_KEY, METADATA_KEY } from '../../src/constants.js';
import { resetDeps, setDeps } from '../../src/deps.js';
import { normalizeKey } from '../../src/graph/graph.js';
import {
    addMemories,
    deleteCurrentChatData,
    deleteEntity,
    deleteMemory,
    generateId,
    getCurrentChatId,
    getOpenVaultData,
    incrementGraphMessageCount,
    markMessagesProcessed,
    saveOpenVaultData,
    updateEntity,
    updateMemory,
} from '../../src/store/chat-data.js';
import * as stHelpers from '../../src/utils/st-helpers.js';
import { buildMockGraphNode } from '../factories.js';

describe('store/chat-data', () => {
    let mockConsole;
    let mockContext;

    beforeEach(() => {
        mockConsole = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        mockContext = { chatMetadata: {}, chatId: 'test-chat-123' };
        setDeps({
            console: mockConsole,
            getContext: () => mockContext,
            getExtensionSettings: () => ({
                [extensionName]: {
                    enabled: true,
                    debugMode: true,
                    requestLogging: false,
                },
            }),
            Date: { now: () => 1000000 },
        });
    });

    afterEach(() => resetDeps());

    describe('getOpenVaultData', () => {
        it('creates complete schema for new chats', () => {
            const data = getOpenVaultData();
            expect(data.schema_version).toBe(6);
            expect(data.memories).toEqual([]);
            expect(data.character_states).toEqual({});
            expect(data.graph).toBeDefined();
            expect(data.graph_message_count).toBe(0);
            expect(data.processed_message_ids).toEqual([]);
            expect(data.settings.injection.reflections).toEqual({ position: 1, depth: 4 });
            expect(data.settings.injection.memory).toEqual({ position: 1, depth: 4 });
            expect(data.settings.injection.world).toEqual({ position: 1, depth: 4 });
        });

        it('creates empty data structure if none exists', () => {
            const data = getOpenVaultData();
            expect(data).toEqual({
                schema_version: 6,
                [MEMORIES_KEY]: [],
                [CHARACTERS_KEY]: {},
                processed_message_ids: [],
                reflection_state: {},
                graph: expect.any(Object),
                graph_message_count: 0,
                settings: {
                    injection: {
                        memory: { position: 1, depth: 4 },
                        reflections: { position: 1, depth: 4 },
                        world: { position: 1, depth: 4 },
                    },
                },
            });
        });

        it('returns existing data if present', () => {
            const existing = {
                [MEMORIES_KEY]: [{ id: '1' }],
                [CHARACTERS_KEY]: {},
            };
            mockContext.chatMetadata[METADATA_KEY] = existing;
            expect(getOpenVaultData()).toBe(existing);
        });

        it('returns null if context is not available', () => {
            setDeps({
                console: mockConsole,
                getContext: () => null,
                getExtensionSettings: () => ({}),
            });
            expect(getOpenVaultData()).toBeNull();
            expect(mockConsole.warn).toHaveBeenCalled();
        });

        it('creates chatMetadata if missing', () => {
            mockContext.chatMetadata = undefined;
            const data = getOpenVaultData();
            expect(mockContext.chatMetadata).toBeDefined();
            expect(data).toBeDefined();
        });
    });

    describe('getCurrentChatId', () => {
        it('returns chatId from context', () => {
            expect(getCurrentChatId()).toBe('test-chat-123');
        });

        it('falls back to chat_metadata.chat_id', () => {
            mockContext.chatId = undefined;
            mockContext.chat_metadata = { chat_id: 'fallback-id' };
            expect(getCurrentChatId()).toBe('fallback-id');
        });

        it('returns null if no chat id available', () => {
            mockContext.chatId = undefined;
            expect(getCurrentChatId()).toBeNull();
        });
    });

    describe('saveOpenVaultData', () => {
        it('calls saveChatConditional and returns true', async () => {
            const mockSave = vi.fn().mockResolvedValue(undefined);
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: mockSave,
            });
            expect(await saveOpenVaultData()).toBe(true);
            expect(mockSave).toHaveBeenCalled();
        });

        it('returns false on failure', async () => {
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: false },
                }),
                saveChatConditional: vi.fn().mockRejectedValue(new Error('Save failed')),
                showToast: vi.fn(),
            });
            expect(await saveOpenVaultData()).toBe(false);
            expect(mockConsole.error).toHaveBeenCalled();
        });

        it('returns false if expectedChatId does not match', async () => {
            const mockSave = vi.fn().mockResolvedValue(undefined);
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: false },
                }),
                saveChatConditional: mockSave,
            });
            expect(await saveOpenVaultData('different-chat-id')).toBe(false);
            expect(mockSave).not.toHaveBeenCalled();
        });

        it('saves when expectedChatId matches', async () => {
            const mockSave = vi.fn().mockResolvedValue(undefined);
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: mockSave,
            });
            expect(await saveOpenVaultData('test-chat-123')).toBe(true);
        });

        it('should call yieldToMain before and after saveChatConditional', async () => {
            const yieldToMainSpy = vi.spyOn(stHelpers, 'yieldToMain').mockResolvedValue(undefined);
            const saveChatConditionalSpy = vi.fn().mockResolvedValue(undefined);

            // Mock dependencies
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: saveChatConditionalSpy,
            });

            await saveOpenVaultData('test-chat-123');

            // Verify yieldToMain was called twice (before and after save)
            expect(yieldToMainSpy).toHaveBeenCalledTimes(2);
            expect(yieldToMainSpy.mock.calls[0]).toEqual([]);
            expect(yieldToMainSpy.mock.calls[1]).toEqual([]);

            // Verify saveChatConditional was called between the yields
            expect(saveChatConditionalSpy).toHaveBeenCalledTimes(1);

            yieldToMainSpy.mockRestore();
        });
    });

    describe('generateId', () => {
        it('generates unique IDs with timestamp prefix', () => {
            setDeps({ Date: { now: () => 1234567890 } });
            expect(generateId()).toMatch(/^1234567890-[a-z0-9]+$/);
        });

        it('generates different IDs on subsequent calls', () => {
            let time = 1000;
            setDeps({
                Date: {
                    now: () => {
                        return time++;
                    },
                },
            });
            expect(generateId()).not.toBe(generateId());
        });
    });

    describe('updateMemory', () => {
        it('updates allowed fields and saves', async () => {
            const mockSave = vi.fn().mockResolvedValue(undefined);
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: 'mem1', summary: 'old', importance: 3 }],
            };
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: mockSave,
            });
            const result = await updateMemory('mem1', { importance: 5 });
            expect(result.success).toBe(true);
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY][0].importance).toBe(5);
        });

        it('invalidates embedding when summary changes', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: 'mem1', summary: 'old', embedding: [1, 2, 3] }],
            };
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: vi.fn().mockResolvedValue(undefined),
            });
            await updateMemory('mem1', { summary: 'new' });
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY][0].embedding).toBeUndefined();
        });

        it('returns false for non-existent memory', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [],
            };
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
            });
            const result = await updateMemory('nonexistent', { summary: 'x' });
            expect(result.success).toBe(false);
        });

        it('should allow updating temporal_anchor field', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: 'mem1', summary: 'Test', temporal_anchor: null }],
            };
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: vi.fn().mockResolvedValue(undefined),
            });
            const result = await updateMemory('mem1', { temporal_anchor: 'Monday, Jan 1, 12:00 PM' });
            expect(result.success).toBe(true);
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY][0].temporal_anchor).toBe(
                'Monday, Jan 1, 12:00 PM'
            );
        });

        it('should allow updating is_transient field', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: 'mem1', summary: 'Test', is_transient: false }],
            };
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: vi.fn().mockResolvedValue(undefined),
            });
            const result = await updateMemory('mem1', { is_transient: true });
            expect(result.success).toBe(true);
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY][0].is_transient).toBe(true);
        });
    });

    describe('deleteMemory', () => {
        it('removes memory and saves', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: 'mem1' }, { id: 'mem2' }],
            };
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: vi.fn().mockResolvedValue(undefined),
            });
            const result = await deleteMemory('mem1');
            expect(result.success).toBe(true);
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY]).toHaveLength(1);
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY][0].id).toBe('mem2');
        });
    });

    describe('deleteMemoriesByType', () => {
        let mockSave;

        beforeEach(() => {
            mockSave = vi.fn().mockResolvedValue(undefined);
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: mockSave,
            });
        });

        it('deletes only memories of the specified type', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [
                    { id: 'mem1', type: 'reflection' },
                    { id: 'mem2', type: 'world' },
                    { id: 'mem3', type: 'reflection' },
                    { id: 'mem4', type: 'character' },
                ],
            };
            const { deleteMemoriesByType } = await import('../../src/store/chat-data.js');
            const count = await deleteMemoriesByType('reflection');
            expect(count).toBe(2);
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY]).toEqual([
                { id: 'mem2', type: 'world' },
                { id: 'mem4', type: 'character' },
            ]);
        });

        it('preserves memories of other types', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [
                    { id: 'mem1', type: 'reflection' },
                    { id: 'mem2', type: 'world' },
                    { id: 'mem3', type: 'character' },
                ],
            };
            const { deleteMemoriesByType } = await import('../../src/store/chat-data.js');
            await deleteMemoriesByType('reflection');
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY]).toEqual([
                { id: 'mem2', type: 'world' },
                { id: 'mem3', type: 'character' },
            ]);
        });

        it('preserves reflection_state accumulators', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: 'mem1', type: 'reflection' }],
                reflection_state: { accumulator: 'some-data' },
            };
            const { deleteMemoriesByType } = await import('../../src/store/chat-data.js');
            await deleteMemoriesByType('reflection');
            expect(mockContext.chatMetadata[METADATA_KEY].reflection_state).toEqual({
                accumulator: 'some-data',
            });
        });

        it('returns count of deleted memories', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [
                    { id: 'mem1', type: 'reflection' },
                    { id: 'mem2', type: 'reflection' },
                    { id: 'mem3', type: 'reflection' },
                ],
            };
            const { deleteMemoriesByType } = await import('../../src/store/chat-data.js');
            const count = await deleteMemoriesByType('reflection');
            expect(count).toBe(3);
        });

        it('returns 0 when no memories of that type exist', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [
                    { id: 'mem1', type: 'world' },
                    { id: 'mem2', type: 'character' },
                ],
            };
            const { deleteMemoriesByType } = await import('../../src/store/chat-data.js');
            const count = await deleteMemoriesByType('reflection');
            expect(count).toBe(0);
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY]).toHaveLength(2);
        });

        it('handles empty memories array', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [],
            };
            const { deleteMemoriesByType } = await import('../../src/store/chat-data.js');
            const count = await deleteMemoriesByType('reflection');
            expect(count).toBe(0);
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY]).toEqual([]);
        });
    });

    describe('deleteCurrentChatData', () => {
        it('deletes openvault key from chatMetadata', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: '1' }],
            };
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: vi.fn().mockResolvedValue(undefined),
            });
            expect(await deleteCurrentChatData()).toBe(true);
            expect(mockContext.chatMetadata[METADATA_KEY]).toBeUndefined();
        });

        it('only unhides messages tagged by OpenVault, preserves ST-native hidden messages', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: '1' }],
            };
            mockContext.chat = [
                { is_system: false }, // visible — no change
                { is_system: true, is_user: true }, // ST-native hidden (e.g. Author's Note)
                { is_system: true, openvault_hidden: true }, // OpenVault hidden — should unhide
                { is_system: true }, // ST-native hidden — should stay hidden
            ];
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: vi.fn().mockResolvedValue(undefined),
            });

            await deleteCurrentChatData();

            expect(mockContext.chat[0].is_system).toBe(false); // unchanged
            expect(mockContext.chat[1].is_system).toBe(true); // ST-native preserved
            expect(mockContext.chat[2].is_system).toBe(false); // OV-hidden unhid
            expect(mockContext.chat[3].is_system).toBe(true); // ST-native preserved
        });
    });

    describe('addMemories', () => {
        it('appends memories to the store', () => {
            mockContext.chatMetadata[METADATA_KEY] = { [MEMORIES_KEY]: [{ id: 'existing' }] };
            addMemories([{ id: 'new1' }, { id: 'new2' }]);
            expect(getOpenVaultData()[MEMORIES_KEY]).toEqual([{ id: 'existing' }, { id: 'new1' }, { id: 'new2' }]);
        });

        it('initializes memories array if missing', () => {
            mockContext.chatMetadata[METADATA_KEY] = {};
            addMemories([{ id: 'first' }]);
            expect(getOpenVaultData()[MEMORIES_KEY]).toEqual([{ id: 'first' }]);
        });

        it('no-ops on empty array', () => {
            mockContext.chatMetadata[METADATA_KEY] = { [MEMORIES_KEY]: [{ id: 'existing' }] };
            addMemories([]);
            expect(getOpenVaultData()[MEMORIES_KEY]).toEqual([{ id: 'existing' }]);
        });

        it('no-ops when context unavailable', () => {
            setDeps({
                console: mockConsole,
                getContext: () => null,
                getExtensionSettings: () => ({}),
            });
            expect(() => addMemories([{ id: 'x' }])).not.toThrow();
        });
    });

    describe('markMessagesProcessed', () => {
        it('appends fingerprints to processed list', () => {
            mockContext.chatMetadata[METADATA_KEY] = { processed_message_ids: ['fp1'] };
            markMessagesProcessed(['fp2', 'fp3']);
            expect(getOpenVaultData().processed_message_ids).toEqual(['fp1', 'fp2', 'fp3']);
        });

        it('initializes processed list if missing', () => {
            mockContext.chatMetadata[METADATA_KEY] = {};
            markMessagesProcessed(['fp1']);
            expect(getOpenVaultData().processed_message_ids).toEqual(['fp1']);
        });

        it('no-ops on empty array', () => {
            mockContext.chatMetadata[METADATA_KEY] = { processed_message_ids: ['fp1'] };
            markMessagesProcessed([]);
            expect(getOpenVaultData().processed_message_ids).toEqual(['fp1']);
        });
    });

    describe('incrementGraphMessageCount', () => {
        it('increments existing count', () => {
            mockContext.chatMetadata[METADATA_KEY] = { graph_message_count: 10 };
            incrementGraphMessageCount(5);
            expect(getOpenVaultData().graph_message_count).toBe(15);
        });

        it('initializes from zero if missing', () => {
            mockContext.chatMetadata[METADATA_KEY] = {};
            incrementGraphMessageCount(3);
            expect(getOpenVaultData().graph_message_count).toBe(3);
        });

        it('no-ops when context unavailable', () => {
            setDeps({
                console: mockConsole,
                getContext: () => null,
                getExtensionSettings: () => ({}),
            });
            expect(() => incrementGraphMessageCount(5)).not.toThrow();
        });
    });
});

describe('deleteEntity', () => {
    let mockContext;

    beforeEach(() => {
        // Use a stable context reference so getOpenVaultData() always returns the same object
        mockContext = { chatMetadata: { [METADATA_KEY]: {} }, chatId: 'test-chat-123' };
        setDeps({
            getContext: () => mockContext,
            saveChatConditional: vi.fn(),
        });
        // Initialize graph data
        mockContext.chatMetadata[METADATA_KEY].graph = {
            nodes: {},
            edges: {},
            _mergeRedirects: {},
        };
    });

    it('should delete entity with no edges', async () => {
        const data = getOpenVaultData();
        data.graph.nodes.marcus_hale = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
        });

        const result = await deleteEntity('marcus_hale');

        expect(result.success).toBe(true);
        expect(data.graph.nodes.marcus_hale).toBeUndefined();
    });

    it('should delete entity and remove connected edges', async () => {
        const data = getOpenVaultData();
        data.graph.nodes.marcus_hale = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
        });
        data.graph.nodes.tavern = buildMockGraphNode({
            name: 'The Tavern',
            type: 'PLACE',
            description: 'A pub',
        });
        data.graph.edges.marcus_hale__tavern = {
            source: 'marcus_hale',
            target: 'tavern',
            relation: 'frequents',
        };
        data.graph.edges.tavern__marcus_hale = {
            source: 'tavern',
            target: 'marcus_hale',
            relation: 'patron',
        };

        const result = await deleteEntity('marcus_hale');

        expect(result.success).toBe(true);
        expect(data.graph.nodes.marcus_hale).toBeUndefined();
        expect(data.graph.edges.marcus_hale__tavern).toBeUndefined();
        expect(data.graph.edges.tavern__marcus_hale).toBeUndefined();
    });

    it('should clean up merge redirects when deleting entity', async () => {
        const data = getOpenVaultData();
        data.graph.nodes.marcus_hale = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
        });
        data.graph._mergeRedirects = {
            old_name: 'marcus_hale',
            marcus_hale: 'new_name',
        };

        await deleteEntity('marcus_hale');

        expect(data.graph._mergeRedirects.old_name).toBeUndefined();
        expect(data.graph._mergeRedirects.marcus_hale).toBeUndefined();
    });

    it('should handle missing _mergeRedirects without error', async () => {
        const data = getOpenVaultData();
        data.graph.nodes.marcus_hale = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
        });
        // Intentionally no _mergeRedirects field (simulates older data structure)
        delete data.graph._mergeRedirects;

        const result = await deleteEntity('marcus_hale');

        expect(result.success).toBe(true);
        expect(data.graph.nodes.marcus_hale).toBeUndefined();
    });

    it('should return failure for non-existent entity', async () => {
        const result = await deleteEntity('non_existent');
        expect(result.success).toBe(false);
    });
});

describe('updateEntity', () => {
    let mockContext;

    beforeEach(() => {
        // Use a stable context reference so getOpenVaultData() always returns the same object
        mockContext = { chatMetadata: { [METADATA_KEY]: {} }, chatId: 'test-chat-123' };
        setDeps({
            getContext: () => mockContext,
            saveChatConditional: vi.fn(),
        });
        // Initialize graph data
        mockContext.chatMetadata[METADATA_KEY].graph = {
            nodes: {},
            edges: {},
            _mergeRedirects: {},
        };
    });

    it('should update entity description without rename', async () => {
        const data = getOpenVaultData();
        const key = normalizeKey('Marcus Hale');
        data.graph.nodes[key] = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A former soldier',
        });

        const result = await updateEntity(key, {
            description: 'A former soldier turned mercenary',
        });

        expect(result.key).toBe(key);
        expect(data.graph.nodes[key].description).toBe('A former soldier turned mercenary');
    });

    it('should rename entity and rewrite edges', async () => {
        const data = getOpenVaultData();
        const oldKey = normalizeKey('Marcus Hale');
        const newKey = normalizeKey('Marcus the Brave');
        const tavernKey = normalizeKey('The Tavern');
        const oldEdgeKey = `${oldKey}__${tavernKey}`;
        const newEdgeKey = `${newKey}__${tavernKey}`;

        data.graph.nodes[oldKey] = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
        });
        data.graph.nodes[tavernKey] = buildMockGraphNode({
            name: 'The Tavern',
            type: 'PLACE',
            description: 'A pub',
        });
        data.graph.edges[oldEdgeKey] = {
            source: oldKey,
            target: tavernKey,
            relation: 'frequents',
        };

        const result = await updateEntity(oldKey, {
            name: 'Marcus the Brave',
        });

        expect(result.key).toBe(newKey);
        expect(data.graph.nodes[newKey]).toBeDefined();
        expect(data.graph.nodes[oldKey]).toBeUndefined();
        expect(data.graph.edges[newEdgeKey]).toBeDefined();
        expect(data.graph.edges[oldEdgeKey]).toBeUndefined();
        expect(data.graph._mergeRedirects[oldKey]).toBe(newKey);
    });

    it('should update existing redirects that point to oldKey on rename', async () => {
        const data = getOpenVaultData();
        const oldKey = normalizeKey('Marcus Hale');
        const newKey = normalizeKey('Marcus the Brave');
        const aliasKey = normalizeKey('Marc');

        // Simulate a prior merge: "Marc" was merged into "Marcus Hale"
        data.graph._mergeRedirects[aliasKey] = oldKey;

        data.graph.nodes[oldKey] = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
        });

        const result = await updateEntity(oldKey, { name: 'Marcus the Brave' });

        expect(result.key).toBe(newKey);
        // The old redirect should be updated, not left orphaned
        expect(data.graph._mergeRedirects[aliasKey]).toBe(newKey);
        expect(data.graph._mergeRedirects[oldKey]).toBe(newKey);
    });

    it('should block rename to existing entity name', async () => {
        const data = getOpenVaultData();
        const marcusKey = normalizeKey('Marcus Hale');
        const johnKey = normalizeKey('John Doe');

        data.graph.nodes[marcusKey] = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
        });
        data.graph.nodes[johnKey] = buildMockGraphNode({
            name: 'John Doe',
            type: 'PERSON',
            description: 'Another person',
        });

        const result = await updateEntity(marcusKey, {
            name: 'John Doe',
        });

        expect(result).toBeNull();
        expect(data.graph.nodes[marcusKey]).toBeDefined();
    });

    it('should update aliases array', async () => {
        const data = getOpenVaultData();
        const key = normalizeKey('Marcus Hale');
        data.graph.nodes[key] = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
            aliases: ['masked figure'],
        });

        const result = await updateEntity(key, {
            aliases: ['masked figure', 'the stranger'],
        });

        expect(result.key).toBe(key);
        expect(data.graph.nodes[key].aliases).toEqual(['masked figure', 'the stranger']);
    });

    it('should merge edges on collision during entity rename', async () => {
        const data = getOpenVaultData();
        const entityA = normalizeKey('Alice');
        const entityB = normalizeKey('Bob');
        const entityC = normalizeKey('Charlie');

        data.graph.nodes[entityA] = buildMockGraphNode({ name: 'Alice', type: 'PERSON' });
        data.graph.nodes[entityC] = buildMockGraphNode({ name: 'Charlie', type: 'PERSON' });

        // C->A (will be rewritten to C->B on rename)
        data.graph.edges[`${entityC}__${entityA}`] = {
            source: entityC,
            target: entityA,
            description: 'old friends',
            weight: 3,
        };
        // C->B (already exists — will collide when A is renamed to B)
        data.graph.edges[`${entityC}__${entityB}`] = {
            source: entityC,
            target: entityB,
            description: 'teammates',
            weight: 2,
        };

        // EntityB node deleted (simulates prior merge) so rename isn't blocked
        const result = await updateEntity(entityA, { name: 'Bob' });
        const bobKey = normalizeKey('Bob');

        expect(result.key).toBe(bobKey);
        const mergedEdge = data.graph.edges[`${entityC}__${bobKey}`];
        expect(mergedEdge).toBeDefined();
        expect(mergedEdge.weight).toBe(5); // 3 + 2
        expect(mergedEdge.description).toContain('old friends');
        expect(mergedEdge.description).toContain('teammates');
        expect(data.graph.edges[`${entityC}__${entityA}`]).toBeUndefined();
    });

    it('should block rename to a name that exists in _mergeRedirects', async () => {
        const data = getOpenVaultData();
        const marcusKey = normalizeKey('Marcus Hale');
        const bobKey = normalizeKey('Bob');

        data.graph.nodes[marcusKey] = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
        });
        // Simulate prior merge: Bob was merged into someone else
        data.graph._mergeRedirects[bobKey] = marcusKey;

        const result = await updateEntity(marcusKey, { name: 'Bob' });

        expect(result).toBeNull();
        expect(data.graph.nodes[marcusKey]).toBeDefined();
    });

    it('should flatten redirect chains when renaming through merged keys', async () => {
        const data = getOpenVaultData();
        const aliceKey = normalizeKey('Alice');
        const daveKey = normalizeKey('Dave');

        // Alice is a real node
        data.graph.nodes[aliceKey] = buildMockGraphNode({
            name: 'Alice',
            type: 'PERSON',
            description: 'A character',
        });

        // Simulate a redirect chain: bob → alice, charlie → alice
        // (bob and charlie were both merged into alice)
        data.graph._mergeRedirects[normalizeKey('Bob')] = aliceKey;
        data.graph._mergeRedirects[normalizeKey('Charlie')] = aliceKey;

        // Rename alice → dave
        const result = await updateEntity(aliceKey, { name: 'Dave' });

        expect(result.key).toBe(daveKey);
        // Both bob and charlie should now point directly to dave
        expect(data.graph._mergeRedirects[normalizeKey('Bob')]).toBe(daveKey);
        expect(data.graph._mergeRedirects[normalizeKey('Charlie')]).toBe(daveKey);
        expect(data.graph._mergeRedirects[aliceKey]).toBe(daveKey);
    });
});
