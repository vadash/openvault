import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetDeps } from '../../src/deps.js';
import { callLLM, LLM_CONFIGS } from '../../src/llm.js';
import { createUsageTracker } from '../../src/utils/usage-tracker.js';

describe('LLM_CONFIGS after smart retrieval removal', () => {
    it('does not have a retrieval config', () => {
        expect(LLM_CONFIGS.retrieval).toBeUndefined();
    });

    it('does not have legacy extraction config', () => {
        expect(LLM_CONFIGS.extraction).toBeUndefined();
    });
});

describe('LLM_CONFIGS reflection configs', () => {
    it('has unified reflection config', () => {
        expect(LLM_CONFIGS.reflection).toBeDefined();
        expect(LLM_CONFIGS.reflection.profileSettingKey).toBe('extractionProfile');
    });
});

describe('LLM_CONFIGS world state config', () => {
    it('has worldState config', () => {
        expect(LLM_CONFIGS.worldState).toBeDefined();
        expect(LLM_CONFIGS.worldState.profileSettingKey).toBe('extractionProfile');
        expect(LLM_CONFIGS.worldState.maxTokens).toBe(8000);
        expect(LLM_CONFIGS.worldState.errorContext).toBe('World state synthesis');
        expect(LLM_CONFIGS.worldState.timeoutMs).toBe(180000);
        expect(LLM_CONFIGS.worldState.getJsonSchema).toBeInstanceOf(Function);
    });
});

describe('LLM_CONFIGS split extraction', () => {
    it('has extraction_events config', () => {
        expect(LLM_CONFIGS.extraction_events).toBeDefined();
        expect(LLM_CONFIGS.extraction_events.maxTokens).toBe(8000);
    });

    it('has extraction_graph config', () => {
        expect(LLM_CONFIGS.extraction_graph).toBeDefined();
        expect(LLM_CONFIGS.extraction_graph.maxTokens).toBe(8000);
    });
});

describe('LLM_CONFIGS timeout values', () => {
    it('extraction_events has 240s timeout', () => {
        expect(LLM_CONFIGS.extraction_events.timeoutMs).toBe(240000);
    });

    it('extraction_graph has 180s timeout', () => {
        expect(LLM_CONFIGS.extraction_graph.timeoutMs).toBe(180000);
    });

    it('reflection has 180s timeout', () => {
        expect(LLM_CONFIGS.reflection.timeoutMs).toBe(180000);
    });

    it('worldState has 180s timeout', () => {
        expect(LLM_CONFIGS.worldState.timeoutMs).toBe(180000);
    });

    it('edge_consolidation stays at 60s', () => {
        expect(LLM_CONFIGS.edge_consolidation.timeoutMs).toBe(60000);
    });
});

