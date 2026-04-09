# PR 5: Nuke the `data.js` Junk Drawer + Unify State Management

## Goal

Dismantle `src/utils/data.js` (773 lines, 18 exports, 10 consumers) into three cohesive modules: a Repository for local state, an Adapter for ST Vector REST calls, and an embedding migration module. Then consolidate all concurrency state (currently split between `state.js` and `worker.js`) into a single module.

**Non-goals:** No changes to how data is stored in `chatMetadata`. No changes to ST Vector API payloads. No changes to embedding invalidation logic. No changes to worker loop scheduling or backoff. We are strictly moving, categorizing, and consolidating code.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Ports & Adapters (Hexagonal) | Clear boundaries between local disk I/O (`saveChatConditional`), Network I/O (`fetch`), and Domain Logic. |
| Directory Structure | `src/store/`, `src/services/`, `src/embeddings/` | Moves away from the generic `utils/` folder into semantic architectural layers. |
| Chat ID Resolution | Stays in `store/chat-data.js` | Resolving the active `chatId` is a local ST context concern, closely tied to `saveOpenVaultData`. |
| Caching | Move `validatedChats` to `services/st-vector.js` | The cache preventing duplicate `/api/characters/chats` calls is purely a network optimization. |
| Migration placement | `src/embeddings/migration.js` | Depends on both st-vector.js and chat-data.js; embeddings are the domain concept. |
| State unification | Move worker state to `state.js` | Single file for all concurrency flags. Worker retains loop logic. |

---

## Part A: Dismantle `data.js`

### 1. `src/services/st-vector.js` (New File)

**Responsibility:** Pure REST API wrappers for SillyTavern's Vector Storage endpoints. Knows nothing about OpenVault data structures (except extracting the OV_ID for query results).

**Move from `data.js`:**

| Function | Visibility |
|----------|-----------|
| `validatedChats` (Set) | Module-level state |
| `_clearValidatedChatsCache()` | Export (test helper) |
| `chatExists(chatId)` | Internal |
| `getSTCollectionId(chatId)` | Internal |
| `extractOvId(text)` | Internal |
| `getSTVectorSource()` | Internal |
| `getSourceApiUrl(sourceType)` | Internal |
| `getSTVectorRequestBody(source)` | Internal |
| `isStVectorSource()` | Export |
| `syncItemsToST(items, chatId)` | Export |
| `deleteItemsFromST(hashes, chatId)` | Export |
| `purgeSTCollection(chatId)` | Export |
| `querySTVector(searchText, topK, threshold, chatId)` | Export |

**Imports needed:** `getDeps` from `deps.js`, `showToast` from `utils/dom.js`, `logDebug/logError/logWarn` from `utils/logging.js`.

**No cross-dependencies** on store or migration modules.

### 2. `src/store/chat-data.js` (New File)

**Responsibility:** Repository for local chat metadata. Handles initialization, saving, and CRUD operations for memories.

**Move from `data.js`:**

| Function | Visibility |
|----------|-----------|
| `getOpenVaultData()` | Export |
| `getCurrentChatId()` | Export |
| `saveOpenVaultData(expectedChatId?)` | Export |
| `generateId()` | Export |
| `updateMemory(id, updates)` | Export |
| `deleteMemory(id)` | Export |
| `deleteCurrentChatData()` | Export |

**Imports needed:** `METADATA_KEY`, `MEMORIES_KEY`, `CHARACTERS_KEY` from `constants.js`, `getDeps` from `deps.js`, `record` from `perf/store.js`, `showToast` from `utils/dom.js`, `deleteEmbedding` from `utils/embedding-codec.js`, `logDebug/logError/logInfo/logWarn` from `utils/logging.js`.

**Cross-dependency:** `deleteCurrentChatData()` calls `purgeSTCollection` from `services/st-vector.js` (imported). This is the only dependency on services — the purge is a cleanup side-effect when the user explicitly deletes all chat data.

### 3. `src/embeddings/migration.js` (New File)

**Responsibility:** Domain logic for detecting model mismatches, wiping stale embeddings, and managing ST Vector fingerprints.

**Move from `data.js`:**

| Function | Visibility |
|----------|-----------|
| `getStVectorFingerprint()` | Export |
| `stampStVectorFingerprint(data)` | Export |
| `_hasStVectorMismatch(data)` | Internal |
| `_hasSyncedItems(data)` | Internal |
| `_clearAllStSyncFlags(data)` | Internal |
| `_countEmbeddings(data)` | Internal |
| `invalidateStaleEmbeddings(data, currentModelId)` | Export |
| `deleteCurrentChatEmbeddings()` | Export |

