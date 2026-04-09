# Edge Case Robustness, Unchained Promises, Skipped Test

**Goal:** Harden three categories of quality debt: division-by-zero in scoring math, debug console.log in production, chained merge redirects, and unchained `.then()` calls.
**Architecture:** All changes are in existing files. No new modules. Changes are purely defensive — clamping values, swapping logging calls, adding `.catch()` handlers, and making `_resolveKey` follow redirect chains.
**Tech Stack:** Vitest, existing test patterns from `tests/retrieval/math.test.js` and `tests/graph/graph.test.js`

**Common Pitfalls:**
- `calculateScore` is tested via parameterized `it.each()` in `tests/retrieval/math.test.js` — follow the same inline-object style for new cases
- `_resolveKey` is private (prefixed with `_`) — test it indirectly through `upsertRelationship` which calls it internally
- The `settings.js` clipboard `.then()` calls are identical patterns — use `.catch(() => {})` consistently
- The `events.js:280` and `settings.js:738` backfill `.then()` already have `.catch(() => {})` on the inner call but the outer dynamic `import().then()` is unchained — add `.catch(() => {})` to the outer
- Never import `logDebug` in `query-context.js` — use the already-imported `tokenize` from `./math.js` style; instead, import from `../utils/logging.js`

---

### File Structure Overview

- Modify: `src/retrieval/math.js` — clamp `vectorSimilarityThreshold` to prevent division by zero
- Modify: `src/graph/graph.js` — make `_resolveKey` follow chained redirects with max-depth guard
- Modify: `src/retrieval/query-context.js` — replace `console.log` with `logDebug`
- Modify: `src/ui/render.js` — add `.catch(() => {})` to clipboard `.then()`
- Modify: `src/ui/settings.js` — add `.catch(() => {})` to clipboard `.then()` and outer backfill `.then()`
- Modify: `src/events.js` — add `.catch(() => {})` to outer backfill `.then()`
- Modify: `tests/retrieval/math.test.js` — add test for threshold=1.0 edge case
- Modify: `tests/graph/graph.test.js` — add test for chained merge redirects
- Modify: `tests/extraction/extract.test.js` — remove skipped test

---

### Task 1: Clamp vectorSimilarityThreshold to prevent division by zero

**Files:**
- Modify: `src/retrieval/math.js`
- Test: `tests/retrieval/math.test.js`

- [ ] Step 1: Write the failing test

Add this test block inside `tests/retrieval/math.test.js` after the existing `Access-Reinforced Decay` describe block:

```javascript
describe('calculateScore - threshold edge cases', () => {
    it('should not produce Infinity when vectorSimilarityThreshold is 0.99', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = {
            importance: 3,
            message_ids: [100],
            _proxyVectorScore: 0.995,
        };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 0.99, alpha: 0.7, combinedBoostWeight: 15 };
        const result = calculateScore(memory, null, 100, constants, settings, 0);
        expect(result.vectorBonus).toBeFinite();
        expect(result.total).toBeFinite();
    });

    it('should not produce Infinity when vectorSimilarityThreshold is 1.0', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const memory = {
            importance: 3,
            message_ids: [100],
            _proxyVectorScore: 1.0,
        };
        const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 1.0, reflectionDecayThreshold: 750 };
        const settings = { vectorSimilarityThreshold: 1.0, alpha: 0.7, combinedBoostWeight: 15 };
        const result = calculateScore(memory, null, 100, constants, settings, 0);
        expect(result.vectorBonus).toBeFinite();
        expect(result.total).toBeFinite();
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/retrieval/math.test.js`
Expected: FAIL — `vectorBonus` is `Infinity` when threshold is 1.0

- [ ] Step 3: Write minimal implementation

In `src/retrieval/math.js`, the normalization `(vectorSimilarity - threshold) / (1 - threshold)` appears in three places (lines 311, 321, 569). All three are inside `if (vectorSimilarity > threshold)` blocks. The fix is to clamp the denominator. Replace each occurrence:

At line 311:
```javascript
// Before:
const normalizedSim = (vectorSimilarity - threshold) / (1 - threshold);
// After:
const denominator = 1 - threshold;
const normalizedSim = denominator > 0 ? (vectorSimilarity - threshold) / denominator : 0;
```

At line 321:
```javascript
// Before:
const normalizedSim = (vectorSimilarity - threshold) / (1 - threshold);
// After:
const denominator = 1 - threshold;
const normalizedSim = denominator > 0 ? (vectorSimilarity - threshold) / denominator : 0;
```

At line 569:
```javascript
// Before:
const normalizedSim = (vectorSimilarity - threshold) / (1 - threshold);
// After:
const denominator = 1 - threshold;
const normalizedSim = denominator > 0 ? (vectorSimilarity - threshold) / denominator : 0;
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/retrieval/math.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: prevent division by zero when vectorSimilarityThreshold >= 1.0"
```

---

