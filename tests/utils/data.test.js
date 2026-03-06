import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS_KEY, extensionName, LAST_PROCESSED_KEY, MEMORIES_KEY, METADATA_KEY } from '../../src/constants.js';
import { resetDeps, setDeps } from '../../src/deps.js';
import {
    deleteCurrentChatData,
    deleteCurrentChatEmbeddings,
    deleteMemory,
    generateId,
    getCurrentChatId,
    getOpenVaultData,
    saveOpenVaultData,
    updateMemory,
} from '../../src/utils/data.js';

describe('data', () => {
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
        it('creates empty data structure if none exists', () => {
            const data = getOpenVaultData();
            expect(data).toEqual({
                [MEMORIES_KEY]: [],
                [CHARACTERS_KEY]: {},
                [LAST_PROCESSED_KEY]: -1,
            });
        });

        it('returns existing data if present', () => {
            const existing = {
                [MEMORIES_KEY]: [{ id: '1' }],
                [CHARACTERS_KEY]: {},
                [LAST_PROCESSED_KEY]: 5,
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
    });

    describe('deleteCurrentChatEmbeddings', () => {
        it('deletes embeddings from all memories', async () => {
            mockContext.chatMetadata[METADATA_KEY] = {
                [MEMORIES_KEY]: [{ id: '1', embedding: [1, 2] }, { id: '2', embedding: [3, 4] }, { id: '3' }],
            };
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({
                    [extensionName]: { debugMode: true },
                }),
                saveChatConditional: vi.fn().mockResolvedValue(undefined),
            });
            const count = await deleteCurrentChatEmbeddings();
            expect(count).toBe(2);
            expect(mockContext.chatMetadata[METADATA_KEY][MEMORIES_KEY][0].embedding).toBeUndefined();
        });
    });
});
