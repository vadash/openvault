/**
 * MemoryList Component
 *
 * Manages the memory browser list display, pagination, search, and filtering.
 * Refactored from class-based to function-based approach.
 */

import { renderMemoryItem, renderMemoryEdit } from '../templates/memory.js';
import { filterMemories, sortMemoriesByDate, getPaginationInfo, extractCharactersSet } from '../calculations.js';
import { getOpenVaultData, showToast } from '../../utils.js';
import { escapeHtml } from '../../utils.js';
import { getDeps } from '../../deps.js';
import { MEMORIES_KEY, MEMORIES_PER_PAGE } from '../../constants.js';
import { deleteMemory as deleteMemoryAction, updateMemory as updateMemoryAction } from '../../data/actions.js';
import { getDocumentEmbedding, isEmbeddingsEnabled } from '../../embeddings.js';
import { refreshStats } from '../status.js';

// DOM Selectors (inlined from constants.js)
const SELECTORS = {
    MEMORY_LIST: '#openvault_memory_list',
    PAGE_INFO: '#openvault_page_info',
    PREV_BTN: '#openvault_prev_page',
    NEXT_BTN: '#openvault_next_page',
    SEARCH_INPUT: '#openvault_memory_search',
    FILTER_TYPE: '#openvault_filter_type',
    FILTER_CHARACTER: '#openvault_filter_character',
    CHARACTER_STATES: '#openvault_character_states',
    MEMORY_CARD: '.openvault-memory-card',
    DELETE_BTN: '.openvault-delete-memory',
    EDIT_BTN: '.openvault-edit-memory',
    CANCEL_EDIT_BTN: '.openvault-cancel-edit',
    SAVE_EDIT_BTN: '.openvault-save-edit',
    EDIT_TEXTAREA: '.openvault-edit-textarea',
    EDIT_FIELD: '[data-field]',
};

const CLASSES = {
    MEMORY_CARD: 'openvault-memory-card',
    PLACEHOLDER: 'openvault-placeholder',
    CHARACTER_TAG: 'openvault-character-tag',
    MEMORY_CHARACTERS: 'openvault-memory-characters',
};

// State
let state = {
    page: 0,
    searchQuery: '',
};
let searchTimeout = null;

// =============================================================================
// Helper Functions
// =============================================================================

function getMemoryById(id) {
    const data = getOpenVaultData();
    if (!data) return null;
    return data[MEMORIES_KEY]?.find(m => m.id === id) || null;
}

function filterBySearch(memories, query) {
    if (!query) return memories;
    return memories.filter(m => {
        const summary = (m.summary || '').toLowerCase();
        const characters = (m.characters_involved || []).join(' ').toLowerCase();
        const location = (m.location || '').toLowerCase();
        return summary.includes(query) ||
               characters.includes(query) ||
               location.includes(query);
    });
}

async function deleteMemory(id) {
    const deleted = await deleteMemoryAction(id);
    if (deleted) {
        render();
        populateCharacterFilter();
        refreshStats();
        showToast('success', 'Memory deleted');
    }
}

function enterEditMode(id) {
    const memory = getMemoryById(id);
    if (!memory) return;

    const $card = $(SELECTORS.MEMORY_LIST).find(`[data-id="${id}"]`);
    $card.replaceWith(renderMemoryEdit(memory));
}

function exitEditMode(id) {
    const memory = getMemoryById(id);
    if (!memory) return;

    const $card = $(SELECTORS.MEMORY_LIST).find(`[data-id="${id}"]`);
    $card.replaceWith(renderMemoryItem(memory));
}

async function saveEdit(id, btnElement) {
    const $card = $(SELECTORS.MEMORY_LIST).find(`[data-id="${id}"]`);
    const $btn = $(btnElement);

    // Gather values
    const summary = $card.find('[data-field="summary"]').val().trim();
    const importance = parseInt($card.find('[data-field="importance"]').val(), 10);

    if (!summary) {
        showToast('warning', 'Summary cannot be empty');
        return;
    }

    // Disable button during save
    $btn.prop('disabled', true);

    const updated = await updateMemoryAction(id, { summary, importance });
    if (updated) {
        // Auto-generate embedding if needed
        const memory = getMemoryById(id);
        if (memory && !memory.embedding && isEmbeddingsEnabled()) {
            const embedding = await getDocumentEmbedding(summary);
            if (embedding) {
                memory.embedding = embedding;
                await getDeps().saveChatConditional();
            }
        }

        // Re-render card
        const updatedMemory = getMemoryById(id);
        if (updatedMemory) {
            $card.replaceWith(renderMemoryItem(updatedMemory));
        }
        showToast('success', 'Memory updated');
        refreshStats();
    }
    $btn.prop('disabled', false);
}

