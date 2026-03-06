# Design: Test Suite Entropy Reduction

## 1. Problem Statement

The test suite contains ~300-400 lines of tests that provide zero behavioral guarantees:
- Tests asserting deleted exports are undefined (caught by linter/build)
- Tests asserting constants equal their hardcoded values (tautologies)
- Tests reading source files as strings and regex-matching variable names (fragile)
- A test file mocking 11 modules to test a 5-symbol function (mock hairball)
- 9 files repeating identical `setDeps()` boilerplate (~100+ lines of copy-paste)

These tests increase maintenance cost on every change without catching real bugs.

## 2. Goals & Non-Goals

**Must do:**
- Delete all "ghost of codebases past" tests (removal assertions)
- Delete all tautology tests (constant === constant)
- Delete all string-matching source code tests
- Refactor events.test.js to mock only what `onMessageReceived` touches
- Consolidate `setDeps()` boilerplate into a shared `setupTestContext()` helper
- Preserve the structural invariant test (all backend settings have UI hints)
- All remaining tests must pass after changes

**Won't do:**
- Add new tests (this is a deletion/consolidation pass)
- Refactor test logic beyond mock reduction
- Change any production source code

## 3. Proposed Architecture

### Phase 1: Delete Files (4 files removed)

| File | Lines | Reason |
|------|-------|--------|
| `tests/scoring.test.js` | 7 | Tests that `selectRelevantMemoriesSmart` is not exported |
| `tests/ui/settings-bindings.test.js` | 61 | Reads `settings.js` as text, regex-matches jQuery selectors |
| `tests/ui/settings-panel-structure.test.js` | 69 | Reads HTML as text, regex-matches element IDs |
| `tests/constants.test.js` | **partially** | Keep only the invariant test (see Phase 2) |

### Phase 2: Strip Dead Tests from Remaining Files

**`tests/constants.test.js`** — delete everything except the "all backend settings have corresponding UI hints" invariant test (~lines 40-62). Remove the removal assertions (smartRetrievalEnabled, retrievalProfile) and the tautology assertions (reflectionThreshold === 40, worldContextBudget === 2000, etc.).

**`tests/extraction/structured.test.js`** — delete:
- Lines 11-25: `RetrievalResponseSchema` / `getRetrievalJsonSchema` / `parseRetrievalResponse` removal test
- Lines 177-190: `ExtractionResponseSchema` / `getExtractionJsonSchema` / `parseExtractionResponse` removal test

**`tests/prompts.test.js`** — delete:
- Lines 10-18: `buildSmartRetrievalPrompt` removal test

**`tests/utils.test.js`** — delete:
- Lines 356-363: `typeof yieldToMain === 'function'` tautology test

### Phase 3: Refactor events.test.js

Verified against `src/events.js`: `onMessageReceived` uses exactly **5 symbols** from **4 modules**:

| Symbol | Module | Purpose |
|--------|--------|---------|
| `isAutomaticMode` | `./utils.js` | Guard: early return if not automatic |
| `isChatLoadingCooldown` | `./state.js` | Guard: early return during cooldown |
| `log` | `./utils.js` | Logging skip reason |
| `getDeps` | `./deps.js` | Access `getContext()` for chat array |
| `wakeUpBackgroundWorker` | `./extraction/worker.js` | The actual side effect |

The current file mocks **11 modules** (13 mock calls). The refactored version mocks **4 modules** with only the symbols actually needed. The remaining 7 mocked modules (`extraction/extract.js`, `extraction/scheduler.js`, `retrieval/retrieve.js`, `retrieval/debug-cache.js`, `ui/render.js`, `ui/status.js`, `embeddings.js`) are only used by other exported functions in events.js and are irrelevant to `onMessageReceived`.

**Note:** The other functions in events.js (`onChatChanged`, `onBeforeGeneration`, etc.) are not currently tested. This refactor does not add tests for them — it only right-sizes the mocks for the one function that IS tested.

```javascript
// NEW tests/events.test.js
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/deps.js', () => ({
    getDeps: () => ({
        getContext: () => ({ chat: [{ is_user: true }, { is_user: false }] }),
    }),
}));

vi.mock('../src/utils.js', () => ({
    isAutomaticMode: () => true,
    log: vi.fn(),
}));

vi.mock('../src/state.js', () => ({
    isChatLoadingCooldown: () => false,
}));

vi.mock('../src/extraction/worker.js', () => ({
    wakeUpBackgroundWorker: vi.fn(),
}));

import { onMessageReceived } from '../src/events.js';
import { wakeUpBackgroundWorker } from '../src/extraction/worker.js';

describe('onMessageReceived', () => {
    beforeEach(() => vi.clearAllMocks());

    it('calls wakeUpBackgroundWorker for AI messages', () => {
        onMessageReceived(1);
        expect(wakeUpBackgroundWorker).toHaveBeenCalledOnce();
    });

    it('ignores user messages', () => {
        onMessageReceived(0);
        expect(wakeUpBackgroundWorker).not.toHaveBeenCalled();
    });
});
```

