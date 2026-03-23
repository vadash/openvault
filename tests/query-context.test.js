/**
 * Tests for src/retrieval/query-context.js
 */
import { describe, expect, it, vi } from 'vitest';

// Mock getOptimalChunkSize — embeddings.js still calls getDeps internally
vi.mock('../src/embeddings.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, getOptimalChunkSize: () => 500 };
});

// Import after mocks
import {
    buildBM25Tokens,
    buildEmbeddingQuery,
    extractQueryContext,
    parseRecentMessages,
} from '../src/retrieval/query-context.js';

describe('query-context', () => {
    const queryConfig = {
        entityWindowSize: 10,
        embeddingWindowSize: 5,
        recencyDecayFactor: 0.09,
        topEntitiesCount: 5,
        entityBoostWeight: 5.0,
    };

    describe('extractQueryContext — graph-anchored', () => {
        describe('entity detection from graph nodes', () => {
            it('detects graph entity names in messages', () => {
                const messages = [
                    { mes: 'Sarah went to the Cabin with Marcus' },
                    { mes: 'They talked for hours.' },
                    { mes: 'Nothing else happened.' },
                ];
                const graphNodes = {
                    sarah: { name: 'Sarah', type: 'PERSON' },
                    cabin: { name: 'Cabin', type: 'PLACE' },
                    marcus: { name: 'Marcus', type: 'PERSON' },
                };
                const result = extractQueryContext(messages, [], graphNodes, queryConfig);
                expect(result.entities).toContain('Sarah');
                expect(result.entities).toContain('Cabin');
                expect(result.entities).toContain('Marcus');
            });

            it('does NOT detect words that are not in graph', () => {
                const messages = [
                    { mes: 'Запомни это. Держись крепче. The weather is nice.' },
                    { mes: 'Another message.' },
                    { mes: 'One more.' },
                ];
                const graphNodes = {
                    sarah: { name: 'Sarah', type: 'PERSON' },
                };
                const result = extractQueryContext(messages, [], graphNodes, queryConfig);
                expect(result.entities).not.toContain('Запомни');
                expect(result.entities).not.toContain('Держись');
                expect(result.entities).not.toContain('The');
            });

            it('matches Russian inflectional forms via stemming', () => {
                const messages = [{ mes: 'Подошла к Елену и сказала' }, { mes: 'Потом ушла.' }, { mes: 'Вернулась.' }];
                const graphNodes = {
                    елена: { name: 'Елена', type: 'PERSON' },
                };
                const result = extractQueryContext(messages, [], graphNodes, queryConfig);
                expect(result.entities).toContain('Елена');
            });

            it('matches aliases from merged entities', () => {
                const messages = [
                    { mes: 'Lily came into the room.' },
                    { mes: 'She sat down.' },
                    { mes: 'Nothing else.' },
                ];
                const graphNodes = {
                    vova: { name: 'Vova', type: 'PERSON', aliases: ['Vova (aka Lily)'] },
                };
                const result = extractQueryContext(messages, [], graphNodes, queryConfig);
                expect(result.entities).toContain('Vova');
            });
        });

        describe('active characters', () => {
            it('boosts known character names even without graph', () => {
                const messages = [
                    { mes: 'Someone mentioned the cabin.' },
                    { mes: 'It was quiet outside.' },
                    { mes: 'Nothing else happened.' },
                ];
                const result = extractQueryContext(messages, ['Elena', 'Viktor'], {}, queryConfig);
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
                    { mes: 'Charlie arrived.' },
                ];
                const graphNodes = {
                    alice: { name: 'Alice', type: 'PERSON' },
                    bob: { name: 'Bob', type: 'PERSON' },
                    charlie: { name: 'Charlie', type: 'PERSON' },
                };
                const result = extractQueryContext(messages, [], graphNodes, queryConfig);
                expect(result.entities).not.toContain('Alice');
                expect(result.entities).toContain('Bob');
                expect(result.entities).toContain('Charlie');
            });
        });

        describe('recency weighting', () => {
            it('weights recent messages higher', () => {
                const messages = [
                    { mes: 'Marcus arrived at the door.' },
                    { mes: 'Sarah left earlier.' },
                    { mes: 'Bob was there too.' },
                    { mes: 'Charlie came by.' },
                    { mes: 'Marcus spoke first.' },
                ];
                const graphNodes = {
                    marcus: { name: 'Marcus', type: 'PERSON' },
                    sarah: { name: 'Sarah', type: 'PERSON' },
                    bob: { name: 'Bob', type: 'PERSON' },
                    charlie: { name: 'Charlie', type: 'PERSON' },
                };
                const result = extractQueryContext(messages, [], graphNodes, queryConfig);
                expect(result.weights.Marcus).toBeGreaterThan(result.weights.Sarah);
            });
        });

        describe('edge cases', () => {
            it('returns empty for null messages', () => {
                const result = extractQueryContext(null, [], {}, queryConfig);
                expect(result.entities).toEqual([]);
                expect(result.weights).toEqual({});
            });

            it('returns empty for empty array', () => {
                const result = extractQueryContext([], [], {}, queryConfig);
                expect(result.entities).toEqual([]);
                expect(result.weights).toEqual({});
            });

            it('handles empty graph gracefully', () => {
                const messages = [
                    { mes: 'just lowercase text here' },
                    { mes: 'more words' },
                    { mes: 'nothing special' },
                ];
                const result = extractQueryContext(messages, [], {}, queryConfig);
                expect(result.entities).toEqual([]);
            });
        });
    });

    describe('buildEmbeddingQuery', () => {
        it('concatenates messages without duplication', () => {
            const messages = [{ mes: 'newest message' }, { mes: 'second message' }, { mes: 'third message' }];
            const entities = { entities: [], weights: {} };
            const query = buildEmbeddingQuery(messages, entities, queryConfig);

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
                weights: { Alice: 2.0, Cabin: 1.5, Secret: 1.0 },
            };
            const query = buildEmbeddingQuery(messages, entities, queryConfig);

            expect(query).toContain('Alice');
            expect(query).toContain('Cabin');
            expect(query).toContain('Secret');
        });

        it('respects chunk size limit', () => {
            const longMessage = 'word '.repeat(500);
            const messages = [{ mes: longMessage }, { mes: longMessage }, { mes: longMessage }];
            const entities = { entities: ['Entity'], weights: { Entity: 1 } };
            const query = buildEmbeddingQuery(messages, entities, queryConfig);

            // Should be capped at optimal chunk size (500 in mock)
            expect(query.length).toBeLessThanOrEqual(500);
        });

        it('handles empty messages', () => {
            const query = buildEmbeddingQuery([], { entities: [], weights: {} }, queryConfig);
            expect(query).toBe('');
        });

        it('handles null entities', () => {
            const messages = [{ mes: 'some text' }];
            const query = buildEmbeddingQuery(messages, null, queryConfig);
            expect(query).toContain('some text');
        });
    });

    describe('buildBM25Tokens', () => {
        it('filters post-stem runt tokens (< 3 chars after stemming)', () => {
            // "боюсь" (5 chars) stems to "бо" (2 chars) via Russian Snowball
            const tokens = buildBM25Tokens('боюсь страшно', null, null, null, queryConfig);
            // "бо" should be filtered out, "страшн" (stem of страшно) should remain
            for (const t of tokens) {
                expect(t.length).toBeGreaterThanOrEqual(3);
            }
        });

        it('includes original user message tokens (stemmed)', () => {
            const userMessage = 'Where is Alice now?';
            const entities = { entities: [], weights: {} };
            const tokens = buildBM25Tokens(userMessage, entities, null, null, queryConfig);

            expect(tokens).toContain('alic'); // 'alice' stemmed by English Snowball
            // 'where' and 'is' are stop words, should be filtered
            expect(tokens).not.toContain('where');
            expect(tokens).not.toContain('is');
        });

        it('boosts entities by repeating them', () => {
            const userMessage = 'hello';
            const entities = {
                entities: ['Sasha'],
                weights: { Sasha: 2.0 },
            };
            const tokens = buildBM25Tokens(userMessage, entities, null, null, queryConfig);

            // Weight 2.0 * default boost 5.0 = 10.0, ceil = 10 repeats
            const sashaCount = tokens.filter((t) => t === 'sasha').length;
            expect(sashaCount).toBe(10);
        });

        it('handles empty user message', () => {
            const entities = {
                entities: ['Alice'],
                weights: { Alice: 1.5 },
            };
            const tokens = buildBM25Tokens('', entities, null, null, queryConfig);

            // Should still have entity tokens (stemmed)
            expect(tokens).toContain('alic'); // 'Alice' stemmed
        });

        it('handles null entities', () => {
            const tokens = buildBM25Tokens('test query', null, null, null, queryConfig);
            expect(tokens).toContain('test');
            expect(tokens).toContain('queri'); // 'query' stemmed by English Snowball
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
