/**
 * Test ST Vector migration toast in settings.js
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extensionName } from '../src/constants.js';
import { setDeps } from '../src/deps.js';
import { __resetSettingsState, loadSettings } from '../src/settings.js';

describe('ST Vector migration', () => {
    let mockConsole;
    let mockToastr;
    let mockExtensionSettings;

    beforeEach(() => {
        // Reset settings state before each test
        __resetSettingsState();

        // Mock console
        mockConsole = {
            error: vi.fn(),
            log: vi.fn(),
            warn: vi.fn(),
        };

        // Mock toastr
        mockToastr = {
            error: vi.fn(),
            info: vi.fn(),
            success: vi.fn(),
            warning: vi.fn(),
        };

        // Mock extension settings
        mockExtensionSettings = {
            [extensionName]: {
                enabled: true,
                embeddingSource: 'st_vector', // Set to ST Vector to trigger migration
                debugMode: false,
            },
        };

        // Set up deps
        setDeps({
            getContext: () => ({
                console: mockConsole,
                toastr: mockToastr,
            }),
            getExtensionSettings: () => mockExtensionSettings,
            saveSettingsDebounced: vi.fn(),
            lodash: {
                merge: vi.fn((defaults, existing) => ({ ...defaults, ...existing })),
                get: vi.fn((obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)),
                set: vi.fn((obj, path, value) => {
                    const keys = path.split('.');
                    const last = keys.pop();
                    const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
                    target[last] = value;
                }),
            },
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('detects st_vector embedding source and resets to multilingual-e5-small', () => {
        // Initially set to st_vector
        expect(mockExtensionSettings[extensionName].embeddingSource).toBe('st_vector');

        // Load settings (which should trigger migration)
        loadSettings();

        // Should have reset embeddingSource to default
        expect(mockExtensionSettings[extensionName].embeddingSource).toBe('multilingual-e5-small');
    });

    it('logs error to console when migrating from st_vector', () => {
        loadSettings();

        expect(mockConsole.error).toHaveBeenCalledWith(
            expect.stringContaining('OpenVault: ST Vector storage has been removed')
        );
        expect(mockConsole.error).toHaveBeenCalledWith(
            expect.stringContaining('Maintaining two parallel storage systems')
        );
        expect(mockConsole.error).toHaveBeenCalledWith(expect.stringContaining('stable_23 branch'));
    });

    it('shows toast notification when migrating from st_vector', () => {
        loadSettings();

        expect(mockToastr.error).toHaveBeenCalledWith(
            expect.stringContaining('ST Vector storage has been removed'),
            'OpenVault Migration',
            expect.objectContaining({
                timeOut: 10000,
                extendedTimeOut: 20000,
                preventDuplicates: true,
            })
        );
    });

    it('does not trigger migration for other embedding sources', () => {
        // Set to a different embedding source
        mockExtensionSettings[extensionName].embeddingSource = 'ollama';

        loadSettings();

        // Should not log error or show toast
        expect(mockConsole.error).not.toHaveBeenCalled();
        expect(mockToastr.error).not.toHaveBeenCalled();

        // Should keep the original setting
        expect(mockExtensionSettings[extensionName].embeddingSource).toBe('ollama');
    });

    it('does not trigger migration for default local model', () => {
        // Set to default local model
        mockExtensionSettings[extensionName].embeddingSource = 'multilingual-e5-small';

        loadSettings();

        // Should not log error or show toast
        expect(mockConsole.error).not.toHaveBeenCalled();
        expect(mockToastr.error).not.toHaveBeenCalled();

        // Should keep the original setting
        expect(mockExtensionSettings[extensionName].embeddingSource).toBe('multilingual-e5-small');
    });
});
