/**
 * OpenVault Simulation Layer
 *
 * Contains game simulation logic like relationship decay over time.
 * Separated from parsing to maintain Single Responsibility Principle.
 */

import { getDeps } from './deps.js';
import { extensionName, RELATIONSHIPS_KEY } from './constants.js';
import { log } from './utils.js';

/**
 * Apply decay to relationships that haven't been updated recently.
 * Tension drifts toward 0, high trust (>5) drifts toward 5.
 *
 * @param {Object} data - OpenVault data object
 * @param {number} currentMessageId - Current message ID for delta calculation
 */
export function applyRelationshipDecay(data, currentMessageId) {
    if (!data[RELATIONSHIPS_KEY] || typeof currentMessageId !== 'number') {
        return;
    }

    // Get decay settings
    const settings = getDeps().getExtensionSettings()[extensionName];
    const decayInterval = settings?.relationshipDecayInterval ?? 50;
    const tensionDecayRate = settings?.tensionDecayRate ?? 0.5;
    const trustDecayRate = settings?.trustDecayRate ?? 0.1;

    for (const [key, relationship] of Object.entries(data[RELATIONSHIPS_KEY])) {
        const lastUpdated = relationship.last_updated_message_id;

        // Skip if no last_updated_message_id tracked yet
        if (typeof lastUpdated !== 'number') {
            continue;
        }

        const delta = currentMessageId - lastUpdated;

        // Only decay if enough messages have passed
        if (delta < decayInterval) {
            continue;
        }

        // Calculate number of decay intervals passed
        const intervals = Math.floor(delta / decayInterval);

        // Decay tension toward 0
        if (relationship.tension_level > 0) {
            const tensionDecay = tensionDecayRate * intervals;
            relationship.tension_level = Math.max(0, relationship.tension_level - tensionDecay);
        }

        // Decay high trust (>5) toward neutral (5)
        // Low trust/distrust is "sticky" and doesn't auto-recover
        if (relationship.trust_level > 5) {
            const trustDecay = trustDecayRate * intervals;
            relationship.trust_level = Math.max(5, relationship.trust_level - trustDecay);
        }

        // Update the last_updated_message_id to current so we don't re-decay
        relationship.last_updated_message_id = currentMessageId;

        log(`Decay applied to ${key}: tension=${relationship.tension_level.toFixed(1)}, trust=${relationship.trust_level.toFixed(1)} (${intervals} intervals)`);
    }
}
