# Testing Subsystem (Vitest + JSDOM)

## CORE RULES & CONSTRAINTS

1. **Zero `vi.mock()`**: NEVER use `vi.mock()` on internal or ST modules (except for minor `embeddings.js` edge cases if explicitly required).
2. **Single I/O Boundary**: All external ST/Browser boundaries are mocked through `setupTestContext({ deps: { ... } })` in `tests/setup.js`. This overrides the injection in `src/deps.js`.
3. **Data & Structure, Not Implementation**: Assert on output data (`mockData.memories`) and string structure (`expect(prompt).toContain('<tags>')`), NOT on spy call counts or exact string matches (`toBe('Exact long string')`). Prompts change often; exact string matches cause fragile tests.
4. **Module-Level State**: Worker tests MUST use `vi.resetModules()` in `beforeEach` to reset mutable top-level variables (like `isRunning` in `worker.js`).
5. **No DOM Mocks for Math/Helpers**: Test pure functions (`helpers.js`, `math.js`) by passing objects directly.
6. **Fake Timers for Speed**: Any test involving timeouts, backoffs, or queues MUST use `vi.useFakeTimers()`. Never wait for real `setTimeout` delays in tests to keep the CI suite blazing fast.

---

## TEST PYRAMID — WHERE DOES THIS TEST GO?

Every test lives at exactly ONE level. Never test the same logic at two levels.

### Unit Tests (pure functions, no `setupTestContext`)

Test a single exported function by passing plain objects and asserting on return values / mutations.
**No LLM mocks, no `setupTestContext`, no `resetDeps`.**

| What | Test file | Source |
|------|-----------|--------|
| Alpha-blend scoring, BM25, cosine similarity, tokenization | `tests/math.test.js`, `tests/retrieval/math.test.js` | `src/retrieval/math.js` |
| Soft-balance memory selection | `tests/retrieval/scoring.test.js` | `src/retrieval/scoring.js` |
| Memory bucket assignment, injection formatting | `tests/formatting.test.js` | `src/retrieval/formatting.js` |
| POV filtering (`filterMemoriesByPOV`) | `tests/pov.test.js` (top-level describe) | `src/pov.js` |
| Character state updates & cleanup | `tests/extraction/character-states.test.js` | `src/extraction/extract.js` |
| Event dedup (Jaccard, cosine, mentions) | `tests/extraction/dedup.test.js` | `src/extraction/extract.js` |
| Graph structure, community detection, consolidation | `tests/graph/*.test.js` | `src/graph/*.js` |
| World context retrieval, macro intent detection | `tests/retrieval/world-context.test.js` | `src/retrieval/world-context.js` |
| Text utils, stemmer, transliteration, tokens | `tests/utils/*.test.js` | `src/utils/*.js` |
| Prompt builders, formatters, schemas | `tests/prompts/*.test.js` | `src/prompts/*.js` |
| Reflection filter, preflight gate | `tests/reflection/*.test.js` | `src/reflection/*.js` |
| Perf store, instrumentation | `tests/perf/*.test.js` | `src/perf/*.js` |
| Internal constants | `tests/constants/internal.test.js` | `src/constants.js` |
| Settings removed from UI | `tests/constants/settings.test.js` | `src/constants.js` |

### UI Structure Tests (HTML parsing, no JSDOM setup)
Validate the progressive disclosure UI layout. Parse `templates/settings_panel.html` directly to verify:
- Dashboard: Quick Toggles and Status before collapsible Connection/Setup sections
- Memories: Browser/Search before collapsed settings
- World: Graph Stats Card at top, zero visible range inputs (pure viewer)
- Advanced: Warning banner present, Danger Zone with renamed reset button
- Setting descriptions updated for clarity

| What | Test file | Source |
|------|-----------|--------|
| Tab structure validation | `tests/ui/*-structure.test.js` | `templates/settings_panel.html` |
| Template functions | `tests/ui/templates.test.js` | `src/ui/templates.js` |
| Reset logic (preserved settings) | `tests/ui/reset-logic.test.js` | `src/ui/settings.js` |
| Payload calculator warning | `tests/ui/payload-calculator.test.js` | `src/ui/settings.js` |
| Full UI integration | `tests/ui/progressive-disclosure.integration.test.js` | All tabs |

