# Design: Emergency Cut Feature

**Status:** v7 - Approved for Implementation
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
   Cancel button available during Phase 1, disabled during Phase 2
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

### 3.2 Progress Modal (templates/settings_panel.html)

**CRITICAL (v6):** Modal must be at document.body level to avoid stacking context issues.

```html
<!-- Appended to document.body, not inside extension panel -->
<div id="openvault_emergency_cut_modal" class="openvault-modal hidden">
    <div class="openvault-modal-content">
        <h3><i class="fa-solid fa-scissors"></i> Emergency Cut in Progress</h3>
        <p id="openvault_emergency_phase">Extracting and hiding messages...</p>
        <p class="openvault-modal-hint">Note: You can manually unhide messages later using ST's built-in message visibility tools.</p>
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

### 4.1 Reuse Existing Flag

Reuse `extractionInProgress` which the background worker already respects.

```javascript
operationState.extractionInProgress = true; // Worker checks this at line 101
```

### 4.2 Blocking Mechanism

**Layer 1 (DOM):** Modal appended to `document.body` with `z-index: 9999`
**Layer 2 (Input):** `$('#send_textarea').prop('disabled', true)`
**Layer 3 (Hotkeys):** Keyboard trap with modal accessibility

```javascript
// Keyboard trap that preserves modal accessibility
$(document).on('keydown.emergencyCut', function(e) {
    // Escape key - always check first (handles focus loss edge case)
    // If user clicks overlay, focus drops to body, but Escape should still work
    if (e.key === 'Escape') {
        e.preventDefault();
        const $cancelBtn = $('#openvault_emergency_cancel');
        // Only trigger if not disabled (Phase 2)
        if (!$cancelBtn.prop('disabled')) {
            $cancelBtn.click();
        }
        return;
    }

    // Allow Tab/Enter/etc inside the modal
    if ($(e.target).closest('#openvault_emergency_cut_modal').length) {
        return;
    }

    // Block ST hotkeys outside the modal (Ctrl+Enter, Enter, etc.)
    e.preventDefault();
    e.stopPropagation();
});
```

---

## 5. Handler Implementation (src/ui/settings.js)

### 5.1 Modal Helpers

```javascript
let emergencyCutModalAppended = false;

function showEmergencyCutModal() {
    // Append to body to avoid stacking context issues with ST's extension panel
    const $modal = $('#openvault_emergency_cut_modal');
    if (!emergencyCutModalAppended) {
        $modal.appendTo('body');
        emergencyCutModalAppended = true;
    }
    $modal.removeClass('hidden');

    // Keyboard trap with modal accessibility
    $(document).on('keydown.emergencyCut', function(e) {
        // Escape - always check first (handles focus loss on overlay click)
        if (e.key === 'Escape') {
            e.preventDefault();
            const $cancelBtn = $('#openvault_emergency_cancel');
            if (!$cancelBtn.prop('disabled')) {
                $cancelBtn.click();
            }
            return;
        }

        // Allow Tab/Enter inside modal
        if ($(e.target).closest('#openvault_emergency_cut_modal').length) {
            return;
        }

        // Block ST hotkeys outside
        e.preventDefault();
        e.stopPropagation();
    });

    // Bind cancel button click to abort controller
    $('#openvault_emergency_cancel').off('click').on('click', () => {
        if (emergencyCutAbortController) {
            emergencyCutAbortController.abort();
        }
    });
}

function hideEmergencyCutModal() {
    $('#openvault_emergency_cut_modal').addClass('hidden');
    $(document).off('keydown.emergencyCut');
    $('#openvault_emergency_cancel').off('click');
}

function updateEmergencyCutProgress(batchNum, totalBatches, eventsCreated) {
    const progress = Math.round((batchNum / totalBatches) * 100);
    $('#openvault_emergency_fill').css('width', `${progress}%`);
    $('#openvault_emergency_label').text(`Batch ${batchNum}/${totalBatches} - ${eventsCreated} memories created`);
}

// v6: Called when entering Phase 2 (uncancellable)
function disableEmergencyCutCancel() {
    $('#openvault_emergency_cancel')
        .prop('disabled', true)
        .text('Synthesizing...');
    $('#openvault_emergency_phase').text('Running final synthesis...');
}
```

### 5.2 handleEmergencyCut()

```javascript
let emergencyCutAbortController = null;

