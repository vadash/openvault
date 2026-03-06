# Implementation Plan - Test Suite Entropy Reduction

> **Reference:** `docs/designs/2026-03-06-test-entropy-reduction-design.md`
> **Execution:** Use `executing-plans` skill.

---

### Task 1: Baseline Verification

**Goal:** Record current test suite state before any changes.

**Step 1: Run full test suite**
- Command: `npm test`
- Expect: All tests pass. Record the total test count from output.

**Step 2: Git status check**
- Command: `git status`
- Expect: Clean working tree (or note existing changes).

---

### Task 2: Delete Zero-Value Test Files

**Goal:** Remove 3 files that test deleted exports or regex-match source code as strings.

**Step 1: Delete files**
- `rm tests/scoring.test.js` (7 lines — asserts `selectRelevantMemoriesSmart` is undefined)
- `rm tests/ui/settings-bindings.test.js` (61 lines — reads `settings.js` as text, regex-matches jQuery selectors)
- `rm tests/ui/settings-panel-structure.test.js` (69 lines — reads HTML as text, regex-matches element IDs)

**Step 2: Verify**
- Command: `npm test`
- Expect: PASS. Test count decreases by the number of tests in deleted files.

**Step 3: Git Commit**
- Command: `git add -A && git commit -m "test: delete scoring, settings-bindings, settings-panel-structure tests"`

---

### Task 3: Trim constants.test.js to Keep Only Invariant

**Goal:** Remove removal-assertions and tautology tests, keep the structural invariant.

**Step 1: Rewrite constants.test.js**
- File: `tests/constants.test.js`
- Replace entire contents with:

```javascript
import { describe, expect, it } from 'vitest';
import { defaultSettings, UI_DEFAULT_HINTS } from '../src/constants.js';

describe('all settings used in backend have UI hints', () => {
    const requiredHints = [
        'forgetfulnessBaseLambda',
        'forgetfulnessImportance5Floor',
        'reflectionDecayThreshold',
        'entityDescriptionCap',
        'maxReflectionsPerCharacter',
        'communityStalenessThreshold',
        'dedupJaccardThreshold',
    ];

    for (const key of requiredHints) {
        it(`has UI_DEFAULT_HINTS.${key}`, () => {
            expect(UI_DEFAULT_HINTS[key]).toBeDefined();
            expect(UI_DEFAULT_HINTS[key]).toBe(defaultSettings[key]);
        });
    }
});
```

**Step 2: Verify**
- Command: `npm test`
- Expect: PASS. Lost tests: removal checks (smartRetrievalEnabled, retrievalProfile), tautology checks (reflectionThreshold === 40, worldContextBudget === 2000, communityDetectionInterval === 50, dedupJaccardThreshold === 0.6), hint tautology checks. Kept: 7 invariant tests.

**Step 3: Git Commit**
- Command: `git add -A && git commit -m "test: trim constants.test.js to structural invariant only"`

---

### Task 4: Strip Removal and Tautology Tests from Remaining Files

**Goal:** Delete tests that assert deleted exports are undefined, and typeof tautology.

**Step 1: Edit structured.test.js — remove smart retrieval removal block**
- File: `tests/extraction/structured.test.js`
- Delete the entire `describe('smart retrieval removal', ...)` block (lines 12-24):

```javascript
describe('smart retrieval removal', () => {
    it('does not export RetrievalResponseSchema', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.RetrievalResponseSchema).toBeUndefined();
    });

    it('does not export getRetrievalJsonSchema', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.getRetrievalJsonSchema).toBeUndefined();
    });

    it('does not export parseRetrievalResponse', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.parseRetrievalResponse).toBeUndefined();
    });
});
```

**Step 2: Edit structured.test.js — remove legacy extraction API removal block**
- File: `tests/extraction/structured.test.js`
- Delete the entire `describe('legacy extraction API removed', ...)` block (lines 170-185):

```javascript
describe('legacy extraction API removed', () => {
    it('does not export ExtractionResponseSchema', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.ExtractionResponseSchema).toBeUndefined();
    });

    it('does not export getExtractionJsonSchema', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.getExtractionJsonSchema).toBeUndefined();
    });

    it('does not export parseExtractionResponse', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.parseExtractionResponse).toBeUndefined();
    });
});
```

**Step 3: Edit prompts.test.js — remove smart retrieval prompt removal block**
- File: `tests/prompts.test.js`
- Delete the entire `describe('smart retrieval prompt removal', ...)` block (lines 10-15):

