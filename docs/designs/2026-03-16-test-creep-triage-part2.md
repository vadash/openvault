# Test Creep Triage Part 2: Pyramid Enforcement & Fixture Isolation

**Status:** Design Ready for Review
**Scope:** Phase 3 (Redundancy Pruning) + Phase 4 (Orchestrator Decoupling) + Phase 5 (Fixture Isolation)
**Target:** Eliminate test overlap, reduce orchestrator test fragility, and decouple test state.

---

## 1. Problem Statement

With parameterization complete, the remaining test bloat comes from architectural overlap:
1. **Testing logic through Orchestrators:** Files like `extract.test.js` and `retrieve.test.js` are testing granular logic (like character state updates or soft-balancing) instead of just testing the pipeline wiring. 
2. **The "God" Fixture:** Tests rely heavily on the global `mockContext` and `mockData` initialized in `tests/setup.js`. If a developer modifies the default `mockData` shape to satisfy a new test, they risk breaking 50 unrelated tests.

## 2. Phase 3 & 4: Pyramid Enforcement (Thinning the Orchestrators)

**WHAT:** Strip edge-case permutations out of heavy orchestrator tests (`extract.test.js`, `retrieve.test.js`, `communities.test.js`) and ensure they are only tested in pure-function unit tests.

**WHY:** Orchestrator tests require mocking the LLM (`mockCallLLM`), the ST environment (`setupTestContext`), and file I/O. They are integration tests. Testing every variation of an input through an integration test creates a brittle suite where a single internal refactor breaks dozens of high-level tests.

**HOW:**
**Step 1: Isolate `extract.js` logic.**
Looking at your test output, `updateCharacterStatesFromEvents` and `cleanupCharacterStates` are currently tested *inside* `extract.test.js`. 
*   **Action:** Move these tests out of the `extract.js` integration suite. They are pure-ish data transformations. They should be tested with plain JavaScript objects, completely bypassing the `setupTestContext` and `mockSendRequest` machinery.
*   **Action:** Reduce `extractMemories` tests to exactly 3 variations:
    1. Happy Path (Everything works, events + graph populated)
    2. Graceful Degradation (Graph LLM fails, but Events still save)
    3. Fast-Fail / Abort (Chat switch aborts pipeline)
    *Delete all other `extractMemories` permutation tests.*

**Step 2: Isolate `retrieve.js` logic.**
*   **Action:** Ensure `retrieve.test.js` does NOT test the math of the forgetfulness curve or BM25. That is fully covered in `math.test.js`.
*   **Action:** Ensure `retrieve.test.js` does NOT test the mechanics of POV filtering. That is fully covered in `pov.test.js`.
*   **Action:** Reduce `retrieveAndInjectContext` tests to:
    1. Happy Path (Valid context injected)
    2. Empty State (No memories = empty injection)
    3. Macro Intent routing (Summarize request hits global state)

## 3. Phase 5: Fixture Isolation (Killing the God Object)

**WHAT:** Replace the reliance on globally shared `mockData` injected by `setupTestContext()` with local Factory Builder functions.

**WHY:** When 100 tests rely on a single `mockData.memories` array defined in a `beforeEach` or `setup.js`, tests become highly coupled. A developer changing the global mock to test "importance 5" might accidentally break a test expecting "importance 3".

**HOW:**
**Step 1: Create `tests/factories.js`**
Create pure functions that return valid default objects:

```javascript
// tests/factories.js
import { generateId } from '../src/utils/data.js';

export function buildMockMemory(overrides = {}) {
    return {
        id: `mem_${generateId()}`,
        type: 'event',
        summary: 'Default memory summary',
        importance: 3,
        sequence: 1000,
        characters_involved: ['Alice', 'Bob'],
        witnesses: ['Alice', 'Bob'],
        message_ids: [1, 2],
        ...overrides
    };
}

export function buildMockGraphNode(overrides = {}) {
    return {
        name: 'Default Node',
        type: 'PERSON',
        description: 'Default description',
        mentions: 1,
        ...overrides
    };
}
```

**Step 2: Refactor pure-logic tests to use Factories**
In files like `math.test.js`, `formatting.test.js`, and `pov.test.js`, stop calling `setupTestContext({ ... })` just to get data. 

*Before:*
```javascript
// Relies on global state injection
setupTestContext({
    mockData: {
        memories: [ { id: '1', importance: 5 }, { id: '2', importance: 1 } ]
    }
});
const result = selectMemoriesWithSoftBalance(getOpenVaultData().memories, ...);
```

*After:*
```javascript
// Explicit, isolated, local state
const memories = [
    buildMockMemory({ id: '1', importance: 5 }),
    buildMockMemory({ id: '2', importance: 1 })
];
const result = selectMemoriesWithSoftBalance(memories, ...);
```

## 4. Execution Plan & Safety Checks

### Week 1: Factory Migration (Safe)
1. Create `tests/factories.js`.
2. Migrate `math.test.js`, `pov.test.js`, and `formatting.test.js` to use factories instead of `setupTestContext`.
3. **Safety Gate:** Run `npm run test:coverage`. Coverage must remain identical.

### Week 2: Orchestrator Pruning (Destructive)
1. Run a baseline coverage check: `npm run test:coverage > coverage-baseline.txt`.
2. Thin out `extract.test.js` — delete overlapping tests, keeping only the pipeline integration tests.
3. Thin out `retrieve.test.js`.
4. **Safety Gate:** Run `npm run test:coverage`. Compare against baseline. 
    *   If line coverage drops, you deleted a test that *wasn't* covered by a lower-level unit test. 
    *   Write a parameterized unit test for the missing line, then proceed.

## 5. Definition of Done

* `extract.test.js` and `retrieve.test.js` contain fewer than 10 tests each.
* `setupTestContext` is *only* used in tests that actually require mocking SillyTavern browser globals (like `DOM` interactions or `saveSettingsDebounced`).
* Pure mathematical/data tests (`math`, `text`, `formatting`, `pov`) require zero `setupTestContext` calls.
