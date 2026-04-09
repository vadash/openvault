# PR 6: The Final Polish — Callback Injection & Repository Lockdown

## Goal

Eliminate the last jQuery/toastr/DOM leakage from `extractAllMessages` by adopting the same callback injection pattern used by `executeEmergencyCut` (PR 3). Lock down direct data mutations in `extract.js` by adding strict repository methods to `store/chat-data.js`.

**Non-goals:** No reactive pub/sub for status. No `getPendingUserMessage()` abstraction (single call site). No changes to extraction logic, prompts, scoring, or graph math. No visual/behavioral changes.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `extractAllMessages` UI | Callback injection (`onStart`, `onProgress`, etc.) | Same pattern as `executeEmergencyCut`. Domain function becomes UI-agnostic and testable without DOM mocking. |
| `setStatus` in extract.js | Removed — caller's responsibility via callbacks | The 3 `setStatus` calls in `extractAllMessages` (lines 1147, 1250, 1342) move to the UI callback handlers in `settings.js`. |
| `showToast` in extract.js | Stays for guard clauses, removed from backfill flow | Guard toasts ("No chat messages", "Worker running") are domain validation feedback — they stay. Backfill progress/completion toasts move to caller callbacks. |
| `refreshAllUI` in extract.js | Removed — caller's responsibility | Called once at completion. Belongs in UI. |
| Store mutations | Explicit repository methods in `chat-data.js` | `addMemories()`, `markMessagesProcessed()`, `setGraphMessageCount()`. Encapsulates array pushes behind the store boundary. |
| `setStatus` in worker.js | Stays (out of scope) | 2 calls. Worker is a background orchestrator — `setStatus('extracting'/'ready')` is reasonable there. Not worth a pub/sub system for 2 calls. |

## File-by-File Changes

### 1. `src/extraction/extract.js` — Callback injection for `extractAllMessages`

**Current state:** `extractAllMessages` directly creates toastr toasts, manipulates jQuery selectors (`.openvault-backfill-toast`), calls `setStatus`, `refreshAllUI`, and `showToast` for progress/completion.

**New signature:**

```js
export async function extractAllMessages(options = {}) {
    const {
        isEmergencyCut = false,
        abortSignal = null,
        onComplete = null,        // (success: boolean) => void — legacy listener re-registration
        // NEW callbacks for backfill UI (non-Emergency-Cut path):
        onStart,                  // (batchCount: number) => void
        onProgress,               // (batchNum: number, totalBatches: number, eventsCreated: number, retryText: string) => void
        onPhase2Start,            // () => void
        onBatchRetryWait,         // (batchNum: number, totalBatches: number, backoffSeconds: number, retryCount: number) => void
        onFinish,                 // (result: { messagesProcessed, eventsCreated }) => void
        onAbort,                  // () => void
        onError,                  // (error: Error) => void
        // Emergency Cut path (unchanged from current):
        progressCallback = null,  // (batch, total, events) => void
    } = options;
```

**What changes inside the function:**

| Current code | Replacement |
|-------------|-------------|
| `setStatus('extracting')` + `toastr.info(...)` toast creation (line 1147-1155) | `onStart?.(initialBatchCount)` |
| `$('.openvault-backfill-toast .toast-message').text(...)` progress update (line 1217) | `onProgress?.(batchesProcessed, initialBatchCount, totalEvents, retryText)` |
| `$('.openvault-backfill-toast .toast-message').text(...)` retry wait (line 1291) | `onBatchRetryWait?.(batchesProcessed, initialBatchCount, backoffSeconds, retryCount)` |
| `$('.openvault-backfill-toast').remove()` + `showToast('warning', ...)` on chat-change abort (line 1247-1250) | `onAbort?.()` |
| `showToast('error', ...)` on backoff limit exceeded (line 1276-1279) | `onError?.(error)` + `break` |
| `$('.openvault-backfill-toast .toast-message').text(...)` Phase 2 start (line 1305) | `onPhase2Start?.()` |
| `showToast('warning', ...)` Phase 2 failure (line 1316) | `onError?.(error)` (non-fatal, just warning) |
| `$('.openvault-backfill-toast').remove()` + `showToast('success', ...)` + `refreshAllUI()` + `setStatus('ready')` (lines 1324-1342) | `onFinish?.({ messagesProcessed, eventsCreated: totalEvents })` |

