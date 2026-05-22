/**
 * Delete Level 2+ reflections and remove stale reflection settings.
 * Removes reflections where type === 'reflection' and level > 1,
 * and deletes maxReflectionLevel and reflectionLevelMultiplier from settings.
 * @param {Object} data - OpenVault data (mutated)
 * @param {Array} _chat - Chat messages (unused)
 * @returns {boolean} True if any changes made
 */
export function migrateToV7(data, _chat) {
    let changed = false;

    // Delete Level 2+ reflections (level > 1)
    // (level || 1) treats missing level as level 1
    if (data.memories?.length > 0) {
        const originalLength = data.memories.length;
        data.memories = data.memories.filter((m) => {
            // Keep non-reflection memories (events, etc.)
            if (m.type !== 'reflection') {
                return true;
            }
            // Delete only if level > 1 (missing level defaults to 1)
            const level = m.level ?? 1;
            return level <= 1;
        });
        if (data.memories.length !== originalLength) {
            changed = true;
        }
    }

    // Remove stale reflection settings
    if (data.settings) {
        if ('maxReflectionLevel' in data.settings) {
            delete data.settings.maxReflectionLevel;
            changed = true;
        }
        if ('reflectionLevelMultiplier' in data.settings) {
            delete data.settings.reflectionLevelMultiplier;
            changed = true;
        }
    }

    return changed;
}
