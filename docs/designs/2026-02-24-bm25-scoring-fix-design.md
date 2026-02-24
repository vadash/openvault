# Design: BM25 Scoring Fix (Post-Stemming)

## 1. Problem Statement

After adding Snowball stemming to BM25 tokenization, three scoring pathologies emerged:

1. **BM25 explosion**: One memory scored 54.2 total (44.8 from BM25 alone) — a 30× outlier over other BM25 contributions. BM25 is unbounded and can dominate vector similarity.
2. **Entity boost × stemming TF inflation**: `Suzy` (stemmed to `suzi`) is entity-boosted 17× in the query, but appears in nearly every memory. High query TF × low-but-nonzero IDF × short-doc length normalization = score blowup.
3. **Post-stem runts**: `боюсь` (5 chars) passes length filter, then Snowball stems it to `бо` (2 chars). No second filter catches this.

## 2. Goals & Non-Goals

### Must do
- BM25 can never dominate vector similarity in the final score
- Entity boost scales down for corpus-common names
- Post-stemming tokens below 3 chars are filtered

### Won't do
- Replace Snowball with spaCy/POS-based lemmatization (too heavy for client-side JS)
- Change the embedding model or prompts
- Redesign entity extraction logic

## 3. Proposed Architecture

### 3a. Alpha-Blend Scoring

**Current** (additive, unbounded):
```
score = base + vectorSim × 15 + bm25 × 3
```

**Proposed** (normalized alpha-blend):
```
score = base + alpha × normalizedVector + (1 - alpha) × normalizedBM25
```

Where:
- `alpha = 0.7` (default, user-configurable)
- `normalizedVector` = existing `(sim - threshold) / (1 - threshold)` scaled to `[0, 1]`, then × `combinedBoostWeight`
- `normalizedBM25` = `bm25 / maxBM25` across current batch, scaled to `[0, 1]`, then × `combinedBoostWeight`
- `combinedBoostWeight` replaces both `vectorSimilarityWeight` and `keywordMatchWeight` — single knob controlling total boost budget (default: `15`, same range as current vector weight)

**Score composition:**
```
base:         0–10 (importance × forgetfulness, floored for imp-5)
vectorBonus:  0 to alpha × combinedBoostWeight        (max ~10.5 at alpha=0.7, weight=15)
bm25Bonus:    0 to (1-alpha) × combinedBoostWeight    (max ~4.5 at alpha=0.7, weight=15)
```

BM25 is now **structurally capped** at `(1-alpha) × weight` regardless of raw BM25 score.

**BM25 normalization detail:** Use batch-max normalization:
```js
const maxBM25 = Math.max(...allBM25Scores, 1e-9); // avoid div-by-zero
const normalizedBM25 = rawBM25 / maxBM25;          // [0, 1]
```

This preserves relative ranking within BM25 while bounding absolute contribution.

### 3b. IDF-Aware Entity Boost

**Current**: `repeats = ceil(entityWeight × entityBoostWeight)` → up to 17 repeats of `suzi`

**Proposed**: Scale repeats inversely by document frequency:
```js
const df = documentFrequency(stemmedEntity); // how many memories contain this term
const N = totalMemories;
const idfFactor = Math.log((N - df + 0.5) / (df + 0.5) + 1);
const maxIDF = Math.log(N + 1); // IDF when df=0 (corpus-unique term)
const idfRatio = idfFactor / maxIDF; // [0, 1]

const baseRepeats = Math.ceil(entityWeight × entityBoostWeight);
const adjustedRepeats = Math.max(1, Math.round(baseRepeats × idfRatio));
```

Effect:
- `Suzy` appears in 28/30 memories → idfRatio ≈ 0.05 → 17 repeats → **1 repeat**
- Rare entity in 2/30 memories → idfRatio ≈ 0.85 → 17 repeats → **14 repeats**

**Requires**: Document frequency data available at query time. Currently computed inside `scoreMemories()` — need to either:
- **(A)** Precompute DF map from memory tokens and pass to `buildBM25Tokens()`, or
- **(B)** Apply the IDF scaling inside `scoreMemories()` after DF is computed, adjusting query tokens before BM25 scoring

Option **(B)** is simpler — adjust query token frequencies in-place using the already-computed DF map, rather than changing the `buildBM25Tokens` API.

### 3c. Post-Stem Length Filter

In `tokenize()`:
```js
return (text.toLowerCase().match(/[\p{L}0-9_]+/gu) || [])
    .filter(word => word.length > 2 && !STOP_WORDS.has(word))
    .map(stemWord)
    .filter(word => word.length > 2);  // ← add this
```

