import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import { extensionName } from '../src/constants.js';
import { callLLMForExtraction, callLLMForRetrieval } from '../src/llm.js';

describe('callLLMForExtraction with structured output', () => {
    let mockConnectionManager;
    const testMessages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'test prompt' }
    ];

    beforeEach(() => {
        mockConnectionManager = {
            sendRequest: vi.fn().mockResolvedValue({ content: '{"reasoning": null, "events": []}' }),
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
        await callLLMForExtraction(testMessages, { structured: true });

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        expect(callArgs[4]).toHaveProperty('jsonSchema');
        expect(callArgs[4].jsonSchema).toMatchObject({
            name: 'MemoryExtraction',
            strict: true,
        });
    });

    it('does not pass jsonSchema when structured option is false', async () => {
        await callLLMForExtraction(testMessages, { structured: false });

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        expect(callArgs[4]).toEqual({});
    });

    it('does not pass jsonSchema when structured option is omitted', async () => {
        await callLLMForExtraction(testMessages);

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        expect(callArgs[4]).toEqual({});
    });

    it('jsonSchema contains valid structure', async () => {
        await callLLMForExtraction(testMessages, { structured: true });

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        const jsonSchema = callArgs[4].jsonSchema;

        expect(jsonSchema.value).toHaveProperty('type');
        expect(jsonSchema.value).toHaveProperty('properties');
        expect(jsonSchema.value.properties).toHaveProperty('events');
    });

    it('jsonSchema has reasoning as first property', async () => {
        await callLLMForExtraction(testMessages, { structured: true });

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        const jsonSchema = callArgs[4].jsonSchema;
        const propKeys = Object.keys(jsonSchema.value.properties);

        expect(propKeys[0]).toBe('reasoning');
        expect(propKeys[1]).toBe('events');
    });

    it('jsonSchema includes event_type in event items', async () => {
        await callLLMForExtraction(testMessages, { structured: true });

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        const jsonSchema = callArgs[4].jsonSchema;
        const eventItemProps = jsonSchema.value.properties.events.items.properties;

        expect(eventItemProps).toHaveProperty('event_type');
    });
});

describe('callLLMForRetrieval with structured output', () => {
    let mockConnectionManager;
    const testMessages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'test prompt' }
    ];

    beforeEach(() => {
        mockConnectionManager = {
            sendRequest: vi.fn().mockResolvedValue({ content: '{"reasoning": null, "selected": [1, 2, 3]}' }),
        };

        setDeps({
            connectionManager: mockConnectionManager,
            getExtensionSettings: () => ({
                [extensionName]: { retrievalProfile: 'test-profile' },
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

    it('passes retrieval jsonSchema when structured option is true', async () => {
        await callLLMForRetrieval(testMessages, { structured: true });

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        expect(callArgs[4]).toHaveProperty('jsonSchema');
        expect(callArgs[4].jsonSchema).toMatchObject({
            name: 'MemoryRetrieval',
            strict: true,
        });
    });

    it('does not pass jsonSchema when structured option is false for retrieval', async () => {
        await callLLMForRetrieval(testMessages, { structured: false });

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        expect(callArgs[4]).toEqual({});
    });
});
