import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import { extensionName } from '../src/constants.js';
import { callLLMForExtraction } from '../src/llm.js';

describe('callLLMForExtraction with structured output', () => {
    let mockConnectionManager;

    beforeEach(() => {
        mockConnectionManager = {
            sendRequest: vi.fn().mockResolvedValue({ content: '{"events": [], "reasoning": null}' }),
        };

        setDeps({
            connectionManager: mockConnectionManager,
            getExtensionSettings: () => ({
                [extensionName]: { extractionProfile: 'test-profile' },
                connectionManager: {
                    profiles: [{ id: 'test-profile', name: 'Test Profile' }],
                    selectedProfile: 'test-profile',
                },
            }),
            getContext: () => ({
                parseReasoningFromString: null,
            }),
        });
    });

    afterEach(() => {
        resetDeps();
    });

    it('passes jsonSchema when structured option is true', async () => {
        await callLLMForExtraction('test prompt', { structured: true });

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        expect(callArgs[4]).toHaveProperty('jsonSchema');
        expect(callArgs[4].jsonSchema).toMatchObject({
            name: 'MemoryExtraction',
            strict: true,
        });
    });

    it('does not pass jsonSchema when structured option is false', async () => {
        await callLLMForExtraction('test prompt', { structured: false });

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        expect(callArgs[4]).toEqual({});
    });

    it('does not pass jsonSchema when structured option is omitted', async () => {
        await callLLMForExtraction('test prompt');

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        expect(callArgs[4]).toEqual({});
    });

    it('jsonSchema contains valid structure', async () => {
        await callLLMForExtraction('test prompt', { structured: true });

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        const jsonSchema = callArgs[4].jsonSchema;

        expect(jsonSchema.value).toHaveProperty('type');
        expect(jsonSchema.value).toHaveProperty('properties');
        expect(jsonSchema.value.properties).toHaveProperty('events');
    });
});
