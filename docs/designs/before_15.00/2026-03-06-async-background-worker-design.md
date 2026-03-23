# Design: Async Background Worker for Non-Blocking Extraction

## 1. Problem Statement

OpenVault currently blocks the SillyTavern chat UI during memory extraction. When `MESSAGE_RECEIVED` fires, the extension locks via `operationState.extractionInProgress = true` and runs the full extraction pipeline (event LLM call → graph LLM call → embedding → dedup → reflection LLM calls → community detection). This takes 15-60+ seconds depending on API speed.

During this time:
- The user cannot generate new messages (the lock prevents re-entry)
- Blocking toasts cover the screen
- The chat flow is interrupted after every AI response

**Goal:** Make extraction invisible to the user. The AI replies, the user reads and types immediately, and OpenVault digests everything silently in the background.

## 2. Goals & Non-Goals

### Must do:
- `onMessageReceived` returns instantly (no `await` on extraction)
- User can continue chatting while extraction runs in background
- Only one worker instance runs at a time (no parallel extraction)
- Messages are hidden only after events + graph extraction succeeds
- Background worker auto-processes backfill batches (no manual trigger needed during chat)
- Worker retries failed batches with exponential backoff
- New incoming messages reset the backoff timer
- Worker halts if user switches chats

### Won't do:
- Web Workers / SharedWorkers (adds complexity, `chatMetadata` is on main thread)
- Service Workers (overkill, same-thread is sufficient)
- Change the manual "Backfill" button behavior (stays blocking with progress toasts)
- Change retrieval/injection flow (`onBeforeGeneration` stays synchronous)
- Change the extraction LLM prompt logic or output schemas

## 3. Proposed Architecture

### 3.0 CPU Yielding (Preventing Micro-Stutters)

Network calls (`await callLLM`) don't block the UI, but heavy synchronous math **does**. With 500+ memories, running Jaccard token overlap, cosine similarity loops in `filterSimilarEvents`, or Graphology's Louvain algorithm will freeze the Chrome tab for 100–300ms.

A `yieldToMain()` helper must be added and sprinkled into heavy `for` loops:

```javascript
// src/utils.js
export function yieldToMain() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

// Usage in heavy loops (filterSimilarEvents, scoreMemories, communities):
for (let i = 0; i < filtered.length; i++) {
    if (i % 10 === 0) await yieldToMain();
    // ... do heavy math
}
```

This pushes continuation to the end of the macrotask queue, allowing Chrome to render frames and process user input between chunks.

### 3.1 Two-Path Split

```
                    ┌─────────────────────────────────────┐
  User clicks       │  CRITICAL PATH (synchronous, fast)  │
  "Generate" ──────►│  1. autoHideOldMessages()            │
                    │  2. retrieveAndInjectContext()       │
                    │  3. Return control to SillyTavern    │
                    └─────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
  AI replies        │  BACKGROUND PATH (async, silent)    │
  MESSAGE_RECEIVED─►│  1. wakeUpBackgroundWorker()        │──► fire-and-forget
                    │     (no await, returns immediately)  │
                    └──────────────┬──────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  WORKER LOOP                        │
                    │  while (batches available) {        │
                    │    Phase 1: events + graph → SAVE   │
                    │    Phase 2: reflect + community → SAVE│
                    │    yield to main thread (2s delay)  │
                    │  }                                  │
                    └─────────────────────────────────────┘
```

### 3.2 Single-Instance Guarantee

JavaScript is single-threaded. The worker uses a boolean flag `isRunning`. If `wakeUpBackgroundWorker()` is called while the worker is already looping, it's a no-op. However, the running worker will naturally pick up any new batches on its next loop iteration.

To handle the "reset backoff on new message" requirement, a monotonically increasing `wakeGeneration` counter is used. Each call to `wakeUpBackgroundWorker()` increments it. The worker checks this counter during backoff sleep — if it changed, the worker resets its retry state and immediately re-attempts.

### 3.3 Two-Phase Extraction with Intermediate Save

Currently `extractMemories()` runs all 7+ stages and saves once at the end. We split it:

