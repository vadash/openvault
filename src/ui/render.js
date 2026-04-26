/**
 * UI Render Orchestration Layer
 *
 * Thin coordinator that re-exports rendering functions from domain-specific modules
 * and provides browser initialization and refresh orchestration.
 *
 * Domain logic has been extracted to:
 * - memory-browser.js - Memory list CRUD, search, pagination
 * - entity-browser.js - Entity CRUD, merge flow, community rendering
 * - character-states.js - Character states and reflection progress
 */

import { showToast } from '../utils/dom.js';
import { renderPerfTab, updateBudgetIndicators } from './settings.js';
import { refreshStats } from './status.js';

// Re-export character states functions
export {
    renderCharacterStates,
    renderReflectionProgressSection,
} from './character-states.js';

// Re-export entity browser functions
export {
    bindEntityBrowserEvents,
    initEntityEventBindings,
    renderEntityList,
    renderWorldTab,
} from './entity-browser.js';

// Import memory browser functions (needed for backward compatibility aliases)
import {
    bindMemoryListEvents,
    nextPage,
    populateFilter,
    prevPage,
    renderMemoryList,
    resetAndRender,
    resetMemoryBrowserPage,
} from './memory-browser.js';

// Re-export memory browser functions
export {
    bindMemoryListEvents,
    nextPage,
    populateFilter,
    prevPage,
    renderMemoryList,
    resetAndRender,
    resetMemoryBrowserPage,
};

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

    $('#openvault_prev_page').on('click', prevPage);
    $('#openvault_next_page').on('click', nextPage);

    // Entity browser events
    bindEntityBrowserEvents();
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

// Backward compatibility aliases
export { prevPage as browserPrevPage, nextPage as browserNextPage, resetAndRender as browserResetAndRender };
