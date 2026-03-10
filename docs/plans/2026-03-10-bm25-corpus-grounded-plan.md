# Implementation Plan - Corpus-Grounded Entity BM25

> **Reference:** `docs/designs/2026-03-10-bm25-corpus-grounded-design.md`
> **Execution:** Use `executing-plans` skill.

## Overview

This plan replaces raw user-message tokens (zero-impact noise) in the BM25 query with corpus-grounded tokens — only stems that actually exist in the memory/graph corpus. It also adds an event gate to skip BM25 entirely when no events are in the candidate pool.

**Files Modified:**
- `src/retrieval/query-context.js` — Add `buildCorpusVocab()`, modify `buildBM25Tokens()` signature
- `src/retrieval/scoring.js` — Build corpus vocab, pass `graphEdges` in ctx, wire new call
- `src/retrieval/retrieve.js` — Add `graphEdges` to `RetrievalContext`
- `tests/retrieval/query-context.test.js` — New test file for `buildCorpusVocab` and modified `buildBM25Tokens`

**No Schema Changes.** No new dependencies. Backward compatible via default parameter.

---

## Task 1: Create Test File + Unit Test `buildCorpusVocab` — Memory Tokens

**Goal:** Verify `buildCorpusVocab` collects stems from memory `.tokens` arrays into a Set.

**Step 1: Write the Failing Test**
- File: `tests/retrieval/query-context.test.js`
- Code:

```javascript
import { describe, expect, it } from 'vitest';

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
        expect(vocab.size).toBe(5); // sword deduplicated
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/retrieval/query-context.test.js`
- Expect: Fail — `buildCorpusVocab is not a function` (not exported yet)

**Step 3: Implementation (Green)**
- File: `src/retrieval/query-context.js`
- Action: Add `buildCorpusVocab` function at the end of the file, before the closing of the module. Add `tokenize` import is already present.

```javascript
/**
 * Build vocabulary Set from memory tokens and graph descriptions.
 * Used to filter user-message stems to only corpus-relevant ones.
 * @param {Object[]} memories - Candidate memories (with m.tokens)
 * @param {Object[]} hiddenMemories - Hidden memories (with m.tokens)
 * @param {Object} graphNodes - Graph nodes keyed by normalized name
 * @param {Object} graphEdges - Graph edges keyed by "src__tgt"
 * @returns {Set<string>} Set of all stems present in the corpus
 */
export function buildCorpusVocab(memories, hiddenMemories, graphNodes, graphEdges) {
    const vocab = new Set();

    // Memory tokens (pre-computed at extraction time)
    for (const m of memories) {
        if (m.tokens) for (const t of m.tokens) vocab.add(t);
    }
    for (const m of hiddenMemories) {
        if (m.tokens) for (const t of m.tokens) vocab.add(t);
    }

    // Graph node descriptions
    for (const node of Object.values(graphNodes || {})) {
        if (node.description) {
            for (const t of tokenize(node.description)) vocab.add(t);
        }
    }

    // Graph edge descriptions
    for (const edge of Object.values(graphEdges || {})) {
        if (edge.description) {
            for (const t of tokenize(edge.description)) vocab.add(t);
        }
    }

    return vocab;
}
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/retrieval/query-context.test.js`
- Expect: PASS

**Step 5: Git Commit**
- `git add -A && git commit -m "feat(bm25): add buildCorpusVocab with memory token collection"`

---

## Task 2: Unit Test `buildCorpusVocab` — Graph Nodes & Edges

**Goal:** Verify `buildCorpusVocab` tokenizes graph node and edge descriptions into the vocab Set.

**Step 1: Write the Failing Test**
- File: `tests/retrieval/query-context.test.js`
- Append inside the `buildCorpusVocab` describe block:

```javascript
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
```

**Step 2: Run Test (Red → Green)**
- Command: `npx vitest run tests/retrieval/query-context.test.js`
- Expect: All PASS (implementation from Task 1 already handles these cases)

**Step 3: No new implementation needed — these are coverage tests.**

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/retrieval/query-context.test.js`
- Expect: PASS

**Step 5: Git Commit**
- `git add -A && git commit -m "test(bm25): add buildCorpusVocab edge case tests"`

---

## Task 3: Unit Test `buildBM25Tokens` — Corpus-Grounded Filtering (Layer 2)

**Goal:** Verify the modified `buildBM25Tokens` filters user-message tokens through the corpus vocab and applies half-boost.

**Step 1: Write the Failing Test**
- File: `tests/retrieval/query-context.test.js`
- Add a new describe block:

```javascript
import { vi } from 'vitest';

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
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/retrieval/query-context.test.js`
- Expect: Fail — `buildBM25Tokens` currently includes all message tokens regardless of corpusVocab

**Step 3: Implementation (Green)**
- File: `src/retrieval/query-context.js`
- Action: Add the constant at module level and rewrite `buildBM25Tokens`:

Add at the top of the file, after imports:
```javascript
/** Boost divisor for corpus-grounded tokens relative to entityBoostWeight */
const CORPUS_GROUNDED_BOOST_DIVISOR = 2;
```

Replace the existing `buildBM25Tokens` function:
```javascript
/**
 * Build enriched token array for BM25 scoring.
 * Layer 1: Entity stems with full boost.
 * Layer 2: User-message stems filtered through corpus vocabulary, half boost.
 * @param {string} userMessage - Original user message
 * @param {{entities: string[], weights: Object}} extractedEntities - Extracted entity context
 * @param {Set<string>|null} [corpusVocab=null] - Corpus vocabulary for grounding.
 *   When provided, user-message tokens are filtered through it.
 *   When null, falls back to including all user-message tokens (backward compat).
 * @returns {string[]} Token array with boosted entities
 */
