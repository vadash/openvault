/**
 * UI Render Layer
 *
 * Consolidated rendering functions for memory list, character states, and browser orchestration.
 * Refactored from class-based components to function-based approach.
 */

import { CHARACTERS_KEY, MEMORIES_KEY, MEMORIES_PER_PAGE } from '../constants.js';
import { getDeps } from '../deps.js';
import { getDocumentEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import {
    deleteMemory as deleteMemoryAction,
    getOpenVaultData,
    updateMemory as updateMemoryAction,
} from '../utils/data.js';
import { escapeHtml, showToast } from '../utils/dom.js';
import {
    buildCharacterStateData,
    extractCharactersSet,
    filterEntities,
    filterMemories,
    getPaginationInfo,
    sortMemoriesByDate,
} from './helpers.js';
import { refreshStats } from './status.js';
import {
    renderCharacterState,
    renderCommunityAccordion,
    renderEntityCard,
    renderMemoryEdit,
    renderMemoryItem,
    renderReflectionProgress,
} from './templates.js';

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

const memoryListState = {
    page: 0,
    searchQuery: '',
};
let searchTimeout = null;

function getMemoryById(id) {
    const data = getOpenVaultData();
    if (!data) return null;
    return data[MEMORIES_KEY]?.find((m) => m.id === id) || null;
}

function filterBySearch(memories, query) {
    if (!query) return memories;
    return memories.filter((m) => {
        const summary = (m.summary || '').toLowerCase();
        const characters = (m.characters_involved || []).join(' ').toLowerCase();
        const location = (m.location || '').toLowerCase();
        return summary.includes(query) || characters.includes(query) || location.includes(query);
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
            .map((char) => `<option value="${escapeHtml(char)}">${escapeHtml(char)}</option>`)
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
    const typeFilter = $(SELECTORS.FILTER_TYPE).val();
    const characterFilter = $(SELECTORS.FILTER_CHARACTER).val();

    let filteredMemories = filterMemories(memories, typeFilter, characterFilter);
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
        .map((name) => renderCharacterState(buildCharacterStateData(name, characters[name])))
        .join('');

    $container.html(html);
}

// =============================================================================
// Reflection Progress Render
// =============================================================================

function renderReflectionProgressSection() {
    const $container = $('#openvault_reflection_progress');
    if ($container.length === 0) return;

    const data = getOpenVaultData();
    const reflectionState = data?.reflection_state || {};

    const settings = getDeps().getExtensionSettings().openvault || {};
    const threshold = settings.reflectionThreshold ?? 30;

    $container.html(renderReflectionProgress(reflectionState, threshold));
}

// =============================================================================
// World Tab State and Render
// =============================================================================

let entitySearchTimeout = null;

function renderCommunityList() {
    const $container = $('#openvault_community_list');
    const $count = $('#openvault_community_count');
    const data = getOpenVaultData();

    const communities = data?.communities || {};
    const ids = Object.keys(communities);

    $count.text(ids.length);

    if (ids.length === 0) {
        $container.html('<p class="openvault-placeholder">No communities detected yet</p>');
        return;
    }

    const html = ids.map((id) => renderCommunityAccordion(id, communities[id])).join('');
    $container.html(html);
}

function renderEntityList() {
    const $container = $('#openvault_entity_list');
    const $count = $('#openvault_entity_count');
    const data = getOpenVaultData();

    const nodes = data?.graph?.nodes || {};
    const allEntities = Object.values(nodes);

    const typeFilter = $('#openvault_entity_type_filter').val() || '';
    const searchQuery = $('#openvault_entity_search').val()?.toLowerCase().trim() || '';

    const filtered = filterEntities(allEntities, typeFilter, searchQuery);

    $count.text(allEntities.length);

    if (filtered.length === 0) {
        const msg = searchQuery || typeFilter ? 'No entities match your filters' : 'No entities extracted yet';
        $container.html(`<p class="openvault-placeholder">${msg}</p>`);
        return;
    }

    const html = filtered.map(renderEntityCard).join('');
    $container.html(html);
}

function renderWorldTab() {
    renderCommunityList();
    renderEntityList();
}

// =============================================================================
// Browser Orchestration Layer
// =============================================================================

export function initBrowser() {
    bindMemoryListEvents();
    renderMemoryList();
    renderCharacterStates();
    renderWorldTab();

    $(SELECTORS.PREV_BTN).on('click', prevPage);
    $(SELECTORS.NEXT_BTN).on('click', nextPage);

    // Entity browser events
    $('#openvault_entity_type_filter').on('change', renderEntityList);
    $('#openvault_entity_search').on('input', () => {
        clearTimeout(entitySearchTimeout);
        entitySearchTimeout = setTimeout(renderEntityList, 200);
    });
}

export function refreshAllUI() {
    refreshStats();
    renderMemoryList();
    renderCharacterStates();
    renderReflectionProgressSection();
    renderWorldTab();
}

export { prevPage as browserPrevPage, nextPage as browserNextPage, resetAndRender as browserResetAndRender };
