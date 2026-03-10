import { describe, expect, it, vi } from 'vitest';

// Mock deps for getQueryContextSettings
vi.mock('../../src/deps.js', () => ({
    getDeps: () => ({
        getExtensionSettings: () => ({
            openvault: {
                entityWindowSize: 10,
                embeddingWindowSize: 3,
                recencyDecayFactor: 0.1,
                topEntitiesCount: 5,
                entityBoostWeight: 5,
            },
        }),
    }),
}));

describe('buildCorpusVocab', () => {
    it('should collect memory tokens into the vocabulary set', async () => {
        const { buildCorpusVocab } = await import('../../src/retrieval/query-context.js');

        const memories = [
            { tokens: ['sword', 'fight', 'castl'] },
            { tokens: ['dragon', 'fire'] },
        ];
        const hiddenMemories = [
            { tokens: ['sword', 'shield'] },
        ];

        const vocab = buildCorpusVocab(memories, hiddenMemories, {}, {});

        expect(vocab).toBeInstanceOf(Set);
        expect(vocab.has('sword')).toBe(true);
        expect(vocab.has('fight')).toBe(true);
        expect(vocab.has('castl')).toBe(true);
        expect(vocab.has('dragon')).toBe(true);
        expect(vocab.has('fire')).toBe(true);
        expect(vocab.has('shield')).toBe(true);
        expect(vocab.size).toBe(6); // sword deduplicated, shield added from hidden
    });

    it('should tokenize graph node and edge descriptions into vocab', async () => {
        const { buildCorpusVocab } = await import('../../src/retrieval/query-context.js');

        const graphNodes = {
            king_aldric: { name: 'King Aldric', description: 'The wise ruler of the northern kingdom' },
        };
        const graphEdges = {
            king_aldric__queen_sera: { description: 'Married in the great cathedral' },
        };

        const vocab = buildCorpusVocab([], [], graphNodes, graphEdges);

        // tokenize() stems and filters stopwords + words <= 2 chars
        // "wise", "ruler", "northern", "kingdom", "married", "great", "cathedral" should produce stems
        expect(vocab.size).toBeGreaterThan(0);
        // Should NOT contain stopwords or short words like "the", "of", "in"
        expect(vocab.has('the')).toBe(false);
        expect(vocab.has('of')).toBe(false);
    });

    it('should handle empty/null inputs gracefully', async () => {
        const { buildCorpusVocab } = await import('../../src/retrieval/query-context.js');

        const vocab = buildCorpusVocab([], [], null, null);
        expect(vocab).toBeInstanceOf(Set);
        expect(vocab.size).toBe(0);
    });

    it('should handle memories without tokens property', async () => {
        const { buildCorpusVocab } = await import('../../src/retrieval/query-context.js');

        const memories = [{ summary: 'no tokens here' }, { tokens: ['valid'] }];
        const vocab = buildCorpusVocab(memories, [], {}, {});

        expect(vocab.has('valid')).toBe(true);
        expect(vocab.size).toBe(1);
    });
});

describe('buildBM25Tokens with corpusVocab', () => {
    it('should filter user message tokens through corpus vocab (Layer 2)', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        // Corpus vocab contains "sword" and "castl" (stems)
        const corpusVocab = new Set(['sword', 'castl', 'dragon']);

        // User message: "I want to find the sword in the castle"
        // tokenize will stem and filter stopwords
        // Only stems that exist in corpusVocab should appear
        const tokens = buildBM25Tokens(
            'I want to find the sword in the castle',
            { entities: [], weights: {} },
            corpusVocab
        );

        // "sword" and "castl" (stem of "castle") should be present
        // "find", "want" should NOT be present (not in corpus)
        const hasSword = tokens.includes('sword');
        const hasCastl = tokens.includes('castl');
        expect(hasSword).toBe(true);
        expect(hasCastl).toBe(true);

        // Should NOT include tokens not in corpus vocab
        const hasFind = tokens.includes('find');
        const hasWant = tokens.includes('want');
        expect(hasFind).toBe(false);
        expect(hasWant).toBe(false);
    });

    it('should apply half-boost (ceil(entityBoostWeight / 2)) to grounded tokens', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        // entityBoostWeight = 5, so half-boost = ceil(5/2) = 3
        const corpusVocab = new Set(['sword']);
        const tokens = buildBM25Tokens('sword', { entities: [], weights: {} }, corpusVocab);

        // "sword" should appear exactly 3 times (ceil(5/2))
        const swordCount = tokens.filter(t => t === 'sword').length;
        expect(swordCount).toBe(3);
    });

    it('should deduplicate grounded tokens before boosting', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        const corpusVocab = new Set(['sword']);
        // "sword sword sword" — same stem repeated, should deduplicate to 1 unique stem × boost
        const tokens = buildBM25Tokens('sword sword sword', { entities: [], weights: {} }, corpusVocab);

        // ceil(5/2) = 3 — one unique stem boosted 3 times
        const swordCount = tokens.filter(t => t === 'sword').length;
        expect(swordCount).toBe(3);
    });

    it('should fall back to all message tokens when corpusVocab is null', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        // No corpusVocab → backward compat → all message tokens at 1x
        const tokens = buildBM25Tokens('sword castle dragon', { entities: [], weights: {} });
        // Should contain all stems (no filtering)
        expect(tokens.length).toBeGreaterThan(0);
        expect(tokens.includes('sword')).toBe(true);
    });

    it('should produce no Layer 2 tokens when corpusVocab is empty Set', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        const corpusVocab = new Set(); // empty
        const tokens = buildBM25Tokens('sword castle', { entities: [], weights: {} }, corpusVocab);

        // Empty corpus = no grounded tokens, no fallback
        expect(tokens.length).toBe(0);
    });

    it('should include Layer 1 entity tokens alongside Layer 2 grounded tokens', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        const corpusVocab = new Set(['sword']);
        const entities = {
            entities: ['King Aldric'],
            weights: { 'King Aldric': 1.0 },
        };

        const tokens = buildBM25Tokens('sword and magic', entities, corpusVocab);

        // Layer 1: "King Aldric" tokenized + boosted
        // Layer 2: "sword" grounded + half-boosted
        // "magic" should NOT appear (not in corpus)
        expect(tokens.includes('sword')).toBe(true);
        expect(tokens.some(t => t !== 'sword')).toBe(true); // entity stems present
    });
});

describe('Event gate behavior', () => {
    it('buildBM25Tokens returns empty array when called with empty string and no entities', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        // Simulates skipped BM25 (no events → no buildBM25Tokens call → empty array)
        const tokens = buildBM25Tokens('', { entities: [], weights: {} }, new Set());
        expect(tokens).toEqual([]);
    });
});
