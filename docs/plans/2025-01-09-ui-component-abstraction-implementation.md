# UI Component Abstraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor `src/ui/browser.js` into a maintainable component-based architecture with extracted templates and centralized selectors.

**Architecture:** Hybrid component system with base class providing DOM helpers and event delegation. Pure template functions generate HTML. Components manage state and render. No reactivity/diffing (YAGNI).

**Tech Stack:** ES Modules, jQuery (SillyTavern standard), Vitest for testing

---

## Phase 1: Foundation (Non-Breaking)

### Task 1: Create Base Component Class

**Files:**
- Create: `src/ui/base/Component.js`
- Create: `src/ui/base/index.js`

**Step 1: Create the base Component class**

```javascript
// src/ui/base/Component.js
import { $ } from '../../deps.js';

/**
 * Base class for UI components
 * Provides DOM helpers, event delegation, and simple state management
 */
export class Component {
    /**
     * @param {Object} options
     * @param {string|jQuery} options.container - CSS selector or jQuery object
     * @param {Object} options.selectors - Map of logical names to CSS selectors
     * @param {Object} options.initialState - Optional initial state
     */
    constructor({ container, selectors = {}, initialState = {} }) {
        this.$container = typeof container === 'string'
            ? $(container)
            : container;
        this.selectors = selectors;
        this.state = { ...initialState };
        this.eventHandlers = new Map();
    }

    /**
     * Get a jQuery element by logical selector key
     * @param {string} key - Key from this.selectors
     * @returns {jQuery} jQuery element
     */
    $(key) {
        const selector = this.selectors[key];
        if (!selector) {
            throw new Error(`Unknown selector key: ${key}. Available keys: ${Object.keys(this.selectors).join(', ')}`);
        }
        return this.$container.find(selector);
    }

    /**
     * Delegate event to container, tracked for potential cleanup
     * @param {string} event - Event type (click, change, etc.)
     * @param {string} selector - CSS selector for delegation
     * @param {Function} handler - Event handler
     * @returns {Component} this for chaining
     */
    on(event, selector, handler) {
        this.$container.on(event, selector, handler);
        this.eventHandlers.set(`${event}:${selector}`, handler);
        return this;
    }

    /**
     * Simple state setter - merges updates into current state
     * @param {Object} updates - State updates
     * @returns {Component} this for chaining
     */
    setState(updates) {
        this.state = { ...this.state, ...updates };
        return this;
    }

    /**
     * Render method - override in subclasses
     */
    render() {
        throw new Error('Component must implement render()');
    }

    /**
     * Clean up events
     */
    destroy() {
        this.eventHandlers.forEach((handler, key) => {
            const [event, selector] = key.split(':');
            this.$container.off(event, selector, handler);
        });
        this.eventHandlers.clear();
    }
}
```

**Step 2: Create barrel export for base module**

```javascript
// src/ui/base/index.js
export { Component } from './Component.js';
export { SELECTORS, CLASSES, EVENTS } from './constants.js';
```

**Step 3: Create constants file**

```javascript
// src/ui/base/constants.js

// =============================================================================
// DOM Selectors - Single source of truth for UI element references
// =============================================================================

export const SELECTORS = {
    // Main containers
    MEMORY_LIST: '#openvault_memory_list',
    PAGE_INFO: '#openvault_page_info',
    PREV_BTN: '#openvault_prev_page',
    NEXT_BTN: '#openvault_next_page',
    SEARCH_INPUT: '#openvault_memory_search',
    FILTER_TYPE: '#openvault_filter_type',
    FILTER_CHARACTER: '#openvault_filter_character',

    // Character states
    CHARACTER_STATES: '#openvault_character_states',

    // Relationships
    RELATIONSHIPS: '#openvault_relationships',

    // Dynamic elements (within cards, for event delegation)
    MEMORY_CARD: '.openvault-memory-card',
    DELETE_BTN: '.openvault-delete-memory',
    EDIT_BTN: '.openvault-edit-memory',
    CANCEL_EDIT_BTN: '.openvault-cancel-edit',
    SAVE_EDIT_BTN: '.openvault-save-edit',
    EDIT_TEXTAREA: '.openvault-edit-textarea',
    EDIT_FIELD: '[data-field]',
};

// CSS classes (for when JS needs to add/remove classes)
export const CLASSES = {
    MEMORY_CARD: 'openvault-memory-card',
    PLACEHOLDER: 'openvault-placeholder',
};

// Event types for internal communication
export const EVENTS = {
    MEMORY_DELETED: 'openvault:memory:deleted',
    MEMORY_UPDATED: 'openvault:memory:updated',
    FILTER_CHANGED: 'openvault:filter:changed',
};

// Event type icons mapping
export const EVENT_TYPE_ICONS = {
    action: 'fa-solid fa-bolt',
    revelation: 'fa-solid fa-lightbulb',
    emotion_shift: 'fa-solid fa-heart',
    relationship_change: 'fa-solid fa-people-arrows',
    default: 'fa-solid fa-bookmark'
};

// Event types for edit dropdown
export const EVENT_TYPES = ['action', 'revelation', 'emotion_shift', 'relationship_change'];
```

