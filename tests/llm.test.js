import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetDeps } from '../src/deps.js';
import { callLLM, LLM_CONFIGS } from '../src/llm.js';

describe('LLM_CONFIGS after smart retrieval removal', () => {
    it('does not have a retrieval config', () => {
        expect(LLM_CONFIGS.retrieval).toBeUndefined();
    });

    it('does not have legacy extraction config', () => {
        expect(LLM_CONFIGS.extraction).toBeUndefined();
    });
});

describe('LLM_CONFIGS reflection configs', () => {
    it('has reflection_questions config', () => {
        expect(LLM_CONFIGS.reflection_questions).toBeDefined();
        expect(LLM_CONFIGS.reflection_questions.profileSettingKey).toBe('extractionProfile');
        expect(LLM_CONFIGS.reflection_questions.maxTokens).toBe(8000);
    });

    it('has reflection_insights config', () => {
        expect(LLM_CONFIGS.reflection_insights).toBeDefined();
        expect(LLM_CONFIGS.reflection_insights.profileSettingKey).toBe('extractionProfile');
        expect(LLM_CONFIGS.reflection_insights.maxTokens).toBe(8000);
    });
});

describe('LLM_CONFIGS community config', () => {
    it('has community config', () => {
        expect(LLM_CONFIGS.community).toBeDefined();
        expect(LLM_CONFIGS.community.profileSettingKey).toBe('extractionProfile');
        expect(LLM_CONFIGS.community.maxTokens).toBe(8000);
        expect(LLM_CONFIGS.community.errorContext).toBe('Community summarization');
        expect(LLM_CONFIGS.community.timeoutMs).toBe(90000);
        expect(LLM_CONFIGS.community.getJsonSchema).toBeInstanceOf(Function);
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
});
