# PR 3: Untangle UI from Business Logic

## Goal

Remove all business logic, network requests, and chat metadata mutations from `src/ui/settings.js`. Move `hideExtractedMessages`, `handleEmergencyCut`, and `testOllamaConnection` into the domain layer where they belong. The UI becomes a thin wiring layer: listen to DOM events, pass callbacks, render results.

**Non-goals:** No UI visual changes. No changes to how the Emergency Cut modal behaves. No changes to the underlying extraction or hiding logic — we are strictly moving code and injecting callbacks.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------
| Communication | Full callback injection (6 callbacks on `executeEmergencyCut`) | Domain function is fully UI-agnostic and independently testable. UI handler becomes pure wiring. |
| `testOllamaConnection` target | `src/embeddings.js` | embeddings.js already owns the Ollama strategy; connection testing is a natural fit. |
| `hideExtractedMessages` target | `src/extraction/extract.js` | It depends on `scheduler.js` (getProcessedFingerprints, getFingerprint) and `data.js` — colocated with the extraction pipeline. |
| `handleEmergencyCut` → `executeEmergencyCut` | `src/extraction/extract.js` | Rename reflects its nature as a domain operation, not a click handler. |
| UI helpers (modal show/hide/progress) | Stay in `settings.js` | Pure DOM manipulation — belongs in the UI layer. |

## File-by-File Changes

### 1. `src/embeddings.js` — New export: `testOllamaConnection(url)`

**Move** the fetch logic from `settings.js` lines 291-329. Strip all DOM/jQuery/UI concerns.