**Step 4: Verify files are created**

```bash
ls -la src/ui/base/
```
Expected: `Component.js`, `constants.js`, `index.js`

**Step 5: Run tests**

```bash
npm test
```
Expected: PASS (no test changes yet)

**Step 6: Commit**

```bash
git add src/ui/base/
git commit -m "feat(ui): add base Component class and constants"
```

---

### Task 2: Create Templates Directory Structure

**Files:**
- Create: `src/ui/templates/memory.js`
- Create: `src/ui/templates/character.js`
- Create: `src/ui/templates/relationship.js`
- Create: `src/ui/templates/index.js`

**Step 1: Create memory templates file**

```javascript
// src/ui/templates/memory.js
import { escapeHtml } from '../../utils/dom.js';
import { isEmbeddingsEnabled } from '../../embeddings.js';
import { formatMemoryImportance, formatMemoryDate, formatWitnesses } from '../formatting.js';
import { EVENT_TYPE_ICONS, EVENT_TYPES } from '../base/constants.js';

// =============================================================================
// Pure template functions - zero side effects, easily testable
// =============================================================================

/**
 * Render a single memory card in view mode
 * @param {Object} memory - Memory object
 * @returns {string} HTML
 */
export function renderMemoryItem(memory) {
    const typeClass = getTypeClass(memory);
    const badges = buildBadges(memory);
    const characterTags = buildCharacterTags(memory.characters_involved);

    return `
        <div class="openvault-memory-card ${typeClass}" data-id="${escapeHtml(memory.id)}">
            ${buildCardHeader(memory, typeClass)}
            <div class="openvault-memory-card-summary">${escapeHtml(memory.summary || 'No summary')}</div>
            ${buildCardFooter(memory, badges)}
            ${characterTags}
        </div>
    `;
}

/**
 * Render a single memory card in edit mode
 * @param {Object} memory - Memory object
 * @returns {string} HTML
 */
export function renderMemoryEdit(memory) {
    const typeClass = getTypeClass(memory);
    const importance = memory.importance || 3;
    const eventType = memory.event_type || 'action';

    const importanceOptions = [1, 2, 3, 4, 5]
        .map(i => `<option value="${i}"${i === importance ? ' selected' : ''}>${i}</option>`)
        .join('');

    const typeOptions = EVENT_TYPES
        .map(t => `<option value="${t}"${t === eventType ? ' selected' : ''}>${t.replace('_', ' ')}</option>`)
        .join('');

    return `
        <div class="openvault-memory-card ${typeClass}" data-id="${escapeHtml(memory.id)}">
            <div class="openvault-edit-form">
                <textarea class="openvault-edit-textarea" data-field="summary">${escapeHtml(memory.summary || '')}</textarea>
                <div class="openvault-edit-row">
                    <label>
                        Importance
                        <select data-field="importance">${importanceOptions}</select>
                    </label>
                    <label>
                        Event Type
                        <select data-field="event_type">${typeOptions}</select>
                    </label>
                </div>
                <div class="openvault-edit-actions">
                    <button class="menu_button openvault-cancel-edit" data-id="${escapeHtml(memory.id)}">
                        <i class="fa-solid fa-times"></i> Cancel
                    </button>
                    <button class="menu_button openvault-save-edit" data-id="${escapeHtml(memory.id)}">
                        <i class="fa-solid fa-check"></i> Save
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Render empty state placeholder
 * @param {string} message - Message to display
 * @returns {string} HTML
 */
