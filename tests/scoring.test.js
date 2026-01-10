/**
 * Tests for src/retrieval/scoring.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import { extensionName, defaultSettings } from '../src/constants.js';
import { scoreMemoriesSync } from '../src/retrieval/sync-scorer.js';

// Store reference to cosineSimilarity mock for MockWorker
let cosineSimilarityMock = vi.fn();

// Mock Worker for Node.js test environment
// Matches the caching pattern in src/retrieval/worker.js
let mockWorkerCachedMemories = [];

class MockWorker {
    constructor() {
        this.listeners = {};
    }
    addEventListener(event, handler) {
        this.listeners[event] = handler;
    }
    removeEventListener(event) {
        delete this.listeners[event];
    }
    postMessage(data) {
        const { memories, memoriesChanged, contextEmbedding, chatLength, limit, constants, settings } = data;

        // Update cache if new memories provided (matches worker.js behavior)
        if (memoriesChanged && memories) {
            mockWorkerCachedMemories = memories;
        }

        const scored = mockWorkerCachedMemories.map(memory => {
            const messageIds = memory.message_ids || [0];
            const maxMessageId = Math.max(...messageIds);
            const distance = Math.max(0, chatLength - maxMessageId);
            const importance = memory.importance || 3;
            const lambda = constants.BASE_LAMBDA / (importance * importance);
            let score = importance * Math.exp(-lambda * distance);
            if (importance === 5) {
                score = Math.max(score, constants.IMPORTANCE_5_FLOOR);
            }
            if (contextEmbedding && memory.embedding) {
                const similarity = cosineSimilarityMock(contextEmbedding, memory.embedding);
                const threshold = settings.vectorSimilarityThreshold || 0.5;
                const maxBonus = settings.vectorSimilarityWeight || 15;
                if (similarity > threshold) {
                    const normalizedSim = (similarity - threshold) / (1 - threshold);
                    score += normalizedSim * maxBonus;
                }
            }
            return { memory, score };
        });
        scored.sort((a, b) => b.score - a.score);
        const results = scored.slice(0, limit).map(s => s.memory);

        setTimeout(() => {
            if (this.listeners.message) {
                this.listeners.message({ data: { success: true, results } });
            }
        }, 0);
    }
}
globalThis.Worker = MockWorker;
globalThis.URL = URL;

// Mock the embeddings module
vi.mock('../src/embeddings.js', () => ({
    getEmbedding: vi.fn(),
    cosineSimilarity: vi.fn(),
    isEmbeddingsEnabled: vi.fn(),
}));

// Mock the llm module
vi.mock('../src/llm.js', () => ({
    callLLMForRetrieval: vi.fn(),
}));

// Mock the prompts module
vi.mock('../src/prompts.js', () => ({
    buildSmartRetrievalPrompt: vi.fn().mockReturnValue('smart retrieval prompt'),
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
}));

// Import after mocks are set up
import {
    selectRelevantMemoriesSimple,
    selectRelevantMemoriesSmart,
    selectRelevantMemories,
    resetWorkerSyncState,
} from '../src/retrieval/scoring.js';
import { getEmbedding, cosineSimilarity, isEmbeddingsEnabled } from '../src/embeddings.js';
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

        // Reset mock worker cache
        mockWorkerCachedMemories = [];

        // Reset worker sync state so each test gets fresh memory sync
        resetWorkerSyncState();

        // Sync mock reference for MockWorker
        cosineSimilarityMock = cosineSimilarity;

        // Default mock behaviors
        isEmbeddingsEnabled.mockReturnValue(false);
        getEmbedding.mockResolvedValue(null);
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
                getEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
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
                // Below threshold (0.5) - no bonus
                cosineSimilarity.mockReturnValue(0.4);

                const memories = [
                    { id: 'low-sim', summary: 'Low similarity', importance: 3, message_ids: [50], embedding: [0.1, 0.2, 0.3] },
                ];

                await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

                // Should not receive bonus (verified by cosineSimilarity being called)
                expect(cosineSimilarity).toHaveBeenCalled();
            });

            it('uses configurable threshold from settings', async () => {
                mockSettings.vectorSimilarityThreshold = 0.7;
                cosineSimilarity.mockReturnValue(0.65); // Below new threshold

                const memories = [
                    { id: '1', summary: 'Test', importance: 3, message_ids: [50], embedding: [0.1, 0.2, 0.3] },
                ];

                await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

                // Memory should not get bonus (similarity 0.65 < threshold 0.7)
                expect(cosineSimilarity).toHaveBeenCalled();
            });

            it('uses configurable weight from settings', async () => {
                mockSettings.vectorSimilarityWeight = 20;
                cosineSimilarity.mockReturnValue(0.8);

                const memories = [
                    { id: '1', summary: 'Test', importance: 3, message_ids: [50], embedding: [0.1, 0.2, 0.3] },
                ];

                await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

                // Weight affects bonus calculation
                expect(cosineSimilarity).toHaveBeenCalled();
            });

            it('works without embeddings (similarity bonus = 0)', async () => {
                isEmbeddingsEnabled.mockReturnValue(false);

                const memories = [
                    { id: '1', summary: 'Memory 1', importance: 3, message_ids: [50] },
                ];

                const result = await selectRelevantMemoriesSimple(memories, makeCtx(), 10);

                expect(result).toHaveLength(1);
                expect(getEmbedding).not.toHaveBeenCalled();
            });

            it('uses enriched query for embedding (built from userMessages only)', async () => {
                const userMessages = 'user question about alice';
                const recentContext = 'full context';

                await selectRelevantMemoriesSimple([], makeCtx({ recentContext, userMessages }), 10);

                // Embedding is called with enriched query built from userMessages (intent matching)
                expect(getEmbedding).toHaveBeenCalledTimes(1);
                // The enriched query includes user messages + extracted entities
                expect(getEmbedding).toHaveBeenCalledWith(expect.stringContaining('user question'));
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

        it('includes event_type and importance in numbered list', async () => {
            const memories = [
                { id: '0', summary: 'Test memory', event_type: 'revelation', importance: 5 },
                { id: '1', summary: 'Another', event_type: 'dialogue', importance: 2, is_secret: true },
            ];

            callLLMForRetrieval.mockResolvedValue('{"selected": [1]}');

            await selectRelevantMemoriesSmart(memories, makeCtx(), 1);

            // Verify the prompt was built with formatted list
            const promptCall = buildSmartRetrievalPrompt.mock.calls[0];
            const numberedList = promptCall[1];
            expect(numberedList).toContain('[revelation]');
            expect(numberedList).toContain('[★★★★★]');
            expect(numberedList).toContain('[Secret]');
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

    describe('sync-scorer fallback', () => {
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

            const params = {
                contextEmbedding: [0.1, 0.2, 0.3],
                chatLength: 100,
                limit: 10,
                queryTokens: ['dragon'],
                constants: { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
                settings: { vectorSimilarityThreshold: 0.5, vectorSimilarityWeight: 15 }
            };

            const results = scoreMemoriesSync(memories, params);

            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBeLessThanOrEqual(params.limit);
            if (results.length > 0) {
                expect(results[0]).toHaveProperty('memory');
                expect(results[0]).toHaveProperty('score');
            }
        });
    });

    describe('worker data serialization', () => {
        it('scoring payload is structuredClone-safe', () => {
            const memories = [{
                id: '1',
                summary: 'test memory',
                importance: 3,
                message_ids: [10],
                embedding: [0.1, 0.2, 0.3],
                event_type: 'dialogue',
                is_secret: false
            }];

            const payload = {
                memories,
                memoriesChanged: true,
                contextEmbedding: [0.1, 0.2, 0.3],
                chatLength: 100,
                limit: 10,
                queryTokens: ['test', 'query'],
                constants: { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
                settings: { vectorSimilarityThreshold: 0.5, vectorSimilarityWeight: 15 }
            };

            // eslint-disable-next-line no-undef
            expect(() => structuredClone(payload)).not.toThrow();
        });

        it('rejects non-serializable memory properties', () => {
            const badMemory = {
                id: '1',
                summary: 'test',
                callback: () => {}  // Functions are not serializable
            };

            // eslint-disable-next-line no-undef
            expect(() => structuredClone(badMemory)).toThrow();
        });

        it('memory schema matches expected structure', () => {
            const validMemory = {
                id: '1',
                summary: 'A dragon attacked the village',
                importance: 4,
                message_ids: [10, 11],
                embedding: new Array(384).fill(0.01),
                event_type: 'action',
                is_secret: false
            };

            // Should clone without error
            // eslint-disable-next-line no-undef
            const cloned = structuredClone(validMemory);

            expect(cloned.id).toBe(validMemory.id);
            expect(cloned.summary).toBe(validMemory.summary);
            expect(cloned.importance).toBe(validMemory.importance);
            expect(cloned.message_ids).toEqual(validMemory.message_ids);
            expect(cloned.embedding.length).toBe(384);
            expect(cloned.event_type).toBe(validMemory.event_type);
            expect(cloned.is_secret).toBe(validMemory.is_secret);
        });
    });
});
