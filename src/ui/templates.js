/**
 * UI Templates
 *
 * Pure template functions for rendering UI elements.
 * Zero side effects, easily testable.
 */

import { isEmbeddingsEnabled } from '../embeddings.js';
import { escapeHtml } from '../utils.js';
import { formatMemoryDate, formatMemoryImportance, formatWitnesses } from './helpers.js';

// CSS class constants
const CLASSES = {
    MEMORY_CARD: 'openvault-memory-card',
    PLACEHOLDER: 'openvault-placeholder',
    CHARACTER_TAG: 'openvault-character-tag',
    MEMORY_CHARACTERS: 'openvault-memory-characters',
};

// =============================================================================
// Memory Card Templates
// =============================================================================

/**
 * Build badge HTML for a memory card
 */
function buildBadges(memory) {
    const badges = [];
    const importance = memory.importance || 3;
    const stars = formatMemoryImportance(importance);
    const witnessText = formatWitnesses(memory.witnesses);
    const location = memory.location || '';
    const needsEmbed = !memory.embedding && isEmbeddingsEnabled();

    badges.push(`<span class="openvault-memory-card-badge importance">${stars}</span>`);

    if (needsEmbed) {
        badges.push(
            `<span class="openvault-memory-card-badge pending-embed" title="Embedding pending"><i class="fa-solid fa-rotate-right"></i></span>`
        );
    }
    if (memory.type === 'reflection') {
        badges.push(
            `<span class="openvault-memory-card-badge reflection"><i class="fa-solid fa-lightbulb"></i> Reflection</span>`
        );
        if (memory.source_ids?.length > 0) {
            badges.push(
                `<span class="openvault-memory-card-badge evidence"><i class="fa-solid fa-link"></i> ${memory.source_ids.length} evidence</span>`
            );
        }
    }
    if (witnessText) {
        badges.push(
            `<span class="openvault-memory-card-badge witness"><i class="fa-solid fa-eye"></i> ${escapeHtml(witnessText)}</span>`
        );
    }
    if (location) {
        badges.push(
            `<span class="openvault-memory-card-badge location"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(location)}</span>`
        );
    }

    return badges.join('');
}

/**
 * Build character tags HTML
 */
function buildCharacterTags(characters) {
    if (!characters || characters.length === 0) return '';

    const tags = characters.map((c) => `<span class="${CLASSES.CHARACTER_TAG}">${escapeHtml(c)}</span>`).join('');

    return `<div class="${CLASSES.MEMORY_CHARACTERS}" style="margin-top: 8px;">${tags}</div>`;
}

/**
 * Build card header HTML
 */
function buildCardHeader(memory) {
    const date = formatMemoryDate(memory.created_at);

    return `
        <div class="openvault-memory-card-header">
            <div class="openvault-memory-card-meta">
                <span class="openvault-memory-card-date">${escapeHtml(date)}</span>
            </div>
        </div>
    `;
}

/**
 * Build card footer HTML
 */
function buildCardFooter(memory, badges) {
    const id = escapeHtml(memory.id);
    return `
        <div class="openvault-memory-card-footer">
            <div class="openvault-memory-card-badges">
                ${badges}
            </div>
            <div>
                <button class="menu_button openvault-edit-memory" data-id="${id}" title="Edit memory">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="menu_button openvault-delete-memory" data-id="${id}" title="Delete memory">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

/**
 * Render a single memory item as a card
 */
export function renderMemoryItem(memory) {
    const id = escapeHtml(memory.id);
    const badges = buildBadges(memory);
    const characterTags = buildCharacterTags(memory.characters_involved);

    return `
        <div class="${CLASSES.MEMORY_CARD}" data-id="${id}">
            ${buildCardHeader(memory)}
            <div class="openvault-memory-card-summary">${escapeHtml(memory.summary || 'No summary')}</div>
            ${buildCardFooter(memory, badges)}
            ${characterTags}
        </div>
    `;
}

/**
 * Build importance select options
 */
function buildImportanceOptions(current) {
    return [1, 2, 3, 4, 5].map((i) => `<option value="${i}"${i === current ? ' selected' : ''}>${i}</option>`).join('');
}

/**
 * Build edit form fields
 */
function buildEditFields(memory) {
    const importance = memory.importance || 3;

    return `
        <div class="openvault-edit-row">
            <label>
                Importance
                <select data-field="importance">${buildImportanceOptions(importance)}</select>
            </label>
        </div>
    `;
}

/**
 * Build edit action buttons
 */
function buildEditActions(id) {
    const escapedId = escapeHtml(id);
    return `
        <div class="openvault-edit-actions">
            <button class="menu_button openvault-cancel-edit" data-id="${escapedId}">
                <i class="fa-solid fa-times"></i> Cancel
            </button>
            <button class="menu_button openvault-save-edit" data-id="${escapedId}">
                <i class="fa-solid fa-check"></i> Save
            </button>
        </div>
    `;
}

/**
 * Render edit mode template for a memory
 */
export function renderMemoryEdit(memory) {
    const id = escapeHtml(memory.id);

    return `
        <div class="${CLASSES.MEMORY_CARD}" data-id="${id}">
            <div class="openvault-edit-form">
                <textarea class="openvault-edit-textarea" data-field="summary">${escapeHtml(memory.summary || '')}</textarea>
                ${buildEditFields(memory)}
                ${buildEditActions(memory.id)}
            </div>
        </div>
    `;
}

// =============================================================================
// Character State Templates
// =============================================================================

/**
 * Render a single character state as HTML
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
 * Render reflection progress counters for all characters.
 * @param {Object|null} reflectionState - charName → { importance_sum }
 * @param {number} threshold - Reflection threshold
 * @returns {string} HTML
 */
export function renderReflectionProgress(reflectionState, threshold) {
    if (!reflectionState || Object.keys(reflectionState).length === 0) {
        return '<p class="openvault-placeholder">No reflection data yet</p>';
    }

    const items = Object.entries(reflectionState)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, state]) => {
            const sum = state.importance_sum || 0;
            return `<span class="openvault-reflection-counter">${escapeHtml(name)}: ${sum}/${threshold}</span>`;
        })
        .join(' \u00b7 ');

    return `<div class="openvault-reflection-counters">${items}</div>`;
}

/**
 * Render a single community as an accordion item.
 * @param {string} id - Community ID (e.g., "C0")
 * @param {Object} community - { title, summary, findings, nodeKeys }
 * @returns {string} HTML
 */
export function renderCommunityAccordion(id, community) {
    const memberCount = community.nodeKeys?.length || 0;
    const findings = (community.findings || [])
        .map(f => `<li>${escapeHtml(f)}</li>`)
        .join('');
    const members = (community.nodeKeys || [])
        .map(k => escapeHtml(k))
        .join(', ');

    return `
        <details class="openvault-community-item">
            <summary>
                <span class="openvault-community-title">${escapeHtml(community.title || id)}</span>
                <span class="openvault-community-badge">${memberCount} entities</span>
            </summary>
            <div class="openvault-community-content">
                <p>${escapeHtml(community.summary || 'No summary')}</p>
                ${findings ? `<ul class="openvault-community-findings">${findings}</ul>` : ''}
                <small class="openvault-community-members">Members: ${members}</small>
            </div>
        </details>
    `;
}
