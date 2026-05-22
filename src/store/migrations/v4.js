/**
 * Add injection.reflections settings with defaults.
 * @param {Object} data - OpenVault data (mutated)
 * @param {Array} chat - Chat messages (unused)
 * @returns {boolean} True if any changes made
 */
export function migrateToV4(data, _chat) {
    if (!data.settings) {
        data.settings = {};
    }
    if (!data.settings.injection) {
        data.settings.injection = {};
    }
    if (!data.settings.injection.reflections) {
        data.settings.injection.reflections = { position: 1, depth: 4 };
        return true;
    }
    return false;
}
