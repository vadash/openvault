import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setDeps, resetDeps } from '../../../src/deps.js';
import { extensionName, MEMORIES_KEY, PROCESSED_MESSAGES_KEY } from '../../../src/constants.js';
import { executeLLM } from '../../../src/extraction/stages/llm-executor.js';

// Mock generateId for deterministic tests
vi.mock('../../../src/utils.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        generateId: vi.fn(() => 'test-id-123'),
    };
});

// Helper to create test messages array
const testMessages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'test prompt' }
];

describe('executeLLM with structured parsing', () => {
    let mockData;
    let mockContext;

    beforeEach(() => {
        mockData = { [MEMORIES_KEY]: [] };
        mockContext = {
            name2: 'Alice',
            name1: 'User',
        };

        setDeps({
            getContext: () => mockContext,
            console: {
                log: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
            getExtensionSettings: () => ({
                [extensionName]: { enabled: true },
            }),
        });

        vi.clearAllMocks();
    });

    afterEach(() => {
        resetDeps();
    });

    it('uses structured output mode', async () => {
        const llmModule = await import('../../../src/llm.js');
        const spy = vi.spyOn(llmModule, 'callLLMForExtraction').mockResolvedValue(
            JSON.stringify({
                events: [
                    {
                        summary: 'Alice greeted Bob',
                        importance: 3,
                        characters_involved: ['Alice', 'Bob'],
                    }
                ],
                reasoning: null,
            })
        );

        const messages = [
            { id: 1, mes: 'Hello Bob!' },
            { id: 2, mes: 'Hi Alice!' },
        ];

        const events = await executeLLM(testMessages, messages, mockContext, 'batch-1', mockData);

        // Verify structured mode was used
        expect(spy).toHaveBeenCalledWith(
            testMessages,
            { structured: true }
        );

        // Verify parsed events
        expect(events).toHaveLength(1);
        expect(events[0].summary).toBe('Alice greeted Bob');
        expect(events[0].characters_involved).toEqual(['Alice', 'Bob']);

        spy.mockRestore();
    });

    it('throws on validation failure (no fallback)', async () => {
        const llmModule = await import('../../../src/llm.js');

        // Return data with invalid importance (out of range)
        const spy = vi.spyOn(llmModule, 'callLLMForExtraction').mockResolvedValue(
            JSON.stringify({
                events: [
                    { summary: 'Has summary but invalid importance', importance: 10 }
                ]
            })
        );

        const messages = [{ id: 1, mes: 'Alice said hello' }];

        // Should throw validation error - no fallback
        await expect(
            executeLLM(testMessages, messages, mockContext, 'batch-1', mockData)
        ).rejects.toThrow('Schema validation failed');

        spy.mockRestore();
    });

    it('applies defaults from schema when fields missing', async () => {
        const llmModule = await import('../../../src/llm.js');
        const spy = vi.spyOn(llmModule, 'callLLMForExtraction').mockResolvedValue(
            JSON.stringify({
                events: [
                    { summary: 'Test event' }  // only required field
                ]
            })
        );

        const messages = [{ id: 1, mes: 'test' }];

        const events = await executeLLM(testMessages, messages, mockContext, 'batch-1', mockData);

        expect(events).toHaveLength(1);
        expect(events[0].summary).toBe('Test event');
        expect(events[0].importance).toBe(3);  // default from schema
        expect(events[0].witnesses).toEqual([]);  // default from schema

        spy.mockRestore();
    });

    it('handles empty events array', async () => {
        const llmModule = await import('../../../src/llm.js');
        const spy = vi.spyOn(llmModule, 'callLLMForExtraction').mockResolvedValue(
            JSON.stringify({
                events: [],
                reasoning: 'No significant events found',
            })
        );

        const messages = [{ id: 1, mes: 'test' }];

        const events = await executeLLM(testMessages, messages, mockContext, 'batch-1', mockData);

        expect(events).toHaveLength(0);

        spy.mockRestore();
    });

    it('tracks processed message IDs', async () => {
        const llmModule = await import('../../../src/llm.js');
        const spy = vi.spyOn(llmModule, 'callLLMForExtraction').mockResolvedValue(
            JSON.stringify({
                events: [{ summary: 'Test', importance: 3, characters_involved: [] }],
                reasoning: null,
            })
        );

        const messages = [
            { id: 10, mes: 'First' },
            { id: 20, mes: 'Second' },
        ];

        await executeLLM(testMessages, messages, mockContext, 'batch-1', mockData);

        expect(mockData[PROCESSED_MESSAGES_KEY]).toEqual([10, 20]);

        spy.mockRestore();
    });

    it('enriches events with metadata', async () => {
        const llmModule = await import('../../../src/llm.js');
        const spy = vi.spyOn(llmModule, 'callLLMForExtraction').mockResolvedValue(
            JSON.stringify({
                events: [
                    {
                        summary: 'Test event',
                        importance: 4,
                        characters_involved: ['Alice', 'Bob'],
                        witnesses: ['Charlie'],
                    }
                ],
                reasoning: null,
            })
        );

        const messages = [
            { id: 100, mes: 'test' },
        ];

        const events = await executeLLM(testMessages, messages, mockContext, 'batch-test', mockData);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            summary: 'Test event',
            importance: 4,
            characters_involved: ['Alice', 'Bob'],
            witnesses: ['Charlie'],
            message_ids: [100],
            batch_id: 'batch-test',
        });
        expect(events[0]).toHaveProperty('id');
        expect(events[0]).toHaveProperty('sequence');
        expect(events[0]).toHaveProperty('created_at');

        spy.mockRestore();
    });
});
