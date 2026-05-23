import { describe, expect, it } from 'vitest';
import { detectMacroIntent, retrieveWorldContext } from '../../src/retrieval/world-context.js';
import { buildMockGraphNode } from '../factories.js';

describe('retrieveWorldContext', () => {
    describe('entity-based local retrieval', () => {
        it('returns most relevant entities by cosine similarity', async () => {
            const graphData = {
                nodes: {
                    king: buildMockGraphNode({
                        name: 'King Aldric',
                        type: 'PERSON',
                        description: 'Rules the kingdom',
                        embedding_b64: encodeFloat32Array(new Float32Array([0.9, 0.1, 0.0])),
                    }),
                    castle: buildMockGraphNode({
                        name: 'Castle',
                        type: 'PLACE',
                        description: 'Royal fortress',
                        embedding_b64: encodeFloat32Array(new Float32Array([0.0, 0.1, 0.9])),
                    }),
                },
                edges: {},
            };
            const queryEmbedding = new Float32Array([0.8, 0.2, 0.0]); // Close to king
            const result = await retrieveWorldContext(graphData, null, '', queryEmbedding, 2000);

            expect(result.text).toContain('King Aldric');
            expect(result.text).toContain('PERSON');
            expect(result.entityKeys).toContain('king');
        });

        it('skips entities without embeddings', async () => {
            const graphData = {
                nodes: {
                    king: buildMockGraphNode({
                        name: 'King Aldric',
                        type: 'PERSON',
                        description: 'Rules the kingdom',
                        embedding_b64: encodeFloat32Array(new Float32Array([0.9, 0.1, 0.0])),
                    }),
                    castle: buildMockGraphNode({
                        name: 'Castle',
                        type: 'PLACE',
                        description: 'Royal fortress',
                        // No embedding
                    }),
                },
                edges: {},
            };
            const queryEmbedding = new Float32Array([0.8, 0.2, 0.0]);
            const result = await retrieveWorldContext(graphData, null, '', queryEmbedding, 2000);

            expect(result.text).toContain('King Aldric');
            expect(result.text).not.toContain('Castle');
            expect(result.entityKeys).not.toContain('castle');
        });

        it('respects token budget', async () => {
            const graphData = {
                nodes: {
                    king: buildMockGraphNode({
                        name: 'King Aldric',
                        type: 'PERSON',
                        description: 'Rules the kingdom with wisdom and power over all the land',
                        embedding_b64: encodeFloat32Array(new Float32Array([0.9, 0.1, 0.0])),
                    }),
                    castle: buildMockGraphNode({
                        name: 'Castle',
                        type: 'PLACE',
                        description: 'A huge fortress with many towers and guards and walls',
                        embedding_b64: encodeFloat32Array(new Float32Array([0.8, 0.2, 0.0])),
                    }),
                },
                edges: {},
            };
            const queryEmbedding = new Float32Array([0.9, 0.1, 0.0]);
            const result = await retrieveWorldContext(graphData, null, '', queryEmbedding, 25); // Very tight budget

            // Should include at most 1 entity
            expect(result.entityKeys.length).toBeLessThanOrEqual(1);
        });

        it('returns empty when no entities exist', async () => {
            const result = await retrieveWorldContext(
                { nodes: {}, edges: {} },
                null,
                '',
                new Float32Array([0.5, 0.5]),
                2000
            );
            expect(result.text).toBe('');
            expect(result.entityKeys).toEqual([]);
        });

        it('formats output with XML tags', async () => {
            const graphData = {
                nodes: {
                    king: buildMockGraphNode({
                        name: 'King Aldric',
                        type: 'PERSON',
                        description: 'Rules the kingdom',
                        embedding_b64: encodeFloat32Array(new Float32Array([0.9, 0.1, 0.0])),
                    }),
                },
                edges: {},
            };
            const queryEmbedding = new Float32Array([0.9, 0.1, 0.0]);
            const result = await retrieveWorldContext(graphData, null, '', queryEmbedding, 2000);

            expect(result.text).toContain('<world_context>');
            expect(result.text).toContain('</world_context>');
        });

        it('includes framing comment in local-mode output', async () => {
            const graphData = {
                nodes: {
                    king: buildMockGraphNode({
                        name: 'King Aldric',
                        type: 'PERSON',
                        description: 'Rules the kingdom',
                        embedding_b64: encodeFloat32Array(new Float32Array([0.9, 0.1, 0.0])),
                    }),
                },
                edges: {},
            };
            const queryEmbedding = new Float32Array([0.9, 0.1, 0.0]);
            const result = await retrieveWorldContext(graphData, null, '', queryEmbedding, 2000);

            expect(result.text).toContain(
                '[This is background knowledge about the world, its communities, and broader context the character is aware of]'
            );
        });

        it('formats edges with endpoint type inline (top 3 by weight)', async () => {
            const graphData = {
                nodes: {
                    king: buildMockGraphNode({
                        name: 'King Aldric',
                        type: 'PERSON',
                        description: 'Rules the kingdom',
                        embedding_b64: encodeFloat32Array(new Float32Array([0.9, 0.1, 0.0])),
                    }),
                    castle: buildMockGraphNode({
                        name: 'Castle',
                        type: 'PLACE',
                        description: 'Royal fortress',
                    }),
                    queen: buildMockGraphNode({
                        name: 'Queen',
                        type: 'PERSON',
                        description: 'Co-ruler',
                    }),
                    guard: buildMockGraphNode({
                        name: 'Guard',
                        type: 'PERSON',
                        description: 'Royal guards',
                    }),
                },
                edges: {
                    king__castle: {
                        source: 'king',
                        target: 'castle',
                        description: 'Lives here',
                        weight: 10,
                    },
                    king__queen: {
                        source: 'king',
                        target: 'queen',
                        description: 'Married to',
                        weight: 8,
                    },
                    king__guard: {
                        source: 'king',
                        target: 'guard',
                        description: 'Commands',
                        weight: 5,
                    },
                    king__jester: {
                        source: 'king',
                        target: 'jester',
                        description: 'Finds amusing',
                        weight: 2,
                    },
                },
            };
            const queryEmbedding = new Float32Array([0.9, 0.1, 0.0]);
            const result = await retrieveWorldContext(graphData, null, '', queryEmbedding, 2000);

            // Should include top 3 edges by weight: castle (10), queen (8), guard (5)
            expect(result.text).toContain('→');
            expect(result.text).toContain('Lives here');
            expect(result.text).toContain('PLACE'); // castle's type
        });

        it('sorts entities by cosine similarity descending', async () => {
            const graphData = {
                nodes: {
                    king: buildMockGraphNode({
                        name: 'King Aldric',
                        type: 'PERSON',
                        description: 'Rules the kingdom',
                        embedding_b64: encodeFloat32Array(new Float32Array([0.9, 0.1, 0.0])),
                    }),
                    castle: buildMockGraphNode({
                        name: 'Castle',
                        type: 'PLACE',
                        description: 'Royal fortress',
                        embedding_b64: encodeFloat32Array(new Float32Array([0.7, 0.2, 0.0])),
                    }),
                },
                edges: {},
            };
            const queryEmbedding = new Float32Array([0.9, 0.1, 0.0]);
            const result = await retrieveWorldContext(graphData, null, '', queryEmbedding, 2000);

            // King (0.9 close) should appear before Castle (0.7 less close)
            const kingIndex = result.text.indexOf('King Aldric');
            const castleIndex = result.text.indexOf('Castle');
            expect(kingIndex).toBeLessThan(castleIndex);
            expect(result.entityKeys).toEqual(['king', 'castle']);
        });
    });
});

