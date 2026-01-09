/**
 * Character State Templates
 *
 * Pure template functions for rendering character states.
 */

import { escapeHtml } from '../../utils/dom.js';

/**
 * Render a single character state as HTML
 * @param {Object} charData - Character state data from buildCharacterStateData
 * @returns {string} HTML string
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
