# Design: Emergency Cut Feature

**Status:** Draft v5 (Final)
**Date:** 2026-03-23
**Scope:** UI dashboard button to extract all unprocessed messages and hide them, breaking LLM repetition loops.

---

## 1. Overview

Emergency Cut allows users to immediately extract all unprocessed chat messages into memories and hide them from the LLM's context. This creates a "clean cut" where the model can no longer see recent chat history to repeat from.

**Key principle:** Only hide messages that were successfully extracted. If extraction fails, nothing is hidden.

---

## 2. User Flow

```
1. User clicks "Emergency Cut" button in Dashboard
   ↓
2. Confirmation dialog: "Extract and hide 47 unprocessed messages?
   The LLM will only see: preset, char card, lorebooks, and OpenVault memories."
   [Cancel] [Extract and Hide]
   ↓
3. Progress modal shows: "Emergency Cut: batch 2 of 8..."
   Chat sending is blocked during this time (mouse + keyboard)
   ↓
4. Extraction completes (reuses existing backfill logic)
   ↓
5. Successfully extracted messages are marked as is_system=true
   ↓
6. Toast: "Emergency Cut complete. 47 messages extracted and hidden."
```

---

## 3. UI Changes

### 3.1 Button Layout (templates/settings_panel.html)

Stack vertically in Extraction Progress card:

```html
<div class="openvault-button-row openvault-button-stack">
    <button id="openvault_extract_all_btn" class="menu_button">
        <i class="fa-solid fa-layer-group"></i> Backfill History
    </button>
    <button id="openvault_emergency_cut_btn" class="menu_button danger"
            title="Extract all unprocessed messages and hide chat history to break repetition loops.">
        <i class="fa-solid fa-scissors"></i> Emergency Cut
    </button>
</div>
```

**Styling:**
- Add `.openvault-button-stack` class for vertical layout
- `.danger` class for visual distinction (red accent)
- Tooltip explains purpose on hover

### 3.2 Progress Modal (templates/settings_panel.html)

New modal overlay, reuses existing batch progress bar:

```html
<div id="openvault_emergency_cut_modal" class="openvault-modal hidden">
    <div class="openvault-modal-content">
        <h3><i class="fa-solid fa-scissors"></i> Emergency Cut in Progress</h3>
        <p>Extracting and hiding messages...</p>
        <p class="openvault-modal-hint">Note: You can manually unhide messages later using ST's built-in message visibility tools.</p>
        <!-- Reuse existing progress bar -->
        <div class="openvault-batch-progress">
            <div class="openvault-batch-progress-bar">
                <div class="openvault-batch-progress-fill" id="openvault_emergency_fill"></div>
            </div>
            <span class="openvault-batch-progress-label" id="openvault_emergency_label">Starting...</span>
        </div>
        <button id="openvault_emergency_cancel" class="menu_button">Cancel</button>
    </div>
</div>
```

---

## 4. State Management

### 4.1 Reuse Existing Flag (src/state.js)

Reuse `extractionInProgress` which the background worker already respects.

```javascript
// In handleEmergencyCut():
operationState.extractionInProgress = true; // Worker checks this at line 101
```

This ensures:
- Worker halts immediately when it sees `extractionInProgress = true`
- No race condition between Emergency Cut and background extraction
- Simpler state management (one flag, one meaning)

### 4.2 Blocking Mechanism

**Layer 1 (DOM):** Modal overlay with `z-index: 9999` covers all ST UI elements
**Layer 2 (Input):** `$('#send_textarea').prop('disabled', true)` blocks keyboard sending
**Layer 3 (Hotkeys - CRITICAL v5):** Global keydown trap prevents ST hotkeys (Ctrl+Enter, etc.)

```javascript
// In showEmergencyCutModal():
$(document).on('keydown.emergencyCut', function(e) {
    e.preventDefault();
    e.stopPropagation();
});

// In hideEmergencyCutModal():
$(document).off('keydown.emergencyCut');
```

**Why needed:** The DOM shield blocks mouse clicks, but ST's keyboard hotkeys (Ctrl+Enter for Regenerate, Ctrl+Right for Swipe, Enter for send) can still trigger generation while extraction is mutating the chat array.

---

## 5. Handler Implementation (src/ui/settings.js)

### 5.1 Modal Helpers

