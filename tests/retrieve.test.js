/**
 * Tests for src/retrieval/retrieve.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import { extensionName, MEMORIES_KEY, CHARACTERS_KEY } from '../src/constants.js';

// Mock dependencies
vi.mock('../src/utils.js', () => ({
    getOpenVaultData: vi.fn(),
    saveOpenVaultData: vi.fn(),
    safeSetExtensionPrompt: vi.fn(),
    showToast: vi.fn(),
    log: vi.fn(),
    isExtensionEnabled: vi.fn(),
    isAutomaticMode: vi.fn(),
}));

vi.mock('../src/ui/status.js', () => ({
    setStatus: vi.fn(),
}));

vi.mock('../src/pov.js', () => ({
    getActiveCharacters: vi.fn(),
    getPOVContext: vi.fn(),
    filterMemoriesByPOV: vi.fn(),
}));

vi.mock('../src/retrieval/scoring.js', () => ({
    selectRelevantMemories: vi.fn(),
}));

vi.mock('../src/retrieval/formatting.js', () => ({
    getRelationshipContext: vi.fn(),
    formatContextForInjection: vi.fn(),
}));

// Import after mocks
import {
    injectContext,
    retrieveAndInjectContext,
    updateInjection,
} from '../src/retrieval/retrieve.js';
import { getOpenVaultData, saveOpenVaultData, safeSetExtensionPrompt, showToast, log, isExtensionEnabled, isAutomaticMode } from '../src/utils.js';
import { setStatus } from '../src/ui/status.js';
import { getActiveCharacters, getPOVContext, filterMemoriesByPOV } from '../src/pov.js';
import { selectRelevantMemories } from '../src/retrieval/scoring.js';
import { getRelationshipContext, formatContextForInjection } from '../src/retrieval/formatting.js';

describe('retrieve', () => {
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
            retrievalPreFilterTokens: 24000,
            retrievalFinalTokens: 12000,
            smartRetrievalEnabled: false,
        };

        mockContext = {
            chat: [
                { mes: 'Hello', is_user: true, is_system: true },  // hidden
                { mes: 'Hi there!', is_user: false, is_system: true },  // hidden
            ],
            name1: 'User',
            name2: 'Alice',
        };

        mockData = {
            [MEMORIES_KEY]: [
                { id: '1', summary: 'Memory 1', importance: 3, message_ids: [0] },
                { id: '2', summary: 'Memory 2', importance: 4, message_ids: [1] },
            ],
            [CHARACTERS_KEY]: {
                Alice: { current_emotion: 'happy', emotion_from_messages: [1] },
            },
        };

        setDeps({
            console: mockConsole,
            getExtensionSettings: () => ({ [extensionName]: mockSettings }),
            getContext: () => mockContext,
        });

        // Reset all mocks
        vi.clearAllMocks();

        // Default mock behaviors
        isExtensionEnabled.mockReturnValue(true);
        isAutomaticMode.mockReturnValue(true);
        getOpenVaultData.mockReturnValue(mockData);
        saveOpenVaultData.mockResolvedValue();
        safeSetExtensionPrompt.mockReturnValue(true);
        getActiveCharacters.mockReturnValue(['Alice']);
        getPOVContext.mockReturnValue({ povCharacters: ['Alice'], isGroupChat: false });
        filterMemoriesByPOV.mockImplementation((memories) => memories);
        selectRelevantMemories.mockResolvedValue([]);
        getRelationshipContext.mockReturnValue('Relationship context');
        formatContextForInjection.mockReturnValue('Formatted context');
    });

    afterEach(() => {
        resetDeps();
    });

    describe('injectContext', () => {
        it('clears injection when context is null', () => {
            injectContext(null);

            expect(safeSetExtensionPrompt).toHaveBeenCalledWith('');
        });

        it('clears injection when context is empty string', () => {
            injectContext('');

            expect(safeSetExtensionPrompt).toHaveBeenCalledWith('');
        });

        it('injects context text via safeSetExtensionPrompt', () => {
            injectContext('Memory context here');

            expect(safeSetExtensionPrompt).toHaveBeenCalledWith('Memory context here');
        });

        it('logs success when injection succeeds', () => {
            safeSetExtensionPrompt.mockReturnValue(true);

            injectContext('Some context');

            expect(log).toHaveBeenCalledWith('Context injected into prompt');
        });

        it('logs failure when injection fails', () => {
            safeSetExtensionPrompt.mockReturnValue(false);

            injectContext('Some context');

            expect(log).toHaveBeenCalledWith('Failed to inject context');
        });
    });

    describe('retrieveAndInjectContext', () => {
        it('returns null if extension disabled', async () => {
            isExtensionEnabled.mockReturnValue(false);

            const result = await retrieveAndInjectContext();

            expect(result).toBeNull();
            expect(log).toHaveBeenCalledWith('OpenVault disabled, skipping retrieval');
        });

        it('returns null if no chat', async () => {
            mockContext.chat = null;

            const result = await retrieveAndInjectContext();

            expect(result).toBeNull();
            expect(log).toHaveBeenCalledWith('No chat to retrieve context for');
        });

        it('returns null if empty chat', async () => {
            mockContext.chat = [];

            const result = await retrieveAndInjectContext();

            expect(result).toBeNull();
        });

        it('returns null if no data', async () => {
            getOpenVaultData.mockReturnValue(null);

            const result = await retrieveAndInjectContext();

            expect(result).toBeNull();
            expect(log).toHaveBeenCalledWith('No chat context available');
        });

        it('returns null if no memories', async () => {
            mockData[MEMORIES_KEY] = [];

            const result = await retrieveAndInjectContext();

            expect(result).toBeNull();
            expect(log).toHaveBeenCalledWith('No memories stored yet');
        });

        it('does not set status (caller handles it)', async () => {
            selectRelevantMemories.mockResolvedValue([]);

            await retrieveAndInjectContext();

            expect(setStatus).not.toHaveBeenCalled();
        });

        it('applies POV filtering', async () => {
            selectRelevantMemories.mockResolvedValue([]);

            await retrieveAndInjectContext();

            expect(filterMemoriesByPOV).toHaveBeenCalledWith(
                mockData[MEMORIES_KEY],  // hiddenMemories = all memories since all are hidden
                ['Alice'],
                mockData
            );
        });

        it('falls back to hidden memories if POV filter too strict', async () => {
            filterMemoriesByPOV.mockReturnValue([]);
            selectRelevantMemories.mockResolvedValue([mockData[MEMORIES_KEY][0]]);

            await retrieveAndInjectContext();

            expect(log).toHaveBeenCalledWith('POV filter returned 0 results, using all hidden memories as fallback');
            expect(selectRelevantMemories).toHaveBeenCalledWith(
                mockData[MEMORIES_KEY],
                expect.any(String),
                expect.any(String), // userMessages
                'Alice',
                ['Alice'],
                mockSettings,
                2
            );
        });

        it('returns null when no relevant memories found', async () => {
            selectRelevantMemories.mockResolvedValue([]);

            const result = await retrieveAndInjectContext();

            expect(result).toBeNull();
            expect(log).toHaveBeenCalledWith('No relevant memories found');
        });

        it('gets relationship context for active characters', async () => {
            selectRelevantMemories.mockResolvedValue([mockData[MEMORIES_KEY][0]]);

            await retrieveAndInjectContext();

            expect(getRelationshipContext).toHaveBeenCalledWith(mockData, 'Alice', ['Alice']);
        });

        it('formats context with emotional info', async () => {
            selectRelevantMemories.mockResolvedValue([mockData[MEMORIES_KEY][0]]);

            await retrieveAndInjectContext();

            expect(formatContextForInjection).toHaveBeenCalledWith(
                expect.any(Array),
                'Relationship context',
                { emotion: 'happy', fromMessages: [1] },
                'Scene',
                12000,
                2
            );
        });

        it('uses primary character header for group chats', async () => {
            getPOVContext.mockReturnValue({ povCharacters: ['Bob', 'Alice'], isGroupChat: true });
            selectRelevantMemories.mockResolvedValue([mockData[MEMORIES_KEY][0]]);

            await retrieveAndInjectContext();

            expect(formatContextForInjection).toHaveBeenCalledWith(
                expect.any(Array),
                expect.any(String),
                expect.any(Object),
                'Bob',  // First POV character as header
                expect.any(Number),
                expect.any(Number)
            );
        });

        it('injects formatted context', async () => {
            selectRelevantMemories.mockResolvedValue([mockData[MEMORIES_KEY][0]]);
            formatContextForInjection.mockReturnValue('Final formatted context');

            await retrieveAndInjectContext();

            expect(safeSetExtensionPrompt).toHaveBeenCalledWith('Final formatted context');
        });

        it('returns result without calling UI functions (caller handles them)', async () => {
            const selectedMemories = [mockData[MEMORIES_KEY][0], mockData[MEMORIES_KEY][1]];
            selectRelevantMemories.mockResolvedValue(selectedMemories);
            formatContextForInjection.mockReturnValue('Context');

            const result = await retrieveAndInjectContext();

            expect(showToast).not.toHaveBeenCalled();
            expect(setStatus).not.toHaveBeenCalled();
            expect(result).toEqual({
                memories: selectedMemories,
                context: 'Context',
            });
        });

        it('throws errors for caller to handle', async () => {
            selectRelevantMemories.mockRejectedValue(new Error('Scoring failed'));

            await expect(retrieveAndInjectContext()).rejects.toThrow('Scoring failed');

            expect(mockConsole.error).toHaveBeenCalled();
        });

        it('uses default emotion when character state missing', async () => {
            mockData[CHARACTERS_KEY] = {};
            selectRelevantMemories.mockResolvedValue([mockData[MEMORIES_KEY][0]]);

            await retrieveAndInjectContext();

            expect(formatContextForInjection).toHaveBeenCalledWith(
                expect.any(Array),
                expect.any(String),
                { emotion: 'neutral', fromMessages: null },
                expect.any(String),
                expect.any(Number),
                expect.any(Number)
            );
        });
    });

    describe('updateInjection', () => {
        it('clears injection if not in automatic mode', async () => {
            isAutomaticMode.mockReturnValue(false);

            await updateInjection();

            expect(safeSetExtensionPrompt).toHaveBeenCalledWith('');
        });

        it('clears injection if no chat', async () => {
            mockContext.chat = null;

            await updateInjection();

            expect(safeSetExtensionPrompt).toHaveBeenCalledWith('');
        });

        it('clears injection if empty chat', async () => {
            mockContext.chat = [];

            await updateInjection();

            expect(safeSetExtensionPrompt).toHaveBeenCalledWith('');
        });

        it('clears injection if no data', async () => {
            getOpenVaultData.mockReturnValue(null);

            await updateInjection();

            expect(safeSetExtensionPrompt).toHaveBeenCalledWith('');
        });

        it('clears injection if no memories', async () => {
            mockData[MEMORIES_KEY] = [];

            await updateInjection();

            expect(safeSetExtensionPrompt).toHaveBeenCalledWith('');
        });

        it('includes pending user message in context', async () => {
            selectRelevantMemories.mockResolvedValue([mockData[MEMORIES_KEY][0]]);

            await updateInjection('What about that thing we discussed?');

            expect(log).toHaveBeenCalledWith('Including pending user message in retrieval context');
        });

        it('clears injection when no relevant memories', async () => {
            selectRelevantMemories.mockResolvedValue([]);

            await updateInjection();

            expect(safeSetExtensionPrompt).toHaveBeenCalledWith('');
        });

        it('logs injection update count', async () => {
            selectRelevantMemories.mockResolvedValue([mockData[MEMORIES_KEY][0]]);
            formatContextForInjection.mockReturnValue('Context');

            await updateInjection();

            expect(log).toHaveBeenCalledWith('Injection updated: 1 memories');
        });
    });
});
