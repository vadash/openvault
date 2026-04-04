import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS_KEY, extensionName, MEMORIES_KEY, METADATA_KEY } from '../../src/constants.js';
import { resetDeps, setDeps } from '../../src/deps.js';
import {
    addMemories,
    deleteCurrentChatData,
    deleteMemory,
    generateId,
    getCurrentChatId,
    getOpenVaultData,
    incrementGraphMessageCount,
    markMessagesProcessed,
    saveOpenVaultData,
    updateMemory,
} from '../../src/store/chat-data.js';

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
        it('creates complete v2 schema for new chats', () => {
            const data = getOpenVaultData();
            expect(data.schema_version).toBe(2);
            expect(data.memories).toEqual([]);
            expect(data.character_states).toEqual({});
            expect(data.graph).toBeDefined();
            expect(data.communities).toEqual({});
            expect(data.graph_message_count).toBe(0);
            expect(data.processed_message_ids).toEqual([]);
        });

        it('creates empty data structure if none exists', () => {
            const data = getOpenVaultData();
            expect(data).toEqual({
                schema_version: 2,
                [MEMORIES_KEY]: [],
                [CHARACTERS_KEY]: {},
                processed_message_ids: [],
                reflection_state: {},
                graph: expect.any(Object),
                communities: {},
                graph_message_count: 0,
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
            expect(result).toBe(true);
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
            expect(await updateMemory('nonexistent', { summary: 'x' })).toBe(false);
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
            expect(result).toBe(true);
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
            expect(result).toBe(true);
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
            expect(await deleteMemory('mem1')).toBe(true);
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY]).toHaveLength(1);
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY][0].id).toBe('mem2');
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

        it('purges ST Vector collection when using st_vector', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: '1' }],
            };
            mockContext.chatId = 'test-chat-456';

            const mockFetch = vi.fn().mockResolvedValue({ ok: true });

            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        debugMode: true,
                        embeddingSource: 'st_vector',
                    },
                }),
                saveChatConditional: vi.fn().mockResolvedValue(undefined),
                fetch: mockFetch,
                getRequestHeaders: () => ({ 'X-CSRF-Token': 'test-token' }),
            });

            await deleteCurrentChatData();

            // Verify purge was called via fetch
            const fetchCalls = mockFetch.mock.calls;
            const purgeCall = fetchCalls.find((call) => call[0] === '/api/vector/purge');
            expect(purgeCall).toBeDefined();
            expect(JSON.parse(purgeCall[1].body)).toMatchObject({
                collectionId: expect.stringContaining('test-chat-456'),
            });
        });

        it('does not purge ST collection when using local embeddings', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: '1' }],
            };
            mockContext.chatId = 'test-chat-789';

            const mockFetch = vi.fn().mockResolvedValue({ ok: true });

            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        debugMode: true,
                        embeddingSource: 'multilingual-e5-small',
                    },
                }),
                saveChatConditional: vi.fn().mockResolvedValue(undefined),
                fetch: mockFetch,
            });

            await deleteCurrentChatData();

            // Verify no purge call was made
            const purgeCalls = mockFetch.mock.calls.filter((call) => call[0] === '/api/vector/purge');
            expect(purgeCalls).toHaveLength(0);
        });

        it('continues with OpenVault data clearing even if ST purge fails', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: '1' }],
            };
            mockContext.chatId = 'test-chat-fail';

            const mockSave = vi.fn().mockResolvedValue(undefined);

            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: {
                        debugMode: true,
                        embeddingSource: 'st_vector',
                    },
                }),
                saveChatConditional: mockSave,
                fetch: vi.fn().mockRejectedValue(new Error('Network error')),
                getRequestHeaders: () => ({ 'X-CSRF-Token': 'test-token' }),
            });

            // Should not throw
            const result = await deleteCurrentChatData();
            expect(result).toBe(true);

            // Verify OpenVault data was still cleared
            expect(mockContext.chatMetadata[METADATA_KEY]).toBeUndefined();

            // Verify warning was logged
            expect(mockConsole.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to purge ST collection'),
                expect.any(Error)
            );
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
