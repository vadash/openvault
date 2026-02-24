/**
 * MemoryList Component
 *
 * Manages the memory browser list display, pagination, search, and filtering.
 */

import { Component } from '../base/Component.js';
import { SELECTORS, CLASSES } from '../base/constants.js';
import { renderMemoryItem, renderMemoryEdit } from '../templates/memory.js';
import { filterMemories, sortMemoriesByDate, getPaginationInfo, extractCharactersSet } from '../calculations.js';
import { getOpenVaultData, showToast } from '../../utils.js';
import { escapeHtml } from '../../utils/dom.js';
import { getDeps } from '../../deps.js';
import { MEMORIES_KEY, MEMORIES_PER_PAGE } from '../../constants.js';
import { deleteMemory as deleteMemoryAction, updateMemory as updateMemoryAction } from '../../data/actions.js';
import { getDocumentEmbedding, isEmbeddingsEnabled } from '../../embeddings.js';
import { refreshStats } from '../status.js';

export class MemoryList extends Component {
    constructor() {
        super({
            container: SELECTORS.MEMORY_LIST,
            selectors: {
                pageInfo: SELECTORS.PAGE_INFO,
                prevBtn: SELECTORS.PREV_BTN,
                nextBtn: SELECTORS.NEXT_BTN,
                searchInput: SELECTORS.SEARCH_INPUT,
                filterType: SELECTORS.FILTER_TYPE,
                filterCharacter: SELECTORS.FILTER_CHARACTER,
            },
            initialState: {
                page: 0,
                searchQuery: '',
            }
        });

        // Bind search debounce
        this._searchTimeout = null;
    }

    /**
     * Initialize component and bind events
     */
    init() {
        this._bindEvents();
        this._bindSearch();
        this.render();
    }

    /**
     * Bind event handlers using delegation
     */
    _bindEvents() {
        // Delete button
        this.on('click', SELECTORS.DELETE_BTN, async (e) => {
            const id = $(e.currentTarget).data('id');
            await this._deleteMemory(id);
        });

        // Edit button - swap to edit mode
        this.on('click', SELECTORS.EDIT_BTN, (e) => {
            const id = $(e.currentTarget).data('id');
            this._enterEditMode(id);
        });

        // Cancel edit - restore view mode
        this.on('click', SELECTORS.CANCEL_EDIT_BTN, (e) => {
            const id = $(e.currentTarget).data('id');
            this._exitEditMode(id);
        });

        // Save edit - update memory
        this.on('click', SELECTORS.SAVE_EDIT_BTN, async (e) => {
            const id = $(e.currentTarget).data('id');
            await this._saveEdit(id, e.currentTarget);
        });
    }

    /**
     * Bind search input with debounce
     */
    _bindSearch() {
        const $search = $(SELECTORS.SEARCH_INPUT);
        $search.off('input'); // Clear any existing handlers
        $search.on('input', () => {
            clearTimeout(this._searchTimeout);
            this._searchTimeout = setTimeout(() => {
                this.state.searchQuery = $search.val().toLowerCase().trim();
                this.state.page = 0;
                this.render();
            }, 200);
        });
    }

    /**
     * Get memory by ID
     */
    _getMemoryById(id) {
        const data = getOpenVaultData();
        if (!data) return null;
        return data[MEMORIES_KEY]?.find(m => m.id === id) || null;
    }

    /**
     * Filter memories by search query
     */
    _filterBySearch(memories, query) {
        if (!query) return memories;
        return memories.filter(m => {
            const summary = (m.summary || '').toLowerCase();
            const characters = (m.characters_involved || []).join(' ').toLowerCase();
            const location = (m.location || '').toLowerCase();
            const tags = (m.tags || []).join(' ').toLowerCase();
            return summary.includes(query) ||
                   characters.includes(query) ||
                   location.includes(query) ||
                   tags.includes(query);
        });
    }

    /**
     * Delete a memory
     */
    async _deleteMemory(id) {
        const deleted = await deleteMemoryAction(id);
        if (deleted) {
            this.render();
            this._populateCharacterFilter();
            refreshStats();
            showToast('success', 'Memory deleted');
        }
    }

    /**
     * Enter edit mode for a memory
     */
    _enterEditMode(id) {
        const memory = this._getMemoryById(id);
        if (!memory) return;

        const $card = this.$container.find(`[data-id="${id}"]`);
        $card.replaceWith(renderMemoryEdit(memory));
    }

