/**
 * Backfill scene_states, scene_ledger, and scene_counter.
 * Adds Scene State subsystem fields for physical scene continuity tracking.
 * @param {Object} data - OpenVault data (mutated)
 * @param {Array} _chat - Chat messages (unused)
 * @returns {boolean} True if any changes made
 */
export function migrateToV8(data, _chat) {
    let changed = false;

    // Backfill scene_states if missing
    if (data.scene_states === undefined) {
        data.scene_states = {};
        changed = true;
    }

    // Backfill scene_ledger if missing
    if (data.scene_ledger === undefined) {
        data.scene_ledger = [];
        changed = true;
    }

    // Backfill scene_counter if missing
    if (data.scene_counter === undefined) {
        data.scene_counter = 0;
        changed = true;
    }

    return changed;
}