describe('callLLM backup profile failover', () => {
    const testConfig = {
        profileSettingKey: 'extractionProfile',
        maxTokens: 100,
        errorContext: 'Test',
        timeoutMs: 5000,
        getJsonSchema: undefined,
    };
    const testMessages = [{ role: 'user', content: 'hello' }];

    afterEach(() => {
        resetDeps();
    });

    it('succeeds on main profile without touching backup', async () => {
        const sendRequest = vi.fn().mockResolvedValue({ content: 'main-ok' });
        setupTestContext({
            settings: { extractionProfile: 'main-id', backupProfile: 'backup-id' },
            deps: { connectionManager: { sendRequest } },
        });

        const result = await callLLM(testMessages, testConfig);
        expect(result).toBe('main-ok');
        expect(sendRequest).toHaveBeenCalledTimes(1);
        expect(sendRequest.mock.calls[0][0]).toBe('main-id');
    });

    it('falls back to backup when main fails', async () => {
        const sendRequest = vi
            .fn()
            .mockRejectedValueOnce(new Error('main down'))
            .mockResolvedValueOnce({ content: 'backup-ok' });
        setupTestContext({
            settings: { extractionProfile: 'main-id', backupProfile: 'backup-id' },
            deps: { connectionManager: { sendRequest } },
        });

        const result = await callLLM(testMessages, testConfig);
        expect(result).toBe('backup-ok');
        expect(sendRequest).toHaveBeenCalledTimes(2);
        expect(sendRequest.mock.calls[0][0]).toBe('main-id');
        expect(sendRequest.mock.calls[1][0]).toBe('backup-id');
    });

    it('throws main error when both profiles fail', async () => {
        const sendRequest = vi
            .fn()
            .mockRejectedValueOnce(new Error('main down'))
            .mockRejectedValueOnce(new Error('backup down'));
        setupTestContext({
            settings: { extractionProfile: 'main-id', backupProfile: 'backup-id' },
            deps: { connectionManager: { sendRequest } },
        });

        await expect(callLLM(testMessages, testConfig)).rejects.toThrow('main down');
        expect(sendRequest).toHaveBeenCalledTimes(2);
    });

    it('skips backup when backupProfile is empty', async () => {
        const sendRequest = vi.fn().mockRejectedValueOnce(new Error('main down'));
        setupTestContext({
            settings: { extractionProfile: 'main-id', backupProfile: '' },
            deps: { connectionManager: { sendRequest } },
        });

        await expect(callLLM(testMessages, testConfig)).rejects.toThrow('main down');
        expect(sendRequest).toHaveBeenCalledTimes(1);
    });

    it('skips backup when backup equals main profile', async () => {
        const sendRequest = vi.fn().mockRejectedValueOnce(new Error('main down'));
        setupTestContext({
            settings: { extractionProfile: 'same-id', backupProfile: 'same-id' },
            deps: { connectionManager: { sendRequest } },
        });

        await expect(callLLM(testMessages, testConfig)).rejects.toThrow('main down');
        expect(sendRequest).toHaveBeenCalledTimes(1);
    });

    it('throws when backup returns empty response', async () => {
        const sendRequest = vi
            .fn()
            .mockRejectedValueOnce(new Error('main down'))
            .mockResolvedValueOnce({ content: '' });
        setupTestContext({
            settings: { extractionProfile: 'main-id', backupProfile: 'backup-id' },
            deps: { connectionManager: { sendRequest } },
        });

        await expect(callLLM(testMessages, testConfig)).rejects.toThrow('main down');
        expect(sendRequest).toHaveBeenCalledTimes(2);
    });

    it('uses explicitly passed profileId over settings', async () => {
        const sendRequest = vi.fn().mockResolvedValue({ content: 'explicit-ok' });
        setupTestContext({
            settings: { extractionProfile: 'settings-id' },
            deps: { connectionManager: { sendRequest } },
        });

        const result = await callLLM(testMessages, testConfig, { profileId: 'explicit-id' });
        expect(result).toBe('explicit-ok');
        expect(sendRequest.mock.calls[0][0]).toBe('explicit-id');
    });

    it('uses explicitly passed backupProfileId over settings', async () => {
        const sendRequest = vi
            .fn()
            .mockRejectedValueOnce(new Error('main down'))
            .mockResolvedValueOnce({ content: 'backup-ok' });
        setupTestContext({
            settings: { extractionProfile: 'main-id', backupProfile: 'settings-backup' },
            deps: { connectionManager: { sendRequest } },
        });

        const result = await callLLM(testMessages, testConfig, {
            backupProfileId: 'explicit-backup',
        });
        expect(result).toBe('backup-ok');
        expect(sendRequest.mock.calls[1][0]).toBe('explicit-backup');
    });
});

describe('callLLM abort signal', () => {
    const testConfig = {
        profileSettingKey: 'extractionProfile',
        maxTokens: 100,
        errorContext: 'Test',
        timeoutMs: 5000,
        getJsonSchema: undefined,
    };
    const testMessages = [{ role: 'user', content: 'hello' }];

    afterEach(() => {
        resetDeps();
    });

    it('throws AbortError immediately with pre-aborted signal', async () => {
        const sendRequest = vi.fn().mockResolvedValue({ content: 'ok' });
        setupTestContext({
            settings: { extractionProfile: 'main-id' },
            deps: { connectionManager: { sendRequest } },
        });

        const ctrl = new AbortController();
        ctrl.abort();

        await expect(callLLM(testMessages, testConfig, { signal: ctrl.signal })).rejects.toThrow(
            expect.objectContaining({ name: 'AbortError' })
        );
        expect(sendRequest).not.toHaveBeenCalled();
    });

    it('throws AbortError when signal aborts mid-request', async () => {
        const ctrl = new AbortController();
        const sendRequest = vi.fn().mockImplementation(() => {
            return new Promise((resolve) => {
                // Simulate slow request — abort fires before it resolves
                setTimeout(() => resolve({ content: 'too late' }), 5000);
            });
        });
        setupTestContext({
            settings: { extractionProfile: 'main-id' },
            deps: { connectionManager: { sendRequest } },
        });

        const promise = callLLM(testMessages, testConfig, { signal: ctrl.signal });
        // Abort after a tick
        setTimeout(() => ctrl.abort(), 10);

        await expect(promise).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }));
    });

    it('does not abort when signal is not triggered', async () => {
        const sendRequest = vi.fn().mockResolvedValue({ content: 'ok' });
        setupTestContext({
            settings: { extractionProfile: 'main-id' },
            deps: { connectionManager: { sendRequest } },
        });

        const ctrl = new AbortController();
        const result = await callLLM(testMessages, testConfig, { signal: ctrl.signal });
        expect(result).toBe('ok');
    });

    it('skips backup profile attempt on AbortError', async () => {
        const ctrl = new AbortController();
        const sendRequest = vi.fn().mockImplementation(() => {
            return new Promise((resolve) => {
                setTimeout(() => resolve({ content: 'too late' }), 5000);
            });
        });
        setupTestContext({
            settings: { extractionProfile: 'main-id', backupProfile: 'backup-id' },
            deps: { connectionManager: { sendRequest } },
        });

        const promise = callLLM(testMessages, testConfig, { signal: ctrl.signal });
        setTimeout(() => ctrl.abort(), 10);

        await expect(promise).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }));
        // Only main profile was attempted — backup is skipped for abort
        expect(sendRequest).toHaveBeenCalledTimes(1);
    });
});