```javascript
describe('smart retrieval prompt removal', () => {
    it('does not export buildSmartRetrievalPrompt', async () => {
        const module = await import('../src/prompts.js');
        expect(module.buildSmartRetrievalPrompt).toBeUndefined();
    });
});
```

**Step 4: Edit utils.test.js — remove yieldToMain typeof tautology**
- File: `tests/utils.test.js`
- In the `describe('yieldToMain', ...)` block, delete the `'is a function'` test:

```javascript
        it('is a function', async () => {
            expect(typeof yieldToMain).toBe('function');
        });
```

Leave the `'returns a promise that resolves'` test — that tests actual behavior.

**Step 5: Verify**
- Command: `npm test`
- Expect: PASS. Lost: 3 (structured smart retrieval) + 3 (structured legacy) + 1 (prompts) + 1 (utils typeof) = 8 tests.

**Step 6: Git Commit**
- Command: `git add -A && git commit -m "test: strip removal assertions and typeof tautology"`

---

### Task 5: Rewrite events.test.js with Minimal Mocks

**Goal:** Reduce mock surface from 11 modules to 4 essential + 7 trivial stubs.

**Step 1: Replace events.test.js**
- File: `tests/events.test.js`
- Replace entire contents with:

```javascript
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Essential mocks: symbols onMessageReceived actually uses ──
vi.mock('../src/deps.js', () => ({
    getDeps: () => ({
        getContext: () => ({
            chat: [
                { is_user: true },
                { is_user: false },
            ],
        }),
    }),
}));

vi.mock('../src/utils.js', () => ({
    isAutomaticMode: () => true,
    log: vi.fn(),
    getCurrentChatId: vi.fn(),
    getOpenVaultData: vi.fn(),
    showToast: vi.fn(),
    safeSetExtensionPrompt: vi.fn(),
    withTimeout: vi.fn(),
}));

vi.mock('../src/state.js', () => ({
    operationState: {},
    isChatLoadingCooldown: vi.fn(() => false),
    setChatLoadingCooldown: vi.fn(),
    setGenerationLock: vi.fn(),
    clearGenerationLock: vi.fn(),
    resetOperationStatesIfSafe: vi.fn(),
}));

vi.mock('../src/extraction/worker.js', () => ({
    wakeUpBackgroundWorker: vi.fn(),
}));

// ── Stub mocks: prevent loading real modules (events.js imports these but
//    onMessageReceived never calls them) ──
vi.mock('../src/embeddings.js', () => ({ clearEmbeddingCache: vi.fn() }));
vi.mock('../src/extraction/extract.js', () => ({ extractMemories: vi.fn(), extractAllMessages: vi.fn(), cleanupCharacterStates: vi.fn() }));
vi.mock('../src/extraction/scheduler.js', () => ({ getBackfillStats: vi.fn(), getExtractedMessageIds: vi.fn(), getNextBatch: vi.fn() }));
vi.mock('../src/retrieval/retrieve.js', () => ({ updateInjection: vi.fn() }));
vi.mock('../src/retrieval/debug-cache.js', () => ({ clearRetrievalDebug: vi.fn() }));
vi.mock('../src/ui/render.js', () => ({ refreshAllUI: vi.fn(), resetMemoryBrowserPage: vi.fn() }));
vi.mock('../src/ui/status.js', () => ({ setStatus: vi.fn() }));

import { onMessageReceived } from '../src/events.js';
import { wakeUpBackgroundWorker } from '../src/extraction/worker.js';
import { isChatLoadingCooldown } from '../src/state.js';

describe('onMessageReceived', () => {
    beforeEach(() => vi.clearAllMocks());

    it('calls wakeUpBackgroundWorker for AI messages', () => {
        onMessageReceived(1);
        expect(wakeUpBackgroundWorker).toHaveBeenCalledOnce();
    });

    it('does not call wakeUpBackgroundWorker for user messages', () => {
        onMessageReceived(0);
        expect(wakeUpBackgroundWorker).not.toHaveBeenCalled();
    });

    it('does not await — returns synchronously', () => {
        const result = onMessageReceived(1);
        expect(result).toBeUndefined();
    });

    it('skips during chat loading cooldown', () => {
        isChatLoadingCooldown.mockReturnValue(true);
        onMessageReceived(1);
        expect(wakeUpBackgroundWorker).not.toHaveBeenCalled();
    });
});
```

**Why this approach:** `onMessageReceived` uses only 5 symbols from 4 modules (verified against `src/events.js`). But events.js imports 12 modules total, and vitest must resolve all of them. The 7 stub mocks prevent loading real modules (which might have complex transitive deps). Each stub exports the named symbols as `vi.fn()` so events.js's other exported functions don't throw on import. This keeps all 4 original tests while cutting setup from ~60 lines to ~30.