/**
 * Helper: encode Float32Array to Base64 (same as embedding-codec.js)
 * @param {Float32Array} vec
 * @returns {string}
 */
function encodeFloat32Array(vec) {
    const bytes = new Uint8Array(vec.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

describe('detectMacroIntent', () => {
    it('should detect English macro intent keywords', () => {
        expect(detectMacroIntent('Can you summarize what happened so far?')).toBe(true);
        expect(detectMacroIntent('Give me a recap of the story')).toBe(true);
        expect(detectMacroIntent('What is the overall dynamic?')).toBe(true);
        expect(detectMacroIntent('Tell me about what has happened lately')).toBe(true);
    });

    it('should detect Russian macro intent keywords', () => {
        expect(detectMacroIntent('Расскажи вкратце, что было')).toBe(true);
        expect(detectMacroIntent('Какой итог нашей истории?')).toBe(true);
        expect(detectMacroIntent('Наполни контекст о происходящем')).toBe(true);
        expect(detectMacroIntent('Напомни, как всё началось')).toBe(true);
    });

    it('should return false for local queries', () => {
        expect(detectMacroIntent("Let's go to the kitchen")).toBe(false);
        expect(detectMacroIntent('I kiss her gently')).toBe(false);
        expect(detectMacroIntent('Пойдём в спальню')).toBe(false);
    });

    it('should handle empty input gracefully', () => {
        expect(detectMacroIntent('')).toBe(false);
        expect(detectMacroIntent(null)).toBe(false);
        expect(detectMacroIntent(undefined)).toBe(false);
    });
});

describe('retrieveWorldContext with intent routing', () => {
    it('should return global state when macro intent detected and state exists', async () => {
        const globalState = { summary: 'Global narrative...' };
        const graphData = { nodes: {}, edges: {} };
        const queryEmbedding = new Float32Array([0.1, 0.2]);
        const userMessages = 'Please summarize the story so far';

        const result = await retrieveWorldContext(graphData, globalState, userMessages, queryEmbedding, 2000);

        expect(result.text).toContain('<world_context>');
        expect(result.text).toContain('Global narrative...');
        expect(result.entityKeys).toEqual([]);
    });

    it('should fall back to vector search when no macro intent', async () => {
        const globalState = { summary: 'Global...' };
        const graphData = {
            nodes: {
                king: buildMockGraphNode({
                    name: 'King Aldric',
                    type: 'PERSON',
                    description: 'Royal ruler',
                    embedding_b64: encodeFloat32Array(new Float32Array([0.9, 0.1, 0.0])),
                }),
            },
            edges: {},
        };
        const queryEmbedding = new Float32Array([0.9, 0.1, 0.0]);
        const userMessages = "Let's go to the kitchen";

        const result = await retrieveWorldContext(graphData, globalState, userMessages, queryEmbedding, 2000);

        // Should run vector search, not use global state
        expect(result.text).not.toContain('Global...');
        expect(result.text).toContain('King Aldric');
    });

    it('should fall back to vector search when global state is null', async () => {
        const globalState = null;
        const graphData = {
            nodes: {
                king: buildMockGraphNode({
                    name: 'King Aldric',
                    type: 'PERSON',
                    description: 'Royal ruler',
                    embedding_b64: encodeFloat32Array(new Float32Array([0.9, 0.1, 0.0])),
                }),
            },
            edges: {},
        };
        const userMessages = 'Summarize everything'; // has macro intent
        const queryEmbedding = new Float32Array([0.9, 0.1, 0.0]);

        const result = await retrieveWorldContext(graphData, globalState, userMessages, queryEmbedding, 2000);

        // No global state available, fall back to vector search
        expect(result.text).toContain('King Aldric');
    });

    it('should handle empty entities with global state', async () => {
        const globalState = { summary: 'Global narrative...' };
        const userMessages = 'Summarize everything';
        const queryEmbedding = new Float32Array([0.1]);

        const result = await retrieveWorldContext(
            { nodes: {}, edges: {} },
            globalState,
            userMessages,
            queryEmbedding,
            2000
        );

        expect(result.text).toContain('Global narrative...');
    });

    it('includes framing comment in macro-intent output', async () => {
        const globalState = { summary: 'Global narrative...' };
        const userMessages = 'Summarize everything';
        const queryEmbedding = new Float32Array([0.1]);

        const result = await retrieveWorldContext(
            { nodes: {}, edges: {} },
            globalState,
            userMessages,
            queryEmbedding,
            2000
        );

        expect(result.text).toContain(
            '[This is background knowledge about the world, its communities, and broader context the character is aware of]'
        );
    });
});
