# Implementation Plan - BM25 Scoring Fix (Post-Stemming)

> **Reference:** `docs/designs/2026-02-24-bm25-scoring-fix-design.md`
> **Execution:** Use `executing-plans` skill.

---

### Task 1: Post-Stem Length Filter

**Goal:** Filter out tokens that become too short after Snowball stemming (e.g. `боюсь` → `бо`).

**Step 1: Write the Failing Test**
- File: `tests/query-context.test.js`
- Add inside `describe('buildBM25Tokens')`:
```js
it('filters post-stem runt tokens (< 3 chars after stemming)', () => {
    // "боюсь" (5 chars) stems to "бо" (2 chars) via Russian Snowball
    const tokens = buildBM25Tokens('боюсь страшно', null);
    // "бо" should be filtered out, "страшн" (stem of страшно) should remain
    for (const t of tokens) {
        expect(t.length).toBeGreaterThanOrEqual(3);
    }
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/query-context.test.js`
- Expect: FAIL — `бо` (2 chars) is in the token list

**Step 3: Implementation (Green)**
- File: `src/retrieval/math.js`
- In `tokenize()` function (~line 75), add a second length filter after `.map(stemWord)`:
```js
export function tokenize(text) {
    if (!text) return [];
    return (text.toLowerCase().match(/[\p{L}0-9_]+/gu) || [])
        .filter(word => word.length > 2 && !STOP_WORDS.has(word))
        .map(stemWord)
        .filter(word => word.length > 2);  // ← ADD THIS LINE
}
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/query-context.test.js`
- Expect: PASS

**Step 5: Run Full Test Suite**
- Command: `npx vitest run`
- Expect: All tests pass (some existing token assertions may need stem-length adjustment)

**Step 6: Git Commit**
- Command: `git add -A && git commit -m "fix: add post-stem length filter to tokenize()"`

---

### Task 2: Alpha-Blend Scoring — Settings & Constants

**Goal:** Replace `vectorSimilarityWeight` + `keywordMatchWeight` with `alpha` + `combinedBoostWeight` in constants and settings wiring.

**Step 1: Write the Failing Test**
- File: `tests/constants.test.js`
- Add test:
```js
it('has alpha and combinedBoostWeight in defaultSettings', () => {
    expect(defaultSettings.alpha).toBe(0.7);
    expect(defaultSettings.combinedBoostWeight).toBe(15);
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/constants.test.js`
- Expect: FAIL — properties don't exist

**Step 3: Implementation (Green)**
- File: `src/constants.js`
- In `defaultSettings`, replace:
  - `vectorSimilarityWeight: 15` → keep for migration, add `alpha: 0.7`
  - `keywordMatchWeight: 3.0` → keep for migration, add `combinedBoostWeight: 15`
