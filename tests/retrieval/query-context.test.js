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

        const memories = [{ tokens: ['sword', 'fight', 'castl'] }, { tokens: ['dragon', 'fire'] }];
        const hiddenMemories = [{ tokens: ['sword', 'shield'] }];

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
        // Three-tier system: Layer 2 (grounded) + Layer 3 (non-grounded)
        const tokens = buildBM25Tokens(
            'I want to find the sword in the castle',
            { entities: [], weights: {} },
            corpusVocab
        );

        // Layer 2: "sword" and "castl" (stem of "castle") are grounded (in corpus) — 3x boost
        const hasSword = tokens.includes('sword');
        const hasCastl = tokens.includes('castl');
        expect(hasSword).toBe(true);
        expect(hasCastl).toBe(true);

        // Layer 3: "find", "want" are non-grounded (not in corpus) — 2x boost
        const hasFind = tokens.includes('find');
        const hasWant = tokens.includes('want');
        expect(hasFind).toBe(true);
        expect(hasWant).toBe(true);
    });

    it('should apply 60% boost (ceil(entityBoostWeight * 0.6)) to grounded tokens (Layer 2)', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        // entityBoostWeight = 5, so 60% boost = ceil(5 * 0.6) = 3
        const corpusVocab = new Set(['sword']);
        const tokens = buildBM25Tokens('sword', { entities: [], weights: {} }, corpusVocab);

        // "sword" should appear exactly 3 times (Layer 2 grounded boost)
        const swordCount = tokens.filter((t) => t === 'sword').length;
        expect(swordCount).toBe(3);
    });

    it('should deduplicate grounded tokens before boosting (Layer 2)', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        const corpusVocab = new Set(['sword']);
        // "sword sword sword" — same stem repeated, should deduplicate to 1 unique stem × boost
        const tokens = buildBM25Tokens('sword sword sword', { entities: [], weights: {} }, corpusVocab);

        // ceil(5 * 0.6) = 3 — one unique stem boosted 3 times
        const swordCount = tokens.filter((t) => t === 'sword').length;
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

    it('should include Layer 1 entity tokens, Layer 2 grounded tokens, and Layer 3 non-grounded tokens', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        const corpusVocab = new Set(['sword']);
        const entities = {
            entities: ['Dragon'], // Single-word entity for Layer 1
            weights: { Dragon: 1.0 },
        };

        const tokens = buildBM25Tokens('sword and magic', entities, corpusVocab);

        // Layer 0: None (Dragon is single-word)
        // Layer 1: "Dragon" tokenized + 5x boost
        // Layer 2: "sword" grounded + 3x boost (in corpus)
        // Layer 3: "magic" non-grounded + 2x boost (not in corpus)
        expect(tokens.includes('sword')).toBe(true);
        expect(tokens.includes('magic')).toBe(true);
        // Entity stems from "Dragon"
        expect(tokens.some((t) => t.startsWith('drag') || t === 'drag')).toBe(true);

        // Verify Layer 3 non-grounded tokens get 2x boost
        const magicCount = tokens.filter((t) => t === 'magic').length;
        expect(magicCount).toBe(2); // ceil(5 * 0.4) = 2
    });

    it('should apply 40% boost (ceil(entityBoostWeight * 0.4)) to non-grounded tokens (Layer 3)', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        // entityBoostWeight = 5, so 40% boost = ceil(5 * 0.4) = 2
        const corpusVocab = new Set(['sword']); // "magic" is NOT in corpus
        const tokens = buildBM25Tokens('magic magic', { entities: [], weights: {} }, corpusVocab);

        // "magic" should appear exactly 2 times (Layer 3 non-grounded boost)
        const magicCount = tokens.filter((t) => t === 'magic').length;
        expect(magicCount).toBe(2);
    });

    it('populates meta object with tier counts when provided', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');
        const corpusVocab = new Set(['sword', 'magic']);
        const entities = { entities: ['Dragon'], weights: { Dragon: 3 } };
        const meta = {};
        buildBM25Tokens('sword castle', entities, corpusVocab, meta);
        expect(meta.entityStems).toBeTypeOf('number');
        expect(meta.entityStems).toBeGreaterThan(0); // 'dragon' stem from entity
        expect(meta.grounded).toBeGreaterThanOrEqual(1); // 'sword' is in corpus
        expect(meta.nonGrounded).toBeGreaterThanOrEqual(0); // 'castle' is not in corpus (may be filtered by length/stem)
        expect(meta.entityStems + meta.grounded + meta.nonGrounded).toBeGreaterThan(0);
    });

    it('does not fail when meta is not provided', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');
        const corpusVocab = new Set(['sword']);
        const tokens = buildBM25Tokens('sword', { entities: [], weights: {} }, corpusVocab);
        expect(tokens.length).toBeGreaterThan(0);
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

describe('buildBM25Tokens multi-word entity splitting', () => {
    it('should separate multi-word entities (Layer 0) from single-word entities (Layer 1)', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        const entities = {
            entities: ['King Aldric', 'Queen', 'Silver Sword of Destiny'],
            weights: { 'King Aldric': 2.0, Queen: 1.0, 'Silver Sword of Destiny': 3.0 },
        };
        const corpusVocab = new Set(['sword', 'king']);
        const meta = {};

        const tokens = buildBM25Tokens('test message', entities, corpusVocab, meta);

        // Layer 0: multi-word entities (un-tokenized, contain spaces)
        const layer0Tokens = tokens.filter((t) => t.includes(' '));
        // Layer 1: single-word entity stems (no spaces)
        const layer1Tokens = tokens
            .filter((t) => !t.includes(' '))
            .filter((t) => t.startsWith('king') || t.startsWith('aldr') || t.startsWith('queen'));

        // "King Aldric" appears once (boost applied in scoring)
        expect(layer0Tokens.filter((t) => t === 'King Aldric').length).toBe(1);
        // "Silver Sword of Destiny" appears once
        expect(layer0Tokens.filter((t) => t === 'Silver Sword of Destiny').length).toBe(1);
        // Single-word "Queen" goes to Layer 1 (stemmed, 5x boost)
        expect(layer1Tokens.length).toBeGreaterThan(0);

        // Meta should track layer counts (phrases added once each)
        expect(meta.layer0Count).toBe(2); // 1 + 1 (not 10 + 10)
        expect(meta.layer1Count).toBeGreaterThan(0);
    });

    it('should treat entities with single space as multi-word', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        const entities = { entities: ['Dark Castle'], weights: { 'Dark Castle': 1.0 } };
        const corpusVocab = new Set();

        const tokens = buildBM25Tokens('test', entities, corpusVocab, {});

        // Should have exact phrase "Dark Castle" once (boost applied in scoring)
        expect(tokens.filter((t) => t === 'Dark Castle').length).toBe(1);
    });

    it('should treat single-word entities as Layer 1 (stemmed)', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        const entities = { entities: ['Dragon'], weights: { Dragon: 1.0 } };
        const corpusVocab = new Set();

        const tokens = buildBM25Tokens('test', entities, corpusVocab, {});

        // Single-word entity should be stemmed (drag -> drag, not "Dragon")
        const hasStemmed = tokens.some((t) => t.includes('drag') && t !== 'Dragon');
        expect(hasStemmed).toBe(true);
        // Should NOT contain raw "Dragon" with space
        expect(tokens.includes('Dragon')).toBe(false);
    });
});
