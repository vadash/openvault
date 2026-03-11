import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDeps } from '../../src/deps.js';
import {
    accumulateImportance,
    filterDuplicateReflections,
    generateReflections,
    shouldReflect,
} from '../../src/reflection/reflect.js';

// Mock embeddings
vi.mock('../../src/embeddings.js', () => ({
    getQueryEmbedding: vi.fn(async () => [0.5, 0.5]),
    enrichEventsWithEmbeddings: vi.fn(async (events) => {
        events.forEach((e) => {
            e.embedding = [0.5, 0.5];
        });
    }),
    isEmbeddingsEnabled: () => true,
}));

// Mock LLM — will be configured per test
const mockCallLLM = vi.fn();
vi.mock('../../src/llm.js', () => ({
    callLLM: (...args) => mockCallLLM(...args),
    LLM_CONFIGS: {
        reflection: { profileSettingKey: 'extractionProfile' },
    },
}));

describe('accumulateImportance', () => {
    let reflectionState;

    beforeEach(() => {
        reflectionState = {};
    });

    it('accumulates importance from event characters_involved', () => {
        const events = [
            { importance: 4, characters_involved: ['Alice', 'Bob'], witnesses: [] },
            { importance: 2, characters_involved: ['Alice'], witnesses: [] },
        ];
        accumulateImportance(reflectionState, events);
        expect(reflectionState.Alice.importance_sum).toBe(6);
        expect(reflectionState.Bob.importance_sum).toBe(4);
    });

    it('accumulates importance from witnesses too', () => {
        const events = [{ importance: 3, characters_involved: ['Alice'], witnesses: ['Charlie'] }];
        accumulateImportance(reflectionState, events);
        expect(reflectionState.Charlie.importance_sum).toBe(3);
    });

    it('adds to existing importance_sum', () => {
        reflectionState.Alice = { importance_sum: 10 };
        const events = [{ importance: 5, characters_involved: ['Alice'], witnesses: [] }];
        accumulateImportance(reflectionState, events);
        expect(reflectionState.Alice.importance_sum).toBe(15);
    });
});

describe('shouldReflect', () => {
    it('returns true when importance_sum >= 40 (default threshold)', () => {
        const state = { Alice: { importance_sum: 40 } };
        expect(shouldReflect(state, 'Alice')).toBe(true);
    });

    it('returns true when importance_sum > 40', () => {
        const state = { Alice: { importance_sum: 45 } };
        expect(shouldReflect(state, 'Alice')).toBe(true);
    });

    it('returns false when importance_sum < 40', () => {
        const state = { Alice: { importance_sum: 39 } };
        expect(shouldReflect(state, 'Alice')).toBe(false);
    });

    it('returns false when character not in state', () => {
        expect(shouldReflect({}, 'Unknown')).toBe(false);
    });

    it('uses custom threshold from parameter', () => {
        const state = { Alice: { importance_sum: 20 } };
        expect(shouldReflect(state, 'Alice', 20)).toBe(true);
        expect(shouldReflect(state, 'Alice', 30)).toBe(false);
    });

    it('does not trigger reflection below threshold of 40', () => {
        const state = { Alice: { importance_sum: 35 } };
        expect(shouldReflect(state, 'Alice')).toBe(false);
    });

    it('triggers reflection at threshold of 40', () => {
        const state = { Alice: { importance_sum: 40 } };
        expect(shouldReflect(state, 'Alice')).toBe(true);
    });
});