- Keep old keys present for backwards compat during migration (Task 5 will handle UI migration).
- Update `QUERY_CONTEXT_DEFAULTS` — no changes needed (entityBoostWeight stays).
- Update `UI_DEFAULT_HINTS` — replace `vectorSimilarityWeight`/`keywordMatchWeight` with `alpha`/`combinedBoostWeight`.

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/constants.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add -A && git commit -m "feat: add alpha and combinedBoostWeight to defaultSettings"`

---

### Task 3: Alpha-Blend Scoring — Core Math

**Goal:** Change `calculateScore()` and `scoreMemories()` in `math.js` to use alpha-blend instead of additive scoring.

**Step 1: Write the Failing Tests**
- File: `tests/scoring.test.js` (or a new `tests/math.test.js` for unit testing `calculateScore` directly)
- Import `calculateScore, scoreMemories` from `src/retrieval/math.js`
- Add tests:

```js
describe('alpha-blend scoring', () => {
    it('BM25 bonus is capped at (1-alpha) * combinedBoostWeight', () => {
        const memory = { importance: 3, message_ids: [50], embedding: [1, 0, 0] };
        const contextEmbedding = [1, 0, 0]; // perfect similarity
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        // Huge raw BM25 score
        const result = calculateScore(memory, contextEmbedding, 100, constants, settings, 999);
        // BM25 bonus should be at most (1 - 0.7) * 15 = 4.5
        expect(result.bm25Bonus).toBeLessThanOrEqual(4.5);
    });

    it('vector bonus uses alpha * combinedBoostWeight', () => {
        const memory = { importance: 3, message_ids: [100], embedding: [1, 0, 0] };
        const contextEmbedding = [1, 0, 0]; // sim = 1.0
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const result = calculateScore(memory, contextEmbedding, 100, constants, settings, 0);
        // Vector bonus = alpha * weight * normalizedSim = 0.7 * 15 * 1.0 = 10.5
        expect(result.vectorBonus).toBeCloseTo(10.5, 1);
    });

    it('scoreMemories normalizes BM25 scores across batch', () => {
        const memories = [
            { summary: 'dragon attacked village', importance: 3, message_ids: [90] },
            { summary: 'dragon fled to mountain', importance: 3, message_ids: [80] },
            { summary: 'peaceful day in town', importance: 3, message_ids: [70] },
        ];
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const results = scoreMemories(memories, null, 100, constants, settings, ['dragon']);
        // The memory with highest BM25 gets normalizedBM25 = 1.0
        // But its bonus is capped at (1 - 0.7) * 15 = 4.5
        for (const r of results) {
            expect(r.breakdown.bm25Bonus).toBeLessThanOrEqual(4.5 + 0.01);
        }
    });

    it('gracefully handles all-zero BM25 scores', () => {
        const memories = [
            { summary: 'no match here', importance: 3, message_ids: [90] },
        ];
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        const results = scoreMemories(memories, null, 100, constants, settings, ['zzzzz']);
        expect(results[0].breakdown.bm25Bonus).toBe(0);
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/scoring.test.js` (or `tests/math.test.js`)
- Expect: FAIL — `calculateScore` still uses additive

**Step 3: Implementation (Green)**
- File: `src/retrieval/math.js`

**3a. Update `calculateScore()`:**
Replace the BM25 bonus and vector bonus section:
```js
// === Vector Similarity Bonus (alpha-blend) ===
let vectorBonus = 0;
let vectorSimilarity = 0;
const alpha = settings.alpha ?? 0.7;
const boostWeight = settings.combinedBoostWeight ?? 15;

if (contextEmbedding && memory.embedding) {
    vectorSimilarity = cosineSimilarity(contextEmbedding, memory.embedding);
    const threshold = settings.vectorSimilarityThreshold || 0.5;
    if (vectorSimilarity > threshold) {
        const normalizedSim = (vectorSimilarity - threshold) / (1 - threshold);
        vectorBonus = alpha * boostWeight * normalizedSim;
    }
}

// === BM25 Bonus (alpha-blend, pre-normalized to [0,1]) ===
// bm25Score is expected to be normalized [0,1] by scoreMemories()
const bm25Bonus = (1 - alpha) * boostWeight * bm25Score;
```

**3b. Update `scoreMemories()`:**
After computing all raw BM25 scores, normalize before passing to `calculateScore`:
```js
// Compute raw BM25 scores
const rawBM25Scores = memories.map((memory, index) => {
    if (tokens && idfMap && memoryTokensList) {
        return bm25Score(tokens, memoryTokensList[index], idfMap, avgDL);
    }
    return 0;
});

// Batch-max normalize BM25 to [0, 1]
const maxBM25 = Math.max(...rawBM25Scores, 1e-9);
const normalizedBM25Scores = rawBM25Scores.map(s => s / maxBM25);

const scored = memories.map((memory, index) => {
    const breakdown = calculateScore(
        memory, contextEmbedding, chatLength, constants, settings, normalizedBM25Scores[index]
    );
    return { memory, score: breakdown.total, breakdown };
});
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/scoring.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add -A && git commit -m "feat: alpha-blend scoring replaces additive BM25+vector"`

---

### Task 4: IDF-Aware Entity Boost

**Goal:** Scale entity token repetitions inversely by document frequency so corpus-common entities (e.g. `Suzy`) get fewer repeats.

**Step 1: Write the Failing Test**
- File: `tests/scoring.test.js` (or `tests/math.test.js`)
```js
describe('IDF-aware entity boost', () => {
    it('reduces query TF for corpus-common entity tokens', () => {
        // 10 memories all containing "suzi" (stemmed Suzy)
        const memories = Array.from({ length: 10 }, (_, i) => ({
            summary: `Suzy did thing ${i}`,
            importance: 3,
            message_ids: [i * 10],
        }));
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        // Query with "suzi" repeated 15 times (entity boost)
        const queryTokens = Array(15).fill('suzi');
        const results = scoreMemories(memories, null, 100, constants, settings, queryTokens);

        // With IDF-aware adjustment, "suzi" appears in all 10 docs → IDF ≈ 0
        // So BM25 scores should be very low, near zero
        for (const r of results) {
            expect(r.breakdown.bm25Bonus).toBeLessThan(1.0);
        }
    });

    it('preserves query TF for corpus-rare entity tokens', () => {
        // 10 memories, only 1 containing "dragon"
        const memories = [
            { summary: 'dragon attacked village', importance: 3, message_ids: [90] },
            ...Array.from({ length: 9 }, (_, i) => ({
                summary: `peaceful day number ${i}`,
                importance: 3,
                message_ids: [i * 10],
            })),
        ];
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
        const settings = {
            vectorSimilarityThreshold: 0.5,
            alpha: 0.7,
            combinedBoostWeight: 15,
        };
        // Query with "dragon" repeated 15 times
        const queryTokens = Array(15).fill('dragon');
        const results = scoreMemories(memories, null, 100, constants, settings, queryTokens);

        // "dragon" is rare (1/10 docs), IDF is high → BM25 should be meaningful
        const dragonMemory = results.find(r => r.memory.summary.includes('dragon'));
        expect(dragonMemory.breakdown.bm25Bonus).toBeGreaterThan(0.5);
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/scoring.test.js`
- Expect: FAIL — first test fails because "suzi" in all docs still gets inflated BM25 from 15 query repeats (IDF is already low via standard BM25, but query TF amplifies)

Wait — standard BM25 already uses IDF which penalizes corpus-common terms. The real issue is that **query TF** (15 repeats of `suzi`) makes even a tiny IDF produce a non-trivial score. The fix from the design is to **adjust query token frequencies** using IDF *before* scoring.

**Step 3: Implementation (Green)**
- File: `src/retrieval/math.js`
- In `scoreMemories()`, after computing IDF data but before BM25 scoring, adjust query tokens:

```js
// IDF-aware query TF adjustment: reduce repeated tokens proportional to their IDF
// This prevents entity-boosted corpus-common tokens (e.g. main character name) from inflating scores
function adjustQueryTokensByIDF(queryTokens, idfMap, totalDocs) {
    if (!queryTokens || queryTokens.length === 0 || !idfMap) return queryTokens;

    const maxIDF = Math.log(totalDocs + 1); // IDF when df=0 (corpus-unique)
    if (maxIDF <= 0) return queryTokens;

    // Count unique tokens and their frequencies
    const tokenCounts = new Map();
    for (const t of queryTokens) {
        tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
    }

    // Build adjusted token array
    const adjusted = [];
    for (const [token, count] of tokenCounts.entries()) {
        const idf = idfMap.get(token) ?? maxIDF; // unknown terms get max IDF (corpus-unique)
        const idfRatio = idf / maxIDF;            // [0, 1]
        const adjustedCount = Math.max(1, Math.round(count * idfRatio));
        for (let i = 0; i < adjustedCount; i++) {
            adjusted.push(token);
        }
    }
    return adjusted;
}
```

Then call it in `scoreMemories()` after IDF computation, before BM25 scoring:
```js
// Apply IDF-aware TF adjustment
const adjustedTokens = adjustQueryTokensByIDF(tokens, idfMap, memories.length);
// Use adjustedTokens instead of tokens for BM25 scoring
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/scoring.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add -A && git commit -m "feat: IDF-aware query token adjustment for entity boost"`

---

### Task 5: Settings Migration & UI

**Goal:** Update settings wiring, UI sliders, and debug output to use `alpha` + `combinedBoostWeight`. Migrate existing user settings.

**Step 1: Write the Failing Test**
- No new unit test needed — this is UI/settings wiring. Manual verification.

**Step 2: Implementation**

**2a. File: `src/retrieval/scoring.js` (~line 56-59)**
- Update `getScoringConfig()` to pass new settings:
```js
settings: {
    vectorSimilarityThreshold: settings.vectorSimilarityThreshold,
    alpha: settings.alpha ?? 0.7,
    combinedBoostWeight: settings.combinedBoostWeight ?? 15,
    // Keep old keys for any code that still reads them during transition
    vectorSimilarityWeight: settings.vectorSimilarityWeight,
    keywordMatchWeight: settings.keywordMatchWeight ?? 1.0,
}
```

**2b. File: `src/ui/settings.js`**
- Replace slider bindings (~line 131-133):
  - `openvault_vector_weight` → bind to `alpha` (range 0-1, step 0.05)
  - `openvault_keyword_weight` → bind to `combinedBoostWeight` (range 1-30, step 1)
- Update value display (~line 235-239) accordingly.
- Add migration: if `alpha` not set but `vectorSimilarityWeight`/`keywordMatchWeight` exist, compute:
  ```js
  const vw = settings.vectorSimilarityWeight ?? 15;
  const kw = settings.keywordMatchWeight ?? 3.0;
  settings.alpha = vw / (vw + kw);
  settings.combinedBoostWeight = vw;
  ```

**2c. File: `templates/settings_panel.html` (~line 291-306)**
- Replace the two sliders:
  - Slider 1: "Vector vs Keyword Balance" → id `openvault_alpha`, range 0-1 step 0.05, default 0.7
  - Slider 2: "Retrieval Boost Strength" → id `openvault_combined_weight`, range 1-30 step 1, default 15

**2d. File: `src/ui/debug.js` (~line 149)**
- Update footer from `vectorWeight=... keywordWeight=...` to `alpha=... boostWeight=...`

**Step 3: Verify**
- Command: `npx vitest run`
- Expect: All tests pass
- Manual: Load extension in SillyTavern, confirm sliders render and save correctly

**Step 4: Git Commit**
- Command: `git add -A && git commit -m "feat: migrate settings UI to alpha-blend sliders"`

---

### Task 6: Update Existing Tests

**Goal:** Fix any tests broken by the scoring formula change (scoring.test.js MockWorker uses old additive formula).

**Step 1: Identify Breakage**
- Command: `npx vitest run`
- Look at failures in `tests/scoring.test.js` — the `MockWorker` class (~line 26-55) replicates the old additive scoring formula. It needs updating to match the new alpha-blend.

**Step 2: Implementation**
- File: `tests/scoring.test.js`
- Update `MockWorker.postMessage()` to use alpha-blend:
```js
// Replace:
//   const maxBonus = settings.vectorSimilarityWeight || 15;
//   score += normalizedSim * maxBonus;
// With:
const alpha = settings.alpha ?? 0.7;
const boostWeight = settings.combinedBoostWeight ?? 15;
score += alpha * boostWeight * normalizedSim;
```
- Update `mockSettings` to include `alpha: 0.7, combinedBoostWeight: 15` alongside old keys.

**Step 3: Verify**
- Command: `npx vitest run`
- Expect: All tests pass

**Step 4: Git Commit**
- Command: `git add -A && git commit -m "test: update MockWorker and settings to alpha-blend scoring"`

---

### Task 7: Embedding Prompt Prefix (Bonus)

**Goal:** Add `task: X | query:` instructional prompt prefix to embeddinggemma embeddings for improved similarity quality.

**Step 1: Write the Failing Test**
- File: `tests/embeddings.test.js`
```js
it('prepends instructional prompt to text for Transformers strategy', async () => {
    // After implementation, getEmbedding should prepend the configured prompt
    // This test verifies the pipe is called with the prefixed text
    // (Exact test depends on existing mock structure)
});
```

**Step 2: Implementation**
- File: `src/embeddings/strategies.js` — `TransformersStrategy.getEmbedding()` (~line 250):
```js
async getEmbedding(text) {
    if (!text || text.trim().length === 0) return null;
    try {
        const pipe = await this.#loadPipeline(this.#currentModelKey);
        const prompt = this.#getEmbeddingPrompt();
        const input = prompt ? `${prompt}${text.trim()}` : text.trim();
        const output = await pipe(input, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    } catch (error) {
        log(`Transformers embedding error: ${error?.message || error || 'unknown'}`);
        return null;
    }
}
```
- Add `#getEmbeddingPrompt()` method that reads from settings (default: `'task: sentence similarity | query: '`).
- File: `src/constants.js` — add `embeddingPrompt: 'task: sentence similarity | query: '` to `defaultSettings`.
- File: `templates/settings_panel.html` — add dropdown for prompt selection (STS, narrative similarity, romantic scene similarity, custom).
- File: `src/ui/settings.js` — bind the dropdown.

**⚠️ WARNING:** Changing the prompt **invalidates all stored embeddings**. Must trigger re-embed notification. Add a check: if `embeddingPrompt` setting changes, mark all embeddings as stale.

**Step 3: Verify**
- Command: `npx vitest run`
- Expect: PASS
- Manual: Confirm prompt prefix appears in pipeline call; test with debug log showing similarity improvement.

**Step 4: Git Commit**
- Command: `git add -A && git commit -m "feat: add instructional prompt prefix for embeddinggemma models"`

---

## Execution Order

```
Task 1 (post-stem filter)     ← standalone, no deps
Task 2 (settings/constants)   ← standalone
Task 3 (alpha-blend math)     ← depends on Task 2
Task 4 (IDF entity boost)     ← depends on Task 3
Task 5 (UI migration)         ← depends on Task 2 + 3
Task 6 (fix existing tests)   ← depends on Task 3
Task 7 (embedding prompt)     ← standalone, bonus
```

Tasks 1, 2, and 7 can be done in parallel.
Tasks 3-6 are sequential.
