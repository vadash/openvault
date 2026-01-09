# UI Component Abstraction & Template Management - Design Document

**Date:** 2025-01-09
**Status:** Design Complete
**Author:** Claude + User Collaboration

## Overview

Refactor `src/ui/browser.js` to improve maintainability by separating concerns:
- Extract HTML templates into pure functions
- Centralize DOM selectors as constants
- Create reusable component base class
- Organize UI code by domain

## Motivation

**Primary Goal:** Maintainability

Currently, `browser.js` (~380 lines) mixes:
- Template literals for HTML generation
- DOM selector strings scattered throughout
- Event handling logic
- State management (pagination, search)
- Data fetching

**Problems this solves:**
1. CSS class rename requires hunting through multiple files
2. Hard to test template logic without full DOM
3. No consistent pattern for new UI components
4. Difficult to locate where specific UI elements are bound

## Architecture: Hybrid Component System

A lightweight component approach without framework overhead. No reactivity or diffing - just organized structure.

```
src/ui/
├── base/
│   ├── Component.js      # Base component class
│   └── constants.js      # DOM selectors/IDs/constants
├── components/
│   ├── MemoryList.js     # Memory browser component
│   ├── CharacterStates.js
│   ├── Relationships.js
│   └── SearchBar.js      # Search/filter controls
├── templates/
│   ├── memory.js         # Memory-related template functions
│   ├── character.js      # Character state templates
│   └── relationship.js   # Relationship templates
└── browser.js            # Thin orchestration layer
```

## Base Component Class

```javascript
// src/ui/base/Component.js
export class Component {
    constructor({ container, selectors = {}, initialState = {} }) {
        this.$container = typeof container === 'string'
            ? $(container)
            : container;
        this.selectors = selectors;
        this.state = { ...initialState };
        this.eventHandlers = new Map();
    }

    /** Get jQuery element by logical selector key */
    $(key) {
        const selector = this.selectors[key];
        if (!selector) throw new Error(`Unknown selector key: ${key}`);
        return this.$container.find(selector);
    }

    /** Delegate event, tracked for cleanup */
    on(event, selector, handler) {
        this.$container.on(event, selector, handler);
        this.eventHandlers.set(`${event}:${selector}`, handler);
        return this;
    }

    /** Simple state merge - no diffing */
    setState(updates) {
        this.state = { ...this.state, ...updates };
        return this;
    }

    render() {
        throw new Error('Component must implement render()');
    }

    destroy() {
        this.eventHandlers.forEach((handler, key) => {
            const [event, selector] = key.split(':');
            this.$container.off(event, selector, handler);
        });
        this.eventHandlers.clear();
    }
}
```

## Constants Module

Single source of truth for all DOM references:

```javascript
// src/ui/base/constants.js
export const SELECTORS = {
    // Containers
    MEMORY_LIST: '#openvault_memory_list',
    PAGE_INFO: '#openvault_page_info',
    PREV_BTN: '#openvault_prev_page',
    NEXT_BTN: '#openvault_next_btn',
    SEARCH_INPUT: '#openvault_memory_search',
    FILTER_TYPE: '#openvault_filter_type',
    FILTER_CHARACTER: '#openvault_filter_character',
    CHARACTER_STATES: '#openvault_character_states',
    RELATIONSHIPS: '#openvault_relationships',

    // Dynamic elements
    MEMORY_CARD: '.openvault-memory-card',
    DELETE_BTN: '.openvault-delete-memory',
    EDIT_BTN: '.openvault-edit-memory',
    CANCEL_EDIT_BTN: '.openvault-cancel-edit',
    SAVE_EDIT_BTN: '.openvault-save-edit',
};

export const CLASSES = {
    MEMORY_CARD: 'openvault-memory-card',
    PLACEHOLDER: 'openvault-placeholder',
};

export const EVENTS = {
    MEMORY_DELETED: 'openvault:memory:deleted',
    MEMORY_UPDATED: 'openvault:memory:updated',
    FILTER_CHANGED: 'openvault:filter:changed',
};
```

## Component Example: MemoryList

```javascript
// src/ui/components/MemoryList.js
import { Component } from '../base/Component.js';
import { SELECTORS } from '../base/constants.js';
import { renderMemoryItem, renderMemoryEdit } from '../templates/memory.js';

export class MemoryList extends Component {
    constructor() {
        super({
            container: SELECTORS.MEMORY_LIST,
            selectors: {
                page: SELECTORS.PAGE_INFO,
                prevBtn: SELECTORS.PREV_BTN,
                nextBtn: SELECTORS.NEXT_BTN,
            },
            initialState: { page: 0, searchQuery: '' }
        });
    }

    init() {
        this._bindEvents();
        this.render();
    }

    _bindEvents() {
        this.on('click', SELECTORS.DELETE_BTN, async (e) => {
            const id = $(e.currentTarget).data('id');
            await this._deleteMemory(id);
        });
        // ... more event handlers
    }

    render() {
        const memories = this._getFilteredMemories();
        const pageMemories = this._paginate(memories);

        if (pageMemories.length === 0) {
            this.$container.html('<p class="openvault-placeholder">No memories</p>');
        } else {
            const html = pageMemories.map(renderMemoryItem).join('');
            this.$container.html(html);
        }

        this._updatePagination();
    }

    // ... private methods
}
```