export function renderEmptyState(message = 'No memories yet') {
    return `<p class="openvault-placeholder">${message}</p>`;
}

// =============================================================================
// Helper functions - pure, testable in isolation
// =============================================================================

function buildBadges(memory) {
    const badges = [];

    // Importance badge
    badges.push(`<span class="openvault-memory-card-badge importance">${formatMemoryImportance(memory.importance || 3)}</span>`);

    // Pending embed badge
    if (!memory.embedding && isEmbeddingsEnabled()) {
        badges.push(`<span class="openvault-memory-card-badge pending-embed" title="Embedding pending"><i class="fa-solid fa-rotate-right"></i></span>`);
    }

    // Witness badge
    const witnessText = formatWitnesses(memory.witnesses);
    if (witnessText) {
        badges.push(`<span class="openvault-memory-card-badge witness"><i class="fa-solid fa-eye"></i> ${escapeHtml(witnessText)}</span>`);
    }

    // Location badge
    if (memory.location) {
        badges.push(`<span class="openvault-memory-card-badge location"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(memory.location)}</span>`);
    }

    return badges.join('');
}

function buildCharacterTags(characters = []) {
    if (characters.length === 0) return '';
    const tags = characters
        .map(c => `<span class="openvault-character-tag">${escapeHtml(c)}</span>`)
        .join('');
    return `<div class="openvault-memory-characters" style="margin-top: 8px;">${tags}</div>`;
}

function buildCardHeader(memory, typeClass) {
    const iconClass = getEventTypeIcon(memory.event_type);
    const date = formatMemoryDate(memory.created_at);

    return `
        <div class="openvault-memory-card-header">
            <div class="openvault-memory-card-icon ${typeClass}">
                <i class="${iconClass}"></i>
            </div>
            <div class="openvault-memory-card-meta">
                <span class="openvault-memory-card-type">${escapeHtml(memory.event_type || 'event')}</span>
                <span class="openvault-memory-card-date">${escapeHtml(date)}</span>
            </div>
        </div>
    `;
}

