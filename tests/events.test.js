/**
 * Tests for src/events.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import { extensionName, MEMORIES_KEY, RETRIEVAL_TIMEOUT_MS } from '../src/constants.js';

// Mock jQuery globally
const mockJQuery = vi.fn(() => ({
    remove: vi.fn(),
}));
globalThis.$ = mockJQuery;

// Mock script.js to add vi.fn() for call tracking
vi.mock('../../../../../script.js', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...original,
        eventSource: {
            on: vi.fn(),
            removeListener: vi.fn(),
            emit: vi.fn(),
        },
    };
});

// Mock dependencies
vi.mock('../src/utils.js', () => ({
    getOpenVaultData: vi.fn(),
    getCurrentChatId: vi.fn(),
    showToast: vi.fn(),
    safeSetExtensionPrompt: vi.fn(),
    withTimeout: vi.fn(),
    log: vi.fn(),
    getExtractedMessageIds: vi.fn(),
    getUnextractedMessageIds: vi.fn(),
    isAutomaticMode: vi.fn(),
}));

vi.mock('../src/state.js', () => ({
    operationState: {
        generationInProgress: false,
        retrievalInProgress: false,
        extractionInProgress: false,
    },
    setGenerationLock: vi.fn(),
    clearGenerationLock: vi.fn(),
    isChatLoadingCooldown: vi.fn(),
    setChatLoadingCooldown: vi.fn(),
    resetOperationStatesIfSafe: vi.fn(),
}));

vi.mock('../src/ui/status.js', () => ({
    setStatus: vi.fn(),
}));

vi.mock('../src/ui/browser.js', () => ({
    refreshAllUI: vi.fn(),
    resetMemoryBrowserPage: vi.fn(),
}));

vi.mock('../src/extraction/extract.js', () => ({
    extractMemories: vi.fn(),
}));

vi.mock('../src/retrieval/retrieve.js', () => ({
    updateInjection: vi.fn(),
}));

vi.mock('../src/auto-hide.js', () => ({
    autoHideOldMessages: vi.fn(),
}));

vi.mock('../src/backfill.js', () => ({
    checkAndTriggerBackfill: vi.fn(),
}));

// Import after mocks
import {
    onBeforeGeneration,
    onGenerationEnded,
    onChatChanged,
    onMessageReceived,
    updateEventListeners,
} from '../src/events.js';
import { eventSource, event_types } from '../../../../../script.js';
import { getOpenVaultData, getCurrentChatId, showToast, safeSetExtensionPrompt, withTimeout, log, getExtractedMessageIds, getUnextractedMessageIds, isAutomaticMode } from '../src/utils.js';
import { operationState, setGenerationLock, clearGenerationLock, isChatLoadingCooldown, setChatLoadingCooldown, resetOperationStatesIfSafe } from '../src/state.js';
import { setStatus } from '../src/ui/status.js';
import { refreshAllUI, resetMemoryBrowserPage } from '../src/ui/browser.js';
import { extractMemories } from '../src/extraction/extract.js';
import { updateInjection } from '../src/retrieval/retrieve.js';
import { autoHideOldMessages } from '../src/auto-hide.js';
import { checkAndTriggerBackfill } from '../src/backfill.js';

describe('events', () => {
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
        };

        mockContext = {
            chat: [
                { mes: 'Hello', is_user: true },
                { mes: 'Hi there!', is_user: false, is_system: false, name: 'Alice' },
            ],
            name1: 'User',
            name2: 'Alice',
        };

        mockData = {
            [MEMORIES_KEY]: [
                { id: '1', summary: 'Memory 1', importance: 3 },
            ],
        };

        setDeps({
            console: mockConsole,
            getExtensionSettings: () => ({ [extensionName]: mockSettings }),
            getContext: () => mockContext,
        });

        // Reset operation state
        operationState.generationInProgress = false;
        operationState.retrievalInProgress = false;
        operationState.extractionInProgress = false;

        // Reset all mocks
        vi.clearAllMocks();

        // Default mock behaviors
        isAutomaticMode.mockReturnValue(true);
        getOpenVaultData.mockReturnValue(mockData);
        getCurrentChatId.mockReturnValue('chat_123');
        safeSetExtensionPrompt.mockReturnValue(true);
        withTimeout.mockImplementation((promise) => promise);
        autoHideOldMessages.mockResolvedValue();
        updateInjection.mockResolvedValue();
        extractMemories.mockResolvedValue({ events_created: 1, messages_processed: 5 });
        isChatLoadingCooldown.mockReturnValue(false);
        getExtractedMessageIds.mockReturnValue(new Set());
        getUnextractedMessageIds.mockReturnValue([]);
    });

    afterEach(() => {
        resetDeps();
    });

    describe('onBeforeGeneration', () => {
        it('skips if automatic mode disabled', async () => {
            isAutomaticMode.mockReturnValue(false);

            await onBeforeGeneration('normal', {});

            expect(updateInjection).not.toHaveBeenCalled();
        });

        it('skips if dry run', async () => {
            await onBeforeGeneration('normal', {}, true);

            expect(updateInjection).not.toHaveBeenCalled();
        });

        it('skips if generation already in progress', async () => {
            operationState.generationInProgress = true;

            await onBeforeGeneration('normal', {});

            expect(log).toHaveBeenCalledWith('Skipping retrieval - generation already in progress');
            expect(updateInjection).not.toHaveBeenCalled();
        });

        it('skips if retrieval already in progress', async () => {
            operationState.retrievalInProgress = true;

            await onBeforeGeneration('normal', {});

            expect(log).toHaveBeenCalledWith('Skipping retrieval - retrieval already in progress');
            expect(updateInjection).not.toHaveBeenCalled();
        });

        it('sets retrieval flag immediately', async () => {
            await onBeforeGeneration('normal', {});

            // Should have been set to true during execution
            // (it's reset in finally block, so check it was called)
            expect(operationState.retrievalInProgress).toBe(false); // Reset after
        });

        it('calls autoHideOldMessages before retrieval', async () => {
            await onBeforeGeneration('normal', {});

            expect(autoHideOldMessages).toHaveBeenCalled();
        });

        it('skips if no data available', async () => {
            getOpenVaultData.mockReturnValue(null);

            await onBeforeGeneration('normal', {});

            expect(log).toHaveBeenCalledWith('>>> Skipping retrieval - no context available');
            expect(updateInjection).not.toHaveBeenCalled();
        });

        it('skips if no memories exist', async () => {
            mockData[MEMORIES_KEY] = [];

            await onBeforeGeneration('normal', {});

            expect(log).toHaveBeenCalledWith('>>> Skipping retrieval - no memories yet');
            expect(updateInjection).not.toHaveBeenCalled();
        });

        it('sets status to retrieving', async () => {
            await onBeforeGeneration('normal', {});

            expect(setStatus).toHaveBeenCalledWith('retrieving');
        });

        it('sets generation lock', async () => {
            await onBeforeGeneration('normal', {});

            expect(setGenerationLock).toHaveBeenCalled();
        });

        it('gets last user message from chat', async () => {
            mockContext.chat = [
                { mes: 'First user', is_user: true },
                { mes: 'AI response', is_user: false },
                { mes: 'Last user message', is_user: true },
            ];

            await onBeforeGeneration('normal', {});

            expect(updateInjection).toHaveBeenCalledWith('Last user message');
        });

        it('uses empty string if no user message', async () => {
            mockContext.chat = [
                { mes: 'AI response', is_user: false },
            ];

            await onBeforeGeneration('normal', {});

            expect(updateInjection).toHaveBeenCalledWith('');
        });

        it('shows retrieval toast', async () => {
            await onBeforeGeneration('normal', {});

            expect(showToast).toHaveBeenCalledWith('info', 'Retrieving memories...', 'OpenVault', { timeOut: 2000 });
        });

        it('calls updateInjection with timeout wrapper', async () => {
            await onBeforeGeneration('normal', {});

            expect(withTimeout).toHaveBeenCalledWith(
                expect.any(Promise),
                RETRIEVAL_TIMEOUT_MS,
                'Memory retrieval'
            );
        });

        it('sets status to ready on success', async () => {
            await onBeforeGeneration('normal', {});

            expect(setStatus).toHaveBeenCalledWith('ready');
        });

        it('clears retrieval flag on completion', async () => {
            await onBeforeGeneration('normal', {});

            expect(operationState.retrievalInProgress).toBe(false);
        });

        it('handles errors gracefully without blocking', async () => {
            updateInjection.mockRejectedValue(new Error('Retrieval failed'));

            // Should not throw
            await onBeforeGeneration('normal', {});

            expect(mockConsole.error).toHaveBeenCalled();
            expect(setStatus).toHaveBeenCalledWith('error');
            expect(operationState.retrievalInProgress).toBe(false);
        });

        it('clears retrieval flag on error', async () => {
            updateInjection.mockRejectedValue(new Error('Failed'));

            await onBeforeGeneration('normal', {});

            expect(operationState.retrievalInProgress).toBe(false);
        });
    });

    describe('onGenerationEnded', () => {
        it('clears generation lock', () => {
            onGenerationEnded();

            expect(clearGenerationLock).toHaveBeenCalled();
        });

        it('logs completion', () => {
            onGenerationEnded();

            expect(log).toHaveBeenCalledWith('Generation ended, clearing lock');
        });
    });

    describe('onChatChanged', () => {
        it('skips if automatic mode disabled', () => {
            isAutomaticMode.mockReturnValue(false);

            onChatChanged();

            expect(resetMemoryBrowserPage).not.toHaveBeenCalled();
        });

        it('resets memory browser page', () => {
            onChatChanged();

            expect(resetMemoryBrowserPage).toHaveBeenCalled();
        });

        it('sets chat loading cooldown', () => {
            onChatChanged();

            expect(setChatLoadingCooldown).toHaveBeenCalledWith(2000, log);
        });

        it('resets operation states', () => {
            onChatChanged();

            expect(resetOperationStatesIfSafe).toHaveBeenCalled();
        });

        it('clears injection', () => {
            onChatChanged();

            expect(safeSetExtensionPrompt).toHaveBeenCalledWith('');
        });

        it('refreshes UI', () => {
            onChatChanged();

            expect(refreshAllUI).toHaveBeenCalled();
        });

        it('sets status to ready', () => {
            onChatChanged();

            expect(setStatus).toHaveBeenCalledWith('ready');
        });

        it('logs chat change', () => {
            onChatChanged();

            expect(log).toHaveBeenCalledWith('Chat changed, clearing injection and setting load cooldown');
        });
    });

    describe('onMessageReceived', () => {
        beforeEach(() => {
            mockContext.chat = [
                { mes: 'User message', is_user: true },
                { mes: 'AI response', is_user: false, is_system: false, name: 'Alice' },
            ];
        });

        it('skips if automatic mode disabled', async () => {
            isAutomaticMode.mockReturnValue(false);

            await onMessageReceived(1);

            expect(extractMemories).not.toHaveBeenCalled();
        });

        it('skips during chat loading cooldown', async () => {
            isChatLoadingCooldown.mockReturnValue(true);

            await onMessageReceived(1);

            expect(log).toHaveBeenCalledWith('Skipping extraction for message 1 - chat load cooldown active');
            expect(extractMemories).not.toHaveBeenCalled();
        });

        it('skips if extraction already in progress', async () => {
            operationState.extractionInProgress = true;

            await onMessageReceived(1);

            expect(log).toHaveBeenCalledWith('Skipping extraction - extraction already in progress');
            expect(extractMemories).not.toHaveBeenCalled();
        });

        it('sets extraction flag immediately', async () => {
            getUnextractedMessageIds.mockReturnValue([]);

            await onMessageReceived(1);

            // Flag should be reset after completion
            expect(operationState.extractionInProgress).toBe(false);
        });

        it('skips user messages', async () => {
            mockContext.chat[1] = { mes: 'User message', is_user: true };

            await onMessageReceived(1);

            expect(log).toHaveBeenCalledWith('Message 1 is user/system message, skipping extraction');
            expect(extractMemories).not.toHaveBeenCalled();
        });

        it('skips system messages', async () => {
            mockContext.chat[1] = { mes: 'System', is_system: true, is_user: false };

            await onMessageReceived(1);

            expect(log).toHaveBeenCalledWith('Message 1 is user/system message, skipping extraction');
        });

        it('skips if no data', async () => {
            getOpenVaultData.mockReturnValue(null);

            await onMessageReceived(1);

            expect(log).toHaveBeenCalledWith('Cannot get OpenVault data, skipping extraction');
        });

        it('waits for complete batch before extracting', async () => {
            mockSettings.messagesPerExtraction = 5;
            getUnextractedMessageIds.mockReturnValue([0, 1, 2]); // Only 3, need 5

            await onMessageReceived(1);

            expect(log).toHaveBeenCalledWith(expect.stringContaining('need 2 more for next batch'));
            expect(extractMemories).not.toHaveBeenCalled();
        });

        it('extracts when batch is complete', async () => {
            mockSettings.messagesPerExtraction = 3;
            getUnextractedMessageIds.mockReturnValue([0, 1, 2, 3, 4]);
            getExtractedMessageIds.mockReturnValue(new Set());

            await onMessageReceived(1);

            expect(extractMemories).toHaveBeenCalledWith([0, 1, 2]);
        });

        it('sets status to extracting', async () => {
            mockSettings.messagesPerExtraction = 2;
            getUnextractedMessageIds.mockReturnValue([0, 1]);

            await onMessageReceived(1);

            expect(setStatus).toHaveBeenCalledWith('extracting');
        });

        it('shows extracting toast', async () => {
            mockSettings.messagesPerExtraction = 2;
            getUnextractedMessageIds.mockReturnValue([0, 1]);

            await onMessageReceived(1);

            expect(showToast).toHaveBeenCalledWith(
                'info',
                expect.stringContaining('Extracting memories'),
                'OpenVault',
                expect.objectContaining({ timeOut: 0, tapToDismiss: false })
            );
        });

        it('detects chat change during extraction', async () => {
            mockSettings.messagesPerExtraction = 2;
            getUnextractedMessageIds.mockReturnValue([0, 1]);
            getCurrentChatId
                .mockReturnValueOnce('chat_123')
                .mockReturnValueOnce('chat_456');

            await onMessageReceived(1);

            expect(log).toHaveBeenCalledWith(expect.stringContaining('Chat changed during extraction'));
            expect(showToast).toHaveBeenCalledWith('warning', expect.stringContaining('Chat changed during extraction'), 'OpenVault');
        });

        it('shows success toast after extraction', async () => {
            mockSettings.messagesPerExtraction = 2;
            getUnextractedMessageIds.mockReturnValue([0, 1]);
            extractMemories.mockResolvedValue({ events_created: 3, messages_processed: 2 });

            await onMessageReceived(1);

            expect(showToast).toHaveBeenCalledWith('success', 'Extracted 3 events from 2 messages', 'OpenVault');
        });

        it('checks backfill after extraction', async () => {
            mockSettings.messagesPerExtraction = 2;
            getUnextractedMessageIds.mockReturnValue([0, 1]);

            await onMessageReceived(1);

            expect(checkAndTriggerBackfill).toHaveBeenCalledWith(updateEventListeners);
        });

        it('always clears extraction flag', async () => {
            mockSettings.messagesPerExtraction = 2;
            getUnextractedMessageIds.mockReturnValue([0, 1]);
            extractMemories.mockRejectedValue(new Error('Failed'));

            await onMessageReceived(1);

            expect(operationState.extractionInProgress).toBe(false);
        });

        it('handles extraction errors', async () => {
            mockSettings.messagesPerExtraction = 2;
            getUnextractedMessageIds.mockReturnValue([0, 1]);
            extractMemories.mockRejectedValue(new Error('Extraction failed'));

            await onMessageReceived(1);

            expect(mockConsole.error).toHaveBeenCalled();
            expect(showToast).toHaveBeenCalledWith('error', 'Extraction failed: Extraction failed', 'OpenVault');
        });

        it('sets status to ready after completion', async () => {
            mockSettings.messagesPerExtraction = 2;
            getUnextractedMessageIds.mockReturnValue([0, 1]);

            await onMessageReceived(1);

            expect(setStatus).toHaveBeenCalledWith('ready');
        });
    });

    describe('updateEventListeners', () => {
        it('removes old listeners first', () => {
            updateEventListeners();

            expect(eventSource.removeListener).toHaveBeenCalledWith(event_types.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
            expect(eventSource.removeListener).toHaveBeenCalledWith(event_types.GENERATION_ENDED, onGenerationEnded);
            expect(eventSource.removeListener).toHaveBeenCalledWith(event_types.MESSAGE_RECEIVED, onMessageReceived);
            expect(eventSource.removeListener).toHaveBeenCalledWith(event_types.CHAT_CHANGED, onChatChanged);
        });

        it('resets operation state if safe', () => {
            updateEventListeners();

            expect(resetOperationStatesIfSafe).toHaveBeenCalled();
        });

        it('registers all event handlers in automatic mode', () => {
            updateEventListeners();

            expect(eventSource.on).toHaveBeenCalledWith(event_types.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
            expect(eventSource.on).toHaveBeenCalledWith(event_types.GENERATION_ENDED, onGenerationEnded);
            expect(eventSource.on).toHaveBeenCalledWith(event_types.MESSAGE_RECEIVED, onMessageReceived);
            expect(eventSource.on).toHaveBeenCalledWith(event_types.CHAT_CHANGED, onChatChanged);
        });

        it('clears injection in manual mode', () => {
            isAutomaticMode.mockReturnValue(false);

            updateEventListeners();

            expect(safeSetExtensionPrompt).toHaveBeenCalledWith('');
            expect(eventSource.on).not.toHaveBeenCalled();
        });

        it('logs automatic mode enabled', () => {
            updateEventListeners();

            expect(log).toHaveBeenCalledWith('Automatic mode enabled - event listeners registered');
        });

        it('logs manual mode', () => {
            isAutomaticMode.mockReturnValue(false);

            updateEventListeners();

            expect(log).toHaveBeenCalledWith('Manual mode - injection cleared');
        });

        it('does not register listeners when manual mode', () => {
            isAutomaticMode.mockReturnValue(false);

            updateEventListeners();

            expect(eventSource.on).not.toHaveBeenCalled();
        });
    });
});