**Imports needed:** `MEMORIES_KEY` from `constants.js`, `getDeps` from `deps.js` (only for `deleteCurrentChatEmbeddings`'s `saveChatConditional` call), `clearStSynced/deleteEmbedding/hasEmbedding/isStSynced` from `utils/embedding-codec.js`, `logDebug/logInfo/logWarn` from `utils/logging.js`.

**Cross-dependencies:**
- `getStVectorFingerprint()` calls `getSTVectorSource()` and `getSTVectorRequestBody()` from `services/st-vector.js`.
- `invalidateStaleEmbeddings()` calls `purgeSTCollection` from `services/st-vector.js` and `getCurrentChatId` from `store/chat-data.js`.
- `deleteCurrentChatEmbeddings()` calls `getOpenVaultData` from `store/chat-data.js`.

### 4. Delete `src/utils/data.js`

After all consumers are rewired, delete the file completely.

### 5. Consumer Rewiring

| Consumer | Current imports from `data.js` | New imports |
|----------|-------------------------------|-------------|
| `src/extraction/extract.js` | `deleteItemsFromST`, `getCurrentChatId`, `getOpenVaultData`, `isStVectorSource`, `saveOpenVaultData`, `syncItemsToST` | `services/st-vector.js` → `deleteItemsFromST`, `isStVectorSource`, `syncItemsToST`; `store/chat-data.js` → `getCurrentChatId`, `getOpenVaultData`, `saveOpenVaultData` |
| `src/extraction/worker.js` | `getCurrentChatId`, `getOpenVaultData` | `store/chat-data.js` → both |
| `src/reflection/reflect.js` | `generateId` | `store/chat-data.js` → `generateId` |
| `src/retrieval/retrieve.js` | `getOpenVaultData` | `store/chat-data.js` → `getOpenVaultData` |
| `src/perf/store.js` | `getOpenVaultData` | `store/chat-data.js` → `getOpenVaultData` |
| `src/events.js` | `getOpenVaultData` | `store/chat-data.js` → `getOpenVaultData` |
| `src/ui/settings.js` | `deleteCurrentChatData`, `getOpenVaultData` | `store/chat-data.js` → both |
| `src/ui/render.js` | `deleteMemory`, `getOpenVaultData`, `updateMemory` | `store/chat-data.js` → all three |
| `src/ui/status.js` | `getOpenVaultData` | `store/chat-data.js` → `getOpenVaultData` |
| `src/ui/export-debug.js` | `getOpenVaultData` | `store/chat-data.js` → `getOpenVaultData` |

### 6. Test File Split

| Current | New location | What moves |
|---------|-------------|-----------|
| `tests/utils/data.test.js` → `getOpenVaultData`, `saveOpenVaultData`, `generateId`, `updateMemory`, `deleteMemory`, `deleteCurrentChatData`, `getCurrentChatId` tests | `tests/store/chat-data.test.js` | Import from `store/chat-data.js`. Same test logic, new import paths. |
| `tests/utils/data.test.js` → `querySTVector`, `_clearValidatedChatsCache`, ST sync/delete/purge tests | `tests/services/st-vector.test.js` | Import from `services/st-vector.js`. Same test logic, new import paths. |
| `tests/utils/data.test.js` → `invalidateStaleEmbeddings`, `stampStVectorFingerprint`, `getStVectorFingerprint`, `deleteCurrentChatEmbeddings` tests | `tests/embeddings/migration.test.js` | Import from `embeddings/migration.js`. Same test logic, new import paths. |
| `tests/utils/data.test.js` | **Delete** | All tests moved to new locations. |

---

## Part B: Unify State Management

### Problem

Concurrency state is split across two files:
- **`state.js`**: `operationState` (`generationInProgress`, `extractionInProgress`, `retrievalInProgress`), generation lock timeout, chat loading cooldown, session abort controller.
- **`worker.js`**: `isRunning` (singleton guard), `wakeGeneration` (backoff reset counter).

These interact: `worker.js` reads `operationState.extractionInProgress` to yield to manual backfill. `extract.js` checks `isWorkerRunning()` (imported from `worker.js`) to warn before Emergency Cut. The split makes it impossible to reason about the full concurrency picture from a single file.

### Solution

Move `isRunning` and `wakeGeneration` from `worker.js` to `state.js`. Expose them through accessor functions. The worker loop logic stays in `worker.js`.

### Changes to `src/state.js`

Add at module level:

```js
// Worker singleton state — moved from worker.js for concurrency visibility
let _workerRunning = false;
let _wakeGeneration = 0;
```

Add exports:

```js
export function isWorkerRunning() {
    return _workerRunning;
}

export function setWorkerRunning(value) {
    _workerRunning = value;
}

export function getWakeGeneration() {
    return _wakeGeneration;
}

export function incrementWakeGeneration() {
    _wakeGeneration++;
}
```

Update `clearAllLocks()` to also reset worker state:

```js
export function clearAllLocks() {
    operationState.generationInProgress = false;
    operationState.extractionInProgress = false;
    operationState.retrievalInProgress = false;
    _workerRunning = false;
    if (generationLockTimeout) {
        getDeps().clearTimeout(generationLockTimeout);
        generationLockTimeout = null;
    }
}
```

### Changes to `src/extraction/worker.js`

**Delete:**
- `let isRunning = false;`
- `let wakeGeneration = 0;`
- `export function isWorkerRunning()`
- `export function getWakeGeneration()`
- `export function incrementWakeGeneration()`

**Add import:**
```js
import {
    getSessionSignal,
    getWakeGeneration,
    incrementWakeGeneration,
    isWorkerRunning,
    operationState,
    setWorkerRunning,
} from '../state.js';
```

**Update `wakeUpBackgroundWorker()`:**
```js
export function wakeUpBackgroundWorker() {
    incrementWakeGeneration();
    if (isWorkerRunning()) return;
    setWorkerRunning(true);
    runWorkerLoop().finally(() => {
        setWorkerRunning(false);
    });
}
```

**Update `runWorkerLoop()`:**
Replace all bare `wakeGeneration` reads with `getWakeGeneration()`.

**Update `interruptibleSleep()`:**
Replace `wakeGeneration !== generationAtStart` with `getWakeGeneration() !== generationAtStart`.

### Consumer Rewiring

| Consumer | Current import from `worker.js` | New import from `state.js` |
|----------|-------------------------------|---------------------------|
| `src/extraction/extract.js` | `isWorkerRunning` (added in PR 3) | `isWorkerRunning` from `state.js` (already imports from `state.js`) |

Note: `extract.js` already imports `clearAllLocks, operationState` from `state.js`. Adding `isWorkerRunning` to that import eliminates the `worker.js` import for that symbol.

`events.js` does NOT import from `worker.js` — it calls `wakeUpBackgroundWorker()` which stays exported from `worker.js`. No change needed.

### Test Changes

`tests/extraction/worker.test.js` currently uses `vi.resetModules()` to reset `isRunning`. After the move:
- Import `setWorkerRunning(false)` in `beforeEach` from `state.js` to reset.
- Import `isWorkerRunning`, `getWakeGeneration`, `incrementWakeGeneration` from `state.js`.
- `wakeUpBackgroundWorker` and `interruptibleSleep` still import from `worker.js`.

`tests/state.test.js`:
- Add tests for `isWorkerRunning()`, `setWorkerRunning()`, `getWakeGeneration()`, `incrementWakeGeneration()`.
- Verify `clearAllLocks()` resets `_workerRunning`.

---

## Execution Order

| Step | Action | Risk | Test Impact |
|------|--------|------|-------------|
| 1 | Create `src/services/st-vector.js`, move API wrappers | Low | Move ST vector tests to `tests/services/st-vector.test.js` |
| 2 | Create `src/store/chat-data.js`, move CRUD logic | Low | Move CRUD tests to `tests/store/chat-data.test.js` |
| 3 | Create `src/embeddings/migration.js`, move mismatch logic | Low | Move migration tests to `tests/embeddings/migration.test.js` |
| 4 | Update imports globally (10 consumers) | Medium | All test imports updated in steps 1-3 |
| 5 | Delete `src/utils/data.js` and `tests/utils/data.test.js` | Low | Cleanup |
| 6 | Move worker state to `state.js`, update `worker.js` | Low | Update `worker.test.js` reset mechanism, add `state.test.js` tests |
| 7 | Rewire `extract.js` to import `isWorkerRunning` from `state.js` | Low | No test change (extract.test.js mocking stays the same) |

Steps 1-3 are independent (can be done in any order). Step 4 depends on all three. Step 5 depends on step 4. Steps 6-7 are independent of steps 1-5 but logically grouped in the same PR.

## Verification

- `npm run test` passes after each step.
- No `utils/data.js` imports remaining anywhere in `src/` or `tests/`.
- `src/utils/data.js` and `tests/utils/data.test.js` deleted.
- No `isRunning` or `wakeGeneration` variables in `worker.js`.
- All concurrency state (`operationState`, `isWorkerRunning`, `wakeGeneration`, generation lock, session controller, chat loading cooldown) lives in `state.js`.
- `clearAllLocks()` resets worker running state.
- `grep -r "from.*worker.js" src/` shows only `wakeUpBackgroundWorker` and `interruptibleSleep` imports (no state accessors).
- Manual verification: start SillyTavern, extract memories, change embedding model, run Emergency Cut. All flows work.
- Biome lint/format passes (pre-commit hook).

## Dependency Graph (Post-Refactor)

```
services/st-vector.js  ←── embeddings/migration.js ──→  store/chat-data.js
        ↑                           ↑                           ↑
        |                           |                           |
   extract.js              ui/settings.js              ui/render.js
   retrieve.js                                         ui/status.js
                                                       perf/store.js
                                                       events.js
                                                       worker.js

state.js  (all concurrency: operationState + worker state + session + generation lock)
   ↑
   |
extract.js, worker.js, events.js, llm.js, embeddings.js
```

No circular dependencies. `services/` depends only on `deps.js` and `utils/`. `store/` depends only on `deps.js`, `utils/`, and `services/` (one call in `deleteCurrentChatData`). `embeddings/migration.js` depends on both `services/` and `store/` — it's a domain coordination module, not a layer violation.
