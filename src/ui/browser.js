/**
 * OpenVault Memory Browser UI - Orchestration Layer
 *
 * Thin orchestration layer that coordinates UI components.
 * Refactored to use function-based components instead of classes.
 */

import {
    initMemoryList,
    prevPage as memoryListPrevPage,
    nextPage as memoryListNextPage,
    render as renderMemoryList,
    resetAndRender as resetMemoryListAndRender,
    populateFilter,
    resetPage,
} from './components/MemoryList.js';
import { render as renderCharacterStates } from './components/CharacterStates.js';
import { refreshStats } from './status.js';

// DOM Selectors (inlined from constants.js)
const SELECTORS = {
    PREV_BTN: '#openvault_prev_page',
    NEXT_BTN: '#openvault_next_page',
};

/**
 * Initialize browser UI components
 * Call once after HTML is loaded.
 */
export function initBrowser() {
    initMemoryList();
    renderCharacterStates();

    // Bind pagination buttons
    $(SELECTORS.PREV_BTN).on('click', memoryListPrevPage);
    $(SELECTORS.NEXT_BTN).on('click', memoryListNextPage);
}

/**
 * Refresh all UI components
 */
export function refreshAllUI() {
    refreshStats();
    renderMemoryList();
    renderCharacterStates();
}

/**
 * Navigate to previous page
 */
export function prevPage() {
    memoryListPrevPage();
}

/**
 * Navigate to next page
 */
export function nextPage() {
    memoryListNextPage();
}

/**
 * Reset page and re-render (for filter changes)
 */
export function resetAndRender() {
    resetMemoryListAndRender();
}

/**
 * Reset memory browser page (called on chat change)
 */
export function resetMemoryBrowserPage() {
    resetPage();
}

/**
 * Populate character filter dropdown
 */
export function populateCharacterFilter() {
    populateFilter();
}
