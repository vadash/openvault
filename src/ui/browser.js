/**
 * OpenVault Memory Browser UI
 *
 * Handles memory list rendering, character states, and relationship displays.
 * Uses template literals for cleaner, more maintainable HTML generation.
 */

import { getOpenVaultData, showToast } from '../utils.js';
import { escapeHtml } from '../utils/dom.js';
import { MEMORIES_KEY, CHARACTERS_KEY, RELATIONSHIPS_KEY, MEMORIES_PER_PAGE } from '../constants.js';
import { deleteMemory as deleteMemoryAction } from '../data/actions.js';
import { refreshStats } from './status.js';
import { formatMemoryImportance, formatMemoryDate, formatWitnesses } from './formatting.js';
import { filterMemories, sortMemoriesByDate, getPaginationInfo, extractCharactersSet, buildCharacterStateData, buildRelationshipData } from './calculations.js';

// Pagination state for memory browser
let memoryBrowserPage = 0;
let memorySearchQuery = '';

// Event type icons mapping
const EVENT_TYPE_ICONS = {
    action: 'fa-solid fa-bolt',
    revelation: 'fa-solid fa-lightbulb',
    emotion_shift: 'fa-solid fa-heart',
    relationship_change: 'fa-solid fa-people-arrows',
    default: 'fa-solid fa-bookmark'
};

// =============================================================================
// Template Functions
// =============================================================================

/**
 * Get icon class for event type
 * @param {string} eventType - Event type
 * @returns {string} Font Awesome icon class
 */
function getEventTypeIcon(eventType) {
    return EVENT_TYPE_ICONS[eventType] || EVENT_TYPE_ICONS.default;
}

/**
 * Render a single memory item as a card
 * @param {Object} memory - Memory object
 * @returns {string} HTML string
 */
function renderMemoryItemTemplate(memory) {
    const typeClass = (memory.event_type || 'action').replace(/[^a-zA-Z0-9-]/g, '');
    const importance = memory.importance || 3;
    const stars = formatMemoryImportance(importance);
    const date = formatMemoryDate(memory.created_at);
    const witnessText = formatWitnesses(memory.witnesses);
    const iconClass = getEventTypeIcon(memory.event_type);
    const location = memory.location || '';

    // Build badges
    const badges = [];
    badges.push(`<span class="openvault-memory-card-badge importance">${stars}</span>`);
    if (witnessText) {
        badges.push(`<span class="openvault-memory-card-badge witness"><i class="fa-solid fa-eye"></i> ${escapeHtml(witnessText)}</span>`);
    }
    if (location) {
        badges.push(`<span class="openvault-memory-card-badge location"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(location)}</span>`);
    }

    // Build character tags
    const characters = (memory.characters_involved || [])
        .map(c => `<span class="openvault-character-tag">${escapeHtml(c)}</span>`)
        .join('');

    return `
        <div class="openvault-memory-card ${typeClass}" data-id="${escapeHtml(memory.id)}">
            <div class="openvault-memory-card-header">
                <div class="openvault-memory-card-icon ${typeClass}">
                    <i class="${iconClass}"></i>
                </div>
                <div class="openvault-memory-card-meta">
                    <span class="openvault-memory-card-type">${escapeHtml(memory.event_type || 'event')}</span>
                    <span class="openvault-memory-card-date">${escapeHtml(date)}</span>
                </div>
            </div>
            <div class="openvault-memory-card-summary">${escapeHtml(memory.summary || 'No summary')}</div>
            <div class="openvault-memory-card-footer">
                <div class="openvault-memory-card-badges">
                    ${badges.join('')}
                </div>
                <button class="menu_button openvault-delete-memory" data-id="${escapeHtml(memory.id)}" title="Delete memory">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
            ${characters ? `<div class="openvault-memory-characters" style="margin-top: 8px;">${characters}</div>` : ''}
        </div>
    `;
}

/**
 * Render a single character state as HTML
 * @param {Object} charData - Character state data from buildCharacterStateData
 * @returns {string} HTML string
 */
