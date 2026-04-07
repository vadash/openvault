/**
 * UI Templates
 *
 * Pure template functions for rendering UI elements.
 * Zero side effects, easily testable.
 */

import { ENTITY_TYPES } from '../constants.js';
import { isEmbeddingsEnabled } from '../embeddings.js';
import { escapeHtml } from '../utils/dom.js';
import { hasEmbedding } from '../utils/embedding-codec.js';
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
    const needsEmbed = !hasEmbedding(memory) && isEmbeddingsEnabled();

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
    if (memory.is_transient) {
        badges.push(
            `<span class="openvault-memory-card-badge transient"><i class="fa-solid fa-wind"></i> Transient</span>`
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
    const anchorHtml = memory.temporal_anchor
        ? `<span class="openvault-memory-card-date" style="color: var(--SmartThemeQuoteColor);"><i class="fa-solid fa-clock"></i> ${escapeHtml(memory.temporal_anchor)}</span>`
        : '';

    return `
        <div class="openvault-memory-card-header">
            <div class="openvault-memory-card-meta">
                ${anchorHtml}
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
        <div class="openvault-edit-row">
            <label>Time Anchor</label>
            <input type="text" class="text_pole" data-field="temporal_anchor" value="${escapeHtml(memory.temporal_anchor || '')}" placeholder="e.g. Friday 3:00 PM">
        </div>
        <div class="openvault-edit-row">
            <label class="checkbox_label">
                <input type="checkbox" data-field="is_transient" ${memory.is_transient ? 'checked' : ''}>
                <span>Transient (Fades fast)</span>
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
    const findings = (community.findings || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('');
    const members = (community.nodeKeys || []).map((k) => escapeHtml(k)).join(', ');

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

/**
 * Render an entity card in view mode
 * @param {Object} entity - Entity node with name, type, description, aliases
 * @param {string} key - Normalized entity key
 * @returns {string} HTML string
 */
export function renderEntityCard(entity, key) {
    const typeLabel = entity.type.charAt(0) + entity.type.slice(1).toLowerCase();
    const aliasText = entity.aliases?.length > 0 ? entity.aliases.join(', ') : '';
    const pendingBadge = !hasEmbedding(entity)
        ? '<span class="openvault-pending-embed"><span class="icon">↻</span> pending</span>'
        : '';

    return `
    <div class="openvault-entity-card" data-key="${escapeHtml(key)}">
      <div class="openvault-entity-header">
        <span class="openvault-entity-name">${escapeHtml(entity.name)}</span>
        <div class="openvault-entity-badges">
          <span class="openvault-entity-type-badge ${entity.type.toLowerCase()}">
            ${typeLabel}
          </span>
          ${pendingBadge}
        </div>
        <div class="openvault-entity-actions">
          <button class="openvault-entity-action-btn openvault-edit-entity" data-key="${escapeHtml(key)}" title="Edit">
            ✏️
          </button>
          <button class="openvault-entity-action-btn openvault-merge-entity" data-key="${escapeHtml(key)}" title="Merge into another entity">
            <i class="fa-solid fa-code-merge"></i>
          </button>
          <button class="openvault-entity-action-btn openvault-delete-entity" data-key="${escapeHtml(key)}" title="Delete">
            🗑️
          </button>
        </div>
      </div>
      ${aliasText ? `<div class="openvault-entity-aliases">${escapeHtml(aliasText)}</div>` : ''}
      <div class="openvault-entity-description">${escapeHtml(entity.description || '')}</div>
      <small class="openvault-entity-mentions">${entity.mentions || 0} mentions</small>
    </div>
  `;
}

/**
 * Render an entity card in edit mode
 * @param {Object} entity - Entity node with name, type, description, aliases
 * @param {string} key - Normalized entity key
 * @returns {string} HTML string
 */
export function renderEntityEdit(entity, key) {
    const aliasChips = (entity.aliases || [])
        .map(
            (alias) => `
      <span class="openvault-alias-chip">
        ${escapeHtml(alias)}
        <span class="remove openvault-remove-alias" data-key="${escapeHtml(key)}" data-alias="${escapeHtml(alias)}">×</span>
      </span>
    `
        )
        .join('');

    const typeOptions = Object.entries(ENTITY_TYPES)
        .map(
            ([type]) => `
    <option value="${type}" ${entity.type === type ? 'selected' : ''}>
      ${type.charAt(0) + type.slice(1).toLowerCase()}
    </option>
  `
        )
        .join('');

    return `
    <div class="openvault-entity-edit" data-key="${escapeHtml(key)}">
      <div class="openvault-entity-edit-row">
        <label>Name</label>
        <input type="text" class="openvault-edit-name" value="${escapeHtml(entity.name)}" data-key="${escapeHtml(key)}">
      </div>
      <div class="openvault-entity-edit-row">
        <label>Type</label>
        <select class="openvault-edit-type" data-key="${escapeHtml(key)}">
          ${typeOptions}
        </select>
      </div>
      <div class="openvault-entity-edit-row">
        <label>Description</label>
        <textarea class="openvault-edit-description" data-key="${escapeHtml(key)}" rows="3">${escapeHtml(entity.description || '')}</textarea>
      </div>
      <div class="openvault-entity-edit-row">
        <label>Aliases</label>
        <div class="openvault-alias-list" data-key="${escapeHtml(key)}">
          ${aliasChips}
        </div>
        <div class="openvault-alias-input-row">
          <input type="text" class="openvault-alias-input" placeholder="e.g. The Stranger, Masked Figure..." data-key="${escapeHtml(key)}">
          <button class="openvault-add-alias" data-key="${escapeHtml(key)}">Add</button>
        </div>
      </div>
      <div class="openvault-entity-edit-actions">
        <button class="cancel openvault-cancel-entity-edit" data-key="${escapeHtml(key)}">Cancel</button>
        <button class="save openvault-save-entity-edit" data-key="${escapeHtml(key)}">Save</button>
      </div>
    </div>
  `;
}

/**
 * Render a merge picker panel using native HTML5 datalist.
 * @param {string} sourceKey - The entity being merged (will be deleted)
 * @param {Object} sourceNode - The source entity node data
 * @param {Object} graphNodes - All nodes in graph (for building options)
 * @returns {string} HTML string for the merge picker
 */
export function renderEntityMergePicker(sourceKey, sourceNode, graphNodes) {
    const sourceDisplay = escapeHtml(sourceNode.name || sourceKey);
    const datalistId = `merge-targets-${sourceKey.replace(/[^a-zA-Z0-9]/g, '-')}`;

    // Build datalist options from all nodes except source
    // Include both name and aliases as separate options for searchability
    const options = Object.entries(graphNodes)
        .filter(([key]) => key !== sourceKey)
        .flatMap(([key, node]) => {
            const displayName = escapeHtml(node.name || key);
            const typeLabel = node.type ? ` [${node.type}]` : '';
            const primaryOption = `<option value="${displayName}${typeLabel}" data-key="${escapeHtml(key)}">`;

            // Also add alias options pointing to same entity
            const aliasOptions = (node.aliases || [])
                .filter((alias) => alias !== node.name)
                .map(
                    (alias) =>
                        `<option value="${escapeHtml(alias)} [alias of ${displayName}]" data-key="${escapeHtml(key)}">`
                );

            return [primaryOption, ...aliasOptions];
        })
        .join('\n');

    return `
    <div class="openvault-entity-merge-panel" data-source-key="${escapeHtml(sourceKey)}">
      <div class="merge-header">
        <h4>Merge "${sourceDisplay}" into another entity</h4>
        <p class="merge-explanation">
          "${sourceDisplay}" will be deleted. Its relationships, aliases, and description
          will be combined into the target entity.
        </p>
      </div>

      <div class="merge-target-picker">
        <label for="merge-target-input-${sourceKey}">Target:</label>
        <input
          type="text"
          id="merge-target-input-${sourceKey}"
          class="openvault-merge-search"
          placeholder="Type to search entities..."
          autocomplete="off"
          list="${datalistId}"
        />
        <datalist id="${datalistId}">
          ${options}
        </datalist>
      </div>

      <div class="merge-actions">
        <button class="openvault-cancel-entity-merge" data-key="${escapeHtml(sourceKey)}">
          Cancel
        </button>
        <button class="openvault-confirm-entity-merge" data-source-key="${escapeHtml(sourceKey)}">
          Confirm Merge
        </button>
      </div>
    </div>
  `;
}
