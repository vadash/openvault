import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDeps } from '../../src/deps.js';
import { generateReflections } from '../../src/reflection/reflect.js';

// Mock LLM — will be configured per test
const mockCallLLM = vi.fn();
vi.mock('../../src/llm.js', () => ({
    callLLM: (...args) => mockCallLLM(...args),
    LLM_CONFIGS: {
        reflection: { profileSettingKey: 'extractionProfile' },
    },
}));

// Mock embeddings
vi.mock('../../src/embeddings.js', () => ({
    enrichEventsWithEmbeddings: vi.fn(async (events) => {
        events.forEach((e) => {
            e.embedding = [0.5, 0.5];
        });
    }),
    isEmbeddingsEnabled: () => true,
}));

describe('Unified Reflection Integration', () => {
    beforeEach(() => {
        setupTestContext({
            deps: { Date: { now: () => 2000000 } },
        });
        mockCallLLM.mockReset();
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('handles 1-reflection response (minimal)', async () => {
        mockCallLLM.mockResolvedValue(
            JSON.stringify({
                reflections: [{ question: 'Q1', insight: 'Single insight', evidence_ids: ['ev_001'] }],
            })
        );

        const result = await generateReflections(
            'Alice',
            [
                {
                    id: 'ev_001',
                    summary: 'Alice did something important',
                    importance: 3,
                    characters_involved: ['Alice'],
                    witnesses: ['Alice'],
                    type: 'event',
                    embedding: [0.5, 0.5],
                },
                {
                    id: 'ev_002',
                    summary: 'Alice met Bob',
                    importance: 3,
                    characters_involved: ['Alice'],
                    witnesses: ['Alice'],
                    type: 'event',
                    embedding: [0.5, 0.5],
                },
                {
                    id: 'ev_003',
                    summary: 'Alice fought a dragon',
                    importance: 3,
                    characters_involved: ['Alice'],
                    witnesses: ['Alice'],
                    type: 'event',
                    embedding: [0.5, 0.5],
                },
            ],
            {}
        );

        expect(result).toHaveLength(1);
        expect(result[0].summary).toBe('Single insight');
        expect(result[0].source_ids).toEqual(['ev_001']);
    });

    it('handles 3-reflection response (max)', async () => {
        mockCallLLM.mockResolvedValue(
            JSON.stringify({
                reflections: [
                    { question: 'Q1', insight: 'Insight 1', evidence_ids: ['ev_001'] },
                    { question: 'Q2', insight: 'Insight 2', evidence_ids: ['ev_002'] },
                    { question: 'Q3', insight: 'Insight 3', evidence_ids: ['ev_003'] },
                ],
            })
        );

        const result = await generateReflections(
            'Alice',
            [
                {
                    id: 'ev_001',
                    summary: 'Event 1',
                    importance: 3,
                    characters_involved: ['Alice'],
                    witnesses: ['Alice'],
                    type: 'event',
                    embedding: [0.5, 0.5],
                },
                {
                    id: 'ev_002',
                    summary: 'Event 2',
                    importance: 3,
                    characters_involved: ['Alice'],
                    witnesses: ['Alice'],
                    type: 'event',
                    embedding: [0.5, 0.5],
                },
                {
                    id: 'ev_003',
                    summary: 'Event 3',
                    importance: 3,
                    characters_involved: ['Alice'],
                    witnesses: ['Alice'],
                    type: 'event',
                    embedding: [0.5, 0.5],
                },
            ],
            {}
        );

        expect(result).toHaveLength(3);
    });

    it('handles empty evidence_ids gracefully', async () => {
        mockCallLLM.mockResolvedValue(
            JSON.stringify({
                reflections: [{ question: 'Q1', insight: 'General insight', evidence_ids: [] }],
            })
        );

        const result = await generateReflections(
            'Alice',
            [
                {
                    id: 'ev_001',
                    summary: 'Event one',
                    importance: 3,
                    characters_involved: ['Alice'],
                    witnesses: ['Alice'],
                    type: 'event',
                    embedding: [0.5, 0.5],
                },
                {
                    id: 'ev_002',
                    summary: 'Event two',
                    importance: 3,
                    characters_involved: ['Alice'],
                    witnesses: ['Alice'],
                    type: 'event',
                    embedding: [0.5, 0.5],
                },
                {
                    id: 'ev_003',
                    summary: 'Event three',
                    importance: 3,
                    characters_involved: ['Alice'],
                    witnesses: ['Alice'],
                    type: 'event',
                    embedding: [0.5, 0.5],
                },
            ],
            {}
        );

        expect(result).toHaveLength(1);
        expect(result[0].source_ids).toEqual([]);
    });
});
