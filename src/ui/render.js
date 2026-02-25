/**
 * UI Render Layer
 *
 * Consolidated rendering functions for memory list, character states, and browser orchestration.
 * Refactored from class-based components to function-based approach.
 */

import { renderMemoryItem, renderMemoryEdit, renderCharacterState } from './templates.js';
import { filterMemories, sortMemoriesByDate, getPaginationInfo, extractCharactersSet, buildCharacterStateData } from './helpers.js';
import { getOpenVaultData, showToast, escapeHtml } from '../utils.js';
import { getDeps } from '../deps.js';
import { MEMORIES_KEY, MEMORIES_PER_PAGE, CHARACTERS_KEY } from '../constants.js';
import { deleteMemory as deleteMemoryAction, updateMemory as updateMemoryAction } from '../data/actions.js';
import { getDocumentEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { refreshStats } from './status.js';

// DOM Selectors
const SELECTORS = {
    CHARACTER_STATES: '#openvault_character_states',
    MEMORY_LIST: '#openvault_memory_list',
    PAGE_INFO: '#openvault_page_info',
    PREV_BTN: '#openvault_prev_page',
    NEXT_BTN: '#openvault_next_page',
    SEARCH_INPUT: '#openvault_memory_search',
    FILTER_TYPE: '#openvault_filter_type',
    FILTER_CHARACTER: '#openvault_filter_character',
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

// =============================================================================
// Memory List State and Helpers
// =============================================================================

let memoryListState = {
    page: 0,
    searchQuery: '',
};
let searchTimeout = null;

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
        renderMemoryList();
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

    const summary = $card.find('[data-field="summary"]').val().trim();
    const importance = parseInt($card.find('[data-field="importance"]').val(), 10);

    if (!summary) {
        showToast('warning', 'Summary cannot be empty');
        return;
    }

    $btn.prop('disabled', true);

    const updated = await updateMemoryAction(id, { summary, importance });
    if (updated) {
        const memory = getMemoryById(id);
        if (memory && !memory.embedding && isEmbeddingsEnabled()) {
            const embedding = await getDocumentEmbedding(summary);
            if (embedding) {
                memory.embedding = embedding;
                await getDeps().saveChatConditional();
            }
        }

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

    if (currentValue && characters.includes(currentValue)) {
        $filter.val(currentValue);
    }
}

function bindMemoryListEvents() {
    const $container = $(SELECTORS.MEMORY_LIST);

    $container.off('click', SELECTORS.DELETE_BTN);
    $container.on('click', SELECTORS.DELETE_BTN, async (e) => {
        const id = $(e.currentTarget).data('id');
        await deleteMemory(id);
    });

    $container.off('click', SELECTORS.EDIT_BTN);
    $container.on('click', SELECTORS.EDIT_BTN, (e) => {
        const id = $(e.currentTarget).data('id');
        enterEditMode(id);
    });

    $container.off('click', SELECTORS.CANCEL_EDIT_BTN);
    $container.on('click', SELECTORS.CANCEL_EDIT_BTN, (e) => {
        const id = $(e.currentTarget).data('id');
        exitEditMode(id);
    });

    $container.off('click', SELECTORS.SAVE_EDIT_BTN);
    $container.on('click', SELECTORS.SAVE_EDIT_BTN, async (e) => {
        const id = $(e.currentTarget).data('id');
        await saveEdit(id, e.currentTarget);
    });

    const $search = $(SELECTORS.SEARCH_INPUT);
    $search.off('input');
    $search.on('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            memoryListState.searchQuery = $search.val().toLowerCase().trim();
            memoryListState.page = 0;
            renderMemoryList();
        }, 200);
    });
}

// =============================================================================
// Memory List Render
// =============================================================================

export function renderMemoryList() {
    const $container = $(SELECTORS.MEMORY_LIST);
    const $pageInfo = $(SELECTORS.PAGE_INFO);
    const $prevBtn = $(SELECTORS.PREV_BTN);
    const $nextBtn = $(SELECTORS.NEXT_BTN);

    if ($container.find('.openvault-edit-form').length > 0) {
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
    const characterFilter = $(SELECTORS.FILTER_CHARACTER).val();

    let filteredMemories = filterMemories(memories, '', characterFilter);
    filteredMemories = filterBySearch(filteredMemories, memoryListState.searchQuery);
    filteredMemories = sortMemoriesByDate(filteredMemories);

    const pagination = getPaginationInfo(filteredMemories.length, memoryListState.page, MEMORIES_PER_PAGE);
    memoryListState.page = pagination.currentPage;
    const pageMemories = filteredMemories.slice(pagination.startIdx, pagination.endIdx);

    if (pageMemories.length === 0) {
        const message = memoryListState.searchQuery ? 'No memories match your search' : 'No memories yet';
        $container.html(`<p class="${CLASSES.PLACEHOLDER}">${message}</p>`);
    } else {
        const html = pageMemories.map(renderMemoryItem).join('');
        $container.html(html);
    }

    $pageInfo.text(`Page ${pagination.currentPage + 1} of ${pagination.totalPages}`);
    $prevBtn.prop('disabled', !pagination.hasPrev);
    $nextBtn.prop('disabled', !pagination.hasNext);

    populateCharacterFilter();
}

export function prevPage() {
    if (memoryListState.page > 0) {
        memoryListState.page--;
        renderMemoryList();
    }
}

export function nextPage() {
    memoryListState.page++;
    renderMemoryList();
}

export function resetAndRender() {
    memoryListState.page = 0;
    renderMemoryList();
}

export function resetMemoryBrowserPage() {
    memoryListState.page = 0;
}

export function populateFilter() {
    populateCharacterFilter();
}

// =============================================================================
// Character States Render
// =============================================================================

export function renderCharacterStates() {
    const $container = $(SELECTORS.CHARACTER_STATES);
    const data = getOpenVaultData();

    if (!data) {
        $container.html(`<p class="${CLASSES.PLACEHOLDER}">No chat loaded</p>`);
        return;
    }

    const characters = data[CHARACTERS_KEY] || {};
    const charNames = Object.keys(characters);

    if (charNames.length === 0) {
        $container.html(`<p class="${CLASSES.PLACEHOLDER}">No character data yet</p>`);
        return;
    }

    const html = charNames
        .sort()
        .map(name => renderCharacterState(buildCharacterStateData(name, characters[name])))
        .join('');

    $container.html(html);
}

// =============================================================================
// Browser Orchestration Layer
// =============================================================================

export function initBrowser() {
    bindMemoryListEvents();
    renderMemoryList();
    renderCharacterStates();

    $(SELECTORS.PREV_BTN).on('click', prevPage);
    $(SELECTORS.NEXT_BTN).on('click', nextPage);
}

export function refreshAllUI() {
    refreshStats();
    renderMemoryList();
    renderCharacterStates();
}

export {
    prevPage as browserPrevPage,
    nextPage as browserNextPage,
    resetAndRender as browserResetAndRender,
};
