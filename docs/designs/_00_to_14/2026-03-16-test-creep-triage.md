# Test Creep Triage: Workflow + Parameterization

**Status:** Design Ready for Review
**Scope:** Phase 1 (Workflow Optimization) + Phase 2 (Parameterization Compression)
**Target:** 1,074 tests → ~700 tests (35% reduction) + Sub-second dev loop

---

## 1. Problem Statement

Current state:
- **1,074 tests** across 63 files
- Top 5 files contain **360+ tests** (33% of suite)
- No documented workflow for selective test running
- Copy-paste test patterns inflate count artificially

Impact:
- TDD loop exceeds 5 seconds (cognitive flow broken)
- Fear of modifying tests (high coupling via shared fixtures)
- CI passes but local development is painful

---

## 2. Phase 1: Workflow Optimization (Stop the Bleeding)

**Goal:** Change how developers interact with tests—no code changes yet.

### 2.1 Vitest Configuration

**Update `vitest.config.js`:**

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude heavy directories from watch
    watchExclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/docs/**',
      '**/.git/**',
    ],
    // Default to run mode in CI, watch mode locally
    watch: !process.env.CI,
    // Fail fast during development
    bail: process.env.CI ? 0 : 3,
    // Reporter: verbose locally, dot in CI
    reporter: process.env.CI ? 'dot' : 'verbose',
    // Pool options for speed
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 4,
      },
    },
  },
});
```

### 2.2 NPM Scripts

**Update `package.json`:**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:changed": "vitest --changed=HEAD~1 --run",
    "test:watch": "vitest",
    "test:related": "vitest --run --reporter=dot related",
    "test:math": "vitest --run tests/math.test.js tests/retrieval/math.test.js",
    "test:extract": "vitest --run tests/extraction/",
    "test:ci": "vitest run --coverage --reporter=junit"
  }
}
```

### 2.3 Git Hooks (Optional)

**`.husky/pre-commit`** (if using husky):

```bash
#!/bin/sh
# Only run tests related to changed files
npx vitest --changed --run --silent
```

### 2.4 Documentation Update

**Update `@tests/CLAUDE.md`:**

```markdown
## Test Development Workflow

### Quick Development Loop (Use This)
```bash
# While working on specific module — watches only that file
npx vitest tests/math.test.js

# After making changes — runs only tests affected by uncommitted changes
npm run test:changed

# For rapid iteration — interactive filter mode
npx vitest
# Then press 'p' → type pattern → 't' → type test name
```

### Pre-Commit (Full Suite)
```bash
npm test  # or: npx vitest --run
```

### Emergency Escape Hatches
```bash
# Skip tests entirely (not recommended)
git commit --no-verify

# Run specific test by name
npx vitest -t "tokenize filters"
```

### When to Run What

| Scenario | Command | Why |
|----------|---------|-----|
| Active TDD on math.js | `npx vitest tests/math.test.js` | <1s feedback |
| Finished feature | `npm run test:changed` | Catches regressions |
| Refactoring shared code | `npm test` | Full coverage |
| CI/Pre-commit | `npm test` | Gatekeeping |
```

---

## 3. Phase 2: Parameterization Compression

**Goal:** Replace repetitive `it()` blocks with `it.each()` tables.

**Target Files** (highest ROI):

| File | Current Tests | Est. After | Savings |
|------|--------------|------------|---------|
| `tests/prompts.test.js` | 103 | ~25 | 78 |
| `tests/ui-helpers.test.js` | 83 | ~20 | 63 |
| `tests/graph/graph.test.js` | 74 | ~20 | 54 |
| `tests/formatting.test.js` | 55 | ~15 | 40 |
| `tests/utils/text.test.js` | 47 | ~12 | 35 |
| **Subtotal** | **362** | **~92** | **~270** |

### 3.1 Pattern: Pure Function Parameterization

**Before** (from `math.test.js`):

```javascript
it('filters post-stem runt tokens (< 3 chars after stemming)', () => {
  const tokens = tokenize('боюсь страшно');
  for (const t of tokens) {
    expect(t.length).toBeGreaterThanOrEqual(3);
  }
});

it('filters stop words', () => {
  const tokens = tokenize('the dragon and the princess');
  expect(tokens).not.toContain('the');
  expect(tokens).not.toContain('and');
  expect(tokens).toContain('dragon');
  expect(tokens).toContain('princess');
});

it('handles Russian stemming correctly', () => {
  const tokens = tokenize('драконы дракону');
  expect(tokens).toContain('дракон');
});
```

**After**:

```javascript
const TOKENIZE_CASES = [
 {
   name: 'filters post-stem runt tokens',
   input: 'боюсь страшно',
   expectMinLength: 3,
 },
 {
   name: 'filters stop words',
   input: 'the dragon and the princess',
   notContains: ['the', 'and'],
   contains: ['dragon', 'princess'],
 },
 {
   name: 'handles Russian stemming',
   input: 'драконы дракону',
   contains: ['дракон'],
 },
];

it.each(TOKENIZE_CASES)('$name', ({ input, expectMinLength, notContains, contains }) => {
  const tokens = tokenize(input);

  if (expectMinLength) {
    for (const t of tokens) {
      expect(t.length).toBeGreaterThanOrEqual(expectMinLength);
    }
  }

  if (notContains) {
    for (const word of notContains) {
      expect(tokens).not.toContain(word);
    }
  }

  if (contains) {
    for (const word of contains) {
      expect(tokens).toContain(word);
    }
  }
});
```

**Lines saved:** ~30% reduction, better readability, easier to add cases.

### 3.2 Pattern: Math/Scoring Parameterization

**Before** (from `math.test.js`):

```javascript
it('BM25 bonus is capped at (1-alpha) * combinedBoostWeight', () => {
  const memory = { importance: 3, message_ids: [50], embedding: [1, 0, 0] };
  const contextEmbedding = [1, 0, 0];
  const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
  const settings = {
    vectorSimilarityThreshold: 0.5,
    alpha: 0.7,
    combinedBoostWeight: 15,
  };
  const result = calculateScore(memory, contextEmbedding, 100, constants, settings, 1.0);
  expect(result.bm25Bonus).toBeCloseTo(4.5, 1);
});

it('vector bonus uses alpha * combinedBoostWeight', () => {
  const memory = { importance: 3, message_ids: [100], embedding: [1, 0, 0] };
  const contextEmbedding = [1, 0, 0];
  const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
  const settings = {
    vectorSimilarityThreshold: 0.5,
    alpha: 0.7,
    combinedBoostWeight: 15,
  };
  const result = calculateScore(memory, contextEmbedding, 100, constants, settings, 0);
  expect(result.vectorBonus).toBeCloseTo(10.5, 1);
});
```

**After**:

```javascript
const SCORE_CASES = [
  {
    name: 'BM25 bonus capped at (1-alpha) * weight',
    memory: { importance: 3, message_ids: [50], embedding: [1, 0, 0] },
    contextEmbedding: [1, 0, 0],
    settings: { alpha: 0.7, combinedBoostWeight: 15 },
    normalizedBm25: 1.0,
    expect: { field: 'bm25Bonus', closeTo: 4.5, precision: 1 },
  },
  {
    name: 'vector bonus uses alpha * weight',
    memory: { importance: 3, message_ids: [100], embedding: [1, 0, 0] },
    contextEmbedding: [1, 0, 0],
    settings: { alpha: 0.7, combinedBoostWeight: 15 },
    normalizedBm25: 0,
    expect: { field: 'vectorBonus', closeTo: 10.5, precision: 1 },
  },
];

const DEFAULT_CONSTANTS = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
const DEFAULT_SETTINGS = { vectorSimilarityThreshold: 0.5 };

it.each(SCORE_CASES)('$name', ({
  memory, contextEmbedding, settings, normalizedBm25, expect: exp
}) => {
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
  const result = calculateScore(
    memory, contextEmbedding, 100, DEFAULT_CONSTANTS, mergedSettings, normalizedBm25
  );

  if (exp.closeTo) {
    expect(result[exp.field]).toBeCloseTo(exp.closeTo, exp.precision);
  }
  if (exp.lte) {
    expect(result[exp.field]).toBeLessThanOrEqual(exp.lte);
  }
});
```

### 3.3 Pattern: Cosine Similarity Edge Cases

**Before** (6 separate tests):

```javascript
it('handles Float32Array inputs', () => { ... });
it('handles identical Float32Array vectors', () => { ... });
it('handles mixed Float32Array + number[] inputs', () => { ... });
it('handles vectors with length not divisible by 4', () => { ... });
it('handles length=1 vector', () => { ... });
it('handles length=4 vector', () => { ... });
```

**After**:

```javascript
const COSINE_CASES = [
  { name: 'Float32Array orthogonal', a: new Float32Array([1, 0, 0]), b: new Float32Array([0, 1, 0]), expect: 0 },
  { name: 'identical Float32Array', a: new Float32Array([0.5, 0.5, 0.5]), b: null, expect: 1.0, isSelf: true },
  { name: 'mixed Float32Array + number[]', a: new Float32Array([1, 0, 0]), b: [1, 0, 0], expect: 1.0 },
  { name: 'length not divisible by 4', a: new Float32Array([1, 2, 3, 4, 5]), b: new Float32Array([1, 2, 3, 4, 5]), expect: 1.0 },
  { name: 'length=1', a: new Float32Array([1]), b: new Float32Array([1]), expect: 1.0 },
  { name: 'length=4 orthogonal', a: new Float32Array([1, 0, 0, 0]), b: new Float32Array([0, 1, 0, 0]), expect: 0 },
];

it.each(COSINE_CASES)('$name', ({ a, b, expect: expected, isSelf }) => {
  const result = cosineSimilarity(a, isSelf ? a : b);
  expect(result).toBeCloseTo(expected, 10);
});
```

### 3.4 Pattern: Text Utility Parameterization

**Before** (from `utils/text.test.js`):

```javascript
describe('getMemoryPosition', () => {
  it('returns recent for messages near the end', () => { ... });
  it('returns old for messages at the start', () => { ... });
  it('returns mid for messages in the middle', () => { ... });
});
```

**After**:

```javascript
const POSITION_CASES = [
  { msgIndex: 95, total: 100, expected: 'recent', desc: 'near the end' },
  { msgIndex: 5, total: 100, expected: 'old', desc: 'at the start' },
  { msgIndex: 50, total: 100, expected: 'mid', desc: 'in the middle' },
  { msgIndex: 33, total: 100, expected: 'old', desc: 'at 33% boundary' },
  { msgIndex: 34, total: 100, expected: 'mid', desc: 'past 33% boundary' },
  { msgIndex: 66, total: 100, expected: 'mid', desc: 'at 66% boundary' },
  { msgIndex: 67, total: 100, expected: 'recent', desc: 'past 66% boundary' },
];

it.each(POSITION_CASES)('returns $expected for messages $desc', ({ msgIndex, total, expected }) => {
  expect(getMemoryPosition(msgIndex, total)).toBe(expected);
});
```

---

## 4. Implementation Plan

### Week 1: Phase 1 (Workflow)

- [ ] Update `vitest.config.js` with watch optimizations
- [ ] Add npm scripts to `package.json`
- [ ] Update `@tests/CLAUDE.md` with workflow documentation
- [ ] Test the workflow manually

**Deliverable:** Developers can run `npm run test:changed` and get <3s feedback.

### Week 2-3: Phase 2 (Parameterization)

Priority order (most savings first):

| Week | Files | Estimated Reduction |
|------|-------|---------------------|
| 2 | `tests/prompts.test.js` | 103 → 25 (-78) |
| 2 | `tests/ui-helpers.test.js` | 83 → 20 (-63) |
| 3 | `tests/graph/graph.test.js` | 74 → 20 (-54) |
| 3 | `tests/formatting.test.js` | 55 → 15 (-40) |
| 3 | `tests/utils/text.test.js` | 47 → 12 (-35) |

**Deliverable:** 5 files converted, ~270 tests removed.

---

## 5. Success Metrics

| Metric | Before | Target | Measurement |
|--------|--------|--------|-------------|
| Total test count | 1,074 | ~700 | `find tests -name "*.test.js" -exec grep -c "it(" {} \; \| awk '{sum+=$1} END {print sum}'` |
| Dev loop time | 5-10s | <3s | `time npm run test:changed` |
| Lines of test code | ~15,000 | ~10,000 | `find tests -name "*.test.js" -exec wc -l {} \; \| awk '{sum+=$1} END {print sum}'` |
| Test file readability | Low | High | Subjective: can add new case in 1 line? |

---

## 6. Rollback Plan

- Each parameterized file conversion is a separate commit
- Original tests preserved in git history
- If a parameterized test fails to catch a bug, revert that file and investigate

---

## 7. Future Work (Not in Scope)

- Phase 3: Prune redundant tests covered by integration tests
- Phase 4: Shift edge cases to unit tests (decouple orchestrators)
- Phase 5: Replace "god" fixtures with factory functions

---

**Ready for review.** Approve to proceed with implementation.