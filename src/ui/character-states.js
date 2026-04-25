/**
 * Character States UI
 *
 * Handles character state rendering and reflection progress display.
 */

import { CHARACTERS_KEY } from '../constants.js';
import { getDeps } from '../deps.js';
import { getOpenVaultData } from '../store/chat-data.js';
import { buildCharacterStateData } from './helpers.js';
import { renderCharacterState, renderReflectionProgress } from './templates.js';

const SELECTORS = {
    CHARACTER_STATES: '#openvault_character_states',
};

const CLASSES = {
    PLACEHOLDER: 'openvault-placeholder',
};

// =============================================================================
// Character States Render
// =============================================================================

export function renderCharacterStates() {
    const $container = $(SELECTORS.CHARACTER_STATES);
    const data = getOpenVaultData();

    if (!data) {
        $container.html(`<p class="${CLASSES.PLACEHOLDER}">No chat loaded</p>`);
        return;
    }

    const characters = data[CHARACTERS_KEY] || {};
    const charNames = Object.keys(characters);

    if (charNames.length === 0) {
        $container.html(`<p class="${CLASSES.PLACEHOLDER}">No character data yet</p>`);
        return;
    }

    const html = charNames
        .sort()
        .map((name) => renderCharacterState(buildCharacterStateData(name, characters[name])))
        .join('');

    $container.html(html);
}

// =============================================================================
// Reflection Progress Render
// =============================================================================

export function renderReflectionProgressSection() {
    const $container = $('#openvault_reflection_progress');
    if ($container.length === 0) return;

    const data = getOpenVaultData();
    const reflectionState = data?.reflection_state || {};

    const settings = getDeps().getExtensionSettings().openvault || {};
    const threshold = settings.reflectionThreshold;

    $container.html(renderReflectionProgress(reflectionState, threshold));
}