### Integration Tests (`setupTestContext` required — mock LLM, ST context, fetch)

Test pipeline wiring: "does the orchestrator call the right functions in the right order and save the right data?" Keep to 3–5 tests per orchestrator: happy path, graceful degradation, fast-fail.

### The "Integration Bouncer" Rule (LOCKED ORCHESTRATORS)
Treat `extract.test.js`, `retrieve.test.js`, and `communities.test.js` as **locked files**.
When adding a new feature (e.g., a new formatting bucket, a new JSON schema field):
- **DO NOT** add new permutation tests to these orchestrator files.
- **DO** test the pure logic in `formatting.test.js`, `math.test.js`, or `structured.test.js`.
- **ONLY** modify orchestrator tests if you are adding a completely new exit/failure path (like a new `AbortError` or major pipeline stage).

| What | Test file | Source |
|------|-----------|--------|
| Extraction pipeline (events → graph → reflection) | `tests/extraction/extract.test.js` (≤5 tests) | `src/extraction/extract.js` |
| Retrieval pipeline (filter → score → inject) | `tests/retrieval/retrieve.test.js` (≤3 tests) | `src/retrieval/retrieve.js` |
| Background worker lifecycle | `tests/extraction/worker.test.js` | `src/extraction/worker.js` |
| POV context detection (`getActiveCharacters`, `getPOVContext`) | `tests/pov.test.js` (deps-requiring describe) | `src/pov.js` |
| Unified reflection pipeline | `tests/reflection/unified-reflection.integration.test.js` | `src/reflection/*.js` |

### Decision Rule

> **"Does my function call `getDeps()`?"**
> - **No** → Unit test. Pass data directly. No `setupTestContext`.
> - **Yes** → Integration test. Use `setupTestContext`. Keep test count minimal (3–5).
>
> **"Does a unit test already cover this edge case?"**
> - **Yes** → Do NOT add it to the integration test. Integration tests cover wiring, not permutations.
> - **No** → Write a unit test for the edge case. Only add to integration if it's a pipeline-level failure mode.

---

## FACTORY BUILDERS (`tests/factories.js`)

Use factory functions to build test data instead of ad-hoc inline objects or shared `mockData` globals.

```javascript
import { buildMockMemory, buildMockGraphNode, buildMockData } from '../factories.js';

// Override only what matters for this test — rest is sensible defaults
const memory = buildMockMemory({ importance: 5, is_secret: true });
const node = buildMockGraphNode({ name: 'Castle', type: 'PLACE' });
const data = buildMockData({ character_states: { Alice: { current_emotion: 'happy' } } });
```

### When to use factories
- Any test that creates memory objects, graph nodes, or OpenVault data structures.
- Especially in unit tests that don't have `setupTestContext` to inject data.

### When NOT to use factories
- Math tests where the specific numeric values (embeddings, importance, message_ids) ARE the test. Inline objects are clearer when every field is intentional.
- Tests that need only 1–2 fields on a throwaway object (e.g. `{ summary: 'test' }`).

---

## `setupTestContext` RULES

`setupTestContext` (from `tests/setup.js`) is the ONLY way to mock ST globals.

### WHEN to use it
- Tests for functions that call `getDeps()` internally (orchestrators, event handlers, UI code).
- Tests that need `getContext()`, `getExtensionSettings()`, `saveChatConditional`, `setExtensionPrompt`, etc.

### WHEN NOT to use it
- **Pure math/scoring functions** (`calculateScore`, `scoreMemories`, `cosineSimilarity`) — pass args directly.
- **Pure data transforms** (`filterMemoriesByPOV`, `updateCharacterStatesFromEvents`, `cleanupCharacterStates`, `filterSimilarEvents`) — pass args directly.
- **Formatting functions** (`formatContextForInjection`, `assignMemoriesToBuckets`) — pass args directly.
- **Any test where you can call the function with explicit arguments** — always prefer explicit over mocked globals.