## Templates Module

Pure functions - zero side effects, easily testable:

```javascript
// src/ui/templates/memory.js
import { escapeHtml } from '../../utils/dom.js';
import { formatMemoryImportance, formatMemoryDate, formatWitnesses } from '../formatting.js';

export function renderMemoryItem(memory) {
    const badges = buildBadges(memory);
    const characterTags = buildCharacterTags(memory.characters_involved);

    return `
        <div class="openvault-memory-card ${getTypeClass(memory)}" data-id="${escapeHtml(memory.id)}">
            ${buildCardHeader(memory)}
            <div class="openvault-memory-card-summary">${escapeHtml(memory.summary || '')}</div>
            ${buildCardFooter(memory, badges)}
            ${characterTags}
        </div>
    `;
}

export function renderMemoryEdit(memory) {
    return `
        <div class="openvault-memory-card ${getTypeClass(memory)}" data-id="${escapeHtml(memory.id)}">
            <div class="openvault-edit-form">
                <textarea class="openvault-edit-textarea" data-field="summary">${escapeHtml(memory.summary || '')}</textarea>
                ${buildEditFields(memory)}
                ${buildEditActions(memory.id)}
            </div>
        </div>
    `;
}

// Helper functions - testable in isolation
function buildBadges(memory) { /* ... */ }
function buildCharacterTags(characters) { /* ... */ }
function getTypeClass(memory) { /* ... */ }
```

## Data Flow & Refresh

```javascript
// src/ui/browser.js (orchestration layer)
import { MemoryList } from './components/MemoryList.js';
import { CharacterStates } from './components/CharacterStates.js';
import { Relationships } from './components/Relationships.js';

let memoryList = null;
let characterStates = null;
let relationships = null;

export function initBrowser() {
    memoryList = new MemoryList();
    characterStates = new CharacterStates();
    relationships = new Relationships();

    memoryList.init();
    characterStates.init();
    relationships.init();
}

export function refreshAllUI() {
    memoryList?.render();
    characterStates?.render();
    relationships?.render();
    refreshStats();
}

// Navigation exports (for existing bindings)
export function prevPage() { memoryList?.prevPage(); }
export function nextPage() { memoryList?.nextPage(); }
export function resetAndRender() { memoryList?.resetAndRender(); }
export function resetMemoryBrowserPage() { memoryList?.resetPage(); }
export function populateCharacterFilter() { memoryList?.populateFilter(); }
```

**Flow:**
1. User action → Component method
2. Component → Data action (via `data/actions.js`)
3. Action → `refreshAllUI()` → All components re-render
4. Each component reads fresh data from `getOpenVaultData()`

## Migration Plan

### Phase 1: Foundation (Non-Breaking)
- [ ] Create `src/ui/base/Component.js`
- [ ] Create `src/ui/base/constants.js`
- [ ] Create `src/ui/templates/` directory structure

### Phase 2: Extract Templates
- [ ] Move `renderMemoryItemTemplate` → `templates/memory.js`
- [ ] Move `renderMemoryEditTemplate` → `templates/memory.js`
- [ ] Move `renderCharacterStateTemplate` → `templates/character.js`
- [ ] Move `renderRelationshipTemplate` → `templates/relationship.js`
- [ ] Update imports in `browser.js`

### Phase 3: Build Components
- [ ] Create `MemoryList` class
- [ ] Create `CharacterStates` class
- [ ] Create `Relationships` class
- [ ] Update `browser.js` to use components

### Phase 4: Verification
- [ ] Run `npm test`
- [ ] Manual testing in SillyTavern
- [ ] Clean up old code

## Success Criteria

1. ✅ CSS class rename requires changing only `constants.js`
2. ✅ Template changes are isolated to `templates/` directory
3. ✅ New UI sections follow established component pattern
4. ✅ Templates are testable without full DOM
5. ✅ All existing tests pass
6. ✅ Manual verification in SillyTavern succeeds

## Estimated Scope

- **New files:** ~8
- **Lines moved/reorganized:** ~400
- **Breaking changes:** 0 (exports maintained)
- **Estimated effort:** 2-3 hours implementation + testing
