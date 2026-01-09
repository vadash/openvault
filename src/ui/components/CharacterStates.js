/**
 * CharacterStates Component
 *
 * Manages the character states display.
 */

import { Component } from '../base/Component.js';
import { SELECTORS, CLASSES } from '../base/constants.js';
import { renderCharacterState } from '../templates/character.js';
import { buildCharacterStateData } from '../calculations.js';
import { getOpenVaultData } from '../../utils.js';
import { CHARACTERS_KEY } from '../../constants.js';

export class CharacterStates extends Component {
    constructor() {
        super({
            container: SELECTORS.CHARACTER_STATES,
            selectors: {},
            initialState: {}
        });
    }

    /**
     * Initialize component
     */
    init() {
        this.render();
    }

    /**
     * Render character states
     */
    render() {
        const data = getOpenVaultData();

        if (!data) {
            this.$container.html(`<p class="${CLASSES.PLACEHOLDER}">No chat loaded</p>`);
            return;
        }

        const characters = data[CHARACTERS_KEY] || {};
        const charNames = Object.keys(characters);

        if (charNames.length === 0) {
            this.$container.html(`<p class="${CLASSES.PLACEHOLDER}">No character data yet</p>`);
            return;
        }

        const html = charNames
            .sort()
            .map(name => renderCharacterState(buildCharacterStateData(name, characters[name])))
            .join('');

        this.$container.html(html);
    }
}
