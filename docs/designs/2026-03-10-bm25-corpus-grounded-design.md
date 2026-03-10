# Design: Corpus-Grounded Entity BM25

## 1. Problem Statement

BM25 scores 75% of memories at exactly zero in Russian RP scenarios. The root cause is NOT missing stemming (Snowball is already applied) but a query composition problem:

- **Layer 1 (entities)** works — graph-anchored entity stems correctly boost exact-match memories.
- **User message tokens** are provably zero-impact noise: dialogue-register text ("I ordered a salad") has zero lexical overlap with narrative-register memory summaries ("Character tied partner to the headboard"). These tokens waste array space and obfuscate debug output without changing any BM25 score.
- **Entity extraction is too narrow** — only graph-anchored named entities enter the query. Action verbs ("tied", "licked") and scene objects ("candle", "rope") from recent messages are discarded, even when they appear verbatim in memory tokens.

## 2. Goals & Non-Goals

### Must do
- Drop raw user-message tokens from BM25 query (zero-impact noise elimination).
- Add corpus-grounded token enrichment: stems from recent messages that exist in the memory/graph corpus get boosted into the BM25 query.
- No new JS dependencies. Reuse existing `tokenize()` + `stemWord()` pipeline.
- No changes to `math.js` scoring internals (`scoreMemories`, `calculateScore`, `bm25Score`).

### Won't do
- Change alpha or combinedBoostWeight (out of scope per user request).
- Add POS tagging or any NLP library.
- Modify memory-side tokens (`m.tokens` pre-computed at extraction time).
- Change entity extraction in `extractQueryContext()`.

## 3. Proposed Architecture

### Three-Layer BM25 Query

```
Layer 1: Graph-anchored entities (UNCHANGED)
  Source: extractQueryContext() → entity names
  Boost:  entityBoostWeight (default 5) × entity weight
  Stems:  tokenize(entityName) → e.g. "анальн", "хвост", "плаг"

Layer 2: Corpus-grounded message tokens (NEW)
  Source: tokenize(recentUserMessages) ∩ corpusVocab
  Boost:  entityBoostWeight / 2 (default 2.5 → ceil to 3)
  Stems:  only user-message stems that exist in memory tokens or graph descriptions

Layer 3: Raw user-message tokens (REMOVED)
  Was:    tokenize(userMessage) at 1x weight
  Now:    dropped entirely — subsumed by Layer 2 with filter
```

### Data Flow

```
selectRelevantMemoriesSimple()
  │
  ├─ extractQueryContext()          → { entities, weights }     (unchanged)
  │
  ├─ buildCorpusVocab(memories, hiddenMemories, graphNodes)  (NEW)
  │   └─ Set<string> of all stems from:
  │       • m.tokens for each memory (candidates + hidden)
  │       • tokenize(node.description) for each graph node
  │       • tokenize(edge.description) for each graph edge
  │
  ├─ buildBM25Tokens(userMessages, queryContext, corpusVocab)  (MODIFIED)
  │   ├─ Layer 1: entity stems × boost                (unchanged)
  │   └─ Layer 2: msgStems ∩ corpusVocab × boost/2    (NEW, replaces raw msg tokens)
  │
  └─ scoreMemoriesDirect(...)       → scored memories          (unchanged)
```

### Key Components

**`buildCorpusVocab(memories, hiddenMemories, graphNodes)`** — New function in `query-context.js`
- Iterates all memories (candidates + hidden), collecting `m.tokens` into a Set.
- Iterates graph nodes and edges, tokenizing descriptions into the same Set.
- Returns `Set<string>` — the universe of "useful" stems.
- Performance: O(M × T) where M = memory count, T = avg tokens per memory. For 60 memories × 15 tokens = 900 Set insertions. Negligible.

**`buildBM25Tokens()` modification** — Existing function in `query-context.js`
- New optional third parameter: `corpusVocab: Set<string> | null`.
- When provided: tokenize user message, filter through corpusVocab, boost at half weight.
- When null: fall back to current behavior (backward compat for tests).

## 4. Data Models / Schema

No schema changes. No new settings. The boost divisor (2) is hardcoded as `CORPUS_GROUNDED_BOOST_DIVISOR` constant.

### Constants (in function or at module level)

```javascript
/** Boost divisor for corpus-grounded tokens relative to entityBoostWeight */
const CORPUS_GROUNDED_BOOST_DIVISOR = 2;
```

### Function Signatures

