import { getDeps } from '../deps.js';

/**
 * Cached content for macro access.
 * Exported so injection logic can update it.
 * Mutating properties (not reassigning) updates macro return values in-place.
 */
export const cachedContent = {
    memory: '',
    reflections: '',
    world: '',
    scene: '',
};

/**
 * Initialize macros by registering with SillyTavern.
 * Must be called after extension is loaded.
 */
export function initMacros() {
    const context = getDeps().getContext();

    const newRegistry = context.macros?.registry;

    if (newRegistry?.registerMacro) {
        // ST 1.16.0+ new MacroRegistry API — second arg must be an options object with handler key
        newRegistry.registerMacro('openvault_memory', {
            handler: () => cachedContent.memory,
            description: 'OpenVault injected memory content',
            category: 'misc',
        });
        newRegistry.registerMacro('openvault_reflections', {
            handler: () => cachedContent.reflections,
            description: 'OpenVault injected reflection content',
            category: 'misc',
        });
        newRegistry.registerMacro('openvault_world', {
            handler: () => cachedContent.world,
            description: 'OpenVault injected world info content',
            category: 'misc',
        });
        newRegistry.registerMacro('openvault_scene', {
            handler: () => cachedContent.scene,
            description: 'OpenVault injected scene state content',
            category: 'misc',
        });
    } else if (context.registerMacro) {
        // Legacy API (pre-1.16.0) — accepts (name, fn) directly
        context.registerMacro('openvault_memory', () => cachedContent.memory);
        context.registerMacro('openvault_reflections', () => cachedContent.reflections);
        context.registerMacro('openvault_world', () => cachedContent.world);
        context.registerMacro('openvault_scene', () => cachedContent.scene);
    }
}

// Auto-initialize on import
initMacros();