function buildCardFooter(memory, badges) {
    return `
        <div class="openvault-memory-card-footer">
            <div class="openvault-memory-card-badges">
                ${badges}
            </div>
            <div>
                <button class="menu_button openvault-edit-memory" data-id="${escapeHtml(memory.id)}" title="Edit memory">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="menu_button openvault-delete-memory" data-id="${escapeHtml(memory.id)}" title="Delete memory">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

function getTypeClass(memory) {
    return (memory.event_type || 'action').replace(/[^a-zA-Z0-9-]/g, '');
}

function getEventTypeIcon(eventType) {
    return EVENT_TYPE_ICONS[eventType] || EVENT_TYPE_ICONS.default;
}
```

**Step 2: Create character templates file**

```javascript
// src/ui/templates/character.js
import { escapeHtml } from '../../utils/dom.js';

/**
 * Render a single character state as HTML
 * @param {Object} charData - Character state data from buildCharacterStateData
 * @returns {string} HTML
 */
export function renderCharacterState(charData) {
    return `
        <div class="openvault-character-item">
            <div class="openvault-character-name">${escapeHtml(charData.name)}</div>
            <div class="openvault-emotion">
                <span class="openvault-emotion-label">${escapeHtml(charData.emotion)}${charData.emotionSource || ''}</span>
                <div class="openvault-emotion-bar">
                    <div class="openvault-emotion-fill" style="width: ${charData.intensityPercent}%"></div>
                </div>
            </div>
            <div class="openvault-memory-witnesses">Known events: ${charData.knownCount}</div>
        </div>
    `;
}

/**
 * Render empty state for character states
 * @returns {string} HTML
 */
export function renderCharacterEmptyState(message = 'No character data yet') {
    return `<p class="openvault-placeholder">${message}</p>`;
}
```

**Step 3: Create relationship templates file**

```javascript
// src/ui/templates/relationship.js
import { escapeHtml } from '../../utils/dom.js';

/**
 * Render a single relationship as HTML
 * @param {Object} relData - Relationship data from buildRelationshipData
 * @returns {string} HTML
 */
export function renderRelationship(relData) {
    return `
        <div class="openvault-relationship-item">
            <div class="openvault-relationship-pair">${escapeHtml(relData.characterA)} ↔ ${escapeHtml(relData.characterB)}</div>
            <div class="openvault-relationship-type">${escapeHtml(relData.type)}</div>
            <div class="openvault-relationship-bars">
                <div class="openvault-bar-row">
                    <span class="openvault-bar-label">Trust</span>
                    <div class="openvault-bar-container">
                        <div class="openvault-bar-fill trust" style="width: ${relData.trustPercent}%"></div>
                    </div>
                </div>
                <div class="openvault-bar-row">
                    <span class="openvault-bar-label">Tension</span>
                    <div class="openvault-bar-container">
                        <div class="openvault-bar-fill tension" style="width: ${relData.tensionPercent}%"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Render empty state for relationships
 * @returns {string} HTML
 */
export function renderRelationshipEmptyState(message = 'No relationship data yet') {
    return `<p class="openvault-placeholder">${message}</p>`;
}
```

**Step 4: Create barrel export**

```javascript
// src/ui/templates/index.js
export * from './memory.js';
export * from './character.js';
export * from './relationship.js';
```

**Step 5: Run tests**

```bash
npm test
```
Expected: PASS

**Step 6: Commit**

```bash
git add src/ui/templates/
git commit -m "feat(ui): extract template functions to separate modules"
```

---

## Phase 2: Update browser.js to Use New Templates

### Task 3: Update browser.js Imports

**Files:**
- Modify: `src/ui/browser.js`

**Step 1: Update imports in browser.js**

Replace the template function definitions and constants with imports from new modules. Keep event handling and rendering logic for now.

At the top of `src/ui/browser.js`, update imports:

```javascript
/**
 * OpenVault Memory Browser UI
 *
 * Handles memory list rendering, character states, and relationship displays.
 * Uses template literals for cleaner, more maintainable HTML generation.
 */

import { getOpenVaultData, showToast } from '../utils.js';
import { getDeps } from '../deps.js';
import { MEMORIES_KEY, CHARACTERS_KEY, RELATIONSHIPS_KEY, MEMORIES_PER_PAGE } from '../constants.js';
import { deleteMemory as deleteMemoryAction, updateMemory as updateMemoryAction } from '../data/actions.js';
import { getEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { refreshStats } from './status.js';
import { filterMemories, sortMemoriesByDate, getPaginationInfo, extractCharactersSet, buildCharacterStateData, buildRelationshipData } from './calculations.js';

// Import templates and constants from new modules
import { renderMemoryItem, renderMemoryEdit, renderEmptyState } from './templates/memory.js';
import { renderCharacterState, renderCharacterEmptyState } from './templates/character.js';
import { renderRelationship, renderRelationshipEmptyState } from './templates/relationship.js';
import { SELECTORS } from './base/constants.js';
```

**Step 2: Remove old template functions and constants**

Remove these sections from `src/ui/browser.js`:
- `EVENT_TYPE_ICONS` constant (moved to base/constants.js)
- `EVENT_TYPES` constant (moved to base/constants.js)
- `getEventTypeIcon()` function (moved to templates/memory.js)
- `renderMemoryItemTemplate()` function (now `renderMemoryItem`)
- `renderMemoryEditTemplate()` function (now `renderMemoryEdit`)
- `renderCharacterStateTemplate()` function (now `renderCharacterState`)
- `renderRelationshipTemplate()` function (now `renderRelationship`)

**Step 3: Update function calls**

Find and replace:
- `renderMemoryItemTemplate(memory)` → `renderMemoryItem(memory)`
- `renderMemoryEditTemplate(memory)` → `renderMemoryEdit(memory)`
- `renderCharacterStateTemplate(charData)` → `renderCharacterState(charData)`
- `renderRelationshipTemplate(relData)` → `renderRelationship(relData)`

**Step 4: Update placeholder rendering**

In `renderMemoryBrowser()`, replace:
```javascript
$list.html(`<p class="openvault-placeholder">${message}</p>`);
```
With:
```javascript
$list.html(renderEmptyState(message));
```

Similarly for character states and relationships.

**Step 5: Run tests**

```bash
npm test
```
Expected: PASS

**Step 6: Test manually**

Load into SillyTavern and verify memory browser still works.

**Step 7: Commit**

```bash
git add src/ui/browser.js
git commit -m "refactor(ui): use extracted template functions in browser.js"
```

---

## Phase 3: Create MemoryList Component

### Task 4: Create MemoryList Component Class

**Files:**
- Create: `src/ui/components/MemoryList.js`

**Step 1: Create MemoryList component**

```javascript
// src/ui/components/MemoryList.js
import { Component } from '../base/Component.js';
import { SELECTORS } from '../base/constants.js';
import { renderMemoryItem, renderMemoryEdit, renderEmptyState } from '../templates/memory.js';
import { deleteMemory as deleteMemoryAction, updateMemory as updateMemoryAction } from '../../data/actions.js';
import { getEmbedding, isEmbeddingsEnabled } from '../../embeddings.js';
import { showToast } from '../../utils.js';
import { refreshStats } from '../status.js';
import { getDeps } from '../../deps.js';
import { getOpenVaultData } from '../../utils.js';
import { MEMORIES_KEY, MEMORIES_PER_PAGE } from '../../constants.js';
import { filterMemories, sortMemoriesByDate, getPaginationInfo, extractCharactersSet } from '../calculations.js';
import { escapeHtml } from '../../utils/dom.js';

/**
 * MemoryList component - manages memory browser display and interactions
 */
export class MemoryList extends Component {
    constructor() {
        super({
            container: SELECTORS.MEMORY_LIST,
            selectors: {
                page: SELECTORS.PAGE_INFO,
                prevBtn: SELECTORS.PREV_BTN,
                nextBtn: SELECTORS.NEXT_BTN,
                search: SELECTORS.SEARCH_INPUT,
                typeFilter: SELECTORS.FILTER_TYPE,
                charFilter: SELECTORS.FILTER_CHARACTER,
            },
            initialState: {
                page: 0,
                searchQuery: '',
            }
        });
    }

    /**
     * Initialize the component
     */
    init() {
        this._bindEvents();
        this._bindGlobalEvents();
        this.render();
    }

    /**
     * Bind events delegated to the container
     * @private
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

        // Save edit - update memory and auto-embed
        this.on('click', SELECTORS.SAVE_EDIT_BTN, async (e) => {
            const id = $(e.currentTarget).data('id');
            const $btn = $(e.currentTarget);
            await this._saveMemory(id, $btn);
        });
    }

    /**
     * Bind events to elements outside the container
     * @private
     */
    _bindGlobalEvents() {
        // Search input handler with debounce
        let searchTimeout;
        $(SELECTORS.SEARCH_INPUT).on('input', () => {
            clearTimeout(searchTimeout);
            const query = $(SELECTORS.SEARCH_INPUT).val();
            searchTimeout = setTimeout(() => {
                this.setState({ page: 0, searchQuery: query.toLowerCase().trim() });
                this.render();
            }, 200);
        });

        // Filter type change
        $(SELECTORS.FILTER_TYPE).on('change', () => {
            this.setState({ page: 0 });
            this.render();
        });
    }

    /**
     * Render the memory list
     */
    render() {
        const data = getOpenVaultData();
        if (!data) {
            this.$container.html(renderEmptyState('No chat loaded'));
            $(SELECTORS.PAGE_INFO).text('Page 0 / 0');
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
            this.$container.html(renderEmptyState(message));
        } else {
            const html = pageMemories.map(renderMemoryItem).join('');
            this.$container.html(html);
        }

        // Update pagination controls
        this._updatePagination(pagination);

        // Populate character filter dropdown
        this._populateCharacterFilter(memories);
    }

    /**
     * Filter memories by search query
     * @private
     */
    _filterBySearch(memories, query) {
        if (!query) return memories;
        return memories.filter(m => {
            const summary = (m.summary || '').toLowerCase();
            const characters = (m.characters_involved || []).join(' ').toLowerCase();
            const location = (m.location || '').toLowerCase();
            const eventType = (m.event_type || '').toLowerCase();
            return summary.includes(query) ||
                   characters.includes(query) ||
                   location.includes(query) ||
                   eventType.includes(query);
        });
    }

    /**
     * Update pagination controls
     * @private
     */
    _updatePagination(pagination) {
        $(SELECTORS.PAGE_INFO).text(`Page ${pagination.currentPage + 1} of ${pagination.totalPages}`);
        $(SELECTORS.PREV_BTN).prop('disabled', !pagination.hasPrev);
        $(SELECTORS.NEXT_BTN).prop('disabled', !pagination.hasNext);
    }

    /**
     * Populate the character filter dropdown
     * @private
     */
    _populateCharacterFilter(memories) {
        const characters = extractCharactersSet(memories);
        const $filter = $(SELECTORS.FILTER_CHARACTER);
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
     * Delete a memory by ID
     * @private
     */
    async _deleteMemory(id) {
        const deleted = await deleteMemoryAction(id);
        if (deleted) {
            this.render();
            refreshStats();
            showToast('success', 'Memory deleted');
        }
    }

    /**
     * Get memory by ID from current data
     * @private
     */
    _getMemoryById(id) {
        const data = getOpenVaultData();
        if (!data) return null;
        return data[MEMORIES_KEY]?.find(m => m.id === id) || null;
    }

    /**
     * Enter edit mode for a memory
     * @private
     */
    _enterEditMode(id) {
        const memory = this._getMemoryById(id);
        if (!memory) return;

        const $card = this.$container.find(`${SELECTORS.MEMORY_CARD}[data-id="${escapeHtml(id)}"]`);
        if ($card.length) {
            $card.replaceWith(renderMemoryEdit(memory));
        }
    }

    /**
     * Exit edit mode, restore view mode
     * @private
     */
    _exitEditMode(id) {
        const memory = this._getMemoryById(id);
        if (!memory) return;

        const $card = this.$container.find(`${SELECTORS.MEMORY_CARD}[data-id="${escapeHtml(id)}"]`);
        if ($card.length) {
            $card.replaceWith(renderMemoryItem(memory));
        }
    }

    /**
     * Save memory changes
     * @private
     */
    async _saveMemory(id, $btn) {
        const $card = this.$container.find(`${SELECTORS.MEMORY_CARD}[data-id="${escapeHtml(id)}"]`);

        // Gather values
        const summary = $card.find(SELECTORS.EDIT_TEXTAREA).val().trim();
        const importance = parseInt($card.find('[data-field="importance"]').val(), 10);
        const event_type = $card.find('[data-field="event_type"]').val();

        if (!summary) {
            showToast('warning', 'Summary cannot be empty');
            return;
        }

        // Disable button during save
        $btn.prop('disabled', true);

        const updated = await updateMemoryAction(id, { summary, importance, event_type });
        if (updated) {
            // Auto-generate embedding if summary changed
            const memory = this._getMemoryById(id);
            if (memory && !memory.embedding && isEmbeddingsEnabled()) {
                const embedding = await getEmbedding(summary);
                if (embedding) {
                    memory.embedding = embedding;
                    await getDeps().saveChatConditional();
                }
            }

            // Re-render card in view mode
            const updatedMemory = this._getMemoryById(id);
            if (updatedMemory) {
                $card.replaceWith(renderMemoryItem(updatedMemory));
            }
            showToast('success', 'Memory updated');
            refreshStats();
        }
        $btn.prop('disabled', false);
    }

    // =========================================================================
    // Public API for navigation
    // =========================================================================

    /**
     * Navigate to previous page
     */
    prevPage() {
        if (this.state.page > 0) {
            this.setState({ page: this.state.page - 1 });
            this.render();
        }
    }

    /**
     * Navigate to next page
     */
    nextPage() {
        this.setState({ page: this.state.page + 1 });
        this.render();
    }

    /**
     * Reset to first page and re-render
     */
    resetAndRender() {
        this.setState({ page: 0 });
        this.render();
    }

    /**
     * Reset page to 0
     */
    resetPage() {
        this.setState({ page: 0 });
    }

    /**
     * Populate character filter (public API)
     */
    populateFilter() {
        const data = getOpenVaultData();
        if (!data) return;
        const memories = data[MEMORIES_KEY] || [];
        this._populateCharacterFilter(memories);
    }
}
```

**Step 2: Create components barrel export**

```javascript
// src/ui/components/index.js
export { MemoryList } from './MemoryList.js';
```

**Step 3: Run tests**

```bash
npm test
```
Expected: PASS

**Step 4: Commit**

```bash
git add src/ui/components/
git commit -m "feat(ui): add MemoryList component class"
```

---

### Task 5: Create CharacterStates Component

**Files:**
- Create: `src/ui/components/CharacterStates.js`

**Step 1: Create CharacterStates component**

```javascript
// src/ui/components/CharacterStates.js
import { Component } from '../base/Component.js';
import { SELECTORS } from '../base/constants.js';
import { renderCharacterState, renderCharacterEmptyState } from '../templates/character.js';
import { getOpenVaultData } from '../../utils.js';
import { CHARACTERS_KEY } from '../../constants.js';
import { buildCharacterStateData } from '../calculations.js';

/**
 * CharacterStates component - displays character emotional states
 */
export class CharacterStates extends Component {
    constructor() {
        super({
            container: SELECTORS.CHARACTER_STATES,
            selectors: {},
            initialState: {}
        });
    }

    /**
     * Initialize the component
     */
    init() {
        this.render();
    }

    /**
     * Render character states
     */
    render() {
        const data = getOpenVaultData();
        if (!data) {
            this.$container.html(renderCharacterEmptyState('No chat loaded'));
            return;
        }

        const characters = data[CHARACTERS_KEY] || {};
        const charNames = Object.keys(characters);

        if (charNames.length === 0) {
            this.$container.html(renderCharacterEmptyState('No character data yet'));
            return;
        }

        const html = charNames
            .sort()
            .map(name => renderCharacterState(buildCharacterStateData(name, characters[name])))
            .join('');

        this.$container.html(html);
    }
}
```

**Step 2: Update components barrel export**

```javascript
// src/ui/components/index.js
export { MemoryList } from './MemoryList.js';
export { CharacterStates } from './CharacterStates.js';
```

**Step 3: Run tests**

```bash
npm test
```
Expected: PASS

**Step 4: Commit**

```bash
git add src/ui/components/
git commit -m "feat(ui): add CharacterStates component"
```

---

### Task 6: Create Relationships Component

**Files:**
- Create: `src/ui/components/Relationships.js`

**Step 1: Create Relationships component**

```javascript
// src/ui/components/Relationships.js
import { Component } from '../base/Component.js';
import { SELECTORS } from '../base/constants.js';
import { renderRelationship, renderRelationshipEmptyState } from '../templates/relationship.js';
import { getOpenVaultData } from '../../utils.js';
import { RELATIONSHIPS_KEY } from '../../constants.js';
import { buildRelationshipData } from '../calculations.js';

/**
 * Relationships component - displays character relationships
 */
export class Relationships extends Component {
    constructor() {
        super({
            container: SELECTORS.RELATIONSHIPS,
            selectors: {},
            initialState: {}
        });
    }

    /**
     * Initialize the component
     */
    init() {
        this.render();
    }

    /**
     * Render relationships
     */
    render() {
        const data = getOpenVaultData();
        if (!data) {
            this.$container.html(renderRelationshipEmptyState('No chat loaded'));
            return;
        }

        const relationships = data[RELATIONSHIPS_KEY] || {};
        const relKeys = Object.keys(relationships);

        if (relKeys.length === 0) {
            this.$container.html(renderRelationshipEmptyState('No relationship data yet'));
            return;
        }

        const html = relKeys
            .sort()
            .map(key => renderRelationship(buildRelationshipData(key, relationships[key])))
            .join('');

        this.$container.html(html);
    }
}
```

**Step 2: Update components barrel export**

```javascript
// src/ui/components/index.js
export { MemoryList } from './MemoryList.js';
export { CharacterStates } from './CharacterStates.js';
export { Relationships } from './Relationships.js';
```

**Step 3: Run tests**

```bash
npm test
```
Expected: PASS

**Step 4: Commit**

```bash
git add src/ui/components/
git commit -m "feat(ui): add Relationships component"
```

---

## Phase 4: Update browser.js to Use Components

### Task 7: Refactor browser.js to Orchestration Layer

**Files:**
- Modify: `src/ui/browser.js`

**Step 1: Replace browser.js content with orchestration layer**

```javascript
// src/ui/browser.js
/**
 * OpenVault Memory Browser UI
 *
 * Orchestration layer that initializes and coordinates UI components.
 */

import { MemoryList } from './components/MemoryList.js';
import { CharacterStates } from './components/CharacterStates.js';
import { Relationships } from './components/Relationships.js';
import { refreshStats } from './status.js';

// Component instances
let memoryList = null;
let characterStates = null;
let relationships = null;

/**
 * Initialize all browser UI components
 * Call once after HTML is loaded
 */
export function initBrowser() {
    memoryList = new MemoryList();
    characterStates = new CharacterStates();
    relationships = new Relationships();

    memoryList.init();
    characterStates.init();
    relationships.init();
}

/**
 * Refresh all UI components
 */
export function refreshAllUI() {
    memoryList?.render();
    characterStates?.render();
    relationships?.render();
    refreshStats();
}

// =============================================================================
// Navigation exports (for existing bindings in SillyTavern)
// =============================================================================

/**
 * Navigate to previous page
 */
export function prevPage() {
    memoryList?.prevPage();
}

/**
 * Navigate to next page
 */
export function nextPage() {
    memoryList?.nextPage();
}

/**
 * Reset page and re-render (for filter changes)
 */
export function resetAndRender() {
    memoryList?.resetAndRender();
}

/**
 * Reset memory browser page (called on chat change)
 */
export function resetMemoryBrowserPage() {
    memoryList?.resetPage();
}

/**
 * Populate character filter dropdown
 */
export function populateCharacterFilter() {
    memoryList?.populateFilter();
}

/**
 * Render character states
 */
export function renderCharacterStates() {
    characterStates?.render();
}

/**
 * Render relationships
 */
export function renderRelationships() {
    relationships?.render();
}

/**
 * Render the memory browser list
 */
export function renderMemoryBrowser() {
    memoryList?.render();
}
```

**Step 2: Run tests**

```bash
npm test
```
Expected: PASS

**Step 3: Manual testing**

Load into SillyTavern and verify:
1. Memory browser displays correctly
2. Pagination works
3. Search/filter works
4. Edit/delete memory works
5. Character states display
6. Relationships display

**Step 4: Commit**

```bash
git add src/ui/browser.js
git commit -m "refactor(ui): convert browser.js to orchestration layer"
```

---

## Phase 5: Cleanup and Verification

### Task 8: Remove Unused Functions from calculations.js

**Files:**
- Modify: `src/ui/calculations.js`

**Step 1: Review and remove unused functions**

Check if any functions in `calculations.js` are no longer used after the refactor.

Run:
```bash
grep -r "filterMemories\|sortMemoriesByDate\|getPaginationInfo\|extractCharactersSet\|buildCharacterStateData\|buildRelationshipData" src/ui/
```

If any are unused, remove them. Otherwise, leave as-is (they're pure utility functions).

**Step 2: Run tests**

```bash
npm test
```
Expected: PASS

**Step 3: Commit if changes made**

```bash
git add src/ui/calculations.js
git commit -m "refactor(ui): remove unused functions from calculations.js"
```

---

### Task 9: Final Verification and Documentation

**Files:**
- Modify: `README.md` (if applicable)

**Step 1: Run full test suite**

```bash
npm test
```
Expected: PASS

**Step 2: Verify CSS build**

```bash
npm run build:css
```
Expected: No errors

**Step 3: Verify linting**

```bash
npm run lint
```
Expected: No errors (or fix any issues)

**Step 4: Final manual testing checklist**

- [ ] Memory browser loads
- [ ] Pagination works (prev/next buttons)
- [ ] Search filters memories
- [ ] Type filter works
- [ ] Character filter works
- [ ] Edit memory opens edit form
- [ ] Save memory updates and re-renders
- [ ] Cancel edit returns to view mode
- [ ] Delete memory removes from list
- [ ] Character states display
- [ ] Relationships display

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix(ui): final cleanup and verification"
```

**Step 6: Merge to master**

```bash
cd C:/projects/openvault
git checkout master
git merge feature/ui-component-abstraction
```

---

## Summary

This plan refactors the UI layer into a maintainable component architecture:

1. **Base infrastructure** - Component class, constants
2. **Templates** - Pure functions for HTML generation
3. **Components** - Stateful classes managing DOM and events
4. **Orchestration** - browser.js as thin facade

**Files created:**
- `src/ui/base/Component.js`
- `src/ui/base/constants.js`
- `src/ui/base/index.js`
- `src/ui/templates/memory.js`
- `src/ui/templates/character.js`
- `src/ui/templates/relationship.js`
- `src/ui/templates/index.js`
- `src/ui/components/MemoryList.js`
- `src/ui/components/CharacterStates.js`
- `src/ui/components/Relationships.js`
- `src/ui/components/index.js`

**Files modified:**
- `src/ui/browser.js` (now ~80 lines vs ~380)

**Benefits:**
- CSS rename = single file change
- Template changes isolated
- Consistent pattern for new components
- Easier testing
