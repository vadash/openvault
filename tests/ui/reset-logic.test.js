import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/constants.js';

// Create a shared mock function that will persist across test runs
const updateUIMock = vi.fn();

// Mock UI dependencies - use importOriginal to include all exports
vi.mock('../../src/ui/render.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        updateUI: updateUIMock,
    };
});

describe('handleResetSettings', () => {
    let mockExtensionSettings;
    let mockDeps;

    beforeEach(async () => {
        // Clear module cache before each test
        vi.resetModules();
        // Re-register CDN overrides after reset
        await global.registerCdnOverrides();

        // Initialize mock settings with custom connection and fine-tune values
        mockExtensionSettings = {
            openvault: {
                // Connection settings (should be preserved)
                extractionProfile: 'custom-llm',
                backupProfile: 'backup-llm',
                preambleLanguage: 'en',
                outputLanguage: 'en',
                extractionPrefill: 'custom_prefill',
                embeddingSource: 'ollama',
                ollamaUrl: 'http://custom:11434',
                embeddingModel: 'custom-model',
                embeddingQueryPrefix: 'custom query:',
                embeddingDocPrefix: 'custom passage:',
                maxConcurrency: 3,
                backfillMaxRPM: 50,
                debugMode: false,
                requestLogging: true,
                // Fine-tune settings (should be reset)
                extractionTokenBudget: 9999,
                extractionRearviewTokens: 9999,
                retrievalFinalTokens: 9999,
                visibleChatBudget: 9999,
                reflectionThreshold: 99,
                maxInsightsPerReflection: 9,
                alpha: 0.99,
                forgetfulnessBaseLambda: 0.99,
                worldContextBudget: 7777,
                dedupSimilarityThreshold: 0.77,
                vectorSimilarityThreshold: 0.55,
                // Required by updateReflectionDedupDisplay
                reflectionDedupThreshold: 0.99,
            },
        };

        mockDeps = {
            getExtensionSettings: () => mockExtensionSettings,
            saveSettingsDebounced: vi.fn(),
            showToast: vi.fn(),
        };

        // Re-import deps after resetModules and setDeps
        const { setDeps } = await import('../../src/deps.js');
        setDeps(mockDeps);

        // Mock global confirm (the implementation calls confirm() directly, not window.confirm())
        global.confirm = vi.fn(() => true);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('preserves connection settings on reset', async () => {
        const { handleResetSettings } = await import('../../src/ui/actions.js');
        await handleResetSettings();

        const settings = mockExtensionSettings.openvault;
        expect(settings.extractionProfile).toBe('custom-llm');
        expect(settings.backupProfile).toBe('backup-llm');
        expect(settings.preambleLanguage).toBe('en');
        expect(settings.outputLanguage).toBe('en');
        expect(settings.extractionPrefill).toBe('custom_prefill');
        expect(settings.embeddingSource).toBe('ollama');
        expect(settings.ollamaUrl).toBe('http://custom:11434');
        expect(settings.embeddingModel).toBe('custom-model');
        expect(settings.embeddingQueryPrefix).toBe('custom query:');
        expect(settings.embeddingDocPrefix).toBe('custom passage:');
        expect(settings.maxConcurrency).toBe(3);
        expect(settings.backfillMaxRPM).toBe(50);
        expect(settings.requestLogging).toBe(true);
    });

    it('resets fine-tune settings to defaults', async () => {
        const { handleResetSettings } = await import('../../src/ui/actions.js');
        await handleResetSettings();

        const settings = mockExtensionSettings.openvault;
        expect(settings.extractionTokenBudget).toBe(defaultSettings.extractionTokenBudget);
        expect(settings.extractionRearviewTokens).toBe(defaultSettings.extractionRearviewTokens);
        expect(settings.retrievalFinalTokens).toBe(defaultSettings.retrievalFinalTokens);
        expect(settings.visibleChatBudget).toBe(defaultSettings.visibleChatBudget);
        expect(settings.reflectionThreshold).toBe(defaultSettings.reflectionThreshold);
        expect(settings.maxInsightsPerReflection).toBe(defaultSettings.maxInsightsPerReflection);
        expect(settings.alpha).toBe(defaultSettings.alpha);
        expect(settings.forgetfulnessBaseLambda).toBe(defaultSettings.forgetfulnessBaseLambda);
        expect(settings.worldContextBudget).toBe(defaultSettings.worldContextBudget);
        expect(settings.dedupSimilarityThreshold).toBe(defaultSettings.dedupSimilarityThreshold);
        expect(settings.vectorSimilarityThreshold).toBe(defaultSettings.vectorSimilarityThreshold);
    });

    it('enables debug mode after reset', async () => {
        const { handleResetSettings } = await import('../../src/ui/actions.js');
        await handleResetSettings();

        expect(mockExtensionSettings.openvault.debugMode).toBe(true);
    });

    it('returns early if user cancels confirmation', async () => {
        global.confirm.mockReturnValue(false);
        const { handleResetSettings } = await import('../../src/ui/actions.js');

        await handleResetSettings();

        // Settings should not be modified
        expect(mockExtensionSettings.openvault.alpha).toBe(0.99);
        expect(mockExtensionSettings.openvault.extractionTokenBudget).toBe(9999);
        expect(mockDeps.saveSettingsDebounced).not.toHaveBeenCalled();
    });
});