### Task 2: Make _resolveKey follow chained merge redirects

**Files:**
- Modify: `src/graph/graph.js`
- Test: `tests/graph/graph.test.js`

- [ ] Step 1: Write the failing test

Add this test block inside `tests/graph/graph.test.js` after the existing `_mergeRedirects serialization` describe block:

```javascript
describe('_resolveKey chained redirects', () => {
    it('should follow A→B→C redirect chain and return C', async () => {
        const { upsertRelationship } = await import('../../src/graph/graph.js');

        const graphData = { nodes: {}, edges: {}, _mergeRedirects: {} };

        // Create three nodes
        graphData.nodes['alice'] = { name: 'Alice', type: 'PERSON', description: 'desc', mentions: 1 };
        graphData.nodes['alice smith'] = { name: 'Alice Smith', type: 'PERSON', description: 'desc', mentions: 1 };
        graphData.nodes['alison'] = { name: 'Alison', type: 'PERSON', description: 'desc', mentions: 1 };

        // Set up chain: alice → alice smith → alison
        graphData._mergeRedirects['alice'] = 'alice smith';
        graphData._mergeRedirects['alice smith'] = 'alison';

        // upsertRelationship uses _resolveKey internally for both source and target
        upsertRelationship(graphData, 'alice', 'bob', 'knows bob', 5);
        upsertRelationship(graphData, 'charlie', 'alice smith', 'met alice smith', 5);

        // Edge from alice should land on 'alison' (final resolved target)
        const edgeToAlison = graphData.edges['alison__bob'];
        expect(edgeToAlison).toBeDefined();
        expect(edgeToAlison.description).toBe('knows bob');

        // Edge to alice smith should also land on 'alison'
        const edgeFromCharlie = graphData.edges['charlie__alison'];
        expect(edgeFromCharlie).toBeDefined();
        expect(edgeFromCharlie.description).toBe('met alice smith');
    });

    it('should break circular redirect chains', async () => {
        const { upsertRelationship } = await import('../../src/graph/graph.js');

        const graphData = { nodes: {}, edges: {}, _mergeRedirects: {} };

        // Create two nodes
        graphData.nodes['bob'] = { name: 'Bob', type: 'PERSON', description: 'desc', mentions: 1 };
        graphData.nodes['charlie'] = { name: 'Charlie', type: 'PERSON', description: 'desc', mentions: 1 };

        // Create circular redirect (should not happen in practice, but defensive)
        graphData._mergeRedirects['bob'] = 'charlie';
        graphData._mergeRedirects['charlie'] = 'bob';

        upsertRelationship(graphData, 'bob', 'dave', 'knows dave', 5);

        // Should not infinite-loop — either bob or charlie key should exist
        const hasEdge = !!graphData.edges['bob__dave'] || !!graphData.edges['charlie__dave'];
        expect(hasEdge).toBe(true);
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/graph/graph.test.js`
Expected: FAIL — edge lands on `alice smith__bob` instead of `alison__bob` (chain not followed)

- [ ] Step 3: Write minimal implementation

In `src/graph/graph.js`, replace the `_resolveKey` function (lines 62-65):

```javascript
// Before:
function _resolveKey(graphData, rawName) {
    const key = normalizeKey(rawName);
    return graphData._mergeRedirects?.[key] || key;
}

// After:
const MAX_REDIRECT_DEPTH = 10;

function _resolveKey(graphData, rawName) {
    const key = normalizeKey(rawName);
    const visited = new Set();
    let current = key;

    while (graphData._mergeRedirects?.[current]) {
        if (visited.has(current)) break; // Circular redirect guard
        visited.add(current);
        current = graphData._mergeRedirects[current];
        if (visited.size > MAX_REDIRECT_DEPTH) break; // Depth guard
    }

    return current;
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/graph/graph.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: _resolveKey follows chained merge redirects with depth guard"
```

---

### Task 3: Replace console.log with logDebug in query-context.js

**Files:**
- Modify: `src/retrieval/query-context.js`

- [ ] Step 1: Add import for logDebug

At the top of `src/retrieval/query-context.js`, add the import after the existing imports:

```javascript
import { logDebug } from '../utils/logging.js';
```

- [ ] Step 2: Replace console.log with logDebug

At line 192-210, replace the DEBUG block:

```javascript
// Before:
        // DEBUG: Log corpus grounding behavior
        if (msgStems.length > 0) {
            console.log('[BM25-DEBUG] Three-tier BM25:', {
                msgStems: msgStems.slice(0, 20),
                groundedCount: grounded.length,
                nonGroundedCount: nonGrounded.length,
                sampleGrounded: grounded.slice(0, 10),
                sampleNonGrounded: nonGrounded.slice(0, 10),
                vocabSize: corpusVocab.size,
                weights: {
                    layer1: `${settings.entityBoostWeight}x (entities)`,
                    layer2: `${Math.ceil(settings.entityBoostWeight * CORPUS_GROUNDED_BOOST_RATIO)}x (grounded)`,
                    layer3: `${Math.ceil(settings.entityBoostWeight * NON_GROUNDED_BOOST_RATIO)}x (non-grounded)`,
                },
            });
        }

// After:
        if (msgStems.length > 0) {
            logDebug('[BM25] Three-tier grounding:', {
                grounded: grounded.length,
                nonGrounded: nonGrounded.length,
                vocabSize: corpusVocab.size,
            });
        }
```

