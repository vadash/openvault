import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setDeps, resetDeps } from '../../../src/deps.js';
import { extensionName, MEMORIES_KEY } from '../../../src/constants.js';
import * as utilsModule from '../../../src/utils.js';
import { executeLLM } from '../../../src/extraction/stages/llm-executor.js';

// Mock generateId for deterministic tests
vi.mock('../../../src/utils.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        generateId: vi.fn(() => 'test-id-123'),
    };
});

describe('executeLLM with structured parsing', () => {
    let mockData;
    let mockContext;
    let mockCallLLMForExtraction;

    beforeEach(() => {
        mockData = { [MEMORIES_KEY]: [] };
        mockContext = {
            name2: 'Alice',
            name1: 'User',
        };

        // Create mock for callLLMForExtraction
        mockCallLLMForExtraction = vi.fn();

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
            // Mock the llm module
            callLLMForExtraction: mockCallLLMForExtraction,
        });

        // Clear any previous mocks
        vi.clearAllMocks();
    });

    afterEach(() => {
        resetDeps();
    });

    it('uses structured output mode', async () => {
        // Need to dynamically import to get the mocked version
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

        const events = await executeLLM('test prompt', messages, mockContext, 'batch-1', mockData);

        // Verify structured mode was used
        expect(spy).toHaveBeenCalledWith(
            'test prompt',
            { structured: true }
        );

        // Verify parsed events
        expect(events).toHaveLength(1);
        expect(events[0].summary).toBe('Alice greeted Bob');
        expect(events[0].characters_involved).toEqual(['Alice', 'Bob']);

        // Cleanup
        spy.mockRestore();
    });

    it('handles validation errors gracefully with fallback', async () => {
        // Return valid data for fallback parser (with summary)
        const llmModule = await import('../../../src/llm.js');
        const spy = vi.spyOn(llmModule, 'callLLMForExtraction').mockResolvedValue(
            JSON.stringify({
                events: [
                    { summary: 'Valid event for fallback', importance: 3 }
                ]
            })
        );

        const messages = [{ id: 1, mes: 'test' }];

        const events = await executeLLM('test', messages, mockContext, 'batch-1', mockData);

        // Should succeed with structured validation first
        expect(events).toHaveLength(1);
        expect(events[0].summary).toBe('Valid event for fallback');

        spy.mockRestore();
    });

    it('uses fallback parser when structured validation fails', async () => {
        const llmModule = await import('../../../src/llm.js');

        // Return data missing required field - will fail structured validation
        // but fallback parser might still process it if it has a summary
        const spy = vi.spyOn(llmModule, 'callLLMForExtraction').mockResolvedValue(
            JSON.stringify({
                events: [
                    { summary: 'Has summary but invalid importance', importance: 10 }
                ]
            })
        );

        const messages = [{ id: 1, mes: 'Alice said hello' }];

        const events = await executeLLM('test', messages, mockContext, 'batch-1', mockData);

        // Structured validation should fail, fallback should handle it
        // Fallback clamps importance to 1-5
        expect(events).toHaveLength(1);
        expect(events[0].summary).toBe('Has summary but invalid importance');
        expect(events[0].importance).toBe(5); // clamped by fallback parser

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

        const events = await executeLLM('test', messages, mockContext, 'batch-1', mockData);

        expect(events).toHaveLength(1);
        expect(events[0].summary).toBe('Test event');
        expect(events[0].importance).toBe(3);  // default from schema
        expect(events[0].witnesses).toEqual([]);  // default from schema

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

        await executeLLM('test', messages, mockContext, 'batch-1', mockData);

        // The import in the test needs to match what's used in the code
        const { PROCESSED_MESSAGES_KEY } = await import('../../../src/constants.js');

        expect(mockData[PROCESSED_MESSAGES_KEY]).toEqual([10, 20]);

        spy.mockRestore();
    });
});
