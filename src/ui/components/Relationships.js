/**
 * Relationships Component
 *
 * Manages the relationships display.
 */

import { Component } from '../base/Component.js';
import { SELECTORS, CLASSES } from '../base/constants.js';
import { renderRelationship } from '../templates/relationship.js';
import { buildRelationshipData } from '../calculations.js';
import { getOpenVaultData } from '../../utils.js';
import { RELATIONSHIPS_KEY } from '../../constants.js';

export class Relationships extends Component {
    constructor() {
        super({
            container: SELECTORS.RELATIONSHIPS,
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
     * Render relationships
     */
    render() {
        const data = getOpenVaultData();

        if (!data) {
            this.$container.html(`<p class="${CLASSES.PLACEHOLDER}">No chat loaded</p>`);
            return;
        }

        const relationships = data[RELATIONSHIPS_KEY] || {};
        const relKeys = Object.keys(relationships);

        if (relKeys.length === 0) {
            this.$container.html(`<p class="${CLASSES.PLACEHOLDER}">No relationship data yet</p>`);
            return;
        }

        const html = relKeys
            .sort()
            .map(key => renderRelationship(buildRelationshipData(key, relationships[key])))
            .join('');

        this.$container.html(html);
    }
}