**What stays:**
- `showToast('warning', ...)` in guard clauses (no chat, worker running, no data, no batches) — these are quick-return paths where the caller doesn't need callbacks.
- `clearAllLocks()`, `safeSetExtensionPrompt('')`, `saveChatConditional()` — domain cleanup.
- The `onComplete` callback (legacy listener re-registration) fires at the very end, unchanged.
- Emergency Cut path (`isEmergencyCut` branches) — unchanged, already uses `progressCallback`.

**Removed imports after changes:**
- `setStatus` from `../ui/status.js` — no longer called in this file.
- `refreshAllUI` from `../ui/render.js` — no longer called in this file.
- `toastr` global reference — no longer needed (was used inline, not imported).

**Note:** The `$ ('.openvault-backfill-toast')` jQuery selectors are the main thing being purged. After this change, `extract.js` has zero jQuery references.

### 2. `src/ui/settings.js` — Absorb backfill UI

**Current `handleExtractAll`** (3 lines):
```js
async function handleExtractAll() {
    const { extractAllMessages } = await import('../extraction/extract.js');
    await extractAllMessages({ onComplete: updateEventListeners });
}
```

**New `handleExtractAll`** — provides all the UI callbacks:

```js
async function handleExtractAll() {
    const { extractAllMessages } = await import('../extraction/extract.js');

    await extractAllMessages({
        onComplete: updateEventListeners,
        onStart: (batchCount) => {
            setStatus('extracting');
            toastr?.info(
                `Backfill: 0/${batchCount} batches (0%)`,
                'OpenVault - Extracting',
                { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false, toastClass: 'toast openvault-backfill-toast' }
            );
        },
        onProgress: (batchNum, totalBatches, eventsCreated, retryText) => {
            const progress = Math.round((batchNum / totalBatches) * 100);
            $('.openvault-backfill-toast .toast-message').text(
                `Backfill: ${batchNum}/${totalBatches} batches (${Math.min(progress, 100)}%) - Processing...${retryText}`
            );
        },
        onBatchRetryWait: (batchNum, totalBatches, backoffSeconds, retryCount) => {
            $('.openvault-backfill-toast .toast-message').text(
                `Backfill: ${batchNum}/${totalBatches} batches - Waiting ${backoffSeconds}s before retry ${retryCount}...`
            );
        },
        onPhase2Start: () => {
            $('.openvault-backfill-toast .toast-message').text(
                'Backfill: 100% - Synthesizing world state and reflections. This may take a minute...'
            );
        },
        onFinish: ({ messagesProcessed, eventsCreated }) => {
            $('.openvault-backfill-toast').remove();
            showToast('success', `Extracted ${eventsCreated} events from ${messagesProcessed} messages`);
            refreshAllUI();
            setStatus('ready');
        },
        onAbort: () => {
            $('.openvault-backfill-toast').remove();
            showToast('warning', 'Backfill aborted: chat changed', 'OpenVault');
            setStatus('ready');
        },
        onError: (error) => {
            $('.openvault-backfill-toast').remove();
            showToast('warning', error.message, 'OpenVault');
            setStatus('ready');
        },
    });
}
```

**New imports needed in `settings.js`:** None. `setStatus`, `showToast`, `refreshAllUI`, and jQuery `$` are already available in this file.

### 3. `src/store/chat-data.js` — Repository methods

Add three new exports:

```js
/**
 * Append new memories to the store
 * @param {Array} newMemories - Memory objects to add
 */
export function addMemories(newMemories) {
    const data = getOpenVaultData();
    if (!data || newMemories.length === 0) return;
    data[MEMORIES_KEY] = data[MEMORIES_KEY] || [];
    data[MEMORIES_KEY].push(...newMemories);
}

/**
 * Record message fingerprints as processed
 * @param {Array<string>} fingerprints - Message fingerprints to mark
 */
export function markMessagesProcessed(fingerprints) {
    const data = getOpenVaultData();
    if (!data || fingerprints.length === 0) return;
    data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
    data[PROCESSED_MESSAGES_KEY].push(...fingerprints);
}

/**
 * Increment the graph message count
 * @param {number} count - Number of messages to add
 */
export function incrementGraphMessageCount(count) {
    const data = getOpenVaultData();
    if (!data) return;
    data.graph_message_count = (data.graph_message_count || 0) + count;
}
```