async function handleEmergencyCut() {
    const { getBackfillStats, getProcessedFingerprints, getFingerprint } = await import('../extraction/scheduler.js');
    const { getDeps } = await import('../deps.js');
    const { operationState } = await import('../state.js');
    const { isWorkerRunning } = await import('../extraction/worker.js');
    const { getOpenVaultData } = await import('../utils/data.js');

    if (isWorkerRunning()) {
        showToast('warning', 'Background extraction in progress. Please wait a moment.');
        return;
    }

    const context = getDeps().getContext();
    const chat = context.chat || [];
    const data = getOpenVaultData();

    const stats = getBackfillStats(chat, data);

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

    if (!confirm(confirmMessage)) return;

    if (!shouldExtract) {
        const hiddenCount = await hideExtractedMessages();
        showToast('success', `Emergency Cut complete. ${hiddenCount} messages hidden from context.`);
        refreshAllUI();
        return;
    }

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
            onPhase2Start: disableEmergencyCutCancel, // v6: Disable cancel during Phase 2
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
    const { getProcessedFingerprints, getFingerprint } = await import('../extraction/scheduler.js');
    const { getOpenVaultData } = await import('../utils/data.js'); // v6: Was missing

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
| `extractAllMessages()` | `src/extraction/extract.js` | Full extraction pipeline |
| `getBackfillStats()` | `src/extraction/scheduler.js` | Count messages for confirmation |
| `getProcessedFingerprints()` | `src/extraction/scheduler.js` | Track successfully extracted |
| `getFingerprint()` | `src/extraction/scheduler.js` | Message fingerprinting |
| `getOpenVaultData()` | `src/utils/data.js` | Get plugin data |
| `showToast()` | `src/utils/dom.js` | User feedback |
| `refreshAllUI()` | `src/ui/render.js` | Update dashboard |

---

## 7. Error Handling

| Scenario | Behavior |
|----------|----------|
| **Extraction fails** | Throw error. Handler catches. Toast error. **No messages hidden.** |
| **Max backoff reached** | Throw error. Handler catches. Toast error. **No messages hidden.** |
| User cancels (Phase 1) | AbortError propagates from `callLLM`. Handler catches. Toast "Cancelled - nothing hidden." |
| User tries cancel (Phase 2) | Button disabled. Cannot cancel. |
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
| Emergency Cut cancellation mid-batch | `tests/integration/emergency-cut.test.js` | Cancel during LLM call, verify abort propagates |
| Emergency Cut Phase 2 non-cancellable | `tests/integration/emergency-cut.test.js` | Verify cancel button disabled during Phase 2 |

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
    backdrop-filter: blur(2px);
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

#openvault_emergency_cancel:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
```

---

## 10. Required Changes to Existing Code

### 10.1 src/extraction/extract.js - extractAllMessages()

**v6 fixes:**
- Normalize options before destructuring (JS anti-pattern fix)
- Pass abortSignal to extractMemories and runPhase2Enrichment
- Call onPhase2Start callback before Phase 2

```javascript
export async function extractAllMessages(options = {}) {
    // v6: Normalize options to handle legacy function argument
    const opts = typeof options === 'function' ? { onComplete: options } : (options || {});

    const {
        isEmergencyCut = false,
        progressCallback = null,
        abortSignal = null,
        onComplete = null,
        onPhase2Start = null, // v6: Callback when entering Phase 2
    } = opts;

    const updateEventListenersFn = onComplete;

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

        // ... existing batch processing ...

        try {
            const result = await extractMemories(currentBatch, targetChatId, {
                isBackfill: true,
                silent: true,
                abortSignal, // v6: Pass signal to interrupt in-flight LLM calls
            });
            // ...
        } catch (error) {
            // ... existing error handling ...
        }

        if (!isEmergencyCut) {
            // toast updates
        } else if (progressCallback) {
            progressCallback(batchNum, initialBatchCount, eventsCreated);
        }
    }

    // v6: Notify caller that Phase 2 is starting (uncancellable)
    if (isEmergencyCut && onPhase2Start) {
        onPhase2Start();
    }

    // Run Phase 2 enrichment with abortSignal
    runPhase2Enrichment(data, settings, targetChatId, { abortSignal }); // v6: Pass signal

    if (!isEmergencyCut && toast) {
        toastr.clear(toast);
    }

    if (updateEventListenersFn) {
        updateEventListenersFn(true);
    }

    return { messagesProcessed: totalMessages, eventsCreated: totalEvents };
}
```

### 10.2 src/extraction/extract.js - extractMemories()

Pass abortSignal to callLLM for in-flight cancellation.

```javascript
export async function extractMemories(messages, targetChatId, options = {}) {
    const { isBackfill = false, silent = false, abortSignal = null } = options;

    // ... existing setup ...

    // Pass signal to callLLM so in-flight requests can be aborted
    const eventJson = await callLLM(eventPrompt, LLM_CONFIGS.extraction_events, {
        structured: true,
        signal: abortSignal, // v6: Enables mid-request cancellation
    });

    // ... rest of extraction ...

    const graphJson = await callLLM(graphPrompt, LLM_CONFIGS.extraction_graph, {
        structured: true,
        signal: abortSignal, // v6: Enables mid-request cancellation
    });

    // ... rest of function ...
}
```

### 10.3 src/extraction/extract.js - runPhase2Enrichment()

Accept abortSignal and check it in character loop.

```javascript
export async function runPhase2Enrichment(data, settings, targetChatId, options = {}) {
    const { abortSignal = null } = options; // v6: Accept signal

    // ... existing setup ...

    for (const characterName of Object.keys(data.reflection_state || {})) {
        // v6: Check abort signal in loop
        if (abortSignal?.aborted) {
            throw new DOMException('Emergency Cut Cancelled', 'AbortError');
        }

        if (shouldReflect(data.reflection_state[characterName])) {
            await generateReflections(characterName, data, settings, { abortSignal });
        }
    }

    // ... communities ...

    await saveOpenVaultData(targetChatId);
}
```

### 10.4 src/extraction/extract.js - AbortError Catch Block

Same as v5 - throw for Emergency Cut.

```javascript
} catch (error) {
    if (error.name === 'AbortError' || error.message === 'Chat changed during extraction') {
        if (isEmergencyCut) throw error;
        // ... legacy cleanup
    }
    // ...
}
```

### 10.5 src/extraction/extract.js - Max Backoff Catch Block

Same as v5 - throw for Emergency Cut.

```javascript
if (cumulativeBackoffMs >= MAX_BACKOFF_TOTAL_MS) {
    if (isEmergencyCut) {
        throw new Error(`Extraction failed after ${Math.round(cumulativeBackoffMs / 1000)}s of API errors.`);
    }
    // ... legacy toast and break
}
```

### 10.6 src/ui/settings.js - Update handleExtractAll

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
- [ ] Implement `showEmergencyCutModal()` with body append and accessible keydown trap
- [ ] Implement `hideEmergencyCutModal()` with keydown cleanup
- [ ] Implement `disableEmergencyCutCancel()` for Phase 2
- [ ] Implement `handleEmergencyCut()` in `src/ui/settings.js`
- [ ] Implement `hideExtractedMessages()` with all required imports
- [ ] Bind button click in `bindUIElements()`
- [ ] Update `extractAllMessages()` with options normalization and signal propagation
- [ ] Update `extractMemories()` to pass abortSignal to callLLM
- [ ] Update `runPhase2Enrichment()` to accept and check abortSignal
- [ ] Fix AbortError swallow bug in catch block
- [ ] Fix max-backoff silent success bug in catch block
- [ ] Update `handleExtractAll()` to use new options signature
- [ ] Add unit tests
- [ ] Add integration tests
- [ ] Add structure tests

---

## 12. Design Review Notes

### v4 Fixes
1. AbortError Swallow Bug
2. Background Worker Collision (reuse `extractionInProgress`)
3. Modal z-index (9999)

### v5 Fixes
1. Max Backoff Silent Success Bug
2. Keyboard Hotkey Trap
3. Backdrop blur

### v6 Fixes
1. **AbortSignal Propagation** - Pass signal through `extractMemories` → `callLLM` so in-flight LLM calls can be cancelled mid-request.

2. **Uncancellable Phase 2** - Disable Cancel button during Phase 2 synthesis with `onPhase2Start` callback. Button shows "Synthesizing...".

3. **Keyboard Trap Accessibility** - Allow Tab/Enter/Escape inside modal. Only block events outside modal (ST hotkeys). Escape triggers cancel.

4. **JS Destructuring Anti-Pattern** - Normalize `options` before destructuring to handle legacy function argument.

5. **Missing Imports** - Added `getOpenVaultData` and `getFingerprint` imports to `hideExtractedMessages`.

6. **Modal Stacking Context** - Append modal to `document.body` instead of extension panel to avoid CSS transform/overflow clipping.

### v7 Fixes (Final)
1. **Escape Key Focus Loss** - Pull Escape check above `closest()` check. If user clicks overlay, focus drops to body, but Escape must still cancel.

2. **Cancel Button Binding** - Explicitly bind click handler in `showEmergencyCutModal()` that calls `emergencyCutAbortController.abort()`. Cleanup in `hideEmergencyCutModal()`.

---

**Status: APPROVED FOR IMPLEMENTATION**