```js
// NEW EXPORT in src/embeddings.js
export async function testOllamaConnection(url) {
    const response = await fetch(`${url}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return true;
}
```

No `getDeps()` needed — this uses the browser's global `fetch` for a direct Ollama call (not an ST API endpoint, so no CSRF headers required).

### 2. `src/extraction/extract.js` — New exports: `hideExtractedMessages()`, `executeEmergencyCut(options)`

#### `hideExtractedMessages()`

**Move** from `settings.js` lines 117-168. Replace dynamic imports with static imports (extract.js already imports from `scheduler.js`, `data.js`, `deps.js`).

```js
// Moved from settings.js. No signature change.
export async function hideExtractedMessages() {
    const context = getDeps().getContext();
    const chat = context.chat || [];
    const data = getOpenVaultData();
    const processedFps = getProcessedFingerprints(data);

    let hiddenCount = 0;
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (processedFps.has(getFingerprint(msg)) && !msg.is_system) {
            msg.is_system = true;
            hiddenCount++;
        }
    }

    if (hiddenCount > 0) {
        await getDeps().saveChatConditional();
        logInfo(`Emergency Cut: hid ${hiddenCount} messages (all extracted)`);
    }
    return hiddenCount;
}
```

**Note:** The verbose per-message debug logging in the current implementation is development scaffolding. Strip it down to the essential info log. If we need it again, we can re-add.

**New imports needed in extract.js:** `getProcessedFingerprints`, `getFingerprint` from `../extraction/scheduler.js`. Also `getBackfillStats` (used by executeEmergencyCut).

#### `executeEmergencyCut(options)`

**Move** orchestration logic from `settings.js` lines 170-260. Accept a callbacks object instead of touching DOM directly.

```js
export async function executeEmergencyCut(options = {}) {
    const {
        onWarning,       // (msg: string) => void
        onConfirmPrompt, // (msg: string) => boolean
        onStart,         // () => void
        onProgress,      // (batch: number, total: number, events: number) => void
        onPhase2Start,   // () => void
        onComplete,      // (result: { messagesProcessed, eventsCreated, hiddenCount }) => void
        onError,         // (error: Error, isCancel: boolean) => void
        abortSignal,     // AbortSignal
    } = options;

    if (isWorkerRunning()) {
        onWarning?.('Background extraction in progress. Please wait a moment.');
        return;
    }

    const context = getDeps().getContext();
    const chat = context.chat || [];
    const data = getOpenVaultData();
    const stats = getBackfillStats(chat, data);

    let shouldExtract = true;

    if (stats.unextractedCount === 0) {
        const processedFps = getProcessedFingerprints(data);
        const hideableCount = chat.filter(m =>
            !m.is_system && processedFps.has(getFingerprint(m))
        ).length;

        if (hideableCount === 0) {
            onWarning?.('No messages to hide');
            return;
        }

        const msg = `All messages are already extracted. Hide ${hideableCount} messages from the LLM to break the loop?\n\n` +
            `The LLM will only see: preset, char card, lorebooks, and OpenVault memories.`;
        if (!onConfirmPrompt?.(msg)) return;
        shouldExtract = false;
    } else {
        const msg = `Extract and hide ${stats.unextractedCount} unprocessed messages?\n\n` +
            `The LLM will only see: preset, char card, lorebooks, and OpenVault memories.`;
        if (!onConfirmPrompt?.(msg)) return;
    }

    if (!shouldExtract) {
        const hiddenCount = await hideExtractedMessages();
        onComplete?.({ messagesProcessed: 0, eventsCreated: 0, hiddenCount });
        return;
    }

    onStart?.();
    operationState.extractionInProgress = true;

    try {
        const result = await extractAllMessages({
            isEmergencyCut: true,
            progressCallback: onProgress,
            abortSignal,
            onPhase2Start,
        });

        const hiddenCount = await hideExtractedMessages();

        onComplete?.({
            messagesProcessed: result.messagesProcessed,
            eventsCreated: result.eventsCreated,
            hiddenCount,
        });
    } catch (err) {
        onError?.(err, err.name === 'AbortError');
    } finally {
        operationState.extractionInProgress = false;
    }
}
```

**Key changes from current `handleEmergencyCut`:**
- `operationState` imported statically (extract.js already imports from `state.js`). Need to add `operationState` to the import.
- `isWorkerRunning` imported statically from `worker.js` (new import for extract.js).
- `getBackfillStats`, `getProcessedFingerprints`, `getFingerprint` imported from `scheduler.js` (new imports for extract.js).
- No `showToast`, no jQuery, no modal, no `refreshAllUI` — all handled by callbacks.
- The `finally` block only cleans up domain state (`operationState`). UI cleanup (`$('#send_textarea').prop(...)`, modal hide) is the caller's job.

**New imports for extract.js:**

```js
import { getBackfillStats, getProcessedFingerprints, getFingerprint } from './scheduler.js';
import { isWorkerRunning } from './worker.js';
import { operationState } from '../state.js';
```

Note: `clearAllLocks` is already imported from `state.js`. We just need to add `operationState` to that import.

### 3. `src/ui/settings.js` — Thin wiring layer

**Remove:** The function bodies of `hideExtractedMessages`, `handleEmergencyCut`, and `testOllamaConnection`. Remove the `export` on `hideExtractedMessages` and `handleEmergencyCut` (they're no longer defined here).

**Add imports:**

```js
import { testOllamaConnection } from '../embeddings.js';
import { executeEmergencyCut } from '../extraction/extract.js';
```

**New click handler for Ollama test:**

```js
async function handleOllamaTestClick() {
    const $btn = $('#openvault_test_ollama_btn');
    const url = $('#openvault_ollama_url').val().trim();

    if (!url) {
        $btn.removeClass('success').addClass('error');
        $btn.html('<i class="fa-solid fa-xmark"></i> No URL');
        return;
    }

    $btn.removeClass('success error');
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Testing...');

    try {
        await testOllamaConnection(url);
        $btn.removeClass('error').addClass('success');
        $btn.html('<i class="fa-solid fa-check"></i> Connected');
    } catch (err) {
        $btn.removeClass('success').addClass('error');
        $btn.html('<i class="fa-solid fa-xmark"></i> Failed');
        logError('Ollama test failed', err);
    }

    setTimeout(() => {
        $btn.removeClass('success error');
        $btn.html('<i class="fa-solid fa-plug"></i> Test');
    }, 3000);
}
```

**New click handler for Emergency Cut:**

```js
async function handleEmergencyCutClick() {
    let emergencyCutAbortController = null;

    await executeEmergencyCut({
        onWarning: (msg) => showToast('warning', msg),
        onConfirmPrompt: (msg) => confirm(msg),
        onStart: () => {
            $('#send_textarea').prop('disabled', true);
            emergencyCutAbortController = new AbortController();
            showEmergencyCutModal();
        },
        onProgress: (batch, total, events) => updateEmergencyCutProgress(batch, total, events),
        onPhase2Start: () => disableEmergencyCutCancel(),
        onComplete: ({ messagesProcessed, eventsCreated, hiddenCount }) => {
            if (messagesProcessed > 0) {
                showToast('success',
                    `Emergency Cut complete. ${messagesProcessed} messages processed, ` +
                    `${eventsCreated} memories created. Chat history hidden.`
                );
            } else {
                showToast('success', `Emergency Cut complete. ${hiddenCount} messages hidden from context.`);
            }
            $('#send_textarea').prop('disabled', false);
            hideEmergencyCutModal();
            emergencyCutAbortController = null;
            refreshAllUI();
        },
        onError: (err, isCancel) => {
            const message = isCancel
                ? 'Emergency Cut cancelled. No messages were hidden.'
                : `Emergency Cut failed: ${err.message}. No messages were hidden.`;
            showToast(isCancel ? 'info' : 'error', message);
            logError('Emergency Cut failed', err);
            $('#send_textarea').prop('disabled', false);
            hideEmergencyCutModal();
            emergencyCutAbortController = null;
        },
        abortSignal: emergencyCutAbortController?.signal,
    });
}
```

**Wait — AbortController timing issue.** The `abortSignal` is passed at call time, but `onStart` creates the controller. The signal would be `null` when `executeEmergencyCut` is called because the controller doesn't exist yet.

**Fix:** Create the AbortController before calling `executeEmergencyCut`, not inside `onStart`:

```js
async function handleEmergencyCutClick() {
    emergencyCutAbortController = new AbortController();

    await executeEmergencyCut({
        onWarning: (msg) => showToast('warning', msg),
        onConfirmPrompt: (msg) => confirm(msg),
        onStart: () => {
            $('#send_textarea').prop('disabled', true);
            showEmergencyCutModal();
        },
        onProgress: (batch, total, events) => updateEmergencyCutProgress(batch, total, events),
        onPhase2Start: () => disableEmergencyCutCancel(),
        onComplete: ({ messagesProcessed, eventsCreated, hiddenCount }) => {
            if (messagesProcessed > 0) {
                showToast('success',
                    `Emergency Cut complete. ${messagesProcessed} messages processed, ` +
                    `${eventsCreated} memories created. Chat history hidden.`
                );
            } else {
                showToast('success', `Emergency Cut complete. ${hiddenCount} messages hidden from context.`);
            }
            $('#send_textarea').prop('disabled', false);
            hideEmergencyCutModal();
            emergencyCutAbortController = null;
            refreshAllUI();
        },
        onError: (err, isCancel) => {
            const message = isCancel
                ? 'Emergency Cut cancelled. No messages were hidden.'
                : `Emergency Cut failed: ${err.message}. No messages were hidden.`;
            showToast(isCancel ? 'info' : 'error', message);
            logError('Emergency Cut failed', err);
            $('#send_textarea').prop('disabled', false);
            hideEmergencyCutModal();
            emergencyCutAbortController = null;
        },
        abortSignal: emergencyCutAbortController.signal,
    });
}
```

The `emergencyCutAbortController` remains a module-level variable in `settings.js` so the cancel button handler can call `.abort()` on it. The controller is created eagerly (before confirmation) — this is fine since an unused AbortController is cheap.

**Event binding change** (line ~872):

```js
// BEFORE
$('#openvault_emergency_cut_btn').on('click', handleEmergencyCut);
// AFTER
$('#openvault_emergency_cut_btn').on('click', handleEmergencyCutClick);
```

And the Ollama test binding already calls `testOllamaConnection` — replace with `handleOllamaTestClick`.

### 4. Cleanup: Remove dead imports from `settings.js`

After the move, these imports are no longer needed in `settings.js`:
- Dynamic `import('../extraction/scheduler.js')` (was in `hideExtractedMessages`)
- Dynamic `import('../state.js')` (was in `handleEmergencyCut`)
- Dynamic `import('../extraction/worker.js')` (was in `handleEmergencyCut`)
- Dynamic `import('../extraction/extract.js')` (was in `handleEmergencyCut`)

## Test Changes

### Tests to move/rewrite

| Current location | New location | What changes |
|-----------------|-------------|-------------|
| `tests/ui/settings-helpers.test.js` → `hideExtractedMessages` (2 tests) | `tests/extraction/extract.test.js` or new `tests/extraction/hide-messages.test.js` | Import from `extract.js` instead of `settings.js`. These use `setupTestContext` — keep as integration tests. |
| `tests/ui/settings-helpers.test.js` → `handleEmergencyCut` (3 stub tests) | `tests/extraction/emergency-cut.test.js` | Rewrite as proper tests against `executeEmergencyCut`. Pass mock callback objects. No DOM setup needed. |
| `tests/integration/emergency-cut.test.js` | Update imports | Change `import('../../src/ui/settings.js')` to `import('../../src/extraction/extract.js')` for domain exports. UI helpers (`showEmergencyCutModal` etc.) still import from `settings.js`. |

### New tests for `testOllamaConnection`

Add to `tests/embeddings.test.js`:

```js
describe('testOllamaConnection', () => {
    it('returns true on successful connection', async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
        const result = await testOllamaConnection('http://localhost:11434');
        expect(result).toBe(true);
        expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.any(Object));
    });

    it('throws on failed connection', async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
        await expect(testOllamaConnection('http://localhost:11434')).rejects.toThrow('HTTP 500');
    });

    it('throws on network error', async () => {
        global.fetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
        await expect(testOllamaConnection('http://localhost:11434')).rejects.toThrow('ECONNREFUSED');
    });
});
```

### New tests for `executeEmergencyCut`

These are pure unit tests — pass mock callbacks, assert on which callbacks fired and with what arguments. No `setupTestContext` needed for the callback wiring tests (only for the integration path that calls `extractAllMessages`).

```js
describe('executeEmergencyCut', () => {
    it('calls onWarning and returns if worker is running', async () => { /* ... */ });
    it('calls onWarning if no messages to hide', async () => { /* ... */ });
    it('calls onConfirmPrompt and returns early on cancel', async () => { /* ... */ });
    it('skips extraction if all messages already extracted', async () => { /* ... */ });
    it('calls onError with isCancel=true on AbortError', async () => { /* ... */ });
});
```

### Test file for `hideExtractedMessages` (unit)

Since `hideExtractedMessages` calls `getDeps()`, it stays as an integration test. Move the existing 2 tests from `settings-helpers.test.js`, update imports only.

## Execution Order

| Step | File | Risk | Test change |
|------|------|------|-------------|
| 1 | `embeddings.js` | Low | Add 3 pure unit tests to `embeddings.test.js`. |
| 2 | `extract.js`: Add `hideExtractedMessages` | Low | Move 2 tests from `settings-helpers.test.js`. Update imports. |
| 3 | `extract.js`: Add `executeEmergencyCut` | Medium | New test file `tests/extraction/emergency-cut.test.js` with 5 tests. |
| 4 | `settings.js`: Wire click handlers | Low | Update `tests/integration/emergency-cut.test.js` imports. Remove stubs from `settings-helpers.test.js`. |

Steps 1-2 are independent. Step 3 depends on step 2 (`executeEmergencyCut` calls `hideExtractedMessages`). Step 4 depends on all prior steps.

## Verification

- `npm run test` green after each step.
- `src/ui/settings.js` contains ZERO dynamic imports from `extraction/scheduler.js`, `extraction/worker.js`, `extraction/extract.js`, or `state.js`.
- `src/ui/settings.js` has no references to `getProcessedFingerprints`, `getFingerprint`, `getBackfillStats`, `isWorkerRunning`, or `operationState`.
- `src/embeddings.js` exports `testOllamaConnection`.
- `src/extraction/extract.js` exports `hideExtractedMessages` and `executeEmergencyCut`.
- Manual verification: click Emergency Cut button, verify modal → progress → hide → toast still works. Click Ollama test button, verify spinner → success/fail states.
- Biome lint/format passes (pre-commit hook).
