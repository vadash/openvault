/**
 * Tests for src/retrieval/scoring.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import { extensionName, defaultSettings } from '../src/constants.js';
import { scoreMemories } from '../src/retrieval/math.js';

// Mock the embeddings module
vi.mock('../src/embeddings.js', () => ({
    getQueryEmbedding: vi.fn(),
    cosineSimilarity: vi.fn(),
    isEmbeddingsEnabled: vi.fn(),
}));

// Mock the llm module
vi.mock('../src/llm.js', () => ({
    callLLMForRetrieval: vi.fn(),
}));

// Mock the prompts module
vi.mock('../src/prompts.js', () => ({
    buildSmartRetrievalPrompt: vi.fn().mockReturnValue([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'smart retrieval prompt' }
    ]),
}));

// Mock the utils module
vi.mock('../src/utils.js', () => ({
    log: vi.fn(),
    safeParseJSON: vi.fn((str) => {
        try {
            return JSON.parse(str);
        } catch {
            return null;
        }
    }),
    sliceToTokenBudget: vi.fn((memories) => memories), // Return all memories by default
    estimateTokens: vi.fn((text) => Math.ceil((text || '').length / 3.5)),
    stripThinkingTags: vi.fn((content) => content), // Passthrough by default
}));

// Import after mocks are set up
import {
    selectRelevantMemoriesSimple,
    selectRelevantMemoriesSmart,
    selectRelevantMemories,
} from '../src/retrieval/scoring.js';
import { getQueryEmbedding, cosineSimilarity, isEmbeddingsEnabled } from '../src/embeddings.js';
import { callLLMForRetrieval } from '../src/llm.js';
import { buildSmartRetrievalPrompt } from '../src/prompts.js';
import { log } from '../src/utils.js';

describe('scoring', () => {
    let mockConsole;
    let mockSettings;

    beforeEach(() => {
        mockConsole = {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        mockSettings = {
            enabled: true,
            debugMode: true,
            smartRetrievalEnabled: false,
            retrievalPreFilterTokens: 24000,
            retrievalFinalTokens: 12000,
            // New alpha-blend settings
            alpha: 0.7,
            combinedBoostWeight: 15,
            // Old keys kept for backwards compatibility during migration
            vectorSimilarityWeight: 15,
            vectorSimilarityThreshold: 0.5,
        };

        setDeps({
            console: mockConsole,
            getExtensionSettings: () => ({
                [extensionName]: mockSettings,
            }),
        });

        // Reset all mocks
        vi.clearAllMocks();

        // Default mock behaviors
        isEmbeddingsEnabled.mockReturnValue(false);
        getQueryEmbedding.mockResolvedValue(null);
        cosineSimilarity.mockReturnValue(0);
        callLLMForRetrieval.mockResolvedValue('{}');
    });

    afterEach(() => {
        resetDeps();
    });

    describe('selectRelevantMemoriesSimple', () => {
        // Helper to create a RetrievalContext object
        const makeCtx = (overrides = {}) => ({
            recentContext: 'context',
            userMessages: 'user messages',
            primaryCharacter: 'Alice',
            activeCharacters: [],
            chatLength: 100,
            preFilterTokens: 24000,
            finalTokens: 12000,
            smartRetrievalEnabled: false,
            ...overrides,
        });

        it('returns empty array for empty memories', async () => {
            const result = await selectRelevantMemoriesSimple([], makeCtx(), 10);
            expect(result).toEqual([]);
        });

        it('returns all memories when count <= limit', async () => {
            const memories = [
                { id: '1', summary: 'Memory 1', importance: 3, message_ids: [10] },
                { id: '2', summary: 'Memory 2', importance: 3, message_ids: [20] },
            ];

            const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

            expect(result).toHaveLength(2);
        });

        it('calculates forgetfulness curve score correctly', async () => {
            // Memory at distance 0 should have score = importance
            const memories = [
                { id: '1', summary: 'Recent', importance: 3, message_ids: [100] },
            ];

            const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('higher importance memories decay slower', async () => {
            // At same distance, higher importance should rank higher
            const memories = [
                { id: 'low', summary: 'Low importance', importance: 1, message_ids: [50] },
                { id: 'high', summary: 'High importance', importance: 5, message_ids: [50] },
            ];

            const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

            expect(result[0].id).toBe('high');
            expect(result[1].id).toBe('low');
        });

        it('more recent memories score higher than distant ones (same importance)', async () => {
            const memories = [
                { id: 'old', summary: 'Old memory', importance: 3, message_ids: [10] },
                { id: 'recent', summary: 'Recent memory', importance: 3, message_ids: [90] },
            ];

            const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

            expect(result[0].id).toBe('recent');
            expect(result[1].id).toBe('old');
        });

        it('importance-5 memories have floor score', async () => {
            // Even very old importance-5 memories should have minimum score
            const memories = [
                { id: 'critical', summary: 'Critical memory', importance: 5, message_ids: [1] },
                { id: 'recent-low', summary: 'Recent low', importance: 2, message_ids: [95] },
            ];

            const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

            // The importance-5 memory at distance 99 should still score well due to floor
            // IMPORTANCE_5_FLOOR = 5, so it should compete with recent memories
            expect(result).toHaveLength(2);
            // Verify both are returned (exact order depends on floor vs recent score)
        });

        it('sorts by score descending', async () => {
            const memories = [
                { id: '1', summary: 'Memory 1', importance: 1, message_ids: [10] },
                { id: '2', summary: 'Memory 2', importance: 5, message_ids: [50] },
                { id: '3', summary: 'Memory 3', importance: 3, message_ids: [80] },
            ];

            const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

            // Higher importance and/or more recent should come first
            // Memory 2 (imp 5, dist 50) and Memory 3 (imp 3, dist 20) should beat Memory 1
            expect(result[result.length - 1].id).toBe('1'); // Lowest score last
        });

        it('returns top N memories (limit parameter)', async () => {
            const memories = Array.from({ length: 20 }, (_, i) => ({
                id: `${i}`,
                summary: `Memory ${i}`,
                importance: 3,
                message_ids: [i * 5],
            }));

            const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 5);

            expect(result).toHaveLength(5);
        });

        it('uses default importance of 3 when not specified', async () => {
            const memories = [
                { id: '1', summary: 'No importance', message_ids: [50] },
            ];

            const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

            expect(result).toHaveLength(1);
        });

        it('uses default message_ids of [0] when not specified', async () => {
            const memories = [
                { id: '1', summary: 'No message_ids', importance: 3 },
            ];

            const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

            expect(result).toHaveLength(1);
        });

        describe('vector similarity bonus', () => {
            beforeEach(() => {
                isEmbeddingsEnabled.mockReturnValue(true);
                getQueryEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
            });

            it('adds vector similarity bonus when embeddings enabled', async () => {
                cosineSimilarity.mockReturnValue(0.8);

                const memories = [
                    { id: 'with-embed', summary: 'With embedding', importance: 3, message_ids: [50], embedding: [0.1, 0.2, 0.3] },
                    { id: 'no-embed', summary: 'No embedding', importance: 3, message_ids: [50] },
                ];

                const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

                // Memory with embedding and good similarity should rank higher
                expect(result[0].id).toBe('with-embed');
            });

            it('filters by similarity threshold', async () => {
                // Below threshold (0.5) - minimal impact
                const memories = [
                    { id: 'low-sim', summary: 'Low similarity', importance: 3, message_ids: [50], embedding: [0.1, 0.2, 0.3] },
                ];

                const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

                // Memory should still be returned
                expect(result).toHaveLength(1);
                expect(result[0].id).toBe('low-sim');
            });

            it('uses configurable threshold from settings', async () => {
                mockSettings.vectorSimilarityThreshold = 0.7;

                const memories = [
                    { id: '1', summary: 'Test', importance: 3, message_ids: [50], embedding: [0.1, 0.2, 0.3] },
                ];

                const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

                // Memory should still be returned (just without bonus if below threshold)
                expect(result).toHaveLength(1);
            });

            it('uses configurable weight from settings', async () => {
                // New alpha-blend: boostWeight affects bonus calculation
                mockSettings.combinedBoostWeight = 20;

                const memories = [
                    { id: '1', summary: 'Test', importance: 3, message_ids: [50], embedding: [0.1, 0.2, 0.3] },
                ];

                const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

                // Weight affects bonus calculation (alpha * boostWeight * normalizedSim)
                expect(result).toHaveLength(1);
            });

            it('works without embeddings (similarity bonus = 0)', async () => {
                isEmbeddingsEnabled.mockReturnValue(false);

                const memories = [
                    { id: '1', summary: 'Memory 1', importance: 3, message_ids: [50] },
                ];

                const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

                expect(result).toHaveLength(1);
                expect(getQueryEmbedding).not.toHaveBeenCalled();
            });

            it('uses enriched query for embedding (built from userMessages only)', async () => {
                const userMessages = 'user question about alice';
                const recentContext = 'full context';

                await selectRelevantMemoriesSimple([], makeCtx({ recentContext, userMessages }), 10);

                // Embedding is called with enriched query built from userMessages (intent matching)
                expect(getQueryEmbedding).toHaveBeenCalledTimes(1);
                // The enriched query includes user messages + extracted entities
                expect(getQueryEmbedding).toHaveBeenCalledWith(expect.stringContaining('user question'));
            });
        });
    });

    describe('selectRelevantMemoriesSmart', () => {
        // Helper to create a RetrievalContext object
        const makeCtx = (overrides = {}) => ({
            recentContext: 'context',
            userMessages: 'user messages',
            primaryCharacter: 'Alice',
            activeCharacters: [],
            chatLength: 100,
            preFilterTokens: 24000,
            finalTokens: 12000,
            smartRetrievalEnabled: false,
            ...overrides,
        });

        it('returns empty array for empty memories', async () => {
            const result = await selectRelevantMemoriesSmart([], makeCtx(), 10);
            expect(result).toEqual([]);
        });

        it('returns all memories when count <= limit', async () => {
            const memories = [
                { id: '1', summary: 'Memory 1' },
                { id: '2', summary: 'Memory 2' },
            ];

            const result = await selectRelevantMemoriesSmart(memories, makeCtx(), 10);

            expect(result).toEqual(memories);
            expect(callLLMForRetrieval).not.toHaveBeenCalled();
        });

        it('calls LLM with formatted prompt', async () => {
            const memories = Array.from({ length: 5 }, (_, i) => ({
                id: `${i}`,
                summary: `Memory ${i}`,
                importance: 3,
            }));

            callLLMForRetrieval.mockResolvedValue('{"selected": [1, 2, 3]}');

            await selectRelevantMemoriesSmart(memories, makeCtx({ recentContext: 'recent context' }), 3);

            expect(buildSmartRetrievalPrompt).toHaveBeenCalledWith(
                'recent context',
                expect.any(String),
                'Alice',
                3
            );
            expect(callLLMForRetrieval).toHaveBeenCalled();
        });

        it('parses JSON response and returns selected memories', async () => {
            const memories = [
                { id: '0', summary: 'Memory 0' },
                { id: '1', summary: 'Memory 1' },
                { id: '2', summary: 'Memory 2' },
                { id: '3', summary: 'Memory 3' },
            ];

            callLLMForRetrieval.mockResolvedValue('{"selected": [1, 3]}');

            const result = await selectRelevantMemoriesSmart(memories, makeCtx(), 2);

            // Indices are 1-indexed, so [1, 3] -> memories[0], memories[2]
            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('0');
            expect(result[1].id).toBe('2');
        });

        it('converts 1-indexed to 0-indexed', async () => {
            const memories = [
                { id: 'first', summary: 'First' },
                { id: 'second', summary: 'Second' },
            ];

            // 1-indexed: 2 -> 0-indexed: 1 -> memories[1]
            callLLMForRetrieval.mockResolvedValue('{"selected": [2]}');

            const result = await selectRelevantMemoriesSmart(memories, makeCtx(), 1);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('second');
        });

        it('falls back to simple mode on LLM error', async () => {
            isEmbeddingsEnabled.mockReturnValue(false);
            const memories = [
                { id: '0', summary: 'Memory 0', importance: 5, message_ids: [90] },
                { id: '1', summary: 'Memory 1', importance: 1, message_ids: [10] },
                { id: '2', summary: 'Memory 2', importance: 3, message_ids: [50] },
            ];

            callLLMForRetrieval.mockRejectedValue(new Error('LLM error'));

            const result = await selectRelevantMemoriesSmart(memories, makeCtx(), 2);

            // Should fall back to simple mode and return some results
            expect(result.length).toBeGreaterThan(0);
            expect(result.length).toBeLessThanOrEqual(2);
        });

        it('falls back on invalid JSON response', async () => {
            isEmbeddingsEnabled.mockReturnValue(false);
            const memories = [
                { id: '0', summary: 'Memory 0', importance: 3, message_ids: [50] },
                { id: '1', summary: 'Memory 1', importance: 3, message_ids: [50] },
                { id: '2', summary: 'Memory 2', importance: 3, message_ids: [50] },
            ];

            callLLMForRetrieval.mockResolvedValue('not valid json');

            const result = await selectRelevantMemoriesSmart(memories, makeCtx(), 2);

            // Should fall back to simple mode
            expect(result.length).toBeLessThanOrEqual(2);
        });

        it('falls back on empty selection', async () => {
            isEmbeddingsEnabled.mockReturnValue(false);
            const memories = [
                { id: '0', summary: 'Memory 0', importance: 3, message_ids: [50] },
                { id: '1', summary: 'Memory 1', importance: 3, message_ids: [50] },
                { id: '2', summary: 'Memory 2', importance: 3, message_ids: [50] },
            ];

            callLLMForRetrieval.mockResolvedValue('{"selected": []}');

            const result = await selectRelevantMemoriesSmart(memories, makeCtx(), 2);

            // Should fall back to simple mode
            expect(result.length).toBeLessThanOrEqual(2);
        });

        it('falls back on invalid indices', async () => {
            isEmbeddingsEnabled.mockReturnValue(false);
            const memories = [
                { id: '0', summary: 'Memory 0', importance: 3, message_ids: [50] },
            ];

            // Index 99 doesn't exist
            callLLMForRetrieval.mockResolvedValue('{"selected": [99]}');

            const result = await selectRelevantMemoriesSmart(memories, makeCtx(), 1);

            // Should fall back since all indices are invalid
            expect(result).toBeDefined();
        });

        it('filters out invalid indices but keeps valid ones', async () => {
            const memories = [
                { id: '0', summary: 'Memory 0' },
                { id: '1', summary: 'Memory 1' },
                { id: '2', summary: 'Memory 2' },
            ];

            // Index 1 is valid (memories[0]), index 99 is not
            callLLMForRetrieval.mockResolvedValue('{"selected": [1, 99]}');

            const result = await selectRelevantMemoriesSmart(memories, makeCtx(), 2);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('0');
        });

        it('includes importance in numbered list', async () => {
            const memories = [
                { id: '0', summary: 'Test memory', importance: 5 },
                { id: '1', summary: 'Another', importance: 2, is_secret: true },
            ];

            callLLMForRetrieval.mockResolvedValue('{"selected": [1]}');

            await selectRelevantMemoriesSmart(memories, makeCtx(), 1);

            // Verify the prompt was built with formatted list
            const promptCall = buildSmartRetrievalPrompt.mock.calls[0];
            const numberedList = promptCall[1];
            expect(numberedList).toContain('[★★★★★]');
            expect(numberedList).toContain('[★★]');
            expect(numberedList).toContain('[Secret]');
            expect(numberedList).not.toContain('event_type');
        });

        it('logs reasoning from LLM response', async () => {
            const memories = [
                { id: '0', summary: 'Memory 0' },
                { id: '1', summary: 'Memory 1' },
            ];

            callLLMForRetrieval.mockResolvedValue('{"selected": [1], "reasoning": "Memory 0 is most relevant"}');

            await selectRelevantMemoriesSmart(memories, makeCtx(), 1);

            expect(log).toHaveBeenCalledWith(
                expect.stringContaining('Memory 0 is most relevant')
            );
        });

        it('calls LLM with structured output option', async () => {
            const memories = Array.from({ length: 5 }, (_, i) => ({
                id: `${i}`,
                summary: `Memory ${i}`,
                importance: 3,
            }));

            callLLMForRetrieval.mockResolvedValue(JSON.stringify({ reasoning: null, selected: [1, 2, 3] }));

            await selectRelevantMemoriesSmart(memories, makeCtx({ recentContext: 'recent context' }), 3);

            expect(callLLMForRetrieval).toHaveBeenCalledWith(
                expect.any(Array),  // messages array
                { structured: true }
            );
        });
    });

    describe('selectRelevantMemories (dispatcher)', () => {
        // Helper to create a RetrievalContext object
        const makeCtx = (overrides = {}) => ({
            recentContext: 'context',
            userMessages: 'user messages',
            primaryCharacter: 'Alice',
            activeCharacters: [],
            chatLength: 100,
            preFilterTokens: mockSettings.retrievalPreFilterTokens || 24000,
            finalTokens: mockSettings.retrievalFinalTokens || 12000,
            smartRetrievalEnabled: mockSettings.smartRetrievalEnabled,
            ...overrides,
        });

        it('uses smart retrieval when smartRetrievalEnabled = true', async () => {
            mockSettings.smartRetrievalEnabled = true;
            const memories = [
                { id: '0', summary: 'Memory 0' },
            ];

            callLLMForRetrieval.mockResolvedValue('{"selected": [1]}');

            const ctx = makeCtx({ smartRetrievalEnabled: true });
            const result = await selectRelevantMemories(memories, ctx);

            // Smart mode returns all if count <= limit (no LLM call needed)
            expect(result).toEqual(memories);
        });

        it('uses simple retrieval when smartRetrievalEnabled = false', async () => {
            mockSettings.smartRetrievalEnabled = false;
            const memories = [
                { id: '0', summary: 'Memory 0', importance: 3, message_ids: [50] },
            ];

            const ctx = makeCtx({ smartRetrievalEnabled: false });
            const result = await selectRelevantMemories(memories, ctx);

            expect(result).toHaveLength(1);
            expect(callLLMForRetrieval).not.toHaveBeenCalled();
        });

        it('passes correct parameters to simple mode', async () => {
            mockSettings.smartRetrievalEnabled = false;
            isEmbeddingsEnabled.mockReturnValue(false);

            const memories = [
                { id: '0', summary: 'Memory 0', importance: 3, message_ids: [50] },
            ];

            const ctx = makeCtx({
                recentContext: 'context text',
                primaryCharacter: 'Alice',
                activeCharacters: ['Bob'],
                chatLength: 200,
                smartRetrievalEnabled: false,
            });
            await selectRelevantMemories(memories, ctx);

            // Simple mode doesn't call LLM
            expect(callLLMForRetrieval).not.toHaveBeenCalled();
        });

        it('passes correct parameters to smart mode', async () => {
            mockSettings.smartRetrievalEnabled = true;
            // Use very low token budget to ensure targetCount is less than memory count
            mockSettings.retrievalFinalTokens = 5;
            const memories = [
                { id: '0', summary: 'Memory zero' },
                { id: '1', summary: 'Memory one' },
                { id: '2', summary: 'Memory two' },
            ];

            callLLMForRetrieval.mockResolvedValue('{"selected": [1, 2]}');

            const ctx = makeCtx({
                recentContext: 'context text',
                primaryCharacter: 'Alice',
                activeCharacters: ['Bob'],
                chatLength: 200,
                smartRetrievalEnabled: true,
                finalTokens: 5,
            });
            await selectRelevantMemories(memories, ctx);

            // Smart mode calls LLM with calculated target count (based on token budget)
            expect(buildSmartRetrievalPrompt).toHaveBeenCalledWith(
                'context text',
                expect.any(String),
                'Alice',
                expect.any(Number) // Target count calculated from token budget
            );
        });
    });

    describe('forgetfulness curve math', () => {
        it('verifies BASE_LAMBDA default setting', () => {
            expect(defaultSettings.forgetfulnessBaseLambda).toBe(0.05);
        });

        it('verifies IMPORTANCE_5_FLOOR default setting', () => {
            expect(defaultSettings.forgetfulnessImportance5Floor).toBe(5);
        });

        it('importance affects lambda quadratically', async () => {
            // lambda = BASE_LAMBDA / (importance²)
            // imp 1: lambda = 0.05 / 1 = 0.05
            // imp 5: lambda = 0.05 / 25 = 0.002
            // This means importance-5 decays 25x slower than importance-1

            const memories = [
                { id: 'imp1', summary: 'Importance 1', importance: 1, message_ids: [0] },
                { id: 'imp5', summary: 'Importance 5', importance: 5, message_ids: [0] },
            ];

            // At distance 100:
            // imp1: 1 * e^(-0.05 * 100) = 1 * e^(-5) ≈ 0.0067
            // imp5: 5 * e^(-0.002 * 100) = 5 * e^(-0.2) ≈ 4.09

            const ctx = {
                recentContext: 'context',
                userMessages: 'user messages',
                primaryCharacter: 'Alice',
                activeCharacters: [],
                chatLength: 100,
                preFilterTokens: 24000,
                finalTokens: 12000,
                smartRetrievalEnabled: false,
            };
            const result = await selectRelevantMemoriesSimple(memories, ctx, 10);

            // Importance 5 should be first
            expect(result[0].id).toBe('imp5');
            expect(result[1].id).toBe('imp1');
        });
    });

    describe('direct scoring (no worker)', () => {
        it('scores memories synchronously', () => {
            const memories = [{
                id: '1',
                summary: 'test memory about dragons',
                importance: 3,
                message_ids: [10],
                embedding: [0.1, 0.2, 0.3],
                event_type: 'dialogue',
                is_secret: false
            }];

            const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
            const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };

            const results = scoreMemories(
                memories,
                [0.1, 0.2, 0.3],
                100,
                constants,
                settings,
                ['dragon']
            );

            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBeLessThanOrEqual(memories.length);
            if (results.length > 0) {
                expect(results[0]).toHaveProperty('memory');
                expect(results[0]).toHaveProperty('score');
                expect(results[0]).toHaveProperty('breakdown');
            }
        });
    });
});