```javascript
function showEmergencyCutModal() {
    $('#openvault_emergency_cut_modal').removeClass('hidden');
    // CRITICAL (v5): Trap all keyboard input to prevent ST hotkeys
    $(document).on('keydown.emergencyCut', function(e) {
        e.preventDefault();
        e.stopPropagation();
    });
}

function hideEmergencyCutModal() {
    $('#openvault_emergency_cut_modal').addClass('hidden');
    // CRITICAL (v5): Release keyboard trap
    $(document).off('keydown.emergencyCut');
}

function updateEmergencyCutProgress(batchNum, totalBatches, eventsCreated) {
    const progress = Math.round((batchNum / totalBatches) * 100);
    $('#openvault_emergency_fill').css('width', `${progress}%`);
    $('#openvault_emergency_label').text(`Batch ${batchNum}/${totalBatches} - ${eventsCreated} memories created`);
}
```

### 5.2 handleEmergencyCut()

```javascript
let emergencyCutAbortController = null;

async function handleEmergencyCut() {
    const { getBackfillStats } = await import('../extraction/scheduler.js');
    const { getDeps } = await import('../deps.js');
    const { operationState } = await import('../state.js');
    const { isWorkerRunning } = await import('../extraction/worker.js');

    // Check for worker conflict
    if (isWorkerRunning()) {
        showToast('warning', 'Background extraction in progress. Please wait a moment.');
        return;
    }

    const context = getDeps().getContext();
    const chat = context.chat || [];
    const data = getOpenVaultData();

    // Get stats for confirmation
    const stats = getBackfillStats(chat, data);

    // Handle "Zero Unextracted" case
    let shouldExtract = true;
    let confirmMessage = '';

    if (stats.unextractedCount === 0) {
        const processedFps = getProcessedFingerprints(data);
        const hideableCount = chat.filter(m =>
            !m.is_system && processedFps.has(getFingerprint(m))
        ).length;

        if (hideableCount === 0) {
            showToast('info', 'No messages to hide');
            return;
        }

        confirmMessage = `All messages are already extracted. Hide ${hideableCount} messages from the LLM to break the loop?\n\n` +
            `The LLM will only see: preset, char card, lorebooks, and OpenVault memories.`;
        shouldExtract = false;
    } else {
        confirmMessage = `Extract and hide ${stats.unextractedCount} unprocessed messages?\n\n` +
            `The LLM will only see: preset, char card, lorebooks, and OpenVault memories.`;
    }

    const confirmed = confirm(confirmMessage);
    if (!confirmed) return;

    // If no extraction needed, just hide and done
    if (!shouldExtract) {
        const hiddenCount = await hideExtractedMessages();
        showToast('success', `Emergency Cut complete. ${hiddenCount} messages hidden from context.`);
        refreshAllUI();
        return;
    }

    // Block chat sending
    operationState.extractionInProgress = true;
    $('#send_textarea').prop('disabled', true);
    emergencyCutAbortController = new AbortController();

    showEmergencyCutModal();

    try {
        const { extractAllMessages } = await import('../extraction/extract.js');
        const result = await extractAllMessages({
            isEmergencyCut: true,
            progressCallback: updateEmergencyCutProgress,
            abortSignal: emergencyCutAbortController.signal,
        });

        await hideExtractedMessages();

        showToast('success',
            `Emergency Cut complete. ${result.messagesProcessed} messages processed, ` +
            `${result.eventsCreated} memories created. Chat history hidden.`
        );
        refreshAllUI();

    } catch (err) {
        logError('Emergency Cut failed', err);
        const isCancel = err.name === 'AbortError';
        const message = isCancel
            ? 'Emergency Cut cancelled. No messages were hidden.'
            : `Emergency Cut failed: ${err.message}. No messages were hidden.`;
        showToast(isCancel ? 'info' : 'error', message);
    } finally {
        operationState.extractionInProgress = false;
        $('#send_textarea').prop('disabled', false);
        hideEmergencyCutModal();
        emergencyCutAbortController = null;
    }
}
```

### 5.3 hideExtractedMessages()

