import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../src/deps.js', () => ({
    getDeps: () => ({
        getContext: () => ({ chatId: 'test-chat' }),
        getExtensionSettings: () => ({ openvault: {} }),
        showToast: vi.fn(),
        saveChatConditional: vi.fn().mockResolvedValue(true),
        console: { error: vi.fn() }
    })
}));

vi.mock('../src/extraction/batch.js', () => ({
    extractAllMessages: vi.fn().mockResolvedValue({ success: true })
}));

vi.mock('../src/data/actions.js', () => ({
    deleteCurrentChatData: vi.fn().mockResolvedValue(true),
    deleteCurrentChatEmbeddings: vi.fn().mockResolvedValue(3)
}));

vi.mock('../src/backfill.js', () => ({
    checkAndTriggerBackfill: vi.fn()
}));

vi.mock('../src/utils.js', () => ({
    getOpenVaultData: () => ({ memories: [] }),
    showToast: vi.fn(),
    log: vi.fn()
}));

vi.mock('../src/ui/browser.js', () => ({
    refreshAllUI: vi.fn()
}));

vi.mock('../src/ui/status.js', () => ({
    setStatus: vi.fn()
}));

vi.mock('../src/embeddings.js', () => ({
    isEmbeddingsEnabled: () => true,
    generateEmbeddingsForMemories: vi.fn().mockResolvedValue(5)
}));

vi.mock('../src/constants.js', () => ({
    MEMORIES_KEY: 'memories'
}));

describe('ui/actions module', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('exports all action handlers', async () => {
        const actions = await import('../src/ui/actions.js');

        expect(typeof actions.handleExtractAll).toBe('function');
        expect(typeof actions.handleDeleteChatData).toBe('function');
        expect(typeof actions.handleDeleteEmbeddings).toBe('function');
        expect(typeof actions.backfillEmbeddings).toBe('function');
    });
});
