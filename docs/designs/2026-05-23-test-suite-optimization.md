# Test Suite Optimization: Maintenance Burden Reduction

**Date:** 2026-05-23
**Status:** Approved
**Goal:** Reduce maintenance burden by removing fragile tests that break on unrelated changes

## Summary

Consolidate ~1,000+ tests to ~600-700 tests by:
1. Replacing literal prompt assertions with topology checks
2. Removing timing/performance threshold tests
3. Consolidating mathematical permutations to boundary tests
4. Enforcing 3-test limit on orchestrator tests
5. Centralizing CDN fallback tests

**Preserved:** Behavioral invariant tests (hit damping, frequency factor, reflection decay, transient multiplier)

## Architecture

```
tests/
├── prompts/
│   └── topology.test.js       # NEW: Single topology test per builder
│   └── format.test.js         # DELETED (merged into topology)
│   └── prefill.test.js        # DELETED (merged into topology)
│   └── world-state/
│       └── builder.test.js    # DELETED (merged into topology)
├── perf/
│   └── reflection.test.js     # DELETED (timing assertions removed)
│   └── store.test.js          # KEPT (registers values correctly)
├── retrieval/
│   └── math.test.js           # CONSOLIDATED: 73 → ~20 tests
│   └── retrieve.test.js       # ORCHESTRATOR: 3 tests only
├── utils/
│   └── cdn.test.js            # NEW: CDN fallback tests consolidated
│   └── stemmer.test.js        # CDN fallback tests REMOVED
│   └── stopwords.test.js      # CDN fallback tests REMOVED
│   └ transliterate.test.js    # CDN fallback tests REMOVED
```

## Components

### 1. Prompt Topology Tests

**New file:** `tests/prompts/topology.test.js`

Replace literal assertions with structural checks:
- Role sequence verification (System → User → Assistant)
- Key presence checks (no literal string matching)
- Array length matches input counts
- Thinking block presence when input provides it

**Example:**
```javascript
it('formatExamples produces valid structure', () => {
  const result = formatExamples([{ input: 'test', output: '{}' }]);
  expect(typeof result).toBe('string');
  expect(result).toMatch(/<example_\d+>/);
  expect(result).toMatch(/<\/example_\d+>/);
});
```

### 2. Performance Tests

**Delete:** `tests/perf/reflection.test.js`

- Timing thresholds (`20000ms`) are constants, not behaviors
- Comparative performance claims (`faster than old pipeline`) are not invariants
- Store registration tests covered by `store.test.js`

### 3. Math Tests Consolidation

**Current:** 73 tests, 1,451 lines
**Target:** ~20 tests

| Group | Action |
|-------|--------|
| `cosineSimilarity` | 9 → 2 tests (short vector, long vector unrolling) |
| `calculateScore alpha-blend` | 4 → 1 boundary test |
| `hitDamping` | KEPT (behavioral invariant) |
| `frequencyFactor` | KEPT (behavioral invariant) |
| `reflection decay` | KEPT (behavioral invariant) |
| `transient decay` | KEPT (behavioral invariant) |
| `threshold edge cases` | 4 → 1 test (all edge values) |
| `large iterable (100K)` | REMOVED (slow, covered by unrolling) |
| `hasExactPhrase` | REMOVED (trivial string matching) |
| `exact phrase tokens` | 6 → 1 boost behavior test |

### 4. Orchestrator Tests

**Files:** `extract.test.js`, `retrieve.test.js`

**Enforced structure:**
1. Happy path (events + graph + reflection state populated)
2. Graceful degradation (LLM fails, fallback to stale data)
3. Fast-fail (invalid input throws AbortError)

**Removed:** Unit-level assertions moved to dedicated unit tests

### 5. CDN Fallback Consolidation

**New file:** `tests/utils/cdn.test.js`

Single test covering fallback mechanism. Individual utilities (stemmer, stopwords, transliterate) rely on this—no repetition needed.

## Execution Plan

### Step 1: Prompt Tests
1. Create `tests/prompts/topology.test.js` with topology checks
2. Delete `format.test.js`, `prefill.test.js`, `world-state/builder.test.js`
3. Run tests, verify pass

### Step 2: Performance Tests
1. Delete `tests/perf/reflection.test.js`
2. Run tests, verify pass

### Step 3: Math Tests
1. Consolidate `math.test.js`:
   - Keep behavioral invariants
   - Remove 384/768-dim reference tests
   - Remove large-iterable tests
   - Remove `hasExactPhrase`
   - Merge alpha-blend cases
2. Run tests, verify pass

### Step 4: Orchestrator Tests
1. Reduce `extract.test.js` to 3 tests
2. Reduce `retrieve.test.js` to 3 tests
3. Move unit assertions to dedicated files
4. Run tests, verify pass

### Step 5: CDN Fallback
1. Create `tests/utils/cdn.test.js`
2. Remove CDN fallback tests from stemmer, stopwords, transliterate
3. Run tests, verify pass

### Final Validation
- Run `npm run check` (typecheck, lint, tests)
- Verify test count reduced to ~600-700
- Verify execution time reduced

## Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Test files | 55 | ~50 |
| Test count | ~1000+ | ~600-700 |
| `math.test.js` lines | 1,451 | ~400 |

## Preserved Behavioral Invariants

- `hitDamping`: `1 / (1 + hits * 0.1)` capped at 0.5
- `frequencyFactor`: `1 + log(mentions) * 0.05`
- Reflection decay beyond threshold
- Transient decay multiplier
- NaN/Infinity clamping in scoring