```javascript
async function hideExtractedMessages() {
    const { getDeps } = await import('../deps.js');
    const { getProcessedFingerprints } = await import('../extraction/scheduler.js');

    const context = getDeps().getContext();
    const chat = context.chat || [];
    const data = getOpenVaultData();

    const processedFps = getProcessedFingerprints(data);

    let hiddenCount = 0;
    for (const msg of chat) {
        const fp = getFingerprint(msg);
        if (processedFps.has(fp) && !msg.is_system) {
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

---

## 6. Reused Components

| Component | Location | Usage |
|-----------|----------|-------|
| `extractAllMessages()` | `src/extraction/extract.js` | Full extraction pipeline (Phase 1 + Phase 2) |
| `getBackfillStats()` | `src/extraction/scheduler.js` | Count messages for confirmation |
| `getProcessedFingerprints()` | `src/extraction/scheduler.js` | Track successfully extracted |
| `getFingerprint()` | `src/extraction/scheduler.js` | Message fingerprinting |
| `showToast()` | `src/utils/dom.js` | User feedback |
| `refreshAllUI()` | `src/ui/render.js` | Update dashboard |

---

## 7. Error Handling

| Scenario | Behavior |
|----------|----------|
| **Extraction fails** | Throw error. Handler catches. Toast error. **No messages hidden.** |
| **Max backoff reached** | Throw error. Handler catches. Toast error. **No messages hidden.** |
| User cancels | AbortError thrown. Handler catches. Toast "Cancelled - nothing hidden." |
| Chat switch | AbortError thrown. Handler catches. Cleanup, unblock chat. |
| Zero unextracted | Offer to hide already-extracted messages instead. |

---

## 8. Testing Strategy

### 8.1 Unit Tests

| Test | File | Description |
|------|------|-------------|
| hideExtractedMessages only marks extracted | `tests/ui/settings.test.js` | Verify only fp in processed set are hidden |
| hideExtractedMessages skips already hidden | `tests/ui/settings.test.js` | Don't double-hide messages |
| handleEmergencyCut shows confirmation | `tests/ui/settings.test.js` | Confirm dialog with correct count |

### 8.2 Integration Tests

| Test | File | Description |
|------|------|-------------|
| Emergency Cut full flow | `tests/integration/emergency-cut.test.js` | Click → confirm → extract → hide → toast |
| Emergency Cut cancellation | `tests/integration/emergency-cut.test.js` | Cancel mid-extraction, verify nothing hidden |
| Emergency Cut failure | `tests/integration/emergency-cut.test.js` | Mock extraction fail, verify nothing hidden |

### 8.3 Structure Tests

| Test | File | Description |
|------|------|-------------|
| Emergency Cut button exists | `tests/ui/dashboard-structure.test.js` | ID, class, icon, tooltip |
| Progress modal exists | `tests/ui/dashboard-structure.test.js` | Modal HTML structure |

---

## 9. CSS Additions (css/dashboard.css)

```css
.openvault-button-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.openvault-button-stack .menu_button {
    width: 100%;
}

#openvault_emergency_cut_btn {
    border-color: var(--danger-border, #dc3545);
    color: var(--danger-text, #dc3545);
}

#openvault_emergency_cut_btn:hover {
    background: var(--danger-bg, #dc354520);
}

.openvault-modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px); /* v5: Match ST's native modal style */
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
}

.openvault-modal.hidden {
    display: none;
}

.openvault-modal-content {
    background: var(--background-color, #fff);
    padding: 20px;
    border-radius: 8px;
    min-width: 300px;
    text-align: center;
}

.openvault-modal-hint {
    font-size: 0.85em;
    color: var(--muted-text, #666);
    margin-top: 8px;
}
```

---

## 10. Required Changes to Existing Code

### 10.1 src/extraction/extract.js - extractAllMessages()

Add options parameter, fix AbortError and max-backoff bugs.

```javascript
export async function extractAllMessages(options = {}) {
    const {
        isEmergencyCut = false,
        progressCallback = null,
        abortSignal = null,
        onComplete = null,
    } = options;

    // Support legacy call signature: extractAllMessages(callbackFn)
    const updateEventListenersFn = typeof options === 'function' ? options : onComplete;

    // ... existing setup ...

    let toast = null;
    if (!isEmergencyCut) {
        toast = toastr.info('...', 'Backfill', { ... });
    }

    // ... existing code ...

    while (true) {
        if (abortSignal?.aborted) {
            throw new DOMException('Emergency Cut Cancelled', 'AbortError');
        }

        // ... process batch ...

        if (!isEmergencyCut) {
            if (toast) {
                toast.find('.toastr-progress').text(`Batch ${batchNum}/${initialBatchCount}`);
            }
            $('.openvault-backfill-toast .toast-message').text(...);
        } else if (progressCallback) {
            progressCallback(batchNum, initialBatchCount, eventsCreated);
        }
    }

    // Run Phase 2 enrichment
    // ...

    if (!isEmergencyCut && toast) {
        toastr.clear(toast);
    }

    if (updateEventListenersFn) {
        updateEventListenersFn(true);
    }

    return { messagesProcessed: totalMessages, eventsCreated: totalEvents };
}
```

### 10.2 src/extraction/extract.js - AbortError Catch Block

Fix at line ~1048.

```javascript
} catch (error) {
    if (error.name === 'AbortError' || error.message === 'Chat changed during extraction') {
        // For Emergency Cut, MUST throw to let handler catch it
        if (isEmergencyCut) throw error;

        logDebug('Chat changed during backfill, aborting');
        $('.openvault-backfill-toast').remove();
        showToast('warning', 'Backfill aborted: chat changed', 'OpenVault');
        clearAllLocks();
        setStatus('ready');
        return;
    }
    // ... rest of error handling
}
```

### 10.3 src/extraction/extract.js - Max Backoff Catch Block

**CRITICAL (v5):** Fix at line ~1070. When max backoff is reached, throw for Emergency Cut instead of breaking.

```javascript
if (cumulativeBackoffMs >= MAX_BACKOFF_TOTAL_MS) {
    // CRITICAL (v5): For Emergency Cut, MUST throw - breaking would silently succeed
    // with partial extraction, leading to hiding incomplete data
    if (isEmergencyCut) {
        throw new Error(`Extraction failed after ${Math.round(cumulativeBackoffMs / 1000)}s of API errors. No messages were hidden.`);
    }

    logDebug(`Batch ${batchesProcessed + 1} failed: cumulative backoff reached ${Math.round(cumulativeBackoffMs / 1000)}s...`);
    logError('Extraction stopped after exceeding backoff limit', error);
    showToast('error', `Extraction stopped: API errors persisted...`, 'OpenVault');
    break;
}
```

**Why this matters:** Without this fix, if the API completely fails:
1. `extractAllMessages` breaks the loop after 15 min of retries
2. Proceeds to Phase 2, finishes, resolves successfully
3. `handleEmergencyCut` thinks it succeeded → hides partial messages
4. User loses chat history but only got partial memories extracted

With the fix, the error bubbles to handler's catch block, showing error toast with no hiding.

### 10.4 src/ui/settings.js - Update handleExtractAll

```javascript
async function handleExtractAll() {
    const { extractAllMessages } = await import('../extraction/extract.js');
    const { isWorkerRunning } = await import('../extraction/worker.js');
    if (isWorkerRunning()) {
        showToast('warning', 'Background extraction in progress. Please wait.', 'OpenVault');
        return;
    }
    await extractAllMessages({ onComplete: updateEventListeners });
}
```

---

## 11. Implementation Checklist

- [ ] Add buttons to `templates/settings_panel.html`
- [ ] Add modal HTML to `templates/settings_panel.html`
- [ ] Add CSS to `css/dashboard.css`
- [ ] Implement `showEmergencyCutModal()` with keydown trap
- [ ] Implement `hideEmergencyCutModal()` with keydown cleanup
- [ ] Implement `handleEmergencyCut()` in `src/ui/settings.js`
- [ ] Implement `hideExtractedMessages()` in `src/ui/settings.js`
- [ ] Bind button click in `bindUIElements()`
- [ ] Update `extractAllMessages()` to accept options object
- [ ] Fix AbortError swallow bug in catch block
- [ ] Fix max-backoff silent success bug in catch block
- [ ] Update `handleExtractAll()` to use new options signature
- [ ] Add unit tests
- [ ] Add integration tests
- [ ] Add structure tests

---

## 12. Design Review Notes

### v4 Fixes
1. **AbortError Swallow Bug** - Throw if `isEmergencyCut: true`
2. **Background Worker Collision** - Reuse `extractionInProgress` flag
3. **Modal z-index** - 9999 to cover ST's top navigation

### v5 Fixes (Final)
1. **Max Backoff Silent Success Bug** - Throw instead of break when backoff limit reached during Emergency Cut. Prevents hiding partial data on API outage.

2. **Keyboard Hotkey Bypass** - Add `keydown.emergencyCut` event trap while modal is open. Prevents Ctrl+Enter, Enter, etc. from triggering ST generation.

3. **UI Polish** - Added `backdrop-filter: blur(2px)` to match ST's native modal style.

### Open Questions (Answered)
1. **Keyboard shortcut?** - No. Button + confirmation is the right friction.
2. **Clear Memories reset?** - Not needed. ST has built-in tools.
3. **Perf metrics?** - No. Already tracked at operation level.