```javascript
// NEW — query-context.js
/**
 * Build vocabulary Set from memory tokens and graph descriptions.
 * Used to filter user-message stems to only corpus-relevant ones.
 * @param {Object[]} memories - Candidate memories (with m.tokens)
 * @param {Object[]} hiddenMemories - Hidden memories (with m.tokens)
 * @param {Object} graphNodes - Graph nodes keyed by normalized name
 * @param {Object} graphEdges - Graph edges keyed by "src__tgt"
 * @returns {Set<string>} Set of all stems present in the corpus
 */
export function buildCorpusVocab(memories, hiddenMemories, graphNodes, graphEdges)

// MODIFIED — query-context.js
/**
 * Build enriched token array for BM25 scoring.
 * Layer 1: Entity stems with full boost.
 * Layer 2: User-message stems filtered through corpus vocabulary, half boost.
 * @param {string} userMessage - Recent user messages (concatenated)
 * @param {{entities: string[], weights: Object}} extractedEntities - Extracted entities
 * @param {Set<string>|null} [corpusVocab=null] - Corpus vocabulary for grounding.
 *   When provided, user-message tokens are filtered through it.
 *   When null, falls back to including all user-message tokens (backward compat).
 * @returns {string[]} Token array for BM25
 */
export function buildBM25Tokens(userMessage, extractedEntities, corpusVocab = null)
```

## 5. Detailed Logic

### buildCorpusVocab

```javascript
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

### buildBM25Tokens (modified)

```javascript
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

### Caller change in scoring.js

```javascript
// In selectRelevantMemoriesSimple():
const corpusVocab = buildCorpusVocab(
    activeMemories,
    hiddenMemories,
    ctx.graphNodes || {},
    ctx.graphEdges || {}
);
const bm25Tokens = buildBM25Tokens(userMessages, queryContext, corpusVocab);
```

## 6. Event Gate (Skip BM25 Early)

Before any messages are auto-hidden, the candidate pool contains only reflections (abstract insights, not keyword-rich). BM25 adds negligible value for reflections — vector + base scoring handles them fine.

**Gate:** Skip the entire BM25 pipeline when candidates contain zero events.

```javascript
// In selectRelevantMemoriesSimple():
const hasEvents = memories.some(m => m.type === 'event');

let bm25Tokens = [];
if (hasEvents) {
    const corpusVocab = buildCorpusVocab(memories, allHiddenMemories, ctx.graphNodes || {}, ctx.graphEdges || {});
    bm25Tokens = buildBM25Tokens(userMessages, queryContext, corpusVocab);
}
```

This saves tokenization, IDF computation, and scoring loop until BM25 actually has keyword-rich events to work with. No new constant or setting needed — it's a boolean derived from the candidate pool.

## 7. Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| **Empty corpus** (new chat, no memories yet) | `corpusVocab.size === 0` → Layer 2 produces zero tokens. Layer 1 still works if entities exist. Equivalent to current behavior on empty chats. |
| **Coincidental matches** ("candle" in food context matches "candle" in wax-play memory) | IDF handles this: if "candle" appears in many memories, its IDF is low and contribution is small. The 2.5x boost is modest enough that coincidental matches don't dominate. |
| **Graph description bloat** — node descriptions contain narrative language that inflates corpus vocab | `tokenize()` already filters stopwords and short words. Graph description tokens are stemmed same as everything else. The Set just grows larger, which only means more user-message stems pass the filter — but each still needs to match individual documents via BM25 TF to contribute score. |
| **Layer 1 + Layer 2 overlap** — an entity stem that also appears in user message gets double-boosted | Acceptable: entity stems are high-signal and deserve the extra weight. The overlap is small (entities are typically proper nouns, user message verbs/objects). |
| **Performance** — building Set from all memory tokens | 60 memories × 15 tokens = 900 inserts. Graph: 60 nodes × ~20 desc tokens = 1,200 inserts. Total: ~2,100 Set operations. Sub-millisecond. |
| **Backward compatibility** — existing tests pass `buildBM25Tokens(msg, entities)` without corpusVocab | Default `corpusVocab = null` falls back to current behavior (all message tokens at 1x). |
| **Reflection-only chats** — event gate skips BM25 entirely when no events in candidates | Reflections still scored via base + vector. BM25 contributed avg 1.5% to reflection scores in analysis — negligible loss. |

## 7. Expected Impact

For the analyzed scenario (restaurant dialogue, 60 memories):

| Metric | Before | After (projected) |
|---|---|---|
| BM25 query noise tokens | ~20 (food stems) | 0-2 (only corpus-grounded) |
| Corpus-grounded hits | N/A | ~3-5 (verbs/objects from recent msgs matching memories) |
| Memories with BM25 > 0 | 15 (25%) | 18-25 (30-42%) estimated |
| Scoring computation | ~105 query tokens iterated | ~95 query tokens iterated |

The improvement is modest but targeted: we won't dramatically increase BM25 coverage (it's fundamentally limited by vocabulary overlap between dialogue and summaries), but we'll:
1. Eliminate guaranteed-zero-impact tokens from the query
2. Catch action verbs and scene objects that currently slip through
3. Make debug output cleaner (no food stems in BM25 token lists)

## 8. Files Changed

| File | Change |
|---|---|
| `src/retrieval/query-context.js` | Add `buildCorpusVocab()`, modify `buildBM25Tokens()` signature |
| `src/retrieval/scoring.js` | Build corpusVocab, pass graphEdges in ctx, pass to buildBM25Tokens |
| `src/retrieval/retrieve.js` | Pass `graphEdges` in ctx (if not already available) |
| `tests/retrieval/query-context.test.js` | New tests for buildCorpusVocab, updated tests for buildBM25Tokens |
