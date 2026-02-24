/**
 * Tests for src/retrieval/query-context.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import { extensionName, defaultSettings, QUERY_CONTEXT_DEFAULTS } from '../src/constants.js';

// Mock getOptimalChunkSize
vi.mock('../src/embeddings/strategies.js', () => ({
    getOptimalChunkSize: () => 500
}));

// Import after mocks
import {
    extractQueryContext,
    buildEmbeddingQuery,
    buildBM25Tokens,
    parseRecentMessages
} from '../src/retrieval/query-context.js';

describe('query-context', () => {
    beforeEach(() => {
        setDeps({
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings }
            }),
            saveSettingsDebounced: vi.fn(),
        });
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    describe('extractQueryContext', () => {
        describe('entity extraction', () => {
            it('extracts Latin capitalized names', () => {
                // Use multiple messages so frequency filter doesn't eliminate entities
                const messages = [
                    { mes: 'Sarah went to the Cabin with Marcus' },
                    { mes: 'They talked for hours.' },
                    { mes: 'It was a good day.' }
                ];
                const result = extractQueryContext(messages);

                expect(result.entities).toContain('Sarah');
                expect(result.entities).toContain('Cabin');
                expect(result.entities).toContain('Marcus');
            });

            it('extracts Cyrillic names', () => {
                const messages = [
                    { mes: 'Саша пошла в Москву' },
                    { mes: 'Там было хорошо.' },
                    { mes: 'Она вернулась домой.' }
                ];
                const result = extractQueryContext(messages);

                expect(result.entities).toContain('Саша');
                expect(result.entities).toContain('Москву');
            });

            it('filters common Latin sentence starters', () => {
                const messages = [
                    { mes: 'The quick fox. Then Sarah arrived. This is a test.' },
                    { mes: 'Another message here.' },
                    { mes: 'And one more.' }
                ];
                const result = extractQueryContext(messages);

                expect(result.entities).not.toContain('The');
                expect(result.entities).not.toContain('Then');
                expect(result.entities).not.toContain('This');
                expect(result.entities).toContain('Sarah');
            });

            it('filters common Cyrillic sentence starters', () => {
                const messages = [
                    { mes: 'После обеда Саша ушла. Когда она вернулась...' },
                    { mes: 'Она была рада.' },
                    { mes: 'Все было хорошо.' }
                ];
                const result = extractQueryContext(messages);

                expect(result.entities).not.toContain('После');
                expect(result.entities).not.toContain('Когда');
                expect(result.entities).toContain('Саша');
            });

            it('requires minimum 3 characters', () => {
                const messages = [
                    { mes: 'Mr Jo went home. Sarah stayed.' },
                    { mes: 'It was late.' },
                    { mes: 'Time to sleep.' }
                ];
                const result = extractQueryContext(messages);

                expect(result.entities).not.toContain('Mr');
                expect(result.entities).not.toContain('Jo');
                expect(result.entities).toContain('Sarah');
            });
        });

        describe('recency weighting', () => {
            it('weights recent messages higher', () => {
                const messages = [
                    { mes: 'Marcus arrived at the door.' },    // newest, index 0
                    { mes: 'Sarah left earlier.' },            // middle, index 1
                    { mes: 'Bob was there too.' },             // index 2
                    { mes: 'Charlie came by.' },               // index 3
                    { mes: 'Marcus spoke first.' }             // oldest, index 4
                ];
                const result = extractQueryContext(messages);

                // Marcus appears in newest (weight 1.0) and oldest (weight ~0.64)
                // Sarah appears only in index 1 (weight ~0.91)
                // Marcus should have higher total weight
                expect(result.weights['Marcus']).toBeGreaterThan(result.weights['Sarah']);
            });

            it('returns top entities sorted by weight', () => {
                const messages = [
                    { mes: 'Alice talked to Bob. Alice smiled.' },  // Alice 2x, Bob 1x
                    { mes: 'Charlie arrived at noon.' },            // Charlie 1x
                    { mes: 'David waved hello.' },                  // David 1x
                    { mes: 'Alice left the room.' },                // Alice 1x
                    { mes: 'Everyone said goodbye.' }               // no entities
                ];
                const result = extractQueryContext(messages);

                // Alice appears 3 times across 2 messages (40%), should be first
                expect(result.entities[0]).toBe('Alice');
            });
        });

        describe('active characters', () => {
            it('boosts known character names', () => {
                const messages = [
                    { mes: 'Someone mentioned the cabin.' },
                    { mes: 'It was quiet outside.' },
                    { mes: 'Nothing else happened.' }
                ];
                const activeCharacters = ['Elena', 'Viktor'];
                const result = extractQueryContext(messages, activeCharacters);

                // Active characters get boosted even if not in messages
                expect(result.entities).toContain('Elena');
                expect(result.entities).toContain('Viktor');
            });
        });

        describe('frequency filtering', () => {
            it('filters entities appearing in >50% of messages', () => {
                const messages = [
                    { mes: 'Alice and Bob talked.' },
                    { mes: 'Alice went home.' },
                    { mes: 'Alice came back.' },
                    { mes: 'Charlie arrived.' }
                ];
                const result = extractQueryContext(messages);

                // Alice appears in 3/4 (75%) messages, should be filtered
                expect(result.entities).not.toContain('Alice');
                // Bob and Charlie appear in fewer messages
                expect(result.entities).toContain('Bob');
                expect(result.entities).toContain('Charlie');
            });
        });

        describe('edge cases', () => {
            it('returns empty for null messages', () => {
                const result = extractQueryContext(null);
                expect(result.entities).toEqual([]);
                expect(result.weights).toEqual({});
            });

            it('returns empty for empty array', () => {
                const result = extractQueryContext([]);
                expect(result.entities).toEqual([]);
                expect(result.weights).toEqual({});
            });

            it('handles messages with no entities', () => {
                const messages = [
                    { mes: 'just lowercase text here' },
                    { mes: 'more lowercase words' },
                    { mes: 'nothing special' }
                ];
                const result = extractQueryContext(messages);
                expect(result.entities).toEqual([]);
            });
        });
    });

    describe('buildEmbeddingQuery', () => {
        it('concatenates messages without duplication', () => {
            const messages = [
                { mes: 'newest message' },
                { mes: 'second message' },
                { mes: 'third message' }
            ];
            const entities = { entities: [], weights: {} };
            const query = buildEmbeddingQuery(messages, entities);

            // Messages should appear once each, in order
            expect(query).toContain('newest message');
            expect(query).toContain('second message');
            expect(query).toContain('third message');
            const newestCount = (query.match(/newest message/g) || []).length;
            expect(newestCount).toBe(1);
        });

        it('appends top entities', () => {
            const messages = [{ mes: 'some context' }];
            const entities = {
                entities: ['Alice', 'Cabin', 'Secret'],
                weights: { Alice: 2.0, Cabin: 1.5, Secret: 1.0 }
            };
            const query = buildEmbeddingQuery(messages, entities);

            expect(query).toContain('Alice');
            expect(query).toContain('Cabin');
            expect(query).toContain('Secret');
        });

        it('respects chunk size limit', () => {
            const longMessage = 'word '.repeat(500);
            const messages = [
                { mes: longMessage },
                { mes: longMessage },
                { mes: longMessage }
            ];
            const entities = { entities: ['Entity'], weights: { Entity: 1 } };
            const query = buildEmbeddingQuery(messages, entities);

            // Should be capped at optimal chunk size (500 in mock)
            expect(query.length).toBeLessThanOrEqual(500);
        });

        it('handles empty messages', () => {
            const query = buildEmbeddingQuery([], { entities: [], weights: {} });
            expect(query).toBe('');
        });

        it('handles null entities', () => {
            const messages = [{ mes: 'some text' }];
            const query = buildEmbeddingQuery(messages, null);
            expect(query).toContain('some text');
        });
    });

    describe('buildBM25Tokens', () => {
        it('filters post-stem runt tokens (< 3 chars after stemming)', () => {
            // "боюсь" (5 chars) stems to "бо" (2 chars) via Russian Snowball
            const tokens = buildBM25Tokens('боюсь страшно', null);
            // "бо" should be filtered out, "страшн" (stem of страшно) should remain
            for (const t of tokens) {
                expect(t.length).toBeGreaterThanOrEqual(3);
            }
        });

        it('includes original user message tokens (stemmed)', () => {
            const userMessage = 'Where is Alice now?';
            const entities = { entities: [], weights: {} };
            const tokens = buildBM25Tokens(userMessage, entities);

            expect(tokens).toContain('alic');  // 'alice' stemmed by English Snowball
            // 'where' and 'is' are stop words, should be filtered
            expect(tokens).not.toContain('where');
            expect(tokens).not.toContain('is');
        });

        it('boosts entities by repeating them', () => {
            const userMessage = 'hello';
            const entities = {
                entities: ['Sasha'],
                weights: { Sasha: 2.0 }
            };
            const tokens = buildBM25Tokens(userMessage, entities);

            // Weight 2.0 * default boost 5.0 = 10.0, ceil = 10 repeats
            const sashaCount = tokens.filter(t => t === 'sasha').length;
            expect(sashaCount).toBe(10);
        });

        it('handles empty user message', () => {
            const entities = {
                entities: ['Alice'],
                weights: { Alice: 1.5 }
            };
            const tokens = buildBM25Tokens('', entities);

            // Should still have entity tokens (stemmed)
            expect(tokens).toContain('alic');  // 'Alice' stemmed
        });

        it('handles null entities', () => {
            const tokens = buildBM25Tokens('test query', null);
            expect(tokens).toContain('test');
            expect(tokens).toContain('queri');  // 'query' stemmed by English Snowball
        });
    });

    describe('parseRecentMessages', () => {
        it('parses newline-separated context', () => {
            const context = 'First message\nSecond message\nThird message';
            const messages = parseRecentMessages(context, 10);

            expect(messages).toHaveLength(3);
            // Should be reversed (newest first)
            expect(messages[0].mes).toBe('Third message');
            expect(messages[2].mes).toBe('First message');
        });

        it('respects count limit', () => {
            const context = 'One\nTwo\nThree\nFour\nFive';
            const messages = parseRecentMessages(context, 3);

            // Should take last 3, then reverse
            expect(messages).toHaveLength(3);
            expect(messages[0].mes).toBe('Five');
            expect(messages[1].mes).toBe('Four');
            expect(messages[2].mes).toBe('Three');
        });

        it('filters empty lines', () => {
            const context = 'First\n\n\nSecond\n';
            const messages = parseRecentMessages(context);

            expect(messages).toHaveLength(2);
        });

        it('handles null context', () => {
            const messages = parseRecentMessages(null);
            expect(messages).toEqual([]);
        });

        it('handles empty string', () => {
            const messages = parseRecentMessages('');
            expect(messages).toEqual([]);
        });
    });
});
