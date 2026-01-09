/**
 * Relationship Templates
 *
 * Pure template functions for rendering relationship displays.
 */

import { escapeHtml } from '../../utils/dom.js';

/**
 * Render a single relationship as HTML
 * @param {Object} relData - Relationship data from buildRelationshipData
 * @returns {string} HTML string
 */
export function renderRelationship(relData) {
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
