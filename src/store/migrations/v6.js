/**
 * Remove community detection data and rename interval setting.
 * Deletes `data.communities`, removes `community_count` from `global_world_state`,
 * and renames `communityDetectionInterval` to `worldStateInterval` in settings.
 * @param {Object} data - OpenVault data (mutated)
 * @param {Array} _chat - Chat messages (unused)
 * @returns {boolean} True if any changes made
 */
export function migrateToV6(data, _chat) {
    let changed = false;

    // Delete communities object
    if (data.communities) {
        delete data.communities;
        changed = true;
    }

    // Remove community_count from global_world_state
    if (data.global_world_state && 'community_count' in data.global_world_state) {
        delete data.global_world_state.community_count;
        changed = true;
    }

    // Rename communityDetectionInterval to worldStateInterval
    if (data.settings && 'communityDetectionInterval' in data.settings) {
        data.settings.worldStateInterval = data.settings.communityDetectionInterval;
        delete data.settings.communityDetectionInterval;
        changed = true;
    }

    return changed;
}
