/**
 * CharacterStates Component
 *
 * Manages the character states display.
 * Refactored from class-based to function-based approach.
 */

import { renderCharacterState } from '../templates/character.js';
import { buildCharacterStateData } from '../calculations.js';
import { getOpenVaultData } from '../../utils.js';
import { CHARACTERS_KEY } from '../../constants.js';

// DOM Selectors (inlined from constants.js)
const SELECTORS = {
    CHARACTER_STATES: '#openvault_character_states',
};

const CLASSES = {
    PLACEHOLDER: 'openvault-placeholder',
};

/**
 * Render character states
 */
export function render() {
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
        .map(name => renderCharacterState(buildCharacterStateData(name, characters[name])))
        .join('');

    $container.html(html);
}