export function buildBM25Tokens(userMessage, extractedEntities, corpusVocab = null) {
    const tokens = [];
    const settings = getQueryContextSettings();

    // Layer 1: Named entities from graph (unchanged)
    if (extractedEntities?.entities) {
        for (const entity of extractedEntities.entities) {
            const weight = (extractedEntities.weights[entity] || 1) * settings.entityBoostWeight;
            const repeats = Math.ceil(weight);
            const stemmed = tokenize(entity);
            for (let r = 0; r < repeats; r++) {
                tokens.push(...stemmed);
            }
        }
    }

    // Layer 2: Corpus-grounded message tokens (NEW)
    if (corpusVocab && corpusVocab.size > 0) {
        const msgStems = tokenize(userMessage || '');
        const grounded = msgStems.filter(t => corpusVocab.has(t));

        // Deduplicate grounded tokens (each unique stem boosted once)
        const unique = [...new Set(grounded)];
        const boost = Math.ceil(settings.entityBoostWeight / CORPUS_GROUNDED_BOOST_DIVISOR);
        for (const t of unique) {
            for (let r = 0; r < boost; r++) {
                tokens.push(t);
            }
        }
    } else if (!corpusVocab) {
        // Backward compat: no corpus vocab → include all message tokens at 1x
        tokens.push(...tokenize(userMessage || ''));
    }

    return tokens;
}
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/retrieval/query-context.test.js`
- Expect: All PASS

**Step 5: Git Commit**
- `git add -A && git commit -m "feat(bm25): add corpus-grounded filtering to buildBM25Tokens"`

---

## Task 4: Wire `graphEdges` into `RetrievalContext`

**Goal:** Add `graphEdges` to the retrieval context so `buildCorpusVocab` can access edge descriptions.

**Step 1: Write the Failing Test**
- No separate test — this is a plumbing change verified by the integration test in Task 5.

**Step 2: Implementation**
- File: `src/retrieval/retrieve.js`
- Action: In `buildRetrievalContext()`, add `graphEdges` to the returned object.

In the JSDoc `@typedef RetrievalContext`, add:
```javascript
 * @property {Object} graphEdges - Graph entity edges for corpus vocabulary
```

In the return statement of `buildRetrievalContext()`, add after `graphNodes`:
```javascript
        graphEdges: data?.graph?.edges || {},
```

**Step 3: Verify existing tests still pass**
- Command: `npx vitest run tests/retrieval/`
- Expect: All PASS (additive change, nothing breaks)

**Step 4: Git Commit**
- `git add -A && git commit -m "feat(bm25): wire graphEdges into RetrievalContext"`

---

## Task 5: Wire `buildCorpusVocab` into `selectRelevantMemoriesSimple` + Event Gate

**Goal:** Call `buildCorpusVocab` in the scoring pipeline and pass the result to `buildBM25Tokens`. Add event gate to skip BM25 when no events in candidates.

**Step 1: Write the Failing Test**
- File: `tests/retrieval/query-context.test.js`
- Append a new describe block to verify the event gate logic is sound (unit-level, not integration):

```javascript
describe('Event gate behavior', () => {
    it('buildBM25Tokens returns empty array when called with empty string and no entities', async () => {
        const { buildBM25Tokens } = await import('../../src/retrieval/query-context.js');

        // Simulates skipped BM25 (no events → no buildBM25Tokens call → empty array)
        const tokens = buildBM25Tokens('', { entities: [], weights: {} }, new Set());
        expect(tokens).toEqual([]);
    });
});
```

**Step 2: Implementation**
- File: `src/retrieval/scoring.js`
- Action: Import `buildCorpusVocab` and wire it into `selectRelevantMemoriesSimple`.

Add to the import from `./query-context.js`:
```javascript
import { buildBM25Tokens, buildCorpusVocab, buildEmbeddingQuery, extractQueryContext, parseRecentMessages } from './query-context.js';
```

In `selectRelevantMemoriesSimple`, replace:
```javascript
    const bm25Tokens = buildBM25Tokens(userMessages, queryContext);
```

With:
```javascript
    // Event gate: skip BM25 pipeline when no events in candidates
    const hasEvents = memories.some(m => m.type === 'event');

    let bm25Tokens = [];
    if (hasEvents) {
        const corpusVocab = buildCorpusVocab(
            memories,
            allHiddenMemories,
            ctx.graphNodes || {},
            ctx.graphEdges || {}
        );
        bm25Tokens = buildBM25Tokens(userMessages, queryContext, corpusVocab);
    }
```

**Step 3: Verify (Green)**
- Command: `npx vitest run`
- Expect: All PASS (including existing scoring integration tests)

**Step 4: Git Commit**
- `git add -A && git commit -m "feat(bm25): wire corpus-grounded vocab + event gate into scoring pipeline"`

---

## Task 6: Full Regression Test

**Goal:** Verify all existing tests pass with the changes.

**Step 1: Run full test suite**
- Command: `npm test`
- Expect: All PASS

**Step 2: Git Commit (if any fixups needed)**
- `git add -A && git commit -m "fix(bm25): address test regressions"`

---

## Summary: File Changes

| File | Change |
|---|---|
| `src/retrieval/query-context.js` | Add `CORPUS_GROUNDED_BOOST_DIVISOR` constant, `buildCorpusVocab()` function, modify `buildBM25Tokens()` to accept optional `corpusVocab` param |
| `src/retrieval/scoring.js` | Import `buildCorpusVocab`, add event gate, pass `corpusVocab` to `buildBM25Tokens` |
| `src/retrieval/retrieve.js` | Add `graphEdges` to `RetrievalContext` typedef and `buildRetrievalContext()` return |
| `tests/retrieval/query-context.test.js` | New file: tests for `buildCorpusVocab` + modified `buildBM25Tokens` |