### Anti-pattern: God `beforeEach`
```javascript
// BAD: Every test gets setupTestContext even if it doesn't need it
describe('myModule', () => {
    beforeEach(() => { setupTestContext({ ... }); });
    it('pure function test', () => { /* doesn't need deps */ });
    it('integration test', () => { /* needs deps */ });
});

// GOOD: Separate pure tests from integration tests
describe('pure functions', () => {
    it('pure function test', () => { /* no setup needed */ });
});
describe('integration (deps-requiring)', () => {
    beforeEach(() => { setupTestContext({ ... }); });
    afterEach(() => { resetDeps(); });
    it('integration test', () => { /* needs deps */ });
});
```

---

## ESM URL ALIASING
Production code uses bare URLs (e.g., `https://esm.sh/graphology`). Node/Vitest cannot resolve these natively.
- **Requirement**: Any CDN package MUST be aliased in `vitest.config.js` to a local `node_modules/` path.
- **Requirement**: You must `npm install --save-dev` the package to make it available to the alias.

## EMBEDDING MOCKS
Do not run real Transformers.js models in Vitest.
- Force the 'ollama' strategy in test settings (`embeddingSource: 'ollama'`).
- Mock `deps.fetch` to return `{ ok: true, json: () => ({ embedding: [0.1, 0.2] }) }`.

## UI RENDERING TESTS
`render.js` and `status.js` run real code. jQuery on empty JSDOM selections is a silent no-op. If you need to test DOM output, use string templates from `templates.js` directly, or mount standard HTML to the JSDOM document before running.

---

## Test Development Workflow

### Quick Development Loop (Use These)

```bash
# While working on specific module — watches only that file
npx vitest tests/math.test.js

# After making changes — runs only tests affected by uncommitted changes
npm run test:changed

# For rapid iteration — interactive filter mode
npm run test:watch
# Then press:
#   'p' → filter by filename pattern
#   't' → filter by test name pattern
#   'a' → run all tests
#   'q' → quit
```

### Module-Specific Shortcuts

```bash
# Math/scoring functions (fastest feedback)
npm run test:math

# Extraction pipeline
npm run test:extract

# With UI (for debugging parameterized tests)
npm run test:ui
```

### Pre-Commit (Full Suite)

```bash
npm run test:run  # Run all tests once
```

### Coverage Check

```bash
# Before and after refactoring, verify coverage unchanged
npm run test:coverage
```

### When to Run What

| Scenario | Command | Why |
|----------|---------|-----|
| Active TDD on math.js | `npx vitest tests/math.test.js` | <1s feedback |
| Finished feature | `npm run test:changed` | Catches regressions |
| Refactoring shared code | `npm run test:run` | Full coverage |
| Debugging parameterized test | `npm run test:ui` | Visual test explorer |
| CI/Pre-commit | `npm run test:run` | Gatekeeping |

### Parameterized Tests Best Practices

Use `it.each()` with object arrays for readability:

```javascript
const CASES = [
  { name: 'handles positive', input: 5, expected: 10 },
  { name: 'handles zero', input: 0, expected: 0 },
  { name: 'handles negative', input: -3, expected: -6 },
];

it.each(CASES)('$name', ({ input, expected }) => {
  expect(double(input)).toBe(expected);
});
```

**Warning:** If test functions mutate input objects, use `structuredClone()`:

```javascript
it.each(CASES)('$name', (caseData) => {
  const memory = structuredClone(caseData.memory);
  const result = processMemory(memory);
  expect(result).toBe(caseData.expected);
});
```

## PERF TEST SUITE (`tests/perf/`)
- **`store.test.js`**: Unit tests for perf store singleton — `record()`, `getAll()`, `loadFromChat()`, `formatForClipboard()`. Uses `_resetForTest()` for isolation.
- **`tab.test.js`**: HTML/CSS presence tests for Perf tab UI structure.
- **`instrumentation.test.js`**: Validates that `record()` is called in instrumented code paths (`autoHide`, memory scoring, event dedup, chat save).
- **`reflection.test.js`**: Perf metrics for reflection pipeline timing.