**Step 2: Verify**
- Command: `npm test`
- Expect: PASS. Same 4 tests pass. If any test fails due to missing mock exports, add the missing symbol to the relevant stub mock.

**Step 3: Git Commit**
- Command: `git add -A && git commit -m "test: rewrite events.test.js with right-sized mocks"`

---

### Task 6: Add setupTestContext() to setup.js

**Goal:** Create the shared helper that replaces per-file setDeps boilerplate.

**Step 1: Edit setup.js — add imports and global helper**
- File: `tests/setup.js`
- Add at the END of the file (after the toastr mock):

```javascript
// ── Shared test context helper ──
import { setDeps } from '../src/deps.js';
import { defaultSettings, extensionName } from '../src/constants.js';

/**
 * Standard test context setup. Replaces per-file setDeps boilerplate.
 *
 * @param {Object} [overrides]
 * @param {Object} [overrides.context]  - Merged into getContext() return
 * @param {Object} [overrides.settings] - Merged into openvault extension settings
 * @param {Object} [overrides.deps]     - Merged directly into deps (Date, saveChatConditional, etc.)
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

**Step 2: Verify setup.js doesn't break existing tests**
- Command: `npm test`
- Expect: PASS. Adding a global function has no side effects on existing tests.

**Step 3: Git Commit**
- Command: `git add -A && git commit -m "test: add setupTestContext() global helper to setup.js"`

---

### Task 7: Migrate extract.test.js (5 identical setDeps blocks)

**Goal:** Replace 5 identical 8-line setDeps blocks with 1-line setupTestContext calls.

**Step 1: Edit extract.test.js imports**
- File: `tests/extraction/extract.test.js`
- Change:
```javascript
import { resetDeps, setDeps } from '../../src/deps.js';
```
to:
```javascript
import { resetDeps } from '../../src/deps.js';
```

**Step 2: Replace setDeps blocks**
- In the `beforeEach` of **each** of these 5 describe blocks:
  - `extractMemories graph integration`
  - `extractMemories reflection integration`
  - `extractMemories community detection`
  - `two-stage extraction pipeline`
  - `two-phase extraction with intermediate save`

- Replace this 7-line block:
```javascript
        setDeps({
            getContext: () => mockContext,
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings, enabled: true },
            }),
            saveChatConditional: vi.fn(async () => true),
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            Date: { now: () => 1000000 },
        });
```

- With:
```javascript
        setupTestContext({
            context: mockContext,
            deps: { saveChatConditional: vi.fn(async () => true) },
        });
```

Note: `setupTestContext` spreads `overrides.context` into its default context object. But here we want `getContext()` to return `mockContext` directly (a full context object), not a merge. This requires using the `deps` override for `getContext` instead:

```javascript
        setupTestContext({
            deps: {
                getContext: () => mockContext,
                saveChatConditional: vi.fn(async () => true),
            },
        });
```

**Step 3: Remove now-unused import**
- File: `tests/extraction/extract.test.js`
- The `defaultSettings, extensionName` import is only used inside the old setDeps blocks. After migration, check if they're used elsewhere in the file. If not, remove:
```javascript
import { defaultSettings, extensionName } from '../../src/constants.js';
```
Note: `extensionName` is likely still used elsewhere in the file (mock factories or test assertions). Only remove if truly unused.

**Step 4: Verify**
- Command: `npm test`
- Expect: PASS. All extract.test.js tests pass with same behavior.

**Step 5: Git Commit**
- Command: `git add -A && git commit -m "test: migrate extract.test.js to setupTestContext"`

---

### Task 8: Migrate communities.test.js and reflect.test.js

**Goal:** Replace setDeps boilerplate in 2 files that follow the standard pattern.

**Step 1: Edit communities.test.js**
- File: `tests/graph/communities.test.js`
- Change import:
```javascript
import { resetDeps, setDeps } from '../../src/deps.js';
```
to:
```javascript
import { resetDeps } from '../../src/deps.js';
```

- In `describe('updateCommunitySummaries')` → `beforeEach`, replace:
```javascript
        setDeps({
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings },
            }),
            Date: { now: () => 1000000 },
        });
```
with:
```javascript
        setupTestContext();
```

- Check if `defaultSettings` and `extensionName` are used elsewhere in the file (they are — in the LLM mock and other tests). Keep imports only if used outside the deleted setDeps block.

**Step 2: Edit reflect.test.js**
- File: `tests/reflection/reflect.test.js`
- Change import:
```javascript
import { resetDeps, setDeps } from '../../src/deps.js';
```
to:
```javascript
import { resetDeps } from '../../src/deps.js';
```

- In `describe('generateReflections')` → `beforeEach`, replace:
```javascript
        setDeps({
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings },
            }),
            Date: { now: () => 2000000 },
        });
