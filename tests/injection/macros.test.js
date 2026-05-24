// tests/injection/macros.test.js

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('injection/macros.js', () => {
    beforeEach(async () => {
        vi.resetModules();
        await global.registerCdnOverrides();
    });

    it('has cachedContent with memory, reflections, world, and scene properties', async () => {
        setupTestContext();
        const { cachedContent } = await import('../../src/injection/macros.js');

        expect(cachedContent).toHaveProperty('memory');
        expect(cachedContent).toHaveProperty('reflections');
        expect(cachedContent).toHaveProperty('world');
        expect(cachedContent).toHaveProperty('scene');

        // Verify exactly these 4 properties exist
        const keys = Object.keys(cachedContent);
        expect(keys).toHaveLength(4);
        expect(keys.sort()).toEqual(['memory', 'reflections', 'scene', 'world']);
    });

    it('registers openvault_reflections macro via new API (ST 1.16.0+)', async () => {
        const registeredMacros = new Map();

        const mockRegistry = {
            registerMacro: vi.fn((name, options) => {
                registeredMacros.set(name, options);
            }),
        };

        // Set up deps BEFORE importing macros.js
        const { setDeps } = await import('../../src/deps.js');
        setDeps({
            getContext: () => ({ macros: { registry: mockRegistry } }),
            getExtensionSettings: () => ({}),
        });

        const { initMacros, cachedContent } = await import('../../src/injection/macros.js');

        initMacros();

        // Verify openvault_reflections was registered
        expect(mockRegistry.registerMacro).toHaveBeenCalledWith(
            'openvault_reflections',
            expect.objectContaining({
                handler: expect.any(Function),
                description: 'OpenVault injected reflection content',
                category: 'misc',
            })
        );

        // Verify the handler returns cachedContent.reflections
        const registered = registeredMacros.get('openvault_reflections');
        expect(registered.handler()).toBe(cachedContent.reflections);
    });

    it('registers openvault_reflections macro via legacy API (pre-1.16.0)', async () => {
        const macroHandlers = new Map();

        const mockContext = {
            registerMacro: vi.fn((name, handler) => {
                macroHandlers.set(name, handler);
            }),
        };

        // Set up deps BEFORE importing macros.js
        const { setDeps } = await import('../../src/deps.js');
        setDeps({
            getContext: () => mockContext,
            getExtensionSettings: () => ({}),
        });

        const { initMacros, cachedContent } = await import('../../src/injection/macros.js');

        initMacros();

        // Verify openvault_reflections was registered
        expect(mockContext.registerMacro).toHaveBeenCalledWith('openvault_reflections', expect.any(Function));

        // Verify the handler returns cachedContent.reflections
        expect(macroHandlers.get('openvault_reflections')()).toBe(cachedContent.reflections);
    });
});
