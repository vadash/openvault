import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDeps } from '../../src/deps.js';

describe('executeEmergencyCut', () => {
    beforeEach(async () => {
        vi.resetModules();
        await global.registerCdnOverrides();
    });

    afterEach(() => {
        resetDeps();
        vi.restoreAllMocks();
    });

    it('calls onWarning and returns if worker is running', async () => {
        const workerModule = await import('../../src/extraction/worker.js');
        vi.spyOn(workerModule, 'isWorkerRunning').mockReturnValue(true);

        const { executeEmergencyCut } = await import('../../src/extraction/extract.js');
        const onWarning = vi.fn();

        await executeEmergencyCut({ onWarning });

        expect(onWarning).toHaveBeenCalledWith('Background extraction in progress. Please wait a moment.');
    });

    it('calls onWarning when no messages to extract or hide', async () => {
        const workerModule = await import('../../src/extraction/worker.js');
        vi.spyOn(workerModule, 'isWorkerRunning').mockReturnValue(false);

        const schedulerModule = await import('../../src/extraction/scheduler.js');
        vi.spyOn(schedulerModule, 'getBackfillStats').mockReturnValue({
            totalMessages: 5, extractedCount: 5, unextractedCount: 0,
        });
        vi.spyOn(schedulerModule, 'getProcessedFingerprints').mockReturnValue(new Set());
        vi.spyOn(schedulerModule, 'getFingerprint').mockImplementation((msg) => msg.fp);

        const dataModule = await import('../../src/utils/data.js');
        vi.spyOn(dataModule, 'getOpenVaultData').mockReturnValue({ memories: [] });

        const depsModule = await import('../../src/deps.js');
        vi.spyOn(depsModule, 'getDeps').mockReturnValue({
            getContext: () => ({ chat: [{ fp: 'fp1', is_system: true }] }),
            console: globalThis.console,
        });

        const { executeEmergencyCut } = await import('../../src/extraction/extract.js');
        const onWarning = vi.fn();

        await executeEmergencyCut({ onWarning });

        expect(onWarning).toHaveBeenCalledWith('No messages to hide');
    });

    it('returns early if user declines confirmation', async () => {
        const workerModule = await import('../../src/extraction/worker.js');
        vi.spyOn(workerModule, 'isWorkerRunning').mockReturnValue(false);

        const schedulerModule = await import('../../src/extraction/scheduler.js');
        vi.spyOn(schedulerModule, 'getBackfillStats').mockReturnValue({
            totalMessages: 10, extractedCount: 5, unextractedCount: 5,
        });

        const dataModule = await import('../../src/utils/data.js');
        vi.spyOn(dataModule, 'getOpenVaultData').mockReturnValue({ memories: [] });

        const depsModule = await import('../../src/deps.js');
        vi.spyOn(depsModule, 'getDeps').mockReturnValue({
            getContext: () => ({ chat: [] }),
            console: globalThis.console,
        });

        const { executeEmergencyCut } = await import('../../src/extraction/extract.js');
        const onConfirmPrompt = vi.fn(() => false);
        const onStart = vi.fn();

        await executeEmergencyCut({ onConfirmPrompt, onStart });

        expect(onConfirmPrompt).toHaveBeenCalled();
        expect(onStart).not.toHaveBeenCalled();
    });

    it('hide-only path: skips extraction when all messages already extracted', async () => {
        const workerModule = await import('../../src/extraction/worker.js');
        vi.spyOn(workerModule, 'isWorkerRunning').mockReturnValue(false);

        const schedulerModule = await import('../../src/extraction/scheduler.js');
        vi.spyOn(schedulerModule, 'getBackfillStats').mockReturnValue({
            totalMessages: 5, extractedCount: 5, unextractedCount: 0,
        });
        vi.spyOn(schedulerModule, 'getProcessedFingerprints').mockReturnValue(new Set(['fp1', 'fp2']));
        vi.spyOn(schedulerModule, 'getFingerprint').mockImplementation((msg) => msg.fp);

        const dataModule = await import('../../src/utils/data.js');
        vi.spyOn(dataModule, 'getOpenVaultData').mockReturnValue({ memories: [] });

        const mockChat = [
            { fp: 'fp1', is_system: false },
            { fp: 'fp2', is_system: false },
        ];
        const mockSave = vi.fn(async () => true);
        const depsModule = await import('../../src/deps.js');
        vi.spyOn(depsModule, 'getDeps').mockReturnValue({
            getContext: () => ({ chat: mockChat }),
            saveChatConditional: mockSave,
            console: globalThis.console,
        });

        const { executeEmergencyCut } = await import('../../src/extraction/extract.js');
        const onConfirmPrompt = vi.fn(() => true);
        const onComplete = vi.fn();
        const onStart = vi.fn();

        await executeEmergencyCut({ onConfirmPrompt, onComplete, onStart });

        expect(onConfirmPrompt).toHaveBeenCalled();
        expect(onStart).not.toHaveBeenCalled(); // No extraction phase
        expect(onComplete).toHaveBeenCalledWith(
            expect.objectContaining({ messagesProcessed: 0, eventsCreated: 0, hiddenCount: 2 }),
        );
    });

    it('calls onError with isCancel=true on AbortError', async () => {
        const workerModule = await import('../../src/extraction/worker.js');
        vi.spyOn(workerModule, 'isWorkerRunning').mockReturnValue(false);

        const schedulerModule = await import('../../src/extraction/scheduler.js');
        vi.spyOn(schedulerModule, 'getBackfillStats').mockReturnValue({
            totalMessages: 10, extractedCount: 0, unextractedCount: 10,
        });

        const dataModule = await import('../../src/utils/data.js');
        vi.spyOn(dataModule, 'getOpenVaultData').mockReturnValue({ memories: [] });

        const depsModule = await import('../../src/deps.js');
        vi.spyOn(depsModule, 'getDeps').mockReturnValue({
            getContext: () => ({ chat: [{ mes: 'test' }] }),
            console: globalThis.console,
        });

        // Mock extractAllMessages to throw AbortError
        const extractModule = await import('../../src/extraction/extract.js');
        vi.spyOn(extractModule, 'extractAllMessages').mockRejectedValue(
            new DOMException('Aborted', 'AbortError'),
        );

        const onConfirmPrompt = vi.fn(() => true);
        const onStart = vi.fn();
        const onError = vi.fn();

        await extractModule.executeEmergencyCut({ onConfirmPrompt, onStart, onError });

        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'AbortError' }),
            true,
        );
    });
});