function renderCharacterStateTemplate(charData) {
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
 * Render a single relationship as HTML
 * @param {Object} relData - Relationship data from buildRelationshipData
 * @returns {string} HTML string
 */
function renderRelationshipTemplate(relData) {
    return `
        <div class="openvault-relationship-item">
            <div class="openvault-relationship-pair">${escapeHtml(relData.characterA)} \u2194 ${escapeHtml(relData.characterB)}</div>
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

// =============================================================================
// Initialization & Navigation
// =============================================================================

/**
 * Initialize browser event handlers using event delegation.
 * Call once after HTML is loaded.
 */
export function initBrowser() {
    // Event delegation: attach once to container, not per-render to children
    $('#openvault_memory_list').on('click', '.openvault-delete-memory', async function() {
        const id = $(this).data('id');
        await deleteMemory(id);
    });

    // Search input handler with debounce
    let searchTimeout;
    $('#openvault_memory_search').on('input', function() {
        clearTimeout(searchTimeout);
        const query = $(this).val();
        searchTimeout = setTimeout(() => {
            memorySearchQuery = query.toLowerCase().trim();
            memoryBrowserPage = 0;
            renderMemoryBrowser();
        }, 200);
    });
}

/**
 * Reset memory browser page (called on chat change)
 */
export function resetMemoryBrowserPage() {
    memoryBrowserPage = 0;
}

/**
 * Navigate to previous page
 */
export function prevPage() {
    if (memoryBrowserPage > 0) {
        memoryBrowserPage--;
        renderMemoryBrowser();
    }
}

/**
 * Navigate to next page
 */
export function nextPage() {
    memoryBrowserPage++;
    renderMemoryBrowser();
}

/**
 * Reset page and re-render (for filter changes)
 */
export function resetAndRender() {
    memoryBrowserPage = 0;
    renderMemoryBrowser();
}

// =============================================================================
// Render Functions
// =============================================================================

/**
 * Filter memories by search query
 * @param {Object[]} memories - Array of memories
 * @param {string} query - Search query (lowercase)
 * @returns {Object[]} Filtered memories
 */
function filterBySearch(memories, query) {
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
 * Render the memory browser list
 */
export function renderMemoryBrowser() {
    const data = getOpenVaultData();
    if (!data) {
        $('#openvault_memory_list').html('<p class="openvault-placeholder">No chat loaded</p>');
        $('#openvault_page_info').text('Page 0 / 0');
        return;
    }

    const memories = data[MEMORIES_KEY] || [];
    const $list = $('#openvault_memory_list');
    const $pageInfo = $('#openvault_page_info');
    const $prevBtn = $('#openvault_prev_page');
    const $nextBtn = $('#openvault_next_page');

    // Get filter values
    const typeFilter = $('#openvault_filter_type').val();
    const characterFilter = $('#openvault_filter_character').val();

    // Filter, search, and sort using pure functions
    let filteredMemories = filterMemories(memories, typeFilter, characterFilter);
    filteredMemories = filterBySearch(filteredMemories, memorySearchQuery);
    filteredMemories = sortMemoriesByDate(filteredMemories);

    // Pagination using pure function
    const pagination = getPaginationInfo(filteredMemories.length, memoryBrowserPage, MEMORIES_PER_PAGE);
    memoryBrowserPage = pagination.currentPage;
    const pageMemories = filteredMemories.slice(pagination.startIdx, pagination.endIdx);

    // Render memories using template
    if (pageMemories.length === 0) {
        const message = memorySearchQuery ? 'No memories match your search' : 'No memories yet';
        $list.html(`<p class="openvault-placeholder">${message}</p>`);
    } else {
        const html = pageMemories.map(renderMemoryItemTemplate).join('');
        $list.html(html);
    }

    // Update pagination
    $pageInfo.text(`Page ${pagination.currentPage + 1} of ${pagination.totalPages}`);
    $prevBtn.prop('disabled', !pagination.hasPrev);
    $nextBtn.prop('disabled', !pagination.hasNext);

    // Populate character filter dropdown
    populateCharacterFilter();
}

/**
 * Delete a memory by ID (UI wrapper for data action)
 * @param {string} id - Memory ID to delete
 */
async function deleteMemory(id) {
    const deleted = await deleteMemoryAction(id);
    if (deleted) {
        refreshAllUI();
        showToast('success', 'Memory deleted');
    }
}

/**
 * Populate the character filter dropdown
 */
export function populateCharacterFilter() {
    const data = getOpenVaultData();
    if (!data) {
        $('#openvault_filter_character').find('option:not(:first)').remove();
        return;
    }

    const memories = data[MEMORIES_KEY] || [];
    const characters = extractCharactersSet(memories);

    const $filter = $('#openvault_filter_character');
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
 * Render character states
 */
export function renderCharacterStates() {
    const data = getOpenVaultData();
    const $container = $('#openvault_character_states');

    if (!data) {
        $container.html('<p class="openvault-placeholder">No chat loaded</p>');
        return;
    }

    const characters = data[CHARACTERS_KEY] || {};
    const charNames = Object.keys(characters);

    if (charNames.length === 0) {
        $container.html('<p class="openvault-placeholder">No character data yet</p>');
        return;
    }

    const html = charNames
        .sort()
        .map(name => renderCharacterStateTemplate(buildCharacterStateData(name, characters[name])))
        .join('');

    $container.html(html);
}

/**
 * Render relationships
 */
export function renderRelationships() {
    const data = getOpenVaultData();
    const $container = $('#openvault_relationships');

    if (!data) {
        $container.html('<p class="openvault-placeholder">No chat loaded</p>');
        return;
    }

    const relationships = data[RELATIONSHIPS_KEY] || {};
    const relKeys = Object.keys(relationships);

    if (relKeys.length === 0) {
        $container.html('<p class="openvault-placeholder">No relationship data yet</p>');
        return;
    }

    const html = relKeys
        .sort()
        .map(key => renderRelationshipTemplate(buildRelationshipData(key, relationships[key])))
        .join('');

    $container.html(html);
}

/**
 * Refresh all UI components
 */
export function refreshAllUI() {
    refreshStats();
    renderMemoryBrowser();
    renderCharacterStates();
    renderRelationships();
}
