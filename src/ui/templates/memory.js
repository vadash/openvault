/**
 * Memory Card Templates
 *
 * Pure template functions for rendering memory items.
 * Zero side effects, easily testable.
 */

import { escapeHtml } from '../../utils/dom.js';
import { formatMemoryImportance, formatMemoryDate, formatWitnesses } from '../formatting.js';
import { isEmbeddingsEnabled } from '../../embeddings.js';
import { EVENT_TYPE_ICONS, EVENT_TYPES, CLASSES } from '../base/constants.js';

// =============================================================================
// Template Functions
// =============================================================================

/**
 * Get icon class for event type
 * @param {string} eventType - Event type
 * @returns {string} Font Awesome icon class
 */
export function getEventTypeIcon(eventType) {
    return EVENT_TYPE_ICONS[eventType] || EVENT_TYPE_ICONS.default;
}

/**
 * Build type-safe CSS class name from event type
 * @param {string} eventType - Event type
 * @returns {string} CSS class name
 */
export function getTypeClass(eventType) {
    return (eventType || 'action').replace(/[^a-zA-Z0-9-]/g, '');
}

/**
 * Build badge HTML for a memory card
 * @param {Object} memory - Memory object
 * @returns {string} HTML string
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
        badges.push(`<span class="openvault-memory-card-badge pending-embed" title="Embedding pending"><i class="fa-solid fa-rotate-right"></i></span>`);
    }
    if (witnessText) {
        badges.push(`<span class="openvault-memory-card-badge witness"><i class="fa-solid fa-eye"></i> ${escapeHtml(witnessText)}</span>`);
    }
    if (location) {
        badges.push(`<span class="openvault-memory-card-badge location"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(location)}</span>`);
    }

    return badges.join('');
}

/**
 * Build character tags HTML
 * @param {string[]} characters - Array of character names
 * @returns {string} HTML string
 */
function buildCharacterTags(characters) {
    if (!characters || characters.length === 0) return '';

    const tags = characters
        .map(c => `<span class="${CLASSES.CHARACTER_TAG}">${escapeHtml(c)}</span>`)
        .join('');

    return `<div class="${CLASSES.MEMORY_CHARACTERS}" style="margin-top: 8px;">${tags}</div>`;
}

/**
 * Build card header HTML
 * @param {Object} memory - Memory object
 * @returns {string} HTML string
 */
function buildCardHeader(memory) {
    const typeClass = getTypeClass(memory.event_type);
    const date = formatMemoryDate(memory.created_at);
    const iconClass = getEventTypeIcon(memory.event_type);

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

/**
 * Build card footer HTML
 * @param {Object} memory - Memory object
 * @param {string} badges - Pre-rendered badges HTML
 * @returns {string} HTML string
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
 * @param {Object} memory - Memory object
 * @returns {string} HTML string
 */
export function renderMemoryItem(memory) {
    const id = escapeHtml(memory.id);
    const typeClass = getTypeClass(memory.event_type);
    const badges = buildBadges(memory);
    const characterTags = buildCharacterTags(memory.characters_involved);

    return `
        <div class="${CLASSES.MEMORY_CARD} ${typeClass}" data-id="${id}">
            ${buildCardHeader(memory)}
            <div class="openvault-memory-card-summary">${escapeHtml(memory.summary || 'No summary')}</div>
            ${buildCardFooter(memory, badges)}
            ${characterTags}
        </div>
    `;
}

// =============================================================================
// Edit Mode Templates
// =============================================================================

/**
 * Build importance select options
 * @param {number} current - Current importance value
 * @returns {string} HTML string
 */
function buildImportanceOptions(current) {
    return [1, 2, 3, 4, 5]
        .map(i => `<option value="${i}"${i === current ? ' selected' : ''}>${i}</option>`)
        .join('');
}

/**
 * Build event type select options
 * @param {string} current - Current event type
 * @returns {string} HTML string
 */
function buildEventTypeOptions(current) {
    return EVENT_TYPES
        .map(t => `<option value="${t}"${t === current ? ' selected' : ''}>${t.replace('_', ' ')}</option>`)
        .join('');
}

/**
 * Build edit form fields
 * @param {Object} memory - Memory object
 * @returns {string} HTML string
 */
function buildEditFields(memory) {
    const importance = memory.importance || 3;
    const eventType = memory.event_type || 'action';

    return `
        <div class="openvault-edit-row">
            <label>
                Importance
                <select data-field="importance">${buildImportanceOptions(importance)}</select>
            </label>
            <label>
                Event Type
                <select data-field="event_type">${buildEventTypeOptions(eventType)}</select>
            </label>
        </div>
    `;
}

/**
 * Build edit action buttons
 * @param {string} id - Memory ID
 * @returns {string} HTML string
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
 * @param {Object} memory - Memory object
 * @returns {string} HTML string
 */
export function renderMemoryEdit(memory) {
    const id = escapeHtml(memory.id);
    const typeClass = getTypeClass(memory.event_type);

    return `
        <div class="${CLASSES.MEMORY_CARD} ${typeClass}" data-id="${id}">
            <div class="openvault-edit-form">
                <textarea class="openvault-edit-textarea" data-field="summary">${escapeHtml(memory.summary || '')}</textarea>
                ${buildEditFields(memory)}
                ${buildEditActions(memory.id)}
            </div>
        </div>
    `;
}