describe('generateReflections', () => {
    const characterName = 'Alice';
    const allMemories = [
        {
            id: 'ev_001',
            summary: 'Alice met Bob at the tavern',
            importance: 3,
            characters_involved: ['Alice', 'Bob'],
            witnesses: ['Alice'],
            embedding: [0.1, 0.9],
            type: 'event',
        },
        {
            id: 'ev_002',
            summary: 'Alice fought the dragon',
            importance: 5,
            characters_involved: ['Alice'],
            witnesses: ['Alice'],
            embedding: [0.9, 0.1],
            type: 'event',
        },
        {
            id: 'ev_003',
            summary: 'Alice learned a spell',
            importance: 4,
            characters_involved: ['Alice'],
            witnesses: ['Alice'],
            embedding: [0.5, 0.5],
            type: 'event',
        },
    ];
    const characterStates = {
        Alice: { name: 'Alice', known_events: ['ev_001', 'ev_002', 'ev_003'] },
    };

    beforeEach(() => {
        setupTestContext({
            deps: { Date: { now: () => 2000000 } },
        });

        // Mock single unified reflection call
        mockCallLLM.mockReset();
        mockCallLLM.mockResolvedValue(
            JSON.stringify({
                reflections: [
                    {
                        question: 'Q1',
                        insight: 'Alice is becoming a seasoned warrior',
                        evidence_ids: ['ev_002'],
                    },
                    {
                        question: 'Q2',
                        insight: 'Alice values her friendship with Bob',
                        evidence_ids: ['ev_001'],
                    },
                    {
                        question: 'Q3',
                        insight: 'Alice is driven by curiosity',
                        evidence_ids: ['ev_003'],
                    },
                ],
            })
        );
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('returns reflection memory objects', async () => {
        const reflections = await generateReflections(characterName, allMemories, characterStates);
        expect(reflections.length).toBeGreaterThan(0);
        expect(reflections[0].type).toBe('reflection');
        expect(reflections[0].character).toBe('Alice');
        expect(reflections[0].source_ids).toBeDefined();
        expect(reflections[0].summary).toBeDefined();
        expect(reflections[0].embedding).toBeDefined();
    });

    it('makes 1 LLM call total (unified reflection)', async () => {
        await generateReflections(characterName, allMemories, characterStates);
        expect(mockCallLLM).toHaveBeenCalledTimes(1);
    });

    it('assigns importance 4 to reflections by default', async () => {
        const reflections = await generateReflections(characterName, allMemories, characterStates);
        for (const r of reflections) {
            expect(r.importance).toBe(4);
        }
    });

    it('sets character as sole witness', async () => {
        const reflections = await generateReflections(characterName, allMemories, characterStates);
        for (const r of reflections) {
            expect(r.witnesses).toEqual(['Alice']);
        }
    });
});

describe('filterDuplicateReflections', () => {
    it('filters out reflections too similar to existing ones', () => {
        const existing = [
            {
                id: 'ref_001',
                type: 'reflection',
                character: 'Alice',
                embedding: [1, 0, 0],
                summary: 'Alice trusts Bob',
            },
        ];
        const newReflections = [
            {
                id: 'ref_new_1',
                type: 'reflection',
                character: 'Alice',
                embedding: [1, 0, 0],
                summary: 'Alice trusts Bob deeply',
            },
            {
                id: 'ref_new_2',
                type: 'reflection',
                character: 'Alice',
                embedding: [0, 1, 0],
                summary: 'Alice fears the dark',
            },
        ];
        const result = filterDuplicateReflections(newReflections, existing, 0.9);
        expect(result.toAdd).toHaveLength(1);
        expect(result.toAdd[0].summary).toBe('Alice fears the dark');
        expect(result.toArchiveIds).toHaveLength(0);
    });

    it('keeps all reflections when none are similar', () => {
        const existing = [
            { id: 'ref_001', type: 'reflection', character: 'Alice', embedding: [1, 0, 0], summary: 'Existing' },
        ];
        const newReflections = [
            { id: 'ref_new_1', type: 'reflection', character: 'Alice', embedding: [0, 1, 0], summary: 'New 1' },
            { id: 'ref_new_2', type: 'reflection', character: 'Alice', embedding: [0, 0, 1], summary: 'New 2' },
        ];
        const result = filterDuplicateReflections(newReflections, existing, 0.9);
        expect(result.toAdd).toHaveLength(2);
        expect(result.toArchiveIds).toHaveLength(0);
    });

    it('passes through reflections without embeddings', () => {
        const existing = [
            { id: 'ref_001', type: 'reflection', character: 'Alice', embedding: [1, 0, 0], summary: 'Existing' },
        ];
        const newReflections = [{ id: 'ref_new_1', type: 'reflection', character: 'Alice', summary: 'No embedding' }];
        const result = filterDuplicateReflections(newReflections, existing, 0.9);
        expect(result.toAdd).toHaveLength(1);
        expect(result.toArchiveIds).toHaveLength(0);
    });
});
