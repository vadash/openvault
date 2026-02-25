/**
 * Tests for src/ui/components/MemoryList.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import { MEMORIES_KEY } from '../src/constants.js';

// Mock jQuery globally
const mockJQuery = vi.fn((selector) => {
    const result = {
        find: vi.fn(() => result),
        length: 0,
        html: vi.fn(() => result),
        text: vi.fn(() => result),
        val: vi.fn(() => result),
        prop: vi.fn(() => result),
        toggle: vi.fn(() => result),
        on: vi.fn(),
        off: vi.fn(),
        data: vi.fn(),
        replaceWith: vi.fn(() => result),
        append: vi.fn(() => result),
        remove: vi.fn(() => result),
        querySelectorAll: vi.fn(() => []),
    };
    return result;
});

globalThis.$ = mockJQuery;

// Mock getOpenVaultData
vi.mock('../src/utils.js', () => ({
    getOpenVaultData: vi.fn(),
    showToast: vi.fn(),
    log: vi.fn(),
}));

// Mock templates
vi.mock('../src/ui/templates/memory.js', () => ({
    renderMemoryItem: vi.fn((m) => `<div class="openvault-memory-card" data-id="${m.id}">${m.summary}</div>`),
    renderMemoryEdit: vi.fn((m) => `<div class="openvault-edit-form" data-id="${m.id}"><textarea>${m.summary}</textarea></div>`),
}));

// Mock other dependencies
vi.mock('../src/ui/calculations.js', () => ({
    filterMemories: vi.fn((m) => m),
    sortMemoriesByDate: vi.fn((m) => m),
    getPaginationInfo: vi.fn((len, page, perPage) => ({
        currentPage: page,
        totalPages: 1,
        startIdx: 0,
        endIdx: len,
        hasPrev: false,
        hasNext: false,
    })),
    extractCharactersSet: vi.fn(() => []),
}));

vi.mock('../src/data/actions.js', () => ({
    deleteMemory: vi.fn().mockResolvedValue(true),
    updateMemory: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/embeddings.js', () => ({
    isEmbeddingsEnabled: vi.fn(() => false),
}));

vi.mock('../src/ui/status.js', () => ({
    refreshStats: vi.fn(),
}));

describe('MemoryList edit preservation', () => {
    let mockContainer;
    let mockContext;
    let MemoryList;

    beforeEach(async () => {
        vi.resetAllMocks();
        vi.resetModules();

        // Create mock container
        mockContainer = document.createElement('div');
        mockContainer.id = 'openvault-memory-list';
        document.body.appendChild(mockContainer);

        mockContext = {
            chatMetadata: {
                openvault_data: {
                    [MEMORIES_KEY]: [
                        { id: '1', summary: 'Test memory 1', importance: 3 },
                        { id: '2', summary: 'Test memory 2', importance: 4 },
                    ],
                    characters: {},
                    last_processed: -1,
                }
            },
            chatId: 'test-chat-123',
        };

        setDeps({
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            getContext: () => mockContext,
            getExtensionSettings: () => ({ openvault: { enabled: true, debugMode: false } }),
            showToast: vi.fn(),
            saveChatConditional: vi.fn().mockResolvedValue(true),
        });

        // Import after mocks are set up
        const { getOpenVaultData } = await import('../src/utils.js');
        vi.mocked(getOpenVaultData).mockReturnValue(mockContext.chatMetadata.openvault_data);

        MemoryList = (await import('../src/ui/components/MemoryList.js')).MemoryList;
    });

    afterEach(() => {
        if (mockContainer && mockContainer.parentNode) {
            document.body.removeChild(mockContainer);
        }
        resetDeps();
    });

    it('skips render when user is editing a memory', () => {
        const list = new MemoryList();
        list.$container = mockJQuery();

        // Mock find to return an edit form (length > 0)
        list.$container.find.mockReturnValue({ length: 1 });

        // Call render - should skip due to edit form presence
        list.render();

        // Verify that html() was never called (rendering skipped)
        // This FAILS before the fix (renders anyway), PASSES after the fix
        expect(list.$container.html).not.toHaveBeenCalled();
    });

    it('renders normally when no edit form is present', () => {
        const list = new MemoryList();
        list.$container = mockJQuery();

        // Mock find to return no edit form (length === 0)
        list.$container.find.mockReturnValue({ length: 0 });

        // Call render
        list.render();

        // Verify that html() was called (rendering occurred)
        expect(list.$container.html).toHaveBeenCalled();
    });
});