```
Phase 1 (Critical — gates auto-hide):
  ├─ Stage 3A: Event extraction (LLM call)
  ├─ Stage 3B: Graph extraction (LLM call)
  ├─ Stage 4: Embedding + dedup
  ├─ Stage 4.5: Graph entity/relationship upsert
  ├─ Update PROCESSED_MESSAGES_KEY  ← moved here
  ├─ Push events to MEMORIES_KEY
  ├─ Update character states
  └─ saveOpenVaultData()  ← INTERMEDIATE SAVE

Phase 2 (Background — enrichment, non-critical):
  ├─ Stage 4.6: Reflection (if threshold met)
  ├─ Stage 4.7: Community detection (if interval crossed)
  └─ saveOpenVaultData()  ← FINAL SAVE
```

**Why two saves:** If Phase 2 crashes (e.g., reflection LLM timeout), Phase 1 work is preserved. Events are stored, processed IDs are persisted, and auto-hide can safely proceed. Phase 2 stages are "bonus" — they enrich but don't create the core data.

**Why mark processed after events + graph (not after events only):** Graph extraction uses the events as context. If events succeed but graph fails, we'd have events without their graph relationships, creating an inconsistent state. Treating them as an atomic unit ensures the knowledge graph stays synchronized with extracted events.

## 4. Data Models / Schema

No schema changes. The existing `chatMetadata.openvault` structure remains identical:

```typescript
// No new fields. The worker is a runtime-only concept.
// Existing fields used by the worker:
{
  processed_message_ids: number[]  // Gate for auto-hide (unchanged)
  memories: Memory[]               // Events and reflections (unchanged)
  graph: GraphState                // Entities and edges (unchanged)
  // ...
}
```

### Runtime-Only State (not persisted)

```typescript
// In worker.js (module-level variables)
let isRunning: boolean = false;
let wakeGeneration: number = 0;  // Incremented by wakeUpBackgroundWorker()
```

## 5. Interface / API Design

### 5.1 New File: `src/extraction/worker.js`

```typescript
/**
 * Wake up the background worker. Fire-and-forget.
 * Safe to call multiple times — only one instance runs.
 * If worker is already running, increments wake generation
 * so it resets backoff and re-checks for work.
 */
export function wakeUpBackgroundWorker(): void

/**
 * Check if the background worker is currently processing.
 * Used by UI status indicators.
 */
export function isWorkerRunning(): boolean
```

### 5.2 Modified: `src/extraction/extract.js`

```typescript
/**
 * extractMemories() — UNCHANGED SIGNATURE
 * Internal behavior change:
 *   - Accepts new optional `options.silent` flag
 *   - When silent=true: no showToast calls, no status updates
 *   - Returns result object as before
 *   - Now performs intermediate save after Phase 1
 *
 * @param messageIds - Specific message IDs to extract
 * @param targetChatId - Chat ID for integrity check
 * @param options - { silent?: boolean }
 */
export async function extractMemories(
  messageIds?: number[],
  targetChatId?: string,
  options?: { silent?: boolean }
): Promise<ExtractionResult>
```

### 5.3 Modified: `src/events.js`

```typescript
/**
 * onMessageReceived() — CHANGED BEHAVIOR
 * Before: await extractMemories() (blocking)
 * After:  wakeUpBackgroundWorker() (fire-and-forget, no await)
 *
 * KEEPS:
 *   - isAutomaticMode() check
 *   - isChatLoadingCooldown() check (ST fires MESSAGE_RECEIVED flurry on chat load)
 *   - is_user / is_system message filter
 *
 * Removes:
 *   - operationState.extractionInProgress check/set
 *   - showToast calls for extraction
 *   - checkAndTriggerBackfill() call (worker handles this)
 */
export async function onMessageReceived(messageId: number): Promise<void>
```

Concrete implementation:
```javascript
export function onMessageReceived(messageId) {
    if (!isAutomaticMode()) return;
    if (isChatLoadingCooldown()) return;

    const message = getDeps().getContext().chat[messageId];
    if (!message || message.is_user || message.is_system) return;

    wakeUpBackgroundWorker();  // fire-and-forget, no await
}
```

### 5.4 Modified: `src/state.js`

```typescript
// operationState.extractionInProgress is KEPT but only used by:
//   - extractAllMessages() (manual backfill button — still blocking)
// The background worker does NOT use this flag.
// Worker uses its own isRunning flag internally.
```

## 6. Detailed Implementation: Worker Loop

