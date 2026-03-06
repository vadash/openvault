import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extensionName } from '../src/constants.js';

// Mock dependencies
vi.mock('../src/deps.js', () => ({
    getDeps: () => ({
        getContext: () => ({
            chat: [
                { mes: 'Hello', is_user: true },
                { mes: 'Welcome!', is_user: false, name: 'Alice' },
            ],
            name1: 'User',
            name2: 'Alice',
        }),
        getExtensionSettings: () => ({
            [extensionName]: { enabled: true, mode: 'automatic' },
        }),
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
}));
vi.mock('../src/utils.js', async (importOriginal) => {
    const orig = await importOriginal();
    return {
        ...orig,
        isAutomaticMode: vi.fn(() => true),
        log: vi.fn(),
        getCurrentChatId: vi.fn(() => 'chat_1'),
        getOpenVaultData: vi.fn(() => ({ memories: [], processed_message_ids: [] })),
        showToast: vi.fn(),
        safeSetExtensionPrompt: vi.fn(),
    };
});
vi.mock('../src/state.js', () => ({
    operationState: { generationInProgress: false, extractionInProgress: false, retrievalInProgress: false },
    isChatLoadingCooldown: vi.fn(() => false),
    setChatLoadingCooldown: vi.fn(),
    setGenerationLock: vi.fn(),
    clearGenerationLock: vi.fn(),
    resetOperationStatesIfSafe: vi.fn(),
}));
vi.mock('../src/extraction/worker.js', () => ({
    wakeUpBackgroundWorker: vi.fn(),
}));
vi.mock('../src/extraction/extract.js', () => ({
    extractMemories: vi.fn(async () => ({ status: 'success' })),
    extractAllMessages: vi.fn(),
    cleanupCharacterStates: vi.fn(),
}));
vi.mock('../src/extraction/scheduler.js', () => ({
    getBackfillStats: vi.fn(() => ({ completeBatches: 0 })),
    getExtractedMessageIds: vi.fn(() => new Set()),
    getNextBatch: vi.fn(),
}));
vi.mock('../src/retrieval/retrieve.js', () => ({ updateInjection: vi.fn() }));
vi.mock('../src/retrieval/debug-cache.js', () => ({ clearRetrievalDebug: vi.fn() }));
vi.mock('../src/ui/render.js', () => ({
    refreshAllUI: vi.fn(),
    resetMemoryBrowserPage: vi.fn(),
}));
vi.mock('../src/ui/status.js', () => ({ setStatus: vi.fn() }));
vi.mock('../src/embeddings.js', () => ({ clearEmbeddingCache: vi.fn() }));

// Static imports of mocked modules (vi.mock is hoisted, so these get the mocked versions)
import { wakeUpBackgroundWorker } from '../src/extraction/worker.js';
import { isChatLoadingCooldown } from '../src/state.js';

describe('onMessageReceived', () => {
    let onMessageReceived;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('../src/events.js');
        onMessageReceived = mod.onMessageReceived;
    });

    it('calls wakeUpBackgroundWorker for AI messages', () => {
        onMessageReceived(1); // index 1 is AI message

        expect(wakeUpBackgroundWorker).toHaveBeenCalledOnce();
    });

    it('does not call wakeUpBackgroundWorker for user messages', () => {
        onMessageReceived(0); // index 0 is user message

        expect(wakeUpBackgroundWorker).not.toHaveBeenCalled();
    });

    it('does not await — returns synchronously', () => {
        const result = onMessageReceived(1);
        // Should not return a promise (fire-and-forget)
        // Or if it returns undefined, that's fine too
        expect(result).toBeUndefined();
    });

    it('skips during chat loading cooldown', () => {
        isChatLoadingCooldown.mockReturnValue(true);

        onMessageReceived(1);

        expect(wakeUpBackgroundWorker).not.toHaveBeenCalled();
    });
});