## 4. Data Models / Schema

No schema changes. Settings additions:

```js
// Replace vectorSimilarityWeight + keywordMatchWeight with:
alpha: 0.7,                    // vector vs BM25 blend ratio
combinedBoostWeight: 15,       // total boost budget for vector+BM25

// Keep existing:
entityBoostWeight: 5.0,        // base entity boost (now IDF-modulated)
vectorSimilarityThreshold: 0.5 // unchanged
```

**Migration**: For users with custom `vectorSimilarityWeight`/`keywordMatchWeight`:
- `combinedBoostWeight = vectorSimilarityWeight` (keep their vector weight as total budget)
- `alpha = vectorSimilarityWeight / (vectorSimilarityWeight + keywordMatchWeight)` (preserve their ratio)

## 5. Interface / API Design

### `calculateScore()` — Updated signature
```js
function calculateScore(memory, contextEmbedding, chatLength, bm25Score, settings)
// bm25Score is now pre-normalized [0, 1]
```

### `scoreMemories()` — Updated flow
```js
function scoreMemories(memories, contextEmbedding, queryTokens, chatLength, settings) {
    // 1. Precompute BM25 corpus stats (existing)
    // 2. Score all memories with raw BM25 (existing)
    // 3. NEW: Apply IDF-aware TF adjustment to query tokens
    // 4. NEW: Find maxBM25 across batch
    // 5. NEW: Normalize each bm25Score to [0, 1]
    // 6. Calculate final scores with alpha-blend
    // 7. Sort and return
}
```

### Settings UI
- Replace two sliders (`vectorSimilarityWeight`, `keywordMatchWeight`) with:
  - `alpha` slider (0.0–1.0, default 0.7, label: "Vector vs Keyword Balance")
  - `combinedBoostWeight` slider (1–30, default 15, label: "Retrieval Boost Strength")

## 6. Embedding Prompt Tuning (Bonus — Related Improvement)

`docs/bm25.md` documents that `embeddinggemma-300M` supports `task: X | query:` instructional prompts that significantly improve similarity quality (0.80 → 0.94 on matched sentences). Currently `strategies.js:257` passes raw text with no prompt prefix.

**Current:**
```js
const output = await pipe(text.trim(), { pooling: 'mean', normalize: true });
```

**Proposed — asymmetric prompting:**

For **query** embeddings (at retrieval time):
```js
const prompted = `task: narrative similarity | query: ${text.trim()}`;
const output = await pipe(prompted, { pooling: 'mean', normalize: true });
```

For **document** embeddings (at index time / memory creation):
```js
const prompted = `task: narrative similarity | query: ${text.trim()}`;
// Same prompt for symmetric matching (doc recommends same prompt both sides)
```

**Prompt options to test:**
| Prompt | Best for |
|---|---|
| `task: sentence similarity \| query:` (STS) | General scene comparison, emotional beats |
| `task: narrative similarity \| query:` | RP scene-to-scene matching |
| `task: romantic scene similarity \| query:` | Erotic/intimate content matching |
| `task: character relationship \| query:` | Relationship dynamics |

**Implementation notes:**
- Must use **same prompt** at index and query time (asymmetry degrades results)
- Adding/changing prompt **invalidates all existing embeddings** — requires re-embed
- Should be user-configurable with a dropdown in settings
- Default: `STS` (most stable built-in)
- Store chosen prompt in settings so re-embed can be triggered on change

**Scope:** This is an independent improvement. Can be implemented separately from the BM25 scoring fix, but worth tracking here since both affect retrieval quality.

## 7. Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| All BM25 scores are 0 (no keyword matches) | `maxBM25` floored at `1e-9`, normalized scores all 0, alpha-blend degrades gracefully to vector-only |
| Single outlier BM25 score compresses all others | Batch-max normalization does compress. Acceptable — the outlier *should* rank highest within BM25 component. Alpha-blend caps total contribution. |
| IDF-aware boost makes rare entities too powerful | Already limited by `entityBoostWeight` cap and alpha-blend ceiling. Max BM25 contribution is `(1-alpha) × weight ≈ 4.5`. |
| Migration breaks existing user settings | Compute equivalent `alpha` + `combinedBoostWeight` from old values. Fallback to defaults if both old keys missing. |
| Batch-max norm is unstable with tiny batches (<3 memories) | For batches < 3, skip BM25 normalization, use raw scores clamped to [0, weight]. Rare edge case. |
| Embedding prompt change invalidates all stored embeddings | Must trigger re-embed on prompt change. Warn user in settings UI. |