**New import needed:** `PROCESSED_MESSAGES_KEY` from `../constants.js`.

### 4. `src/extraction/extract.js` — Use repository methods

Replace direct mutations with repository calls:

| Line | Current | After |
|------|---------|-------|
| 954 | `data.graph_message_count = (data.graph_message_count \|\| 0) + messages.length` | `incrementGraphMessageCount(messages.length)` |
| 960-961 | `data[MEMORIES_KEY] = data[MEMORIES_KEY] \|\| []; data[MEMORIES_KEY].push(...events)` | `addMemories(events)` |
| 967-968 | `data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] \|\| []; data[PROCESSED_MESSAGES_KEY].push(...processedFps)` | `markMessagesProcessed(processedFps)` |
| 596 | `data[MEMORIES_KEY].push(...reflections)` (inside `synthesizeReflections`) | `addMemories(reflections)` |

**Import changes in extract.js:**
- Add: `addMemories`, `markMessagesProcessed`, `incrementGraphMessageCount` from `../store/chat-data.js`
- Remove: `PROCESSED_MESSAGES_KEY` from `../constants.js` (no longer used directly)
- Keep: `MEMORIES_KEY` (still used in reads: `data[MEMORIES_KEY] || []`)
- Keep: `CHARACTERS_KEY` (used for character state reads/writes — out of scope for this PR)

**Note on reads:** `data[MEMORIES_KEY] || []` reads remain in several places (selectMemoriesForExtraction, updateIDFCache, community detection threshold checks, etc.). These are read paths, not mutations — they stay as-is. Only write paths (`push`, assignment) move behind repository methods.

### 5. Dead code cleanup

After all changes:

| Item | Action |
|------|--------|
| `import { setStatus } from '../ui/status.js'` in extract.js | Delete |
| `import { refreshAllUI } from '../ui/render.js'` in extract.js | Delete |
| `import { PROCESSED_MESSAGES_KEY } from '../constants.js'` in extract.js | Delete (if no other uses remain) |

## Execution Order

| Step | Action | Risk | Test Impact |
|------|--------|------|-------------|
| 1 | `store/chat-data.js`: Add `addMemories`, `markMessagesProcessed`, `incrementGraphMessageCount` | Low | Add unit tests for new methods in `tests/store/chat-data.test.js`. |
| 2 | `extract.js`: Replace direct mutations with repository calls | Low | Existing extraction tests pass unchanged (behavior identical). |
| 3 | `extract.js`: Add callback params, replace jQuery/toast/setStatus with callback invocations | Medium | Existing extraction tests pass (callbacks are optional). |
| 4 | `settings.js`: Wire callbacks in `handleExtractAll` | Low | No unit test changes (UI wiring). |
| 5 | `extract.js`: Remove dead imports (`setStatus`, `refreshAllUI`) | Low | Run linter. |

Steps 1-2 form a natural unit (repository pattern). Steps 3-5 form a natural unit (callback injection).

## Verification

- `npm run test` green after each step.
- `grep -r "\\$(" src/extraction/` returns zero hits (no jQuery in extraction layer).
- `grep -r "toastr" src/extraction/` returns zero hits.
- `grep -r "setStatus" src/extraction/` returns zero hits.
- `grep -r "refreshAllUI" src/extraction/` returns zero hits.
- `grep -r "\.push(" src/extraction/extract.js` — no hits targeting `data[MEMORIES_KEY]` or `data[PROCESSED_MESSAGES_KEY]` directly. (Other `.push` calls like stChanges collection are fine.)
- `showToast` remains in extract.js ONLY for guard clauses (no chat, worker running, etc.).
- Manual verification: click "Extract All", verify toast appears → progress updates → Phase 2 message → completion toast. Emergency Cut flow unchanged.
- Biome lint/format passes (pre-commit hook).