### Phase 4: Consolidate setDeps() Boilerplate

Add `setupTestContext()` to `tests/setup.js`. This replaces the repeated boilerplate found in 9 test files.

#### Interface

```javascript
/**
 * Sets up the standard test dependency context.
 * @param {Object} [overrides] - Optional overrides
 * @param {Object} [overrides.context] - Merged into the getContext() return value
 * @param {Object} [overrides.settings] - Merged into openvault settings
 * @param {Object} [overrides.deps] - Merged directly into the deps object (for Date, saveChatConditional, etc.)
 */
global.setupTestContext = (overrides = {}) => {
    setDeps({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        getContext: () => ({
            chat: [],
            name1: 'User',
            name2: 'Alice',
            chatId: 'test-chat-123',
            chatMetadata: { openvault: {} },
            ...overrides.context,
        }),
        getExtensionSettings: () => ({
            [extensionName]: {
                ...defaultSettings,
                enabled: true,
                debugMode: false,
                ...overrides.settings,
            },
        }),
        Date: { now: () => 1000000 },
        ...overrides.deps,
    });
};
```

#### Migration Map

Each file's `beforeEach` block transforms as follows:

| File | Current | After |
|------|---------|-------|
| `extract.test.js` (×5 blocks) | 8-line setDeps with saveChatConditional | `setupTestContext({ deps: { saveChatConditional: vi.fn(async () => true) } })` |
| `communities.test.js` | 6-line setDeps | `setupTestContext()` |
| `reflect.test.js` | 6-line setDeps + custom Date | `setupTestContext({ deps: { Date: { now: () => 2000000 } } })` |
| `preflight-gate.test.js` | 5-line setDeps | `setupTestContext({ settings: { debugMode: true } })` |
| `reflection-filter.test.js` | 5-line setDeps | `setupTestContext({ settings: { debugMode: true } })` |
| `pov.test.js` | 5-line setDeps | `setupTestContext()` |
| `query-context.test.js` | 5-line setDeps + saveSettingsDebounced | `setupTestContext({ deps: { saveSettingsDebounced: vi.fn() } })` |
| `retrieve.test.js` | 15-line setDeps with full context | `setupTestContext({ context: { chat: [...], chatMetadata: { openvault: { memories: [...] } } }, deps: { setExtensionPrompt: mock, extension_prompt_types: { IN_PROMPT: 0 } } })` |
| `utils.test.js` | Multiple setDeps calls in nested describes | Mixed: top-level `setupTestContext()`, inner describes still use `setDeps()` directly for isolated dep overrides |

**Note on utils.test.js:** This file has ~10 different `setDeps()` calls across nested describe blocks, each with unique minimal dep sets (e.g., testing `showToast` only needs `{ showToast: mock }`). The top-level `beforeEach` can use `setupTestContext()`, but inner describe blocks that intentionally provide incomplete deps to test specific functions should remain as-is. Forcing them through `setupTestContext` would add unnecessary defaults they're deliberately omitting.

## 4. Risks & Edge Cases

**Risk: Mocked module not loading without all mocks**
When reducing events.test.js mocks from 11 to 4, vitest must resolve the other 7 imported modules. Since vitest is configured with `jsdom` environment and extensive module aliases, the unmocked imports will attempt to load real modules. If any of those modules have side effects at import time (e.g., calling `getDeps()` at module scope), the test could fail.

*Mitigation:* Run `npm test` after the events.test.js refactor before proceeding to Phase 4. If import-time side effects exist, add minimal pass-through mocks for those specific modules.

**Risk: setupTestContext defaults mask test-specific requirements**
If a test relies on `debugMode: false` (the default) and someone later changes the default in `setupTestContext`, it would silently change test behavior.

*Mitigation:* Tests that depend on a specific value should always pass it explicitly: `setupTestContext({ settings: { debugMode: false } })`.

**Risk: Deleting removal tests loses historical signal**
If someone re-adds a deleted export by mistake, there's no test to catch it.

*Mitigation:* This is what code review and the build system are for. Testing that something *doesn't* exist is an anti-pattern.

## 5. Verification

After each phase, run:
```bash
npm test
```

All existing passing tests must continue to pass. The only acceptable test count change is a decrease (from deleted tests).

## 6. Estimated Deletion

| Phase | Lines Deleted | Files Removed |
|-------|--------------|---------------|
| Phase 1: Delete files | ~137 | 3 full files |
| Phase 2: Strip dead tests | ~55 | 0 |
| Phase 3: Refactor events.test.js | ~60 net | 0 (rewrite) |
| Phase 4: Consolidate setDeps | ~80 | 0 |
| **Total** | **~330** | **3** |

Plus `constants.test.js` drops from 62 lines to ~25 lines.
