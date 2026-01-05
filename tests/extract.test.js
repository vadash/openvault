/**
 * Tests for src/extraction/extract.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import { extensionName, MEMORIES_KEY, LAST_PROCESSED_KEY, LAST_BATCH_KEY } from '../src/constants.js';

// Mock dependencies
vi.mock('../src/utils.js', () => ({
    getOpenVaultData: vi.fn(),
    saveOpenVaultData: vi.fn(),
    showToast: vi.fn(),
    log: vi.fn(),
    sortMemoriesBySequence: vi.fn(),
    isExtensionEnabled: vi.fn(),
}));

vi.mock('../src/llm.js', () => ({
    callLLMForExtraction: vi.fn(),
}));

vi.mock('../src/ui/status.js', () => ({
    setStatus: vi.fn(),
}));

vi.mock('../src/ui/browser.js', () => ({
    refreshAllUI: vi.fn(),
}));

vi.mock('../src/prompts.js', () => ({
    buildExtractionPrompt: vi.fn().mockReturnValue('extraction prompt'),
}));

vi.mock('../src/extraction/parser.js', () => ({
    parseExtractionResult: vi.fn(),
    updateCharacterStatesFromEvents: vi.fn(),
    updateRelationshipsFromEvents: vi.fn(),
    applyRelationshipDecay: vi.fn(),
}));

vi.mock('../src/embeddings.js', () => ({
    getEmbedding: vi.fn(),
    isEmbeddingsEnabled: vi.fn(),
}));

// Import after mocks
import {
    getRecentMemoriesForContext,
    extractMemories,
} from '../src/extraction/extract.js';
import { getOpenVaultData, saveOpenVaultData, showToast, log, sortMemoriesBySequence, isExtensionEnabled } from '../src/utils.js';
import { callLLMForExtraction } from '../src/llm.js';
import { setStatus } from '../src/ui/status.js';
import { refreshAllUI } from '../src/ui/browser.js';
import { buildExtractionPrompt } from '../src/prompts.js';
import { parseExtractionResult, updateCharacterStatesFromEvents, updateRelationshipsFromEvents } from '../src/extraction/parser.js';
import { getEmbedding, isEmbeddingsEnabled } from '../src/embeddings.js';

describe('extract', () => {
    let mockConsole;
    let mockSettings;
    let mockContext;
    let mockData;

    beforeEach(() => {
        mockConsole = {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        mockSettings = {
            enabled: true,
            debugMode: true,
            messagesPerExtraction: 5,
            memoryContextCount: 3,
        };

        mockContext = {
            chat: [],
            name1: 'User',
            name2: 'Alice',
            characterId: 'char1',
            characters: {
                char1: { description: 'A friendly character' },
            },
            powerUserSettings: {
                persona_description: 'A helpful persona',
            },
        };

        mockData = {
            [MEMORIES_KEY]: [],
            [LAST_PROCESSED_KEY]: -1,
        };

        setDeps({
            console: mockConsole,
            getExtensionSettings: () => ({ [extensionName]: mockSettings }),
            getContext: () => mockContext,
            Date: { now: () => 1000000 },
        });

        // Reset all mocks
        vi.clearAllMocks();

        // Default mock behaviors
        isExtensionEnabled.mockReturnValue(true);
        getOpenVaultData.mockReturnValue(mockData);
        saveOpenVaultData.mockResolvedValue();
        sortMemoriesBySequence.mockImplementation((memories, asc) => {
            return [...memories].sort((a, b) => asc ? a.sequence - b.sequence : b.sequence - a.sequence);
        });
        isEmbeddingsEnabled.mockReturnValue(false);
        callLLMForExtraction.mockResolvedValue('{}');
        parseExtractionResult.mockReturnValue([]);
    });

    afterEach(() => {
        resetDeps();
    });

    describe('getRecentMemoriesForContext', () => {
        it('returns empty array when count is 0', () => {
            mockData[MEMORIES_KEY] = [
                { id: '1', summary: 'Memory 1', sequence: 1 },
            ];

            const result = getRecentMemoriesForContext(0);

            expect(result).toEqual([]);
        });

        it('returns empty array when no data', () => {
            getOpenVaultData.mockReturnValue(null);

            const result = getRecentMemoriesForContext(5);

            expect(result).toEqual([]);
        });

        it('returns empty array when no memories', () => {
            mockData[MEMORIES_KEY] = [];

            const result = getRecentMemoriesForContext(5);

            expect(result).toEqual([]);
        });

        it('returns all memories when count is -1', () => {
            mockData[MEMORIES_KEY] = [
                { id: '1', summary: 'Memory 1', sequence: 1 },
                { id: '2', summary: 'Memory 2', sequence: 2 },
                { id: '3', summary: 'Memory 3', sequence: 3 },
            ];

            const result = getRecentMemoriesForContext(-1);

            expect(result).toHaveLength(3);
            expect(sortMemoriesBySequence).toHaveBeenCalledWith(mockData[MEMORIES_KEY], false);
        });

        it('returns limited memories when count > 0', () => {
            mockData[MEMORIES_KEY] = [
                { id: '1', summary: 'Memory 1', sequence: 1 },
                { id: '2', summary: 'Memory 2', sequence: 2 },
                { id: '3', summary: 'Memory 3', sequence: 3 },
                { id: '4', summary: 'Memory 4', sequence: 4 },
            ];
            // Mock sort returns newest first
            sortMemoriesBySequence.mockReturnValue([
                { id: '4', summary: 'Memory 4', sequence: 4 },
                { id: '3', summary: 'Memory 3', sequence: 3 },
                { id: '2', summary: 'Memory 2', sequence: 2 },
                { id: '1', summary: 'Memory 1', sequence: 1 },
            ]);

            const result = getRecentMemoriesForContext(2);

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('4');
            expect(result[1].id).toBe('3');
        });

        it('sorts memories by sequence (newest first)', () => {
            mockData[MEMORIES_KEY] = [
                { id: '1', summary: 'Old', sequence: 1 },
                { id: '2', summary: 'New', sequence: 5 },
            ];

            getRecentMemoriesForContext(5);

            expect(sortMemoriesBySequence).toHaveBeenCalledWith(mockData[MEMORIES_KEY], false);
        });
    });

    describe('extractMemories', () => {
        beforeEach(() => {
            mockContext.chat = [
                { mes: 'Hello', is_user: true },
                { mes: 'Hi there!', is_user: false, name: 'Alice' },
            ];
        });

        it('returns early and shows warning if extension disabled', async () => {
            isExtensionEnabled.mockReturnValue(false);

            const result = await extractMemories();

            expect(result).toBeUndefined();
            expect(showToast).toHaveBeenCalledWith('warning', 'OpenVault is disabled');
            expect(callLLMForExtraction).not.toHaveBeenCalled();
        });

        it('returns early if no chat messages', async () => {
            mockContext.chat = [];

            const result = await extractMemories();

            expect(result).toBeUndefined();
            expect(showToast).toHaveBeenCalledWith('warning', 'No chat messages to extract');
        });

        it('returns early if no data available', async () => {
            getOpenVaultData.mockReturnValue(null);

            const result = await extractMemories();

            expect(result).toBeUndefined();
            expect(showToast).toHaveBeenCalledWith('warning', 'No chat context available');
        });

        it('returns early if no new messages to extract', async () => {
            mockData[LAST_PROCESSED_KEY] = 10;
            mockContext.chat = [
                { mes: 'Old message', is_user: false },
            ];

            const result = await extractMemories();

            expect(result).toBeUndefined();
            expect(showToast).toHaveBeenCalledWith('info', 'No new messages to extract');
        });

        it('filters out system messages', async () => {
            mockContext.chat = [
                { mes: 'System message', is_system: true },
                { mes: 'User message', is_user: true },
                { mes: 'AI response', is_user: false, name: 'Alice' },
            ];
            parseExtractionResult.mockReturnValue([]);

            await extractMemories();

            // Build extraction prompt should be called with messages excluding system
            expect(buildExtractionPrompt).toHaveBeenCalled();
            const promptCall = buildExtractionPrompt.mock.calls[0][0];
            expect(promptCall).not.toContain('System message');
        });

        it('extracts specific messageIds when provided', async () => {
            mockContext.chat = [
                { mes: 'Message 0', is_user: true },
                { mes: 'Message 1', is_user: false, name: 'Alice' },
                { mes: 'Message 2', is_user: true },
                { mes: 'Message 3', is_user: false, name: 'Alice' },
            ];
            parseExtractionResult.mockReturnValue([]);

            await extractMemories([1, 3]);

            expect(buildExtractionPrompt).toHaveBeenCalled();
            const promptCall = buildExtractionPrompt.mock.calls[0][0];
            expect(promptCall).toContain('Message 1');
            expect(promptCall).toContain('Message 3');
            expect(promptCall).not.toContain('Message 0');
            expect(promptCall).not.toContain('Message 2');
        });

        it('sets status to extracting during extraction', async () => {
            parseExtractionResult.mockReturnValue([]);

            await extractMemories();

            expect(setStatus).toHaveBeenCalledWith('extracting');
        });

        it('builds extraction prompt with character context', async () => {
            parseExtractionResult.mockReturnValue([]);

            await extractMemories();

            expect(buildExtractionPrompt).toHaveBeenCalledWith(
                expect.any(String),
                'Alice',
                'User',
                expect.any(Array),
                'A friendly character',
                'A helpful persona'
            );
        });

        it('calls LLM for extraction', async () => {
            parseExtractionResult.mockReturnValue([]);

            await extractMemories();

            expect(callLLMForExtraction).toHaveBeenCalledWith('extraction prompt');
        });

        it('parses extraction result with correct params', async () => {
            callLLMForExtraction.mockResolvedValue('{"events": []}');
            parseExtractionResult.mockReturnValue([]);

            await extractMemories();

            expect(parseExtractionResult).toHaveBeenCalledWith(
                '{"events": []}',
                expect.any(Array),
                'Alice',
                'User',
                expect.stringContaining('batch_')
            );
        });

        it('stores new memories and updates metadata', async () => {
            const newEvents = [
                { id: 'evt1', summary: 'Event 1', importance: 3 },
                { id: 'evt2', summary: 'Event 2', importance: 4 },
            ];
            parseExtractionResult.mockReturnValue(newEvents);

            await extractMemories();

            expect(mockData[MEMORIES_KEY]).toHaveLength(2);
            expect(mockData[LAST_BATCH_KEY]).toMatch(/^batch_/);
            expect(saveOpenVaultData).toHaveBeenCalled();
        });

        it('updates character states and relationships', async () => {
            const newEvents = [
                { id: 'evt1', summary: 'Event 1', importance: 3 },
            ];
            parseExtractionResult.mockReturnValue(newEvents);

            await extractMemories();

            expect(updateCharacterStatesFromEvents).toHaveBeenCalledWith(newEvents, mockData);
            expect(updateRelationshipsFromEvents).toHaveBeenCalledWith(newEvents, mockData);
        });

        it('updates last processed message ID', async () => {
            mockContext.chat = [
                { mes: 'Message 0', is_user: true },
                { mes: 'Message 1', is_user: false },
                { mes: 'Message 2', is_user: true },
            ];
            parseExtractionResult.mockReturnValue([{ id: 'evt1', summary: 'Event' }]);

            await extractMemories();

            expect(mockData[LAST_PROCESSED_KEY]).toBe(2);
        });

        it('generates embeddings when enabled', async () => {
            isEmbeddingsEnabled.mockReturnValue(true);
            getEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
            const newEvents = [
                { id: 'evt1', summary: 'Event 1' },
            ];
            parseExtractionResult.mockReturnValue(newEvents);

            await extractMemories();

            expect(getEmbedding).toHaveBeenCalledWith('Event 1');
            expect(newEvents[0].embedding).toEqual([0.1, 0.2, 0.3]);
        });

        it('skips embedding if getEmbedding returns null', async () => {
            isEmbeddingsEnabled.mockReturnValue(true);
            getEmbedding.mockResolvedValue(null);
            const newEvents = [
                { id: 'evt1', summary: 'Event 1' },
            ];
            parseExtractionResult.mockReturnValue(newEvents);

            await extractMemories();

            expect(newEvents[0].embedding).toBeUndefined();
        });

        it('shows success toast and sets ready status', async () => {
            const newEvents = [
                { id: 'evt1', summary: 'Event 1' },
                { id: 'evt2', summary: 'Event 2' },
            ];
            parseExtractionResult.mockReturnValue(newEvents);

            await extractMemories();

            expect(showToast).toHaveBeenCalledWith('success', 'Extracted 2 memory events');
            expect(setStatus).toHaveBeenCalledWith('ready');
            expect(refreshAllUI).toHaveBeenCalled();
        });

        it('shows info toast when no events extracted', async () => {
            parseExtractionResult.mockReturnValue([]);

            await extractMemories();

            expect(showToast).toHaveBeenCalledWith('info', 'No significant events found in messages');
        });

        it('returns result with events count and messages processed', async () => {
            const newEvents = [
                { id: 'evt1', summary: 'Event 1' },
            ];
            parseExtractionResult.mockReturnValue(newEvents);
            mockContext.chat = [
                { mes: 'Message 0', is_user: true },
                { mes: 'Message 1', is_user: false },
            ];

            const result = await extractMemories();

            expect(result).toEqual({
                events_created: 1,
                messages_processed: 2,
            });
        });

        it('handles LLM errors gracefully', async () => {
            callLLMForExtraction.mockRejectedValue(new Error('LLM failed'));

            await expect(extractMemories()).rejects.toThrow('LLM failed');

            expect(mockConsole.error).toHaveBeenCalled();
            expect(showToast).toHaveBeenCalledWith('error', 'Extraction failed: LLM failed');
            expect(setStatus).toHaveBeenCalledWith('error');
        });

        it('includes recent memories in extraction prompt', async () => {
            mockSettings.memoryContextCount = 2;
            mockData[MEMORIES_KEY] = [
                { id: '1', summary: 'Old memory', sequence: 1 },
            ];
            sortMemoriesBySequence.mockReturnValue([
                { id: '1', summary: 'Old memory', sequence: 1 },
            ]);
            parseExtractionResult.mockReturnValue([]);

            await extractMemories();

            expect(buildExtractionPrompt).toHaveBeenCalledWith(
                expect.any(String),
                'Alice',
                'User',
                expect.arrayContaining([expect.objectContaining({ id: '1' })]),
                expect.any(String),
                expect.any(String)
            );
        });

        it('generates unique batch ID with timestamp', async () => {
            parseExtractionResult.mockReturnValue([{ id: 'evt1', summary: 'Event' }]);

            await extractMemories();

            expect(mockData[LAST_BATCH_KEY]).toMatch(/^batch_1000000_/);
        });
    });
});
