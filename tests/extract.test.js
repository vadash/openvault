/**
 * Tests for src/extraction/extract.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import { extensionName, MEMORIES_KEY, LAST_PROCESSED_KEY } from '../src/constants.js';

// Mock dependencies
vi.mock('../src/utils.js', () => ({
    getOpenVaultData: vi.fn(),
    saveOpenVaultData: vi.fn(),
    showToast: vi.fn(),
    log: vi.fn(),
    sortMemoriesBySequence: vi.fn(),
    sliceToTokenBudget: vi.fn(),
    isExtensionEnabled: vi.fn(),
    estimateTokens: vi.fn((text) => Math.ceil((text || '').length / 3.5)),
    getCurrentChatId: vi.fn(),
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
    enrichEventsWithEmbeddings: vi.fn(),
}));

vi.mock('../src/extraction/context-builder.js', () => ({
    selectMemoriesForExtraction: vi.fn(),
}));

// Import after mocks
import {
    extractMemories,
} from '../src/extraction/extract.js';
import { getOpenVaultData, saveOpenVaultData, showToast, sortMemoriesBySequence, sliceToTokenBudget, isExtensionEnabled, getCurrentChatId } from '../src/utils.js';
import { callLLMForExtraction } from '../src/llm.js';
import { setStatus } from '../src/ui/status.js';
import { refreshAllUI } from '../src/ui/browser.js';
import { buildExtractionPrompt } from '../src/prompts.js';
import { parseExtractionResult, updateCharacterStatesFromEvents, updateRelationshipsFromEvents } from '../src/extraction/parser.js';
import { getEmbedding, isEmbeddingsEnabled, enrichEventsWithEmbeddings } from '../src/embeddings.js';
import { selectMemoriesForExtraction } from '../src/extraction/context-builder.js';

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
            extractionRearviewTokens: 12000,
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
        saveOpenVaultData.mockResolvedValue(true);
        getCurrentChatId.mockReturnValue('test-chat-123');
        sortMemoriesBySequence.mockImplementation((memories, asc) => {
            return [...memories].sort((a, b) => asc ? a.sequence - b.sequence : b.sequence - a.sequence);
        });
        sliceToTokenBudget.mockImplementation((memories) => memories);
        isEmbeddingsEnabled.mockReturnValue(false);
        enrichEventsWithEmbeddings.mockResolvedValue(0);
        selectMemoriesForExtraction.mockReturnValue([]);
        callLLMForExtraction.mockResolvedValue('{}');
        parseExtractionResult.mockReturnValue([]);
    });

    afterEach(() => {
        resetDeps();
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
            const newEvents = [
                { id: 'evt1', summary: 'Event 1' },
            ];
            parseExtractionResult.mockReturnValue(newEvents);
            enrichEventsWithEmbeddings.mockResolvedValue(1);

            await extractMemories();

            expect(enrichEventsWithEmbeddings).toHaveBeenCalledWith(newEvents);
        });

        it('skips embedding if getEmbedding returns null', async () => {
            isEmbeddingsEnabled.mockReturnValue(true);
            const newEvents = [
                { id: 'evt1', summary: 'Event 1' },
            ];
            parseExtractionResult.mockReturnValue(newEvents);
            // enrichEventsWithEmbeddings returns 0 (no embeddings generated)
            enrichEventsWithEmbeddings.mockResolvedValue(0);

            await extractMemories();

            expect(enrichEventsWithEmbeddings).toHaveBeenCalledWith(newEvents);
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
            selectMemoriesForExtraction.mockReturnValue([
                { id: '1', summary: 'Old memory', sequence: 1 },
            ]);
            parseExtractionResult.mockReturnValue([]);

            await extractMemories();

            expect(selectMemoriesForExtraction).toHaveBeenCalledWith(mockData, mockSettings);
            expect(buildExtractionPrompt).toHaveBeenCalledWith(
                expect.any(String),
                'Alice',
                'User',
                expect.arrayContaining([expect.objectContaining({ id: '1' })]),
                expect.any(String),
                expect.any(String)
            );
        });

        it('throws error if chat changes during extraction when targetChatId provided', async () => {
            const newEvents = [{ id: 'evt1', summary: 'Event 1' }];
            parseExtractionResult.mockReturnValue(newEvents);

            // saveOpenVaultData returns false when chat ID doesn't match
            saveOpenVaultData.mockResolvedValue(false);

            await expect(extractMemories([0, 1], 'original-chat')).rejects.toThrow('Chat changed during extraction');
            expect(saveOpenVaultData).toHaveBeenCalledWith('original-chat');
        });

        it('saves normally when chat ID matches targetChatId', async () => {
            const newEvents = [{ id: 'evt1', summary: 'Event 1' }];
            parseExtractionResult.mockReturnValue(newEvents);
            saveOpenVaultData.mockResolvedValue(true);

            await extractMemories([0, 1], 'same-chat');

            expect(saveOpenVaultData).toHaveBeenCalledWith('same-chat');
        });

        it('saves normally when no targetChatId provided (backwards compatible)', async () => {
            const newEvents = [{ id: 'evt1', summary: 'Event 1' }];
            parseExtractionResult.mockReturnValue(newEvents);

            await extractMemories([0, 1]);

            expect(saveOpenVaultData).toHaveBeenCalled();
        });
    });
});
