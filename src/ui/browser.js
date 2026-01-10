/**
 * OpenVault Memory Browser UI - Orchestration Layer
 *
 * Thin orchestration layer that initializes and coordinates UI components.
 * All rendering logic is delegated to component classes.
 */

import { MemoryList } from './components/MemoryList.js';
import { CharacterStates } from './components/CharacterStates.js';
import { SELECTORS } from './base/constants.js';
import { refreshStats } from './status.js';

// Component instances
let memoryList = null;
let characterStates = null;

/**
 * Initialize browser UI components
 * Call once after HTML is loaded.
 */
export function initBrowser() {
    memoryList = new MemoryList();
    characterStates = new CharacterStates();

    memoryList.init();
    characterStates.init();

    // Bind pagination buttons
    $(SELECTORS.PREV_BTN).on('click', () => memoryList.prevPage());
    $(SELECTORS.NEXT_BTN).on('click', () => memoryList.nextPage());
}

/**
 * Refresh all UI components
 */
export function refreshAllUI() {
    refreshStats();
    memoryList?.render();
    characterStates?.render();
}

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