```
with:
```javascript
        setupTestContext({
            deps: { Date: { now: () => 2000000 } },
        });
```

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS.

**Step 4: Git Commit**
- Command: `git add -A && git commit -m "test: migrate communities.test.js and reflect.test.js to setupTestContext"`

---

### Task 9: Migrate preflight-gate.test.js, reflection-filter.test.js, and pov.test.js

**Goal:** Replace setDeps boilerplate in 3 more files.

**Step 1: Edit preflight-gate.test.js**
- File: `tests/reflection/preflight-gate.test.js`
- Remove import:
```javascript
import { setDeps } from '../../src/deps.js';
```

- In `beforeEach`, replace:
```javascript
        setDeps({
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            getExtensionSettings: () => ({
                [extensionName]: { debugMode: true },
            }),
        });
```
with:
```javascript
        setupTestContext({ settings: { debugMode: true } });
```

- Check if `extensionName` is used elsewhere. It's only used in the deleted setDeps block, so also remove:
```javascript
import { extensionName } from '../../src/constants.js';
```

**Step 2: Edit reflection-filter.test.js**
- File: `tests/reflection/reflection-filter.test.js`
- Remove import:
```javascript
import { setDeps } from '../../src/deps.js';
```

- In `beforeEach`, replace:
```javascript
        setDeps({
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            getExtensionSettings: () => ({
                [extensionName]: { debugMode: true },
            }),
        });
```
with:
```javascript
        setupTestContext({ settings: { debugMode: true } });
```

- Check if `extensionName` is used elsewhere. It's only used in the deleted setDeps block, so also remove:
```javascript
import { extensionName } from '../../src/constants.js';
```

**Step 3: Edit pov.test.js**
- File: `tests/pov.test.js`
- Change import:
```javascript
import { resetDeps, setDeps } from '../src/deps.js';
```
to:
```javascript
import { resetDeps } from '../src/deps.js';
```

- In the top-level `beforeEach`, replace:
```javascript
        setDeps({
            console: mockConsole,
            getContext: () => mockContext,
            getExtensionSettings: () => ({ [extensionName]: { debugMode: false } }),
        });
```
with:
```javascript
        setupTestContext({
            deps: {
                console: mockConsole,
                getContext: () => mockContext,
            },
        });
```

Note: pov.test.js uses `mockConsole` (a local variable with `vi.fn()` methods) and `mockContext` (a local mutable object). These must be passed as `deps` overrides since they're test-specific references, not simple config.

**Step 4: Verify**
- Command: `npm test`
- Expect: PASS.

**Step 5: Git Commit**
- Command: `git add -A && git commit -m "test: migrate preflight-gate, reflection-filter, pov to setupTestContext"`

---

### Task 10: Migrate query-context.test.js and retrieve.test.js

**Goal:** Replace setDeps boilerplate in 2 files with non-trivial overrides.

**Step 1: Edit query-context.test.js**
- File: `tests/query-context.test.js`
- Change import:
```javascript
import { resetDeps, setDeps } from '../src/deps.js';
```
to:
```javascript
import { resetDeps } from '../src/deps.js';
```

- Remove now-unused constants import (check first):
```javascript
import { defaultSettings, extensionName } from '../src/constants.js';
```
These are only used in the setDeps block, so remove the line.

- In `beforeEach`, replace:
```javascript
        setDeps({
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings },
            }),
            saveSettingsDebounced: vi.fn(),
        });
```
with:
```javascript
        setupTestContext({
            deps: { saveSettingsDebounced: vi.fn() },
        });
