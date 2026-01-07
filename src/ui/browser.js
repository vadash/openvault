/**
 * OpenVault Memory Browser UI
 *
 * Handles memory list rendering, character states, and relationship displays.
 */

import { getDeps } from '../deps.js';
import { getOpenVaultData, showToast } from '../utils.js';
import { MEMORIES_KEY, CHARACTERS_KEY, RELATIONSHIPS_KEY, MEMORIES_PER_PAGE } from '../constants.js';
import { refreshStats } from './status.js';
import { formatMemoryImportance, formatMemoryDate, formatWitnesses } from './formatting.js';
import { filterMemories, sortMemoriesByDate, getPaginationInfo, extractCharactersSet, buildCharacterStateData, buildRelationshipData } from './calculations.js';

// Pagination state for memory browser
let memoryBrowserPage = 0;

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

    // Filter and sort using pure functions
    const filteredMemories = sortMemoriesByDate(filterMemories(memories, typeFilter, characterFilter));

    // Pagination using pure function
    const pagination = getPaginationInfo(filteredMemories.length, memoryBrowserPage, MEMORIES_PER_PAGE);
    memoryBrowserPage = pagination.currentPage;
    const pageMemories = filteredMemories.slice(pagination.startIdx, pagination.endIdx);

    // Clear and render using DocumentFragment for performance
    $list.empty();

    if (pageMemories.length === 0) {
        $list.html('<p class="openvault-placeholder">No memories yet</p>');
    } else {
        // Use DocumentFragment to batch DOM insertions
        const fragment = document.createDocumentFragment();

        for (const memory of pageMemories) {
            const date = formatMemoryDate(memory.created_at);
            // Sanitize event_type for use as CSS class (alphanumeric and hyphens only)
            const typeClass = (memory.event_type || 'action').replace(/[^a-zA-Z0-9-]/g, '');
            const importance = memory.importance || 3;
            const stars = formatMemoryImportance(importance);

            // Build memory item using jQuery for safety
            const $item = $('<div>', {
                class: `openvault-memory-item ${typeClass}`,
                'data-id': memory.id
            });

            // Header
            const $header = $('<div>', { class: 'openvault-memory-header' })
                .append($('<span>', { class: 'openvault-memory-type', text: memory.event_type || 'event' }))
                .append($('<span>', { class: 'openvault-memory-importance', title: `Importance: ${importance}/5`, text: stars }))
                .append($('<span>', { class: 'openvault-memory-date', text: date }));
            $item.append($header);

            // Summary
            $item.append($('<div>', { class: 'openvault-memory-summary', text: memory.summary || 'No summary' }));

            // Characters
            const $characters = $('<div>', { class: 'openvault-memory-characters' });
            for (const c of (memory.characters_involved || [])) {
                $characters.append($('<span>', { class: 'openvault-character-tag', text: c }));
            }
            $item.append($characters);

            // Witnesses
            const witnessText = formatWitnesses(memory.witnesses);
            if (witnessText) {
                $item.append($('<div>', { class: 'openvault-memory-witnesses', text: witnessText }));
            }

            // Actions
            const $actions = $('<div>', { class: 'openvault-memory-actions' });
            const $deleteBtn = $('<button>', {
                class: 'menu_button openvault-delete-memory',
                'data-id': memory.id
            }).append($('<i>', { class: 'fa-solid fa-trash' })).append(' Delete');
            $actions.append($deleteBtn);
            $item.append($actions);

            fragment.appendChild($item[0]);
        }

        // Single DOM insertion
        $list[0].appendChild(fragment);

        // Bind delete buttons
        $list.find('.openvault-delete-memory').on('click', async function() {
            const id = $(this).data('id');
            await deleteMemory(id);
        });
    }

    // Update pagination
    $pageInfo.text(`Page ${pagination.currentPage + 1} of ${pagination.totalPages}`);
    $prevBtn.prop('disabled', !pagination.hasPrev);
    $nextBtn.prop('disabled', !pagination.hasNext);

    // Populate character filter dropdown
    populateCharacterFilter();
}

/**
 * Delete a memory by ID
 * @param {string} id - Memory ID to delete
 */
async function deleteMemory(id) {
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat loaded');
        return;
    }
    const idx = data[MEMORIES_KEY]?.findIndex(m => m.id === id);
    if (idx !== -1) {
        data[MEMORIES_KEY].splice(idx, 1);
        await getDeps().saveChatConditional();
        refreshAllUI();
        showToast('success', 'Memory deleted');
    }
}

