/**
 * Tests for src/utils.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import {
    withTimeout,
    getOpenVaultData,
    getCurrentChatId,
    saveOpenVaultData,
    showToast,
    safeSetExtensionPrompt,
    generateId,
    escapeHtml,
    log,
    getExtractedMessageIds,
    getUnextractedMessageIds,
    isExtensionEnabled,
    isAutomaticMode,
    safeParseJSON,
    parseJsonFromMarkdown,
    sortMemoriesBySequence,
} from '../src/utils.js';
import { extensionName, METADATA_KEY, MEMORIES_KEY, CHARACTERS_KEY, RELATIONSHIPS_KEY, LAST_PROCESSED_KEY } from '../src/constants.js';

describe('utils', () => {
    let mockConsole;
    let mockContext;

    beforeEach(() => {
        mockConsole = {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        mockContext = {
            chatMetadata: {},
            chatId: 'test-chat-123',
        };
        setDeps({
            console: mockConsole,
            getContext: () => mockContext,
            getExtensionSettings: () => ({
                [extensionName]: { enabled: true, debugMode: true }
            }),
        });
    });

    afterEach(() => {
        resetDeps();
    });

    describe('withTimeout', () => {
        it('resolves when promise completes before timeout', async () => {
            const promise = Promise.resolve('success');
            const result = await withTimeout(promise, 1000, 'Test');
            expect(result).toBe('success');
        });

        it('rejects when promise exceeds timeout', async () => {
            const promise = new Promise(resolve => setTimeout(resolve, 100));
            await expect(withTimeout(promise, 10, 'Test')).rejects.toThrow('Test timed out after 10ms');
        });
    });

    describe('getOpenVaultData', () => {
        it('creates empty data structure if none exists', () => {
            const data = getOpenVaultData();
            expect(data).toEqual({
                [MEMORIES_KEY]: [],
                [CHARACTERS_KEY]: {},
                [RELATIONSHIPS_KEY]: {},
                [LAST_PROCESSED_KEY]: -1,
            });
        });

        it('returns existing data if present', () => {
            const existingData = {
                [MEMORIES_KEY]: [{ id: '1', summary: 'test' }],
                [CHARACTERS_KEY]: {},
                [RELATIONSHIPS_KEY]: {},
                [LAST_PROCESSED_KEY]: 5,
            };
            mockContext.chatMetadata[METADATA_KEY] = existingData;
            const data = getOpenVaultData();
            expect(data).toBe(existingData);
        });

        it('returns null if context is not available', () => {
            setDeps({
                console: mockConsole,
                getContext: () => null,
            });
            const data = getOpenVaultData();
            expect(data).toBeNull();
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
        it('calls saveChatConditional and returns true on success', async () => {
            const mockSave = vi.fn().mockResolvedValue(undefined);
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({ [extensionName]: { debugMode: true } }),
                saveChatConditional: mockSave,
            });

            const result = await saveOpenVaultData();
            expect(result).toBe(true);
            expect(mockSave).toHaveBeenCalled();
        });

        it('returns false and shows error on failure', async () => {
            const mockShowToast = vi.fn();
            setDeps({
                console: mockConsole,
                getContext: () => mockContext,
                getExtensionSettings: () => ({ [extensionName]: { debugMode: false } }),
                saveChatConditional: vi.fn().mockRejectedValue(new Error('Save failed')),
                showToast: mockShowToast,
            });

            const result = await saveOpenVaultData();
            expect(result).toBe(false);
            expect(mockConsole.error).toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith('error', 'Failed to save data: Save failed', 'OpenVault', {});
        });
    });

    describe('showToast', () => {
        it('delegates to deps.showToast', () => {
            const mockShowToast = vi.fn();
            setDeps({
                showToast: mockShowToast,
            });

            showToast('success', 'Test message', 'Title', { timeout: 1000 });
            expect(mockShowToast).toHaveBeenCalledWith('success', 'Test message', 'Title', { timeout: 1000 });
        });
    });

    describe('safeSetExtensionPrompt', () => {
        it('calls setExtensionPrompt and returns true on success', () => {
            const mockSetPrompt = vi.fn();
            setDeps({
                console: mockConsole,
                setExtensionPrompt: mockSetPrompt,
                extension_prompt_types: { IN_PROMPT: 3 },
            });

            const result = safeSetExtensionPrompt('test content');
            expect(result).toBe(true);
            expect(mockSetPrompt).toHaveBeenCalledWith(extensionName, 'test content', 3, 0);
        });

        it('returns false on error', () => {
            setDeps({
                console: mockConsole,
                setExtensionPrompt: () => { throw new Error('Prompt failed'); },
                extension_prompt_types: { IN_PROMPT: 3 },
            });

            const result = safeSetExtensionPrompt('test content');
            expect(result).toBe(false);
            expect(mockConsole.error).toHaveBeenCalled();
        });
    });

    describe('generateId', () => {
        it('generates unique IDs with timestamp prefix', () => {
            setDeps({
                Date: { now: () => 1234567890 },
            });

            const id = generateId();
            expect(id).toMatch(/^1234567890-[a-z0-9]+$/);
        });

        it('generates different IDs on subsequent calls', () => {
            let time = 1000;
            setDeps({
                Date: { now: () => time++ },
            });

            const id1 = generateId();
            const id2 = generateId();
            expect(id1).not.toBe(id2);
        });
    });

    describe('escapeHtml', () => {
        it('escapes HTML special characters', () => {
            expect(escapeHtml('<script>alert("xss")</script>')).toBe(
                '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
            );
        });

        it('escapes ampersands', () => {
            expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
        });

        it('escapes single quotes', () => {
            expect(escapeHtml("it's")).toBe('it&#039;s');
        });

        it('returns empty string for falsy input', () => {
            expect(escapeHtml(null)).toBe('');
            expect(escapeHtml(undefined)).toBe('');
            expect(escapeHtml('')).toBe('');
        });

        it('converts numbers to string', () => {
            expect(escapeHtml(123)).toBe('123');
        });
    });

    describe('log', () => {
        it('logs message when debug mode is enabled', () => {
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({ [extensionName]: { debugMode: true } }),
            });

            log('test message');
            expect(mockConsole.log).toHaveBeenCalledWith('[OpenVault] test message');
        });

        it('does not log when debug mode is disabled', () => {
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({ [extensionName]: { debugMode: false } }),
            });

            log('test message');
            expect(mockConsole.log).not.toHaveBeenCalled();
        });

        it('handles missing settings gracefully', () => {
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({}),
            });

            log('test message');
            expect(mockConsole.log).not.toHaveBeenCalled();
        });
    });

    describe('getExtractedMessageIds', () => {
        it('returns set of all message IDs from memories', () => {
            const data = {
                [MEMORIES_KEY]: [
                    { id: '1', message_ids: [0, 1, 2] },
                    { id: '2', message_ids: [3, 4] },
                ],
            };
            const ids = getExtractedMessageIds(data);
            expect(ids).toEqual(new Set([0, 1, 2, 3, 4]));
        });

        it('returns empty set for null data', () => {
            expect(getExtractedMessageIds(null)).toEqual(new Set());
        });

        it('returns empty set for empty memories', () => {
            expect(getExtractedMessageIds({ [MEMORIES_KEY]: [] })).toEqual(new Set());
        });

        it('handles memories without message_ids', () => {
            const data = {
                [MEMORIES_KEY]: [
                    { id: '1', message_ids: [0, 1] },
                    { id: '2' }, // no message_ids
                ],
            };
            const ids = getExtractedMessageIds(data);
            expect(ids).toEqual(new Set([0, 1]));
        });
    });

    describe('getUnextractedMessageIds', () => {
        it('returns indices not in extracted set', () => {
            const chat = [{}, {}, {}, {}, {}]; // 5 messages
            const extractedIds = new Set([0, 2, 4]);
            const result = getUnextractedMessageIds(chat, extractedIds);
            expect(result).toEqual([1, 3]);
        });

        it('excludes last N messages when specified', () => {
            const chat = [{}, {}, {}, {}, {}]; // 5 messages
            const extractedIds = new Set([0]);
            const result = getUnextractedMessageIds(chat, extractedIds, 2);
            expect(result).toEqual([1, 2]); // excludes 3, 4
        });

        it('returns all indices for empty extracted set', () => {
            const chat = [{}, {}, {}];
            const result = getUnextractedMessageIds(chat, new Set());
            expect(result).toEqual([0, 1, 2]);
        });
    });

    describe('isExtensionEnabled', () => {
        it('returns true when enabled is true', () => {
            setDeps({
                getExtensionSettings: () => ({ [extensionName]: { enabled: true } }),
            });
            expect(isExtensionEnabled()).toBe(true);
        });

        it('returns false when enabled is false', () => {
            setDeps({
                getExtensionSettings: () => ({ [extensionName]: { enabled: false } }),
            });
            expect(isExtensionEnabled()).toBe(false);
        });

        it('returns false when settings missing', () => {
            setDeps({
                getExtensionSettings: () => ({}),
            });
            expect(isExtensionEnabled()).toBe(false);
        });
    });

    describe('isAutomaticMode', () => {
        it('returns true when enabled is true (automatic mode is now implicit)', () => {
            setDeps({
                getExtensionSettings: () => ({
                    [extensionName]: { enabled: true }
                }),
            });
            expect(isAutomaticMode()).toBe(true);
        });

        it('returns false when disabled', () => {
            setDeps({
                getExtensionSettings: () => ({
                    [extensionName]: { enabled: false }
                }),
            });
            expect(isAutomaticMode()).toBe(false);
        });
    });

    describe('safeParseJSON', () => {
        it('parses valid JSON', () => {
            const result = safeParseJSON('{"key": "value"}');
            expect(result).toEqual({ key: 'value' });
        });

        it('extracts JSON from markdown code block', () => {
            const result = safeParseJSON('```json\n{"key": "value"}\n```');
            expect(result).toEqual({ key: 'value' });
        });

        it('handles arrays', () => {
            const result = safeParseJSON('[1, 2, 3]');
            expect(result).toEqual([1, 2, 3]);
        });

        it('repairs malformed JSON with trailing comma', () => {
            const result = safeParseJSON('{"key": "value",}');
            expect(result).toEqual({ key: 'value' });
        });

        it('repairs JSON with unquoted keys', () => {
            const result = safeParseJSON('{key: "value"}');
            expect(result).toEqual({ key: 'value' });
        });

        it('repairs JSON with single quotes', () => {
            const result = safeParseJSON("{'key': 'value'}");
            expect(result).toEqual({ key: 'value' });
        });

        it('returns null on completely invalid input', () => {
            const result = safeParseJSON('not json at all');
            expect(result).toBeNull();
            expect(mockConsole.error).toHaveBeenCalled();
        });

        it('handles nested objects', () => {
            const result = safeParseJSON('{"outer": {"inner": "value"}}');
            expect(result).toEqual({ outer: { inner: 'value' } });
        });
    });

    describe('parseJsonFromMarkdown', () => {
        it('parses raw JSON', () => {
            const result = parseJsonFromMarkdown('{"key": "value"}');
            expect(result).toEqual({ key: 'value' });
        });

        it('extracts JSON from markdown code block', () => {
            const result = parseJsonFromMarkdown('```json\n{"key": "value"}\n```');
            expect(result).toEqual({ key: 'value' });
        });

        it('extracts JSON from untyped code block', () => {
            const result = parseJsonFromMarkdown('```\n{"key": "value"}\n```');
            expect(result).toEqual({ key: 'value' });
        });

        it('handles arrays', () => {
            const result = parseJsonFromMarkdown('[1, 2, 3]');
            expect(result).toEqual([1, 2, 3]);
        });

        it('throws on invalid JSON', () => {
            expect(() => parseJsonFromMarkdown('not json')).toThrow();
        });

        it('handles whitespace around JSON', () => {
            const result = parseJsonFromMarkdown('  \n  {"key": "value"}  \n  ');
            expect(result).toEqual({ key: 'value' });
        });
    });

    describe('sortMemoriesBySequence', () => {
        it('sorts by sequence ascending by default', () => {
            const memories = [
                { id: '1', sequence: 30 },
                { id: '2', sequence: 10 },
                { id: '3', sequence: 20 },
            ];
            const sorted = sortMemoriesBySequence(memories);
            expect(sorted.map(m => m.id)).toEqual(['2', '3', '1']);
        });

        it('sorts by sequence descending when specified', () => {
            const memories = [
                { id: '1', sequence: 30 },
                { id: '2', sequence: 10 },
                { id: '3', sequence: 20 },
            ];
            const sorted = sortMemoriesBySequence(memories, false);
            expect(sorted.map(m => m.id)).toEqual(['1', '3', '2']);
        });

        it('falls back to created_at when sequence missing', () => {
            const memories = [
                { id: '1', created_at: 300 },
                { id: '2', created_at: 100 },
                { id: '3', sequence: 200 },
            ];
            const sorted = sortMemoriesBySequence(memories);
            expect(sorted.map(m => m.id)).toEqual(['2', '3', '1']);
        });

        it('does not mutate original array', () => {
            const memories = [
                { id: '1', sequence: 30 },
                { id: '2', sequence: 10 },
            ];
            const sorted = sortMemoriesBySequence(memories);
            expect(memories[0].id).toBe('1');
            expect(sorted).not.toBe(memories);
        });

        it('handles empty array', () => {
            expect(sortMemoriesBySequence([])).toEqual([]);
        });
    });
});