    /**
     * Exit edit mode for a memory
     */
    _exitEditMode(id) {
        const memory = this._getMemoryById(id);
        if (!memory) return;

        const $card = this.$container.find(`[data-id="${id}"]`);
        $card.replaceWith(renderMemoryItem(memory));
    }

    /**
     * Save edit changes
     */
    async _saveEdit(id, btnElement) {
        const $card = this.$container.find(`[data-id="${id}"]`);
        const $btn = $(btnElement);

        // Gather values
        const summary = $card.find('[data-field="summary"]').val().trim();
        const importance = parseInt($card.find('[data-field="importance"]').val(), 10);
        const tags = [];
        $card.find('[data-field="tags"] input:checked').each(function() {
            tags.push($(this).val());
        });
        if (tags.length === 0) tags.push('NONE');

        if (!summary) {
            showToast('warning', 'Summary cannot be empty');
            return;
        }

        // Disable button during save
        $btn.prop('disabled', true);

        const updated = await updateMemoryAction(id, { summary, importance, tags });
        if (updated) {
            // Auto-generate embedding if needed
            const memory = this._getMemoryById(id);
            if (memory && !memory.embedding && isEmbeddingsEnabled()) {
                const embedding = await getDocumentEmbedding(summary, memory.tags);
                if (embedding) {
                    memory.embedding = embedding;
                    await getDeps().saveChatConditional();
                }
            }

            // Re-render card
            const updatedMemory = this._getMemoryById(id);
            if (updatedMemory) {
                $card.replaceWith(renderMemoryItem(updatedMemory));
            }
            showToast('success', 'Memory updated');
            refreshStats();
        }
        $btn.prop('disabled', false);
    }

    /**
     * Populate character filter dropdown
     */
    _populateCharacterFilter() {
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

    /**
     * Render the memory list
     */
    render() {
        // Check if user is editing - preserve state if so
        if (this.$container.find('.openvault-edit-form').length > 0) {
            // Skip render to preserve user's in-progress edit
            return;
        }

        const data = getOpenVaultData();
        const $pageInfo = $(SELECTORS.PAGE_INFO);
        const $prevBtn = $(SELECTORS.PREV_BTN);
        const $nextBtn = $(SELECTORS.NEXT_BTN);

        if (!data) {
            this.$container.html(`<p class="${CLASSES.PLACEHOLDER}">No chat loaded</p>`);
            $pageInfo.text('Page 0 / 0');
            $prevBtn.prop('disabled', true);
            $nextBtn.prop('disabled', true);
            return;
        }

        const memories = data[MEMORIES_KEY] || [];

        // Get filter values
        const typeFilter = $(SELECTORS.FILTER_TYPE).val();
        const characterFilter = $(SELECTORS.FILTER_CHARACTER).val();

        // Filter, search, and sort
        let filteredMemories = filterMemories(memories, typeFilter, characterFilter);
        filteredMemories = this._filterBySearch(filteredMemories, this.state.searchQuery);
        filteredMemories = sortMemoriesByDate(filteredMemories);

        // Pagination
        const pagination = getPaginationInfo(filteredMemories.length, this.state.page, MEMORIES_PER_PAGE);
        this.state.page = pagination.currentPage;
        const pageMemories = filteredMemories.slice(pagination.startIdx, pagination.endIdx);

        // Render memories
        if (pageMemories.length === 0) {
            const message = this.state.searchQuery ? 'No memories match your search' : 'No memories yet';
            this.$container.html(`<p class="${CLASSES.PLACEHOLDER}">${message}</p>`);
        } else {
            const html = pageMemories.map(renderMemoryItem).join('');
            this.$container.html(html);
        }

        // Update pagination controls
        $pageInfo.text(`Page ${pagination.currentPage + 1} of ${pagination.totalPages}`);
        $prevBtn.prop('disabled', !pagination.hasPrev);
        $nextBtn.prop('disabled', !pagination.hasNext);

        // Populate character filter
        this._populateCharacterFilter();
    }

    /**
     * Navigate to previous page
     */
    prevPage() {
        if (this.state.page > 0) {
            this.state.page--;
            this.render();
        }
    }

    /**
     * Navigate to next page
     */
    nextPage() {
        this.state.page++;
        this.render();
    }

    /**
     * Reset page and re-render
     */
    resetAndRender() {
        this.state.page = 0;
        this.render();
    }

    /**
     * Reset page only (for filter changes)
     */
    resetPage() {
        this.state.page = 0;
    }

    /**
     * Populate character filter (exported for external use)
     */
    populateFilter() {
        this._populateCharacterFilter();
    }
}