function populateCharacterFilter() {
    const data = getOpenVaultData();
    const $filter = $(SELECTORS.FILTER_CHARACTER);

    if (!data) {
        $filter.find('option:not(:first)').remove();
        return;
    }

    const memories = data[MEMORIES_KEY] || [];
    const characters = extractCharactersSet(memories);

    const currentValue = $filter.val();
    $filter.find('option:not(:first)').remove();

    if (characters.length > 0) {
        const optionsHtml = characters
            .map(char => `<option value="${escapeHtml(char)}">${escapeHtml(char)}</option>`)
            .join('');
        $filter.append(optionsHtml);
    }

    // Restore selection if still valid
    if (currentValue && characters.includes(currentValue)) {
        $filter.val(currentValue);
    }
}

// =============================================================================
// Event Handlers (delegated)
// =============================================================================

function bindEvents() {
    const $container = $(SELECTORS.MEMORY_LIST);

    // Delete button
    $container.off('click', SELECTORS.DELETE_BTN);
    $container.on('click', SELECTORS.DELETE_BTN, async (e) => {
        const id = $(e.currentTarget).data('id');
        await deleteMemory(id);
    });

    // Edit button
    $container.off('click', SELECTORS.EDIT_BTN);
    $container.on('click', SELECTORS.EDIT_BTN, (e) => {
        const id = $(e.currentTarget).data('id');
        enterEditMode(id);
    });

    // Cancel edit
    $container.off('click', SELECTORS.CANCEL_EDIT_BTN);
    $container.on('click', SELECTORS.CANCEL_EDIT_BTN, (e) => {
        const id = $(e.currentTarget).data('id');
        exitEditMode(id);
    });

    // Save edit
    $container.off('click', SELECTORS.SAVE_EDIT_BTN);
    $container.on('click', SELECTORS.SAVE_EDIT_BTN, async (e) => {
        const id = $(e.currentTarget).data('id');
        await saveEdit(id, e.currentTarget);
    });

    // Search input with debounce
    const $search = $(SELECTORS.SEARCH_INPUT);
    $search.off('input');
    $search.on('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            state.searchQuery = $search.val().toLowerCase().trim();
            state.page = 0;
            render();
        }, 200);
    });
}

// =============================================================================
// Render Function
// =============================================================================

export function render() {
    const $container = $(SELECTORS.MEMORY_LIST);
    const $pageInfo = $(SELECTORS.PAGE_INFO);
    const $prevBtn = $(SELECTORS.PREV_BTN);
    const $nextBtn = $(SELECTORS.NEXT_BTN);

    // Check if user is editing - preserve state if so
    if ($container.find('.openvault-edit-form').length > 0) {
        // Skip render to preserve user's in-progress edit
        return;
    }

    const data = getOpenVaultData();

    if (!data) {
        $container.html(`<p class="${CLASSES.PLACEHOLDER}">No chat loaded</p>`);
        $pageInfo.text('Page 0 / 0');
        $prevBtn.prop('disabled', true);
        $nextBtn.prop('disabled', true);
        return;
    }

    const memories = data[MEMORIES_KEY] || [];

    // Get filter values
    const characterFilter = $(SELECTORS.FILTER_CHARACTER).val();

    // Filter, search, and sort
    let filteredMemories = filterMemories(memories, '', characterFilter);
    filteredMemories = filterBySearch(filteredMemories, state.searchQuery);
    filteredMemories = sortMemoriesByDate(filteredMemories);

    // Pagination
    const pagination = getPaginationInfo(filteredMemories.length, state.page, MEMORIES_PER_PAGE);
    state.page = pagination.currentPage;
    const pageMemories = filteredMemories.slice(pagination.startIdx, pagination.endIdx);

    // Render memories
    if (pageMemories.length === 0) {
        const message = state.searchQuery ? 'No memories match your search' : 'No memories yet';
        $container.html(`<p class="${CLASSES.PLACEHOLDER}">${message}</p>`);
    } else {
        const html = pageMemories.map(renderMemoryItem).join('');
        $container.html(html);
    }

    // Update pagination controls
    $pageInfo.text(`Page ${pagination.currentPage + 1} of ${pagination.totalPages}`);
    $prevBtn.prop('disabled', !pagination.hasPrev);
    $nextBtn.prop('disabled', !pagination.hasNext);

    // Populate character filter
    populateCharacterFilter();
}

// =============================================================================
// Public API
// =============================================================================

export function initMemoryList() {
    bindEvents();
    render();
}

export function prevPage() {
    if (state.page > 0) {
        state.page--;
        render();
    }
}

export function nextPage() {
    state.page++;
    render();
}

export function resetAndRender() {
    state.page = 0;
    render();
}

export function resetPage() {
    state.page = 0;
}

export function populateFilter() {
    populateCharacterFilter();
}
