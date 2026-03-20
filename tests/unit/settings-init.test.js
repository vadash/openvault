import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('settings initialization', () => {
    let mockExtensionSettings;
    let mockLodashMerge;
    let mockRegisterSettings;
    let mockGetContext;

    beforeEach(async () => {
        vi.resetModules();

        // Setup mocks
        mockLodashMerge = vi.fn((a, b) => ({ ...a, ...b }));
        mockExtensionSettings = { openvault: { enabled: true } };
        mockRegisterSettings = vi.fn();
        mockGetContext = vi.fn(() => ({
            extensionSettings: mockExtensionSettings,
            lodash: { merge: mockLodashMerge },
            registerSettings: mockRegisterSettings,
        }));

        // Mock deps.js
        vi.doMock('../../src/deps.js', () => ({
            getDeps: () => ({
                getExtensionSettings: () => mockExtensionSettings,
                getContext: mockGetContext,
                registerSettings: mockRegisterSettings,
            }),
            setDeps: vi.fn(),
            resetDeps: vi.fn(),
        }));

        // Mock constants.js
        vi.doMock('../../src/constants.js', () => ({
            extensionName: 'openvault',
            defaultSettings: {
                enabled: true,
                injection: { memory: { position: 1, depth: 4 } },
            },
        }));
    });

    it('should use lodash.merge to combine defaults with existing', async () => {
        const { loadSettings } = await import('../../src/settings.js');
        loadSettings();
        expect(mockLodashMerge).toHaveBeenCalled();
    });

    it('should preserve existing settings while adding defaults', async () => {
        const { loadSettings } = await import('../../src/settings.js');
        loadSettings();
        expect(mockExtensionSettings.openvault.injection).toBeDefined();
    });

    it('should call lodash.merge with defaultSettings first', async () => {
        const { loadSettings } = await import('../../src/settings.js');
        loadSettings();

        expect(mockLodashMerge).toHaveBeenCalledWith(
            expect.objectContaining({
                enabled: true,
                injection: { memory: { position: 1, depth: 4 } },
            }),
            mockExtensionSettings.openvault
        );
    });
});