- [ ] Step 3: Run tests to verify no regressions

Run: `npx vitest run tests/retrieval/query-context.test.js`
Expected: PASS

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "fix: replace console.log with logDebug in query-context"
```

---

### Task 4: Add .catch() to unchained .then() calls (7 instances)

**Files:**
- Modify: `src/events.js`
- Modify: `src/ui/render.js`
- Modify: `src/ui/settings.js`

- [ ] Step 1: Fix `src/events.js:280`

```javascript
// Before:
            import('./embeddings.js').then(({ backfillAllEmbeddings }) => {
                backfillAllEmbeddings({ silent: true }).catch(() => {});
            });

// After:
            import('./embeddings.js').then(({ backfillAllEmbeddings }) => {
                backfillAllEmbeddings({ silent: true }).catch(() => {});
            }).catch(() => {});
```

- [ ] Step 2: Fix `src/ui/render.js:889`

```javascript
// Before:
        navigator.clipboard.writeText(macroText).then(
            () => showToast('success', `Copied {{${macro}}} to clipboard`),
            () => showToast('error', 'Failed to copy')
        );

// After:
        navigator.clipboard.writeText(macroText).then(
            () => showToast('success', `Copied {{${macro}}} to clipboard`),
            () => showToast('error', 'Failed to copy')
        ).catch(() => {});
```

- [ ] Step 3: Fix `src/ui/settings.js:738` (outer dynamic import)

```javascript
// Before:
                import('../embeddings.js').then(({ backfillAllEmbeddings }) => {
                    backfillAllEmbeddings({ silent: true })
                        .then(() => refreshAllUI())
                        .catch(() => {});
                });

// After:
                import('../embeddings.js').then(({ backfillAllEmbeddings }) => {
                    backfillAllEmbeddings({ silent: true })
                        .then(() => refreshAllUI())
                        .catch(() => {});
                }).catch(() => {});
```

- [ ] Step 4: Fix `src/ui/settings.js:823` (perf clipboard)

```javascript
// Before:
        navigator.clipboard.writeText(text).then(
            () => showToast('success', 'Perf data copied to clipboard'),
            () => showToast('error', 'Failed to copy — try selecting manually')
        );

// After:
        navigator.clipboard.writeText(text).then(
            () => showToast('success', 'Perf data copied to clipboard'),
            () => showToast('error', 'Failed to copy — try selecting manually')
        ).catch(() => {});
```

- [ ] Step 5: Fix `src/ui/settings.js:869` (memory macro)

```javascript
// Before:
        navigator.clipboard.writeText('{{openvault_memory}}').then(
            () => showToast('success', 'Copied {{openvault_memory}} to clipboard'),
            () => showToast('error', 'Failed to copy')
        );

// After:
        navigator.clipboard.writeText('{{openvault_memory}}').then(
            () => showToast('success', 'Copied {{openvault_memory}} to clipboard'),
            () => showToast('error', 'Failed to copy')
        ).catch(() => {});
```

- [ ] Step 6: Fix `src/ui/settings.js:876` (world macro)

```javascript
// Before:
        navigator.clipboard.writeText('{{openvault_world}}').then(
            () => showToast('success', 'Copied {{openvault_world}} to clipboard'),
            () => showToast('error', 'Failed to copy')
        );

// After:
        navigator.clipboard.writeText('{{openvault_world}}').then(
            () => showToast('success', 'Copied {{openvault_world}} to clipboard'),
            () => showToast('error', 'Failed to copy')
        ).catch(() => {});
```

- [ ] Step 7: Verify no regressions

Run: `npm test`
Expected: All tests PASS

- [ ] Step 8: Commit

```bash
git add -A && git commit -m "fix: add .catch() to unchained .then() calls to prevent unhandled rejections"
```

---

### Task 5: Remove skipped test

**Files:**
- Modify: `tests/extraction/extract.test.js`

- [ ] Step 1: Remove the skipped test

In `tests/extraction/extract.test.js`, remove lines 371-393 (the `it.skip(...)` block including its body). The test tested `extractAllMessages` with an `isEmergencyCut` flag option — this feature is already covered by integration tests in `tests/integration/emergency-cut.test.js`.

- [ ] Step 2: Verify tests pass

Run: `npm test`
Expected: All tests PASS, one fewer test in the count

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "chore: remove skipped emergency-cut flag test (covered by integration tests)"
```