```

**Step 2: Edit retrieve.test.js — main `beforeEach` only**
- File: `tests/retrieval/retrieve.test.js`
- The `describe('updateInjection world context')` block has a complex setDeps with full context data. Replace:
```javascript
        setDeps({
            getContext: () => ({
                chat: [
                    { mes: 'Hello', is_user: true, is_system: true },
                    { mes: 'Hi', is_user: false, is_system: false },
                ],
                name1: 'User',
                name2: 'Alice',
                chatMetadata: {
                    openvault: {
                        memories: [
                            {
                                id: 'ev1',
                                summary: 'Test memory',
                                importance: 3,
                                message_ids: [0],
                                characters_involved: ['Alice'],
                                witnesses: ['Alice'],
                                embedding: [0.5, 0.5],
                            },
                        ],
                        character_states: { Alice: { name: 'Alice', known_events: ['ev1'] } },
                        communities: {
                            C0: {
                                title: 'Test Community',
                                summary: 'A summary',
                                findings: ['Finding'],
                                embedding: [0.5, 0.5],
                                nodeKeys: ['alice'],
                            },
                        },
                    },
                },
                chatId: 'test',
            }),
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings, enabled: true, automaticMode: true },
            }),
            setExtensionPrompt: mockSetPrompt,
            extension_prompt_types: { IN_PROMPT: 0 },
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        });
```
with:
```javascript
        setupTestContext({
            context: {
                chat: [
                    { mes: 'Hello', is_user: true, is_system: true },
                    { mes: 'Hi', is_user: false, is_system: false },
                ],
                chatMetadata: {
                    openvault: {
                        memories: [
                            {
                                id: 'ev1',
                                summary: 'Test memory',
                                importance: 3,
                                message_ids: [0],
                                characters_involved: ['Alice'],
                                witnesses: ['Alice'],
                                embedding: [0.5, 0.5],
                            },
                        ],
                        character_states: { Alice: { name: 'Alice', known_events: ['ev1'] } },
                        communities: {
                            C0: {
                                title: 'Test Community',
                                summary: 'A summary',
                                findings: ['Finding'],
                                embedding: [0.5, 0.5],
                                nodeKeys: ['alice'],
                            },
                        },
                    },
                },
                chatId: 'test',
            },
            settings: { automaticMode: true },
            deps: {
                setExtensionPrompt: mockSetPrompt,
                extension_prompt_types: { IN_PROMPT: 0 },
            },
        });
```

- Keep the `setDeps` import — the `describe('reflection retrieval')` test uses its own inline `setDeps()` call with unique data. Do NOT migrate that one (it constructs a deliberately different context for a specific test).

**Step 3: Verify**
- Command: `npm test`
- Expect: PASS.

**Step 4: Git Commit**
- Command: `git add -A && git commit -m "test: migrate query-context and retrieve to setupTestContext"`

---

### Task 11: Migrate utils.test.js (Top-Level Only)

**Goal:** Replace only the top-level `beforeEach` setDeps. Inner describe blocks keep raw `setDeps()`.

**Step 1: Edit utils.test.js — top-level beforeEach only**
- File: `tests/utils.test.js`
- In the top-level `describe('utils')` → `beforeEach`, replace:
```javascript
        setDeps({
            console: mockConsole,
            getContext: () => mockContext,
            getExtensionSettings: () => ({
                [extensionName]: { enabled: true, debugMode: true },
            }),
        });
```
with:
```javascript
        setupTestContext({
            settings: { debugMode: true },
            deps: {
                console: mockConsole,
                getContext: () => mockContext,
            },
        });
```

Note: `mockConsole` and `mockContext` are local mutable objects that tests modify. They must remain as `deps` overrides. Inner describe blocks (saveOpenVaultData, showToast, safeSetExtensionPrompt, generateId, log, etc.) keep their own `setDeps()` calls — they intentionally provide minimal/specific deps to test error paths.

Do NOT remove `setDeps` from the import — it's still used in ~10 inner describe blocks.

**Step 2: Verify**
- Command: `npm test`
- Expect: PASS.

**Step 3: Git Commit**
- Command: `git add -A && git commit -m "test: migrate utils.test.js top-level setup to setupTestContext"`

---

### Task 12: Final Verification and Cleanup

**Goal:** Confirm all tests pass and no imports are broken.

**Step 1: Run full test suite**
- Command: `npm test`
- Expect: PASS. Total test count should be lower than baseline (Task 1) by the number of deleted tests.

**Step 2: Verify no unused imports**
- Scan for any `import { ..., setDeps }` that is no longer used in the file body. Specifically check:
  - `tests/extraction/extract.test.js` — should NOT import `setDeps`
  - `tests/graph/communities.test.js` — should NOT import `setDeps`
  - `tests/reflection/reflect.test.js` — should NOT import `setDeps`
  - `tests/reflection/preflight-gate.test.js` — should NOT import `setDeps` or `extensionName`
  - `tests/reflection/reflection-filter.test.js` — should NOT import `setDeps` or `extensionName`
  - `tests/query-context.test.js` — should NOT import `setDeps`, `defaultSettings`, or `extensionName`
  - `tests/pov.test.js` — should NOT import `setDeps`

**Step 3: Git Commit (if any cleanup found)**
- Command: `git add -A && git commit -m "test: clean up unused imports after setupTestContext migration"`
