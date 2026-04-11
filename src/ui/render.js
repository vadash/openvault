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
    deleteEntity as deleteEntityStoreAction,
    deleteMemory as deleteMemoryAction,
    getOpenVaultData,
    mergeEntities,
    updateEntity,
    updateMemory as updateMemoryAction,
} from '../store/chat-data.js';
import { escapeHtml, showToast } from '../utils/dom.js';
import { hasEmbedding, setEmbedding } from '../utils/embedding-codec.js';
import {
    buildCharacterStateData,
    extractCharactersSet,
    filterEntities,
    filterMemories,
    getPaginationInfo,
    sortMemoriesByDate,
} from './helpers.js';
import { renderPerfTab, updateBudgetIndicators } from './settings.js';
import { refreshStats } from './status.js';
import {
    renderCharacterState,
    renderCommunityAccordion,
    renderEntityCard,
    renderEntityEdit,
    renderEntityMergePicker,
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
        const anchor = (m.temporal_anchor || '').toLowerCase();
        return (
            summary.includes(query) || characters.includes(query) || location.includes(query) || anchor.includes(query)
        );
    });
}

async function deleteMemory(id) {
    const deleted = await deleteMemoryAction(id);
    if (deleted.success) {
        if (deleted.stChanges) {
            const { applySyncChanges } = await import('../extraction/extract.js');
            await applySyncChanges(deleted.stChanges);
        }
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
    const temporal_anchor = $card.find('[data-field="temporal_anchor"]').val().trim() || null;
    const is_transient = $card.find('[data-field="is_transient"]').is(':checked');

    if (!summary) {
        showToast('warning', 'Summary cannot be empty');
        return;
    }

    $btn.prop('disabled', true);

    const updated = await updateMemoryAction(id, { summary, importance, temporal_anchor, is_transient });
    if (updated.success) {
        if (updated.stChanges) {
            const { applySyncChanges } = await import('../extraction/extract.js');
            await applySyncChanges(updated.stChanges);
        }
        const memory = getMemoryById(id);
        if (memory && !hasEmbedding(memory) && isEmbeddingsEnabled()) {
            const embedding = await getDocumentEmbedding(summary);
            if (embedding) {
                setEmbedding(memory, embedding);
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
    const threshold = settings.reflectionThreshold;

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

    const graph = data?.graph || {};
    const typeFilter = $('#openvault_entity_type_filter').val() || '';
    const searchQuery = $('#openvault_entity_search').val()?.toLowerCase().trim() || '';

    const filtered = filterEntities(graph, searchQuery, typeFilter);

    $count.text(Object.keys(graph?.nodes || {}).length);

    if (filtered.length === 0) {
        const msg = searchQuery || typeFilter ? 'No entities match your filters' : 'No entities extracted yet';
        $container.html(`<p class="openvault-placeholder">${msg}</p>`);
        return;
    }

    const html = filtered.map(([key, entity]) => renderEntityCard(entity, key)).join('');
    $container.html(html);
}

function renderWorldTab() {
    renderCommunityList();
    renderEntityList();
}

// =============================================================================
// Entity CRUD Event Bindings & Actions
// =============================================================================

// In-memory storage for edit form state
const entityEditState = new Map();

/**
 * Initialize entity list event bindings
 * Called once during UI setup
 */
function initEntityEventBindings() {
    const $container = $('#openvault_entity_list');
    if ($container.length === 0) return;

    // Edit button - switch to edit mode
    $container.on('click', '.openvault-edit-entity', (e) => {
        const key = $(e.currentTarget).data('key');
        enterEntityEditMode(key);
    });

    // Delete button - confirm and delete
    $container.on('click', '.openvault-delete-entity', async (e) => {
        const key = $(e.currentTarget).data('key');
        await deleteEntityAction(key);
    });

    // Cancel button - revert to view mode
    $container.on('click', '.openvault-cancel-entity-edit', (e) => {
        const key = $(e.currentTarget).data('key');
        cancelEntityEdit(key);
    });

    // Save button - validate and save
    $container.on('click', '.openvault-save-entity-edit', async (e) => {
        const key = $(e.currentTarget).data('key');
        await saveEntityEdit(key, e.currentTarget);
    });

    // Remove alias button
    $container.on('click', '.openvault-remove-alias', (e) => {
        const key = $(e.currentTarget).data('key');
        const alias = $(e.currentTarget).data('alias');
        removeAliasChip(key, alias);
    });

    // Add alias button
    $container.on('click', '.openvault-add-alias', (e) => {
        const key = $(e.currentTarget).data('key');
        addAliasChip(key);
    });

    // Add alias on Enter key
    $container.on('keypress', '.openvault-alias-input', (e) => {
        if (e.which === 13) {
            const key = $(e.currentTarget).data('key');
            addAliasChip(key);
        }
    });

    // Merge button on entity card
    $container.on('click', '.openvault-merge-entity', (e) => {
        const key = $(e.currentTarget).data('key');
        enterEntityMergeMode(key);
    });

    // Cancel merge picker
    $container.on('click', '.openvault-cancel-entity-merge', (e) => {
        const key = $(e.currentTarget).data('key');
        cancelEntityMerge(key);
    });

    // Confirm merge
    $container.on('click', '.openvault-confirm-entity-merge', async (e) => {
        const sourceKey = $(e.currentTarget).data('source-key');
        await confirmEntityMerge(sourceKey);
    });

    // Escape key to cancel
    $container.on('keydown', '.openvault-entity-merge-panel', (e) => {
        if (e.key === 'Escape') {
            const key = $(e.currentTarget).data('source-key');
            cancelEntityMerge(key);
        }
    });
}

/**
 * Enter edit mode for an entity
 * @param {string} key - Entity key
 */
function enterEntityEditMode(key) {
    const graph = getOpenVaultData().graph;
    const entity = graph.nodes[key];
    if (!entity) return;

    // Store current state for potential cancel
    entityEditState.set(key, { ...entity });

    // Replace card with edit form
    const $card = $(`.openvault-entity-card[data-key="${key}"]`);
    const editHtml = renderEntityEdit(entity, key);
    $card.replaceWith(editHtml);
}

/**
 * Cancel entity edit and revert to view mode
 * @param {string} key - Entity key
 */
function cancelEntityEdit(key) {
    const graph = getOpenVaultData().graph;
    const entity = graph.nodes[key];
    if (!entity) return;

    entityEditState.delete(key);

    const $edit = $(`.openvault-entity-edit[data-key="${key}"]`);
    const viewHtml = renderEntityCard(entity, key);
    $edit.replaceWith(viewHtml);
}

/**
 * Save entity edit
 * @param {string} key - Entity key
 * @param {HTMLElement} btn - Save button element
 */
async function saveEntityEdit(key, btn) {
    const $edit = $(`.openvault-entity-edit[data-key="${key}"]`);
    const name = $edit.find('.openvault-edit-name').val()?.toString().trim();
    const type = $edit.find('.openvault-edit-type').val()?.toString();
    const description = $edit.find('.openvault-edit-description').val()?.toString().trim();

    // Validation
    if (!name) {
        showToast('warning', 'Entity name cannot be empty');
        return;
    }

    // Build aliases from chips
    const aliases = $edit
        .find('.openvault-alias-chip')
        .map((_, chip) => $(chip).text().replace('×', '').trim())
        .get();

    // Capture any pending alias in the input field
    const pendingAlias = $edit.find('.openvault-alias-input').val()?.toString()?.trim();
    if (pendingAlias) {
        const existingLower = aliases.map((a) => a.toLowerCase());
        if (!existingLower.includes(pendingAlias.toLowerCase())) {
            aliases.push(pendingAlias);
        }
    }

    const updates = {
        name,
        type,
        description,
        aliases,
    };

    // Show loading state
    const $btn = $(btn);
    const originalText = $btn.text();
    $btn.prop('disabled', true).text('Saving...');

    try {
        const result = await updateEntity(key, updates);

        if (result === null) {
            showToast(
                'warning',
                'An entity with that name already exists. Merging will be available in a future update.'
            );
            $btn.prop('disabled', false).text(originalText);
            return;
        }

        // Clear edit state (use old key and new key for rename case)
        entityEditState.delete(key);

        // Sync ST Vector changes (re-sync on rename, delete old hashes)
        if (result.stChanges) {
            const { applySyncChanges } = await import('../extraction/extract.js');
            await applySyncChanges(result.stChanges);
        }

        // Replace with updated view card (use newKey if renamed)
        const graph = getOpenVaultData().graph;
        const entity = graph.nodes[result.key];
        const viewHtml = renderEntityCard(entity, result.key);
        $edit.replaceWith(viewHtml);

        showToast('success', 'Entity updated');
        refreshStats();
    } catch (err) {
        console.error('[OpenVault] Failed to save entity:', err);
        $btn.prop('disabled', false).text(originalText);
    }
}

/**
 * Delete entity action with confirmation
 * @param {string} key - Entity key
 */
async function deleteEntityAction(key) {
    const graph = getOpenVaultData().graph;
    const entity = graph.nodes[key];
    if (!entity) return;

    // Count connected edges
    const edgeCount = Object.values(graph.edges).filter((e) => e.source === key || e.target === key).length;

    const confirmMsg =
        edgeCount > 0
            ? `Delete "${entity.name}"? This will also remove ${edgeCount} connected relationship(s).`
            : `Delete "${entity.name}"?`;

    if (!confirm(confirmMsg)) return;

    const result = await deleteEntityStoreAction(key);
    if (result.success) {
        // Clean up stale edit state
        entityEditState.delete(key);

        // Remove from DOM
        $(`.openvault-entity-card[data-key="${key}"]`).remove();

        // Clean up ST Vector if needed
        if (result.stChanges) {
            const { applySyncChanges } = await import('../extraction/extract.js');
            await applySyncChanges(result.stChanges);
        }

        showToast('success', 'Entity deleted');
        refreshStats();
        // Update entity count
        $('#openvault_entity_count').text(Object.keys(getOpenVaultData().graph?.nodes || {}).length);
    }
}

/**
 * Remove alias chip from edit form
 * @param {string} key - Entity key
 * @param {string} alias - Alias to remove
 */
function removeAliasChip(key, alias) {
    const $edit = $(`.openvault-entity-edit[data-key="${key}"]`);
    $edit.find(`.openvault-remove-alias[data-alias="${alias}"]`).closest('.openvault-alias-chip').remove();
}

/**
 * Add alias chip to edit form
 * @param {string} key - Entity key
 */
function addAliasChip(key) {
    const $edit = $(`.openvault-entity-edit[data-key="${key}"]`);
    const $input = $edit.find('.openvault-alias-input');
    const alias = $input.val()?.toString().trim();

    if (!alias) return;

    // Check for duplicates (case-insensitive)
    const existingAliases = $edit
        .find('.openvault-alias-chip')
        .map((_, chip) => $(chip).text().replace('×', '').trim().toLowerCase())
        .get();

    if (existingAliases.includes(alias.toLowerCase())) {
        $input.val('');
        return;
    }

    // Add chip
    const chipHtml = `
        <span class="openvault-alias-chip">
            ${escapeHtml(alias)}
            <span class="remove openvault-remove-alias" data-key="${escapeHtml(key)}" data-alias="${escapeHtml(alias)}">×</span>
        </span>
    `;
    $edit.find('.openvault-alias-list').append(chipHtml);
    $input.val('');
}

// =============================================================================
// Entity Merge Flow Handlers
// =============================================================================

/**
 * Enter merge mode for an entity - replace card with merge picker.
 * @param {string} sourceKey
 */
function enterEntityMergeMode(sourceKey) {
    const deps = getDeps();
    const ctx = deps.getContext();
    const graph = ctx.chatMetadata?.openvault?.graph;

    if (!graph) return;

    const sourceNode = graph.nodes[sourceKey];
    if (!sourceNode) return;

    // Render the merge picker
    const pickerHtml = renderEntityMergePicker(sourceKey, sourceNode, graph.nodes);

    // Replace the entity card with the picker
    const $card = $(`.openvault-entity-card[data-key="${sourceKey}"]`);
    $card.replaceWith(pickerHtml);

    // Focus the search input
    $('.openvault-merge-search').focus();
}

/**
 * Cancel merge mode - restore the entity card view.
 * @param {string} sourceKey
 */
function cancelEntityMerge(_sourceKey) {
    // Re-render the entity list to restore the card
    renderEntityList();
}

/**
 * Find target entity key from user input text.
 * Matches against node names and aliases (case-insensitive).
 * @param {string} inputText - The text entered by user
 * @param {Object} nodes - Graph nodes
 * @returns {string|null} Target key or null if not found
 */
function findMergeTargetFromInput(inputText, nodes) {
    if (!inputText) return null;

    const normalizedInput = inputText.toLowerCase().trim();
    // Remove type suffix like " [PERSON]" for matching
    const cleanInput = normalizedInput.replace(/\s*\[[^\]]+\]$/, '').trim();

    for (const [key, node] of Object.entries(nodes)) {
        const name = (node.name || '').toLowerCase();
        if (name === cleanInput) return key;

        const aliases = (node.aliases || []).map((a) => a.toLowerCase());
        if (aliases.includes(cleanInput)) return key;
    }

    return null;
}

/**
 * Confirm and execute the entity merge.
 * @param {string} sourceKey
 */
async function confirmEntityMerge(sourceKey) {
    const deps = getDeps();
    const ctx = deps.getContext();
    const graph = ctx.chatMetadata?.openvault?.graph;

    if (!graph) {
        showToast('error', 'Graph not available');
        return;
    }

    // Get the input value and find the target
    const $panel = $(`.openvault-entity-merge-panel[data-source-key="${sourceKey}"]`);
    const inputText = $panel.find('.openvault-merge-search').val();
    const targetKey = findMergeTargetFromInput(inputText, graph.nodes);

    if (!targetKey) {
        showToast('error', 'Please select a valid target entity');
        return;
    }

    if (targetKey === sourceKey) {
        showToast('error', 'Cannot merge an entity into itself');
        return;
    }

    try {
        showToast('info', 'Merging entities...');

        const result = await mergeEntities(sourceKey, targetKey);

        if (!result.success) {
            showToast('error', 'Failed to merge entities');
            return;
        }

        // Sync ST Vector changes (delete removed, re-sync surviving node)
        if (result.stChanges) {
            const { applySyncChanges } = await import('../extraction/extract.js');
            await applySyncChanges(result.stChanges);
        }

        // Re-render the entity list
        renderEntityList();

        showToast('success', `Merged into ${graph.nodes[targetKey]?.name || targetKey}`);
    } catch (error) {
        if (error.name === 'AbortError') return;
        showToast('error', `Merge failed: ${error.message}`);
        console.error('Entity merge failed:', error);
    }
}

// =============================================================================
// Browser Orchestration Layer
// =============================================================================

export function initBrowser() {
    bindMemoryListEvents();
    initEntityEventBindings();
    initPositionBadges();
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
    updateBudgetIndicators();
    renderPerfTab();
}

// =============================================================================
// Position Badges
// =============================================================================

/**
 * Render position badges for display
 * @param {Object} settings - Extension settings
 * @returns {string} HTML for position badges
 */
export function renderPositionBadges(settings) {
    const getPositionLabel = (position) => {
        const labels = {
            0: '↑Char',
            1: '↓Char',
            2: '↑AN',
            3: '↓AN',
            4: 'In-chat',
            '-1': 'Custom',
        };
        return labels[position] || 'Unknown';
    };

    const memoryPos = settings?.injection?.memory?.position ?? 5;
    const worldPos = settings?.injection?.world?.position ?? 5;

    const memoryLabel =
        memoryPos === -1
            ? `<span class="openvault-position-badge custom" title="Click to copy macro" data-macro="openvault_memory">📋 {{openvault_memory}}</span>`
            : `<span class="openvault-position-badge" title="Memory injection position">${getPositionLabel(memoryPos)}</span>`;

    const worldLabel =
        worldPos === -1
            ? `<span class="openvault-position-badge custom" title="Click to copy macro" data-macro="openvault_world">📋 {{openvault_world}}</span>`
            : `<span class="openvault-position-badge" title="World injection position">${getPositionLabel(worldPos)}</span>`;

    return `${memoryLabel} | ${worldLabel}`;
}

/**
 * Initialize click handlers for position badges
 */
function initPositionBadges() {
    $(document).on('click', '.openvault-position-badge.custom', function () {
        const macro = $(this).data('macro');
        const macroText = `{{${macro}}}`;
        navigator.clipboard
            .writeText(macroText)
            .then(
                () => showToast('success', `Copied {{${macro}}} to clipboard`),
                () => showToast('error', 'Failed to copy')
            )
            .catch(() => {});
    });
}

export { prevPage as browserPrevPage, nextPage as browserNextPage, resetAndRender as browserResetAndRender };