```javascript
// src/extraction/worker.js — pseudocode showing the full algorithm

let isRunning = false;
let wakeGeneration = 0;

export function wakeUpBackgroundWorker() {
    wakeGeneration++;
    if (isRunning) return;  // Worker will see new generation on next check
    isRunning = true;
    runLoop().finally(() => { isRunning = false; });
}

async function runLoop() {
    const targetChatId = getCurrentChatId();
    let retryCount = 0;
    let cumulativeBackoffMs = 0;
    let lastSeenGeneration = wakeGeneration;

    while (true) {
        // === Guard: Chat switched? ===
        if (getCurrentChatId() !== targetChatId) break;

        // === Guard: Extension disabled? ===
        if (!isExtensionEnabled()) break;

        // === Guard: Manual backfill took over? ===
        if (operationState.extractionInProgress) {
            log('Worker: Manual backfill took over, yielding.');
            break;
        }

        // === Check for new wake signal (reset backoff) ===
        if (wakeGeneration !== lastSeenGeneration) {
            retryCount = 0;
            cumulativeBackoffMs = 0;
            lastSeenGeneration = wakeGeneration;
        }

        // === Get next batch ===
        const batch = getNextBatch(chat, data, batchSize, bufferSize);
        if (!batch) break;  // No complete batches, go to sleep

        // === Process ===
        setStatus('extracting');
        try {
            await extractMemories(batch, targetChatId, { silent: true });
            // Phase 1 errors propagate here and trigger backoff.
            // Phase 2 errors are caught internally — batch is "done" after Phase 1.
            retryCount = 0;
            cumulativeBackoffMs = 0;
        } catch (err) {
            // Only Phase 1 failures reach here (events + graph).
            // Phase 2 failures (reflection, community) are swallowed inside
            // extractMemories and do NOT cause retries — the batch is already
            // committed after Phase 1's intermediate save.
            retryCount++;
            const backoffMs = getBackoffDelay(retryCount);
            cumulativeBackoffMs += backoffMs;

            if (cumulativeBackoffMs >= MAX_BACKOFF_TOTAL_MS) {
                log('Worker: backoff limit exceeded, stopping');
                break;
            }

            // Interruptible sleep: check wakeGeneration periodically
            await interruptibleSleep(backoffMs);
            continue;  // Retry same batch
        }

        // === Yield to browser (prevent UI jank) ===
        await new Promise(r => setTimeout(r, 2000));
    }

    setStatus('ready');
}
```

**Critical: Phase 2 errors do NOT trigger backoff.** Inside `extractMemories`, Phase 2 (reflection + community) is wrapped in its own try/catch. If reflection times out, the error is logged, Phase 1 data is already saved, and `extractMemories` returns successfully. The worker moves on to the next batch. Only Phase 1 failures (event/graph LLM call errors) propagate as thrown exceptions and trigger the backoff retry loop.