describe('callLLM usage tracking', () => {
    const testConfig = {
        profileSettingKey: 'extractionProfile',
        maxTokens: 100,
        errorContext: 'Test',
        timeoutMs: 5000,
        getJsonSchema: undefined,
    };
    const testMessages = [{ role: 'user', content: 'hello' }];

    afterEach(() => {
        resetDeps();
    });

    it('tracker receives usage when API returns full response with usage fields', async () => {
        const tracker = createUsageTracker();
        const recordSpy = vi.spyOn(tracker, 'record');

        const sendRequest = vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'test-response' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
            model: 'test-model',
        });
        setupTestContext({
            settings: { extractionProfile: 'main-id' },
            deps: { connectionManager: { sendRequest } },
        });

        const result = await callLLM(testMessages, testConfig, { tracker });
        expect(result).toBe('test-response');
        expect(recordSpy).toHaveBeenCalledTimes(1);
        expect(recordSpy).toHaveBeenCalledWith({
            model: 'test-model',
            promptTokens: 10,
            completionTokens: 5,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
        });
    });

    it('tracker receives "unknown" model when response lacks model field', async () => {
        const tracker = createUsageTracker();
        const recordSpy = vi.spyOn(tracker, 'record');

        const sendRequest = vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'test-response' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
        setupTestContext({
            settings: { extractionProfile: 'main-id' },
            deps: { connectionManager: { sendRequest } },
        });

        await callLLM(testMessages, testConfig, { tracker });
        expect(recordSpy).toHaveBeenCalledWith({
            model: undefined,
            promptTokens: 10,
            completionTokens: 5,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
        });
    });

    it('tracker receives N/A tokens when response lacks usage field', async () => {
        const tracker = createUsageTracker();
        const recordSpy = vi.spyOn(tracker, 'record');

        const sendRequest = vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'test-response' } }],
            model: 'test-model',
        });
        setupTestContext({
            settings: { extractionProfile: 'main-id' },
            deps: { connectionManager: { sendRequest } },
        });

        await callLLM(testMessages, testConfig, { tracker });
        expect(recordSpy).toHaveBeenCalledWith({
            model: 'test-model',
            promptTokens: undefined,
            completionTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
        });
    });

    it('tracker not called when no tracker passed', async () => {
        const sendRequest = vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'test-response' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
            model: 'test-model',
        });
        setupTestContext({
            settings: { extractionProfile: 'main-id' },
            deps: { connectionManager: { sendRequest } },
        });

        const result = await callLLM(testMessages, testConfig);
        expect(result).toBe('test-response');
        expect(sendRequest).toHaveBeenCalled();
    });

    it('tracker receives cache read/write tokens when present in usage', async () => {
        const tracker = createUsageTracker();
        const recordSpy = vi.spyOn(tracker, 'record');

        const sendRequest = vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'test-response' } }],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                cache_read_tokens: 100,
                cache_write_tokens: 50,
            },
            model: 'test-model',
        });
        setupTestContext({
            settings: { extractionProfile: 'main-id' },
            deps: { connectionManager: { sendRequest } },
        });

        await callLLM(testMessages, testConfig, { tracker });
        expect(recordSpy).toHaveBeenCalledWith({
            model: 'test-model',
            promptTokens: 10,
            completionTokens: 5,
            cacheReadTokens: 100,
            cacheWriteTokens: 50,
        });
    });
});
