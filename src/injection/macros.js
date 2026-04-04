import { getDeps } from '../deps.js';

/**
 * Cached content for macro access.
 * Exported so injection logic can update it.
 * Mutating properties (not reassigning) updates macro return values in-place.
 */
export const cachedContent = {
    memory: '',
    world: '',
};

/**
 * Initialize macros by registering with SillyTavern.
 * Must be called after extension is loaded.
 */
export function initMacros() {
    const context = getDeps().getContext();

    // Use new registry API with fallback for backward compatibility
    // SillyTavern deprecated top-level registerMacro in favor of macros.registry
    const registerMacro =
        context.macros?.registry?.registerMacro?.bind(context.macros.registry) || context.registerMacro;

    // Macros MUST be synchronous - no async/await
    // Do NOT wrap name in {{ }} - ST does that automatically
    registerMacro('openvault_memory', () => cachedContent.memory);
    registerMacro('openvault_world', () => cachedContent.world);
}

// Auto-initialize on import
initMacros();
