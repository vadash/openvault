# Test Suite Optimization Implementation Plan

**Goal:** Reduce maintenance burden by removing fragile tests that break on unrelated changes
**Testing Conventions:** Unit tests with zero mocking, integration tests via `setupTestContext()`, orchestrator tests limited to 3 (happy/degrade/fail), use `it.each()` for permutations, no literal prompt content assertions.

---

### Task 1: Create CDN Fallback Test

**Objective:** Create a single test file for CDN fallback behavior, removing redundant tests from individual utility files.

**Files to modify/create:**
- Create: `tests/utils/cdn.test.js` (Purpose: Single test for `cdnImport` fallback mechanism)
- Modify: `tests/utils/stemmer.test.js` (Purpose: Remove "CDN unavailable fallback" describe block)
- Modify: `tests/utils/stopwords.test.js` (Purpose: Remove "CDN unavailable fallback" describe block)
- Modify: `tests/utils/transliterate.test.js` (Purpose: Remove "falls back to lowercase when CDN unavailable" test)
- Modify: `tests/utils/tokens.test.js` (Purpose: Remove CDN fallback tests at lines 87-102 and 148-160)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/utils/cdn.js` to understand the fallback mechanism (tries 4 mirrors, 2 rounds).
2. **Write Test:** In `tests/utils/cdn.test.js`, write a test that verifies `cdnImport` returns a fallback module when all CDN mirrors fail. Use `vi.doMock` to simulate network failures.
3. **Remove Redundant Tests:** Delete the CDN fallback describe blocks from stemmer, stopwords, transliterate, and tokens test files.
4. **Verify:** Run `npm test` and ensure all tests pass.
5. **Commit:** Commit with message: `test: centralize CDN fallback tests in cdn.test.js`

---

### Task 2: Delete Performance Threshold Tests

**Objective:** Remove timing-dependent assertions that assert literal threshold values like `20000ms`.

**Files to modify/create:**
- Delete: `tests/perf/reflection.test.js` (Purpose: Contains timing assertions and comparative performance claims)
- Keep: `tests/perf/store.test.js` (Purpose: Validates store registration, no timing assertions)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `tests/perf/reflection.test.js` to confirm tests being deleted (threshold=20000ms, comparative performance).
2. **Delete File:** Remove `tests/perf/reflection.test.js` entirely.
3. **Verify:** Run `npm test` and ensure all tests pass.
4. **Commit:** Commit with message: `test: remove perf reflection threshold tests`

---

### Task 3: Consolidate Prompt Tests into Topology

**Objective:** Remove literal prompt content assertions and consolidate prompt tests into topology checks.

**Files to modify/create:**
- Delete: `tests/prompts/format.test.js` (Purpose: Contains literal `<example_1>` assertions)
- Modify: `tests/prompts/prefill.test.js` (Purpose: Remove literal prefill content assertions, keep topology tests)
- Keep: `tests/prompts/topology.test.js` (Purpose: Already topology-based, may add formatExamples check)
- Keep: `tests/prompts/world-state/builder.test.js` (Purpose: Already topology-based)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `tests/prompts/format.test.js` and `tests/prompts/prefill.test.js` to identify literal assertions being removed.
2. **Delete format.test.js:** Remove the file entirely (formatExamples tests with literal `<example_1>` strings).
3. **Modify prefill.test.js:** Remove the test at line 86 that asserts `result[2].content).toBe('{')` exactly. Keep the topology tests that verify role sequence (system/user/assistant).
4. **Optionally extend topology.test.js:** If needed, add a test for `formatExamples` that checks for presence of `<example_\d+>` pattern instead of exact numbering.
5. **Verify:** Run `npm test` and ensure all tests pass.
6. **Commit:** Commit with message: `test: consolidate prompt tests to topology checks`

---

### Task 4: Consolidate Math Tests

**Objective:** Reduce math tests from 73 to ~20, keeping behavioral invariants and removing redundant permutations.

**Files to modify/create:**
- Modify: `tests/retrieval/math.test.js` (Purpose: Consolidate permutations, keep behavioral invariants)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `tests/retrieval/math.test.js` (1451 lines) to identify tests to keep vs remove.
2. **Keep behavioral invariants (DO NOT DELETE):**
   - `hitDamping` describe block (4 tests)
   - `frequencyFactor` describe block (5 tests)
   - `Reflection decay` describe block (4 tests)
   - `Transient decay multiplier` describe block (4 tests + 3 it.each)
   - `calculateScore - settings clamping defense` (NaN/Infinity edge cases)
3. **Remove redundant tests:**
   - `cosineSimilarity` 384-dim and 768-dim reference tests (lines 1211-1250) → keep only 2 short/long vector tests
   - `Large iterable handling` describe block (lines 709-809) → delete entirely (slow, covered by unrolling test)
   - `hasExactPhrase` describe block (lines 288-331) → delete entirely (trivial string matching)
   - `math.js - alpha-blend scoring (legacy)` describe block (lines 811-919) → consolidate to single boundary test
4. **Consolidate permutations:**
   - Merge `calculateScore - parameterized alpha-blend` into fewer boundary tests
   - Merge `BM25 with exact phrase tokens` into single boost behavior test
5. **Verify:** Run `npm test` and ensure all behavioral invariant tests pass.
6. **Commit:** Commit with message: `test: consolidate math tests to behavioral invariants`

---

### Task 5: Reduce Orchestrator Tests to 3

**Objective:** Enforce Integration Bouncer Rule: orchestrator tests limited to happy path, graceful degradation, and fast-fail.

**Files to modify/create:**
- Modify: `tests/extraction/extract.test.js` (Purpose: Reduce from 23 to 3 tests)
- Modify: `tests/retrieval/retrieve.test.js` (Purpose: Reduce from 16 to 3 tests)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `tests/CLAUDE.md` to understand Integration Bouncer Rule (3-5 tests max: happy, degrade, fail).
2. **Identify tests to keep in extract.test.js:**
   - Keep: "happy path: events + graph + reflection state populated"
   - Keep: "graceful degradation" test (if exists, or create one)
   - Keep: "fast-fail" test (invalid input throws AbortError)
   - Delete: All other permutation tests
3. **Identify tests to keep in retrieve.test.js:**
   - Keep: happy path test
   - Keep: graceful degradation test
   - Keep: fast-fail test
   - Delete: All other permutation tests
4. **Verify:** Run `npm test` and ensure the 3 tests pass.
5. **Commit:** Commit with message: `test: enforce 3-test limit on orchestrator tests`

---

### Task 6: Final Validation

**Objective:** Run full validation to ensure all changes are correct and test suite is healthy.

**Files to modify/create:**
- None (validation only)

**Instructions for Execution Agent:**
1. **Run full suite:** Execute `npm run check` to run all checks (sync-version, generate-types, lint, jsdoc, css, typecheck, tests).
2. **Count tests:** Run `npm test -- --reporter=verbose 2>&1 | grep -c "✓"` to verify test count reduced (target: ~600-700).
3. **Verify execution time:** Run `npm test -- --reporter=basic` and note the timing.
4. **Commit:** If all checks pass, commit with message: `test: suite optimization complete`

---

## Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Test files | 55 | ~50 |
| `math.test.js` tests | 73 | ~20 |
| `extract.test.js` tests | 23 | 3 |
| `retrieve.test.js` tests | 16 | 3 |
| CDN fallback tests | 4 files | 1 file |

## Dependencies

- Task 1 is independent (CDN tests)
- Task 2 is independent (perf tests)
- Task 3 is independent (prompt tests)
- Task 4 is independent (math tests)
- Task 5 is independent (orchestrator tests)
- Task 6 depends on all previous tasks completing successfully