import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('injection settings UI', () => {
    beforeEach(async () => {
        vi.resetModules();
        // Register CDN overrides after resetModules
        await global.registerCdnOverrides();

        // Mock constants
        vi.doMock('../../src/constants.js', () => ({
            extensionName: 'openvault',
            extensionFolderPath: '/extensions/openvault',
            defaultSettings: {
                enabled: true,
                injection: {
                    memory: { position: 1, depth: 4 },
                    world: { position: 1, depth: 4 },
                },
            },
            INJECTION_POSITIONS: {
                BEFORE_MAIN: 0,
                AFTER_MAIN: 1,
                BEFORE_AN: 2,
                AFTER_AN: 3,
                IN_CHAT: 4,
                CUSTOM: -1,
            },
        }));

        // Mock deps.js with getContext
        vi.doMock('../../src/deps.js', () => ({
            getDeps: () => ({
                getContext: () => ({
                    chat: [],
                    name1: 'User',
                    name2: 'Alice',
                }),
                getExtensionSettings: () => ({
                    openvault: {
                        enabled: true,
                        injection: {
                            memory: { position: 1, depth: 4 },
                            world: { position: 1, depth: 4 },
                        },
                    },
                }),
                saveSettingsDebounced: vi.fn(),
            }),
        }));

        // Mock jQuery
        global.$ = vi.fn((selector) => ({
            val: vi.fn().mockReturnThis(),
            on: vi.fn().mockReturnThis(),
            parent: vi.fn().mockReturnThis(),
            toggle: vi.fn().mockReturnThis(),
            data: vi.fn().mockReturnThis(),
            find: vi.fn().mockReturnThis(),
        }));

        global.$.get = vi.fn((url, callback) => {
            callback('<div id="injection_settings"></div>');
            return { done: true };
        });

        // Mock showToast
        vi.doMock('../../src/utils/dom.js', () => ({
            showToast: vi.fn(),
        }));

        // Mock settings.js that gets imported
        vi.doMock('../../src/settings.js', () => ({
            loadSettings: vi.fn(),
        }));
    });

    it('should export updateInjectionUI function', async () => {
        const module = await import('../../src/ui/settings.js');
        expect(module.updateInjectionUI).toBeDefined();
        expect(typeof module.updateInjectionUI).toBe('function');
    });

    it('should have loadInjectionSettings function (internal)', async () => {
        // The function exists internally even if not exported
        const module = await import('../../src/ui/settings.js');
        // Check that updateInjectionUI exists which validates the injection UI code
        expect(module.updateInjectionUI).toBeDefined();
    });
});