/**
 * Populate the character filter dropdown using DocumentFragment for performance
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

    if (characters.size > 0) {
        // Use DocumentFragment to batch option insertions
        const fragment = document.createDocumentFragment();
        for (const char of characters) {
            const option = document.createElement('option');
            option.value = char;
            option.textContent = char;
            fragment.appendChild(option);
        }
        $filter[0].appendChild(fragment);
    }

    // Restore selection if still valid
    if (currentValue && characters.has(currentValue)) {
        $filter.val(currentValue);
    }
}

/**
 * Render character states using DocumentFragment for performance
 */
export function renderCharacterStates() {
    const data = getOpenVaultData();
    const $container = $('#openvault_character_states');
    if (!data) {
        $container.html('<p class="openvault-placeholder">No chat loaded</p>');
        return;
    }
    const characters = data[CHARACTERS_KEY] || {};

    $container.empty();

    const charNames = Object.keys(characters);
    if (charNames.length === 0) {
        $container.html('<p class="openvault-placeholder">No character data yet</p>');
        return;
    }

    // Use DocumentFragment to batch DOM insertions
    const fragment = document.createDocumentFragment();

    for (const name of charNames.sort()) {
        const charData = buildCharacterStateData(name, characters[name]);

        const $item = $('<div>', { class: 'openvault-character-item' });
        $item.append($('<div>', { class: 'openvault-character-name', text: charData.name }));

        const $emotion = $('<div>', { class: 'openvault-emotion' });
        // emotionSource may contain HTML for styling, but emotion is text
        const $label = $('<span>', { class: 'openvault-emotion-label', text: charData.emotion });
        if (charData.emotionSource) {
            $label.append(charData.emotionSource);
        }
        $emotion.append($label);

        const $emotionBar = $('<div>', { class: 'openvault-emotion-bar' });
        $emotionBar.append($('<div>', { class: 'openvault-emotion-fill', css: { width: `${charData.intensityPercent}%` } }));
        $emotion.append($emotionBar);
        $item.append($emotion);

        $item.append($('<div>', { class: 'openvault-memory-witnesses', text: `Known events: ${charData.knownCount}` }));
        fragment.appendChild($item[0]);
    }

    // Single DOM insertion
    $container[0].appendChild(fragment);
}

/**
 * Render relationships using DocumentFragment for performance
 */
export function renderRelationships() {
    const data = getOpenVaultData();
    const $container = $('#openvault_relationships');
    if (!data) {
        $container.html('<p class="openvault-placeholder">No chat loaded</p>');
        return;
    }
    const relationships = data[RELATIONSHIPS_KEY] || {};

    $container.empty();

    const relKeys = Object.keys(relationships);
    if (relKeys.length === 0) {
        $container.html('<p class="openvault-placeholder">No relationship data yet</p>');
        return;
    }

    // Use DocumentFragment to batch DOM insertions
    const fragment = document.createDocumentFragment();

    for (const key of relKeys.sort()) {
        const relData = buildRelationshipData(key, relationships[key]);

        const $item = $('<div>', { class: 'openvault-relationship-item' });
        $item.append($('<div>', { class: 'openvault-relationship-pair', text: `${relData.characterA} \u2194 ${relData.characterB}` }));
        $item.append($('<div>', { class: 'openvault-relationship-type', text: relData.type }));

        const $bars = $('<div>', { class: 'openvault-relationship-bars' });

        // Trust bar
        const $trustRow = $('<div>', { class: 'openvault-bar-row' });
        $trustRow.append($('<span>', { class: 'openvault-bar-label', text: 'Trust' }));
        const $trustContainer = $('<div>', { class: 'openvault-bar-container' });
        $trustContainer.append($('<div>', { class: 'openvault-bar-fill trust', css: { width: `${relData.trustPercent}%` } }));
        $trustRow.append($trustContainer);
        $bars.append($trustRow);

        // Tension bar
        const $tensionRow = $('<div>', { class: 'openvault-bar-row' });
        $tensionRow.append($('<span>', { class: 'openvault-bar-label', text: 'Tension' }));
        const $tensionContainer = $('<div>', { class: 'openvault-bar-container' });
        $tensionContainer.append($('<div>', { class: 'openvault-bar-fill tension', css: { width: `${relData.tensionPercent}%` } }));
        $tensionRow.append($tensionContainer);
        $bars.append($tensionRow);

        $item.append($bars);
        fragment.appendChild($item[0]);
    }

    // Single DOM insertion
    $container[0].appendChild(fragment);
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
