/**
 * Convert reflection toggle settings to position -2 (disabled).
 * Deletes deprecated reflectionGenerationEnabled and reflectionInjectionEnabled keys.
 * @param {Object} data - OpenVault data (mutated)
 * @param {Array} _chat - Chat messages (unused)
 * @returns {boolean} True if any changes made
 */
export function migrateToV5(data, _chat) {
    if (!data.settings) {
        return false;
    }

    let changed = false;

    // If reflection injection was disabled, set position to -2
    if (data.settings.reflectionInjectionEnabled === false) {
        if (!data.settings.injection) {
            data.settings.injection = {};
        }
        if (!data.settings.injection.reflections) {
            data.settings.injection.reflections = { position: 1, depth: 4 };
        }
        data.settings.injection.reflections.position = -2;
        changed = true;
    }

    // Delete the deprecated keys
    if ('reflectionGenerationEnabled' in data.settings) {
        delete data.settings.reflectionGenerationEnabled;
        changed = true;
    }
    if ('reflectionInjectionEnabled' in data.settings) {
        delete data.settings.reflectionInjectionEnabled;
        changed = true;
    }

    return changed;
}