async function interruptibleSleep(totalMs) {
    const generationAtStart = wakeGeneration;
    const chunkMs = 500;  // Check every 500ms
    let elapsed = 0;
    while (elapsed < totalMs) {
        await new Promise(r => setTimeout(r, Math.min(chunkMs, totalMs - elapsed)));
        elapsed += chunkMs;
        if (wakeGeneration !== generationAtStart) return;  // New message, wake up early
    }
}
```

## 7. File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `src/extraction/worker.js` | **CREATE** | Background worker loop with single-instance guard, backoff retry, interruptible sleep |
| `src/extraction/extract.js` | **MODIFY** | Add `options.silent` flag; move `PROCESSED_MESSAGES_KEY` update after graph stage; add intermediate `saveOpenVaultData()` after Phase 1; wrap Phase 2 (reflection+community) in try/catch — Phase 2 failures are logged but do NOT propagate (batch is "done" after Phase 1) |
| `src/events.js` | **MODIFY** | `onMessageReceived`: remove blocking extraction, replace with `wakeUpBackgroundWorker()` (no await); remove `checkAndTriggerBackfill()` call; remove `operationState.extractionInProgress` usage; KEEP `isChatLoadingCooldown()` and `isAutomaticMode()` guards |
| `src/utils.js` | **MODIFY** | Add `yieldToMain()` helper for CPU yielding in heavy loops |
| `src/state.js` | **NO CHANGE** | `operationState.extractionInProgress` stays for manual backfill use only |
| `src/ui/status.js` | **VERIFY** | Confirm `setStatus('extracting')` updates the CSS indicator without blocking toasts |
| `src/ui/settings.js` | **MODIFY** | Manual backfill button handler: reject with toast if `isWorkerRunning()` returns true |
| `src/extraction/scheduler.js` | **NO CHANGE** | `getNextBatch()` already provides the batch selection logic the worker needs |

## 8. Risks & Edge Cases

### 8.1 Race: User generates while worker is mid-LLM-call
**Scenario:** Worker is waiting for the extraction LLM response. User clicks Generate.
**Behavior:** `onBeforeGeneration` runs immediately. `autoHideOldMessages()` checks `PROCESSED_MESSAGES_KEY` — it only sees messages that completed Phase 1. Messages currently being processed stay visible. `retrieveAndInjectContext()` uses the latest saved memories. The worker continues in the background.
**Result:** Safe. User gets slightly stale but complete memories. Next generation will include the freshly extracted ones.

### 8.2 Race: Worker saves while another save is in-flight
**Scenario:** Worker calls `saveOpenVaultData()` at the same time as `onBeforeGeneration` calling `saveChatConditional()`.
**Behavior:** Both write to `chatMetadata` (in-memory object). JavaScript is single-threaded, so the mutations are sequential. The `saveChatConditional()` call serializes the current in-memory state to disk. No data loss.
**Save integrity note:** SillyTavern's `saveChatConditional()` is inherently debounced, so frequent saves from the background worker will not cause disk thrashing or file corruption.
**Result:** Safe. Worst case: one save includes slightly more data than expected.

### 8.3 Race: Two rapid messages before worker wakes
**Scenario:** User sends message → AI replies (msg #50) → user immediately sends another → AI replies (msg #52). Two `MESSAGE_RECEIVED` events fire in quick succession.
**Behavior:** First call sets `isRunning = true` and starts the loop. Second call increments `wakeGeneration` but returns immediately (no-op). The running worker processes both messages' batches in its loop.
**Result:** Safe. Single worker instance, multiple batches processed sequentially.

### 8.4 Manual backfill during background worker
**Scenario:** Worker is running. User clicks "Backfill Chat History" button.
**Behavior:** Manual backfill uses `operationState.extractionInProgress` (separate from worker's `isRunning`). Both could call `extractMemories()` concurrently.
**Resolution — Mutual Exclusion via Existing Flags:**
- **Worker yields to manual backfill:** The worker loop checks `operationState.extractionInProgress` each iteration. If manual backfill set it to `true`, the worker breaks out of its loop gracefully.
  ```javascript
  // Inside worker loop:
  if (operationState.extractionInProgress) {
      log('Worker: Manual backfill took over, yielding.');
      break;
  }
  ```
- **Manual backfill button rejects if worker is busy:** The UI handler checks `isWorkerRunning()` before starting.
  ```javascript
  if (isWorkerRunning()) {
      showToast('warning', 'Background extraction in progress. Please wait.');
      return;
  }
  ```
This two-way guard prevents concurrent `extractMemories()` calls without needing an abort mechanism.

### 8.5 Network down for extended period
**Scenario:** API is unreachable. Worker retries with backoff up to 15 minutes cumulative.
**Behavior:** After 15 minutes of cumulative backoff, worker stops. Messages remain visible (not hidden). Next `MESSAGE_RECEIVED` wakes the worker, which resets the backoff counter and tries again.
**Result:** Safe. No data loss. Messages stay in context until API recovers.

### 8.6 Page refresh during worker execution
**Scenario:** Worker is between Phase 1 save and Phase 2 save. User refreshes.
**Behavior:** Phase 1 data (events, graph, processed IDs) is persisted. Phase 2 (reflection, community) is lost for that batch. On next chat load, the worker would not reprocess those messages (they're in `processed_message_ids`), so reflection/community for that specific batch is skipped.
**Acceptable trade-off:** Reflection and community are triggered periodically (threshold/interval), so they'll catch up naturally from future batches.

## 9. Migration Notes

### Backwards Compatibility
- No schema changes → existing chat data works without migration
- `extractAllMessages()` (manual backfill) is untouched → existing backfill behavior preserved
- `onBeforeGeneration()` is untouched → retrieval/injection unchanged

### Testing Strategy
- Unit test `interruptibleSleep` with mock `wakeGeneration` changes
- Unit test worker single-instance guarantee (call `wakeUpBackgroundWorker` twice, verify only one loop runs)
- Integration test: mock `extractMemories` to verify worker loop processes multiple batches
- Integration test: verify `PROCESSED_MESSAGES_KEY` update timing (after graph, before reflection)
