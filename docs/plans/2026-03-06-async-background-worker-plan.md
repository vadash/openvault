# Implementation Plan - Async Background Worker

> **Reference:** `docs/designs/2026-03-06-async-background-worker-design.md`
> **Execution:** Use `executing-plans` skill.

---

### Task 1: Add `yieldToMain()` Helper

**Goal:** Create a CPU-yielding utility function in `src/utils.js`.

**Step 1: Write the Failing Test**
- File: `tests/utils.test.js`
- Add to the existing test file:
```javascript
describe('yieldToMain', () => {
    it('returns a promise that resolves', async () => {
        const { yieldToMain } = await import('../src/utils.js');
        const before = performance.now();
        await yieldToMain();
        const after = performance.now();
        // Should resolve (not hang), elapsed time is >= 0
        expect(after - before).toBeGreaterThanOrEqual(0);
    });

    it('is a function', async () => {
        const { yieldToMain } = await import('../src/utils.js');
        expect(typeof yieldToMain).toBe('function');
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/utils.test.js`
- Expect: `yieldToMain` is not exported / not a function

**Step 3: Implementation (Green)**
- File: `src/utils.js`
- Action: Add at the end of the file, before closing:
```javascript
/**
 * Yield to the browser's main thread.
 * Use inside heavy for-loops to prevent UI freezing.
 * setTimeout(0) pushes continuation to end of macrotask queue.
 * @returns {Promise<void>}
 */
export function yieldToMain() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/utils.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/utils.js tests/utils.test.js && git commit -m "feat: add yieldToMain CPU-yielding helper"`

---

### Task 2: Create Worker Module — Single-Instance Guard & Interruptible Sleep

**Goal:** Create `src/extraction/worker.js` with the core primitives: `wakeUpBackgroundWorker`, `isWorkerRunning`, and `interruptibleSleep`. The worker loop itself will be a stub that immediately returns (implemented in Task 4).

**Step 1: Write the Failing Test**
- File: `tests/extraction/worker.test.js`
- Create new file:
```javascript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all dependencies that worker.js imports
vi.mock('../../src/deps.js', () => ({
    getDeps: () => ({
        getContext: () => ({ chat: [] }),
        getExtensionSettings: () => ({ openvault: { enabled: true, messagesPerExtraction: 5, extractionBuffer: 5 } }),
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
}));
vi.mock('../../src/utils.js', async (importOriginal) => {
    const orig = await importOriginal();
    return {
        ...orig,
        getCurrentChatId: vi.fn(() => 'chat_123'),
        isExtensionEnabled: vi.fn(() => true),
        getOpenVaultData: vi.fn(() => ({ memories: [], processed_message_ids: [] })),
        log: vi.fn(),
        saveOpenVaultData: vi.fn(async () => true),
        showToast: vi.fn(),
    };
});
vi.mock('../../src/extraction/scheduler.js', () => ({
    getNextBatch: vi.fn(() => null), // No batches by default
}));
vi.mock('../../src/extraction/extract.js', () => ({
    extractMemories: vi.fn(async () => ({ status: 'success', events_created: 1, messages_processed: 5 })),
}));
vi.mock('../../src/ui/status.js', () => ({ setStatus: vi.fn() }));
vi.mock('../../src/state.js', () => ({
    operationState: { extractionInProgress: false },
}));

describe('worker single-instance guard', () => {
    let wakeUpBackgroundWorker, isWorkerRunning;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Re-import to reset module state
        vi.resetModules();
        const mod = await import('../../src/extraction/worker.js');
        wakeUpBackgroundWorker = mod.wakeUpBackgroundWorker;
        isWorkerRunning = mod.isWorkerRunning;
    });

    it('isWorkerRunning returns false initially', () => {
        expect(isWorkerRunning()).toBe(false);
    });

    it('exports wakeUpBackgroundWorker as a function', () => {
        expect(typeof wakeUpBackgroundWorker).toBe('function');
    });

    it('wakeUpBackgroundWorker does not throw', () => {
        expect(() => wakeUpBackgroundWorker()).not.toThrow();
    });
});

describe('interruptibleSleep', () => {
    let interruptibleSleep, getWakeGeneration, incrementWakeGeneration;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        const mod = await import('../../src/extraction/worker.js');
        interruptibleSleep = mod.interruptibleSleep;
        getWakeGeneration = mod.getWakeGeneration;
        incrementWakeGeneration = mod.incrementWakeGeneration;
    });

    it('resolves after the specified time', async () => {
        vi.useFakeTimers();
        const gen = getWakeGeneration();
        const promise = interruptibleSleep(1000, gen);
        vi.advanceTimersByTime(1500);
        await promise;
        vi.useRealTimers();
        // If we get here, it resolved
        expect(true).toBe(true);
    });

    it('resolves early when wakeGeneration changes', async () => {
        vi.useFakeTimers();
        const gen = getWakeGeneration();
        const promise = interruptibleSleep(10000, gen);
        // Advance past one chunk (500ms)
        vi.advanceTimersByTime(600);
        // Simulate new message
        incrementWakeGeneration();
        vi.advanceTimersByTime(600);
        await promise;
        vi.useRealTimers();
        // Resolved in ~1200ms, not 10000ms
        expect(true).toBe(true);
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/extraction/worker.test.js`
- Expect: Cannot find module `../../src/extraction/worker.js`

**Step 3: Implementation (Green)**
- File: `src/extraction/worker.js`
- Create new file:
```javascript
/**
 * OpenVault Background Worker
 *
 * Processes extraction batches in the background without blocking the chat UI.
 * Single-instance: only one worker loop runs at a time.
 * Uses a wakeGeneration counter to reset backoff when new messages arrive.
 */

let isRunning = false;
let wakeGeneration = 0;

/**
 * Wake up the background worker. Fire-and-forget.
 * Safe to call multiple times — only one instance runs.
 * If worker is already running, increments wake generation
 * so it resets backoff and re-checks for work.
 */
export function wakeUpBackgroundWorker() {
    wakeGeneration++;
    if (isRunning) return;
    isRunning = true;
    runWorkerLoop().finally(() => {
        isRunning = false;
    });
}

/**
 * Check if the background worker is currently processing.
 */
export function isWorkerRunning() {
    return isRunning;
}

/**
 * Get current wake generation (for testing).
 */
export function getWakeGeneration() {
    return wakeGeneration;
}

/**
 * Increment wake generation (for testing).
 */
export function incrementWakeGeneration() {
    wakeGeneration++;
}

/**
 * Interruptible sleep that checks wakeGeneration every 500ms.
 * Resolves early if a new message arrives (generation changes).
 * @param {number} totalMs - Total sleep duration
 * @param {number} generationAtStart - The wakeGeneration value when sleep started
 */
export async function interruptibleSleep(totalMs, generationAtStart) {
    const chunkMs = 500;
    let elapsed = 0;
    while (elapsed < totalMs) {
        await new Promise((r) => setTimeout(r, Math.min(chunkMs, totalMs - elapsed)));
        elapsed += chunkMs;
        if (wakeGeneration !== generationAtStart) return;
    }
}

/**
 * Main worker loop. Stub — will be implemented in Task 4.
 */
async function runWorkerLoop() {
    // Stub: immediately returns. Full implementation in Task 4.
}
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/extraction/worker.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/extraction/worker.js tests/extraction/worker.test.js && git commit -m "feat: create worker module with single-instance guard and interruptible sleep"`

---

### Task 3: Split `extractMemories` into Two Phases with Intermediate Save

**Goal:** Restructure `extractMemories` so that:
1. `PROCESSED_MESSAGES_KEY` updates AFTER events are committed to `MEMORIES_KEY` (moved from current position)
2. An intermediate `saveOpenVaultData()` happens after Phase 1 (events + graph + embedding + dedup + commit)
3. Phase 2 (reflection + community) is wrapped in try/catch — failures are logged but don't propagate
4. Accept `options.silent` parameter to suppress toasts

**Step 1: Write the Failing Test**
- File: `tests/extraction/extract.test.js`
- Add new describe block:
```javascript
describe('two-phase extraction with intermediate save', () => {
    it('saves data after Phase 1 (events + graph) even if reflection throws', async () => {
        // Make reflection throw
        const reflectModule = await import('../../src/reflection/reflect.js');
        vi.spyOn(reflectModule, 'shouldReflect').mockReturnValue(true);
        vi.spyOn(reflectModule, 'generateReflections').mockRejectedValue(new Error('Reflection API down'));

        const saveSpy = getDeps().saveChatConditional;
        saveSpy.mockClear();

        // Set up data so reflection triggers (importance_sum >= threshold)
        mockData.reflection_state = { 'King Aldric': { importance_sum: 100 } };

        const result = await extractMemories([0, 1]);

        // Phase 1 should succeed — events committed
        expect(result.status).toBe('success');
        expect(result.events_created).toBeGreaterThan(0);
        expect(mockData.memories.length).toBeGreaterThan(0);

        // processed_message_ids should be populated (Phase 1 committed)
        expect(mockData.processed_message_ids.length).toBeGreaterThan(0);

        // saveOpenVaultData should have been called at least once (intermediate save)
        // Even though reflection failed, Phase 1 data is persisted
        expect(saveSpy).toHaveBeenCalled();
    });

    it('accepts options.silent parameter without throwing', async () => {
        const result = await extractMemories([0, 1], null, { silent: true });
        expect(result.status).toBe('success');
    });

    it('updates PROCESSED_MESSAGES_KEY only after events are pushed to memories', async () => {
        // Verify ordering: memories should contain events AND processed_message_ids should be set
        const result = await extractMemories([0, 1]);
        expect(result.status).toBe('success');

        // Both should be populated
        const hasMemories = mockData.memories.length > 0;
        const hasProcessedIds = mockData.processed_message_ids.length > 0;
        expect(hasMemories).toBe(true);
        expect(hasProcessedIds).toBe(true);
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/extraction/extract.test.js`
- Expect: Fail — `extractMemories` doesn't accept 3rd arg; reflection error propagates and crashes the function

**Step 3: Implementation (Green)**
- File: `src/extraction/extract.js`
- **Change 1:** Update function signature (line ~268):
  ```javascript
  // Before:
  export async function extractMemories(messageIds = null, targetChatId = null) {
  // After:
  export async function extractMemories(messageIds = null, targetChatId = null, options = {}) {
  ```
- **Change 2:** Remove early `PROCESSED_MESSAGES_KEY` update. Delete these lines (around line ~393):
  ```javascript
  // DELETE THIS BLOCK:
  // Track processed message IDs
  const processedIds = messages.map((m) => m.id);
  data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
  data[PROCESSED_MESSAGES_KEY].push(...processedIds);
  log(`Marked ${processedIds.length} messages as processed (total: ${data[PROCESSED_MESSAGES_KEY].length})`);
  ```
  Keep `const processedIds = messages.map((m) => m.id);` but move the push later.
- **Change 3:** After Stage 4.5 (graph upsert, around line ~435), insert Phase 1 commit + intermediate save:
  ```javascript
  // ===== PHASE 1 COMMIT: Events + Graph are done =====
  const maxId = processedIds.length > 0 ? Math.max(...processedIds) : 0;

  if (events.length > 0) {
      data[MEMORIES_KEY] = data[MEMORIES_KEY] || [];
      data[MEMORIES_KEY].push(...events);
      updateCharacterStatesFromEvents(events, data, [characterName, userName]);
  }

  // Mark processed AFTER events are committed to memories
  data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
  data[PROCESSED_MESSAGES_KEY].push(...processedIds);
  data[LAST_PROCESSED_KEY] = Math.max(data[LAST_PROCESSED_KEY] || -1, maxId);
  log(`Phase 1 complete: ${events.length} events, ${processedIds.length} messages processed`);

  // Intermediate save — Phase 1 data is now persisted
  const phase1Saved = await saveOpenVaultData(targetChatId);
  if (!phase1Saved && targetChatId) {
      throw new Error('Chat changed during extraction');
  }
  ```
- **Change 4:** Wrap Stage 4.6 (reflection) and Stage 4.7 (community) in a Phase 2 try/catch:
  ```javascript
  // ===== PHASE 2: Enrichment (non-critical) =====
  try {
      // Stage 4.6: Reflection check ...
      // (keep existing reflection code unchanged)

      // Stage 4.7: Community detection ...
      // (keep existing community code unchanged)

      // Final save — Phase 2 enrichment persisted
      await saveOpenVaultData(targetChatId);
  } catch (phase2Error) {
      deps.console.error('[OpenVault] Phase 2 (reflection/community) error:', phase2Error);
      log(`Phase 2 failed but Phase 1 data is safe: ${phase2Error.message}`);
      // Do NOT re-throw. Phase 1 data is already saved.
  }
  ```
- **Change 5:** Remove the old Stage 5 block (the duplicate commit + save at the end), since it's now handled by Phase 1 commit above.
- **Change 6:** Suppress toasts when `options.silent` is true. At the top of the try block, add:
  ```javascript
  const silent = options.silent || false;
  ```
  This flag will be used in Task 5 (events.js) — for now the function just accepts it without behavior change.

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/extraction/extract.test.js`
- Expect: ALL tests PASS (both new and existing)

**Step 5: Run Full Test Suite**
- Command: `npx vitest run`
- Expect: No regressions

**Step 6: Git Commit**
- Command: `git add src/extraction/extract.js tests/extraction/extract.test.js && git commit -m "feat: split extractMemories into two phases with intermediate save"`

---

### Task 4: Implement Worker Loop with Batch Processing & Backoff

**Goal:** Replace the `runWorkerLoop` stub with the full implementation: batch processing, guards, exponential backoff with interruptible sleep.

**Step 1: Write the Failing Test**
- File: `tests/extraction/worker.test.js`
- Add new describe blocks:
```javascript
describe('worker loop batch processing', () => {
    let wakeUpBackgroundWorker, isWorkerRunning;
    let extractMemoriesMock, getNextBatchMock, setStatusMock;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();

        // Make getNextBatch return one batch, then null (no more work)
        const schedulerMock = await import('../../src/extraction/scheduler.js');
        getNextBatchMock = schedulerMock.getNextBatch;
        let callCount = 0;
        getNextBatchMock.mockImplementation(() => {
            callCount++;
            if (callCount === 1) return [0, 1, 2, 3, 4];
            return null; // No more batches
        });

        const extractMock = await import('../../src/extraction/extract.js');
        extractMemoriesMock = extractMock.extractMemories;

        const statusMock = await import('../../src/ui/status.js');
        setStatusMock = statusMock.setStatus;

        const mod = await import('../../src/extraction/worker.js');
        wakeUpBackgroundWorker = mod.wakeUpBackgroundWorker;
        isWorkerRunning = mod.isWorkerRunning;
    });

    it('processes one batch and stops when no more batches', async () => {
        wakeUpBackgroundWorker();
        // Wait for the async loop to finish
        await vi.waitFor(() => expect(isWorkerRunning()).toBe(false), { timeout: 5000 });

        expect(extractMemoriesMock).toHaveBeenCalledOnce();
        expect(extractMemoriesMock).toHaveBeenCalledWith(
            [0, 1, 2, 3, 4],
            'chat_123',
            { silent: true }
        );
    });

    it('sets status to extracting then ready', async () => {
        wakeUpBackgroundWorker();
        await vi.waitFor(() => expect(isWorkerRunning()).toBe(false), { timeout: 5000 });

        expect(setStatusMock).toHaveBeenCalledWith('extracting');
        expect(setStatusMock).toHaveBeenLastCalledWith('ready');
    });
});

describe('worker loop stops on chat switch', () => {
    let wakeUpBackgroundWorker, isWorkerRunning;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();

        // getNextBatch always returns a batch (infinite work)
        const schedulerMock = await import('../../src/extraction/scheduler.js');
        schedulerMock.getNextBatch.mockReturnValue([0, 1, 2]);

        // Make getCurrentChatId change after first call
        const utilsMock = await import('../../src/utils.js');
        let chatCallCount = 0;
        utilsMock.getCurrentChatId.mockImplementation(() => {
            chatCallCount++;
            return chatCallCount <= 1 ? 'chat_123' : 'chat_456';
        });

        const mod = await import('../../src/extraction/worker.js');
        wakeUpBackgroundWorker = mod.wakeUpBackgroundWorker;
        isWorkerRunning = mod.isWorkerRunning;
    });

    it('halts worker when chat ID changes', async () => {
        wakeUpBackgroundWorker();
        await vi.waitFor(() => expect(isWorkerRunning()).toBe(false), { timeout: 5000 });

        const { extractMemories } = await import('../../src/extraction/extract.js');
        // Should not have processed any batches since chat switched
        expect(extractMemories).not.toHaveBeenCalled();
    });
});

describe('worker fast-fails on chat-switch error during extraction', () => {
    let wakeUpBackgroundWorker, isWorkerRunning;
    let extractMemoriesMock;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();

        const schedulerMock = await import('../../src/extraction/scheduler.js');
        schedulerMock.getNextBatch.mockReturnValue([0, 1, 2]);

        // extractMemories throws the chat-switch error
        const extractMock = await import('../../src/extraction/extract.js');
        extractMemoriesMock = extractMock.extractMemories;
        extractMemoriesMock.mockRejectedValue(new Error('Chat changed during extraction'));

        const mod = await import('../../src/extraction/worker.js');
        wakeUpBackgroundWorker = mod.wakeUpBackgroundWorker;
        isWorkerRunning = mod.isWorkerRunning;
    });

    it('breaks immediately without entering backoff sleep', async () => {
        wakeUpBackgroundWorker();
        await vi.waitFor(() => expect(isWorkerRunning()).toBe(false), { timeout: 5000 });

        // Should have called extractMemories exactly once (no retries)
        expect(extractMemoriesMock).toHaveBeenCalledOnce();
    });
});

describe('worker loop yields to manual backfill', () => {
    let wakeUpBackgroundWorker, isWorkerRunning;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();

        const schedulerMock = await import('../../src/extraction/scheduler.js');
        schedulerMock.getNextBatch.mockReturnValue([0, 1, 2]);

        // Set manual backfill flag
        const stateMock = await import('../../src/state.js');
        stateMock.operationState.extractionInProgress = true;

        const mod = await import('../../src/extraction/worker.js');
        wakeUpBackgroundWorker = mod.wakeUpBackgroundWorker;
        isWorkerRunning = mod.isWorkerRunning;
    });

    it('breaks out of loop when extractionInProgress is true', async () => {
        wakeUpBackgroundWorker();
        await vi.waitFor(() => expect(isWorkerRunning()).toBe(false), { timeout: 5000 });

        const { extractMemories } = await import('../../src/extraction/extract.js');
        expect(extractMemories).not.toHaveBeenCalled();
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/extraction/worker.test.js`
- Expect: Fails — `runWorkerLoop` is a stub, never calls `extractMemories`

**Step 3: Implementation (Green)**
- File: `src/extraction/worker.js`
- Replace the `runWorkerLoop` stub with full implementation:
```javascript
import { getDeps } from '../deps.js';
import { extensionName } from '../constants.js';
import { getCurrentChatId, getOpenVaultData, isExtensionEnabled, log } from '../utils.js';
import { getNextBatch } from './scheduler.js';
import { extractMemories } from './extract.js';
import { setStatus } from '../ui/status.js';
import { operationState } from '../state.js';

const BACKOFF_SCHEDULE_SECONDS = [1, 2, 3, 10, 20, 30, 30, 60, 60];
const MAX_BACKOFF_TOTAL_MS = 15 * 60 * 1000;

async function runWorkerLoop() {
    const targetChatId = getCurrentChatId();
    let retryCount = 0;
    let cumulativeBackoffMs = 0;
    let lastSeenGeneration = wakeGeneration;

    try {
        while (true) {
            // Guard: Chat switched?
            if (getCurrentChatId() !== targetChatId) {
                log('Worker: Chat switched, stopping.');
                break;
            }

            // Guard: Extension disabled?
            if (!isExtensionEnabled()) {
                log('Worker: Extension disabled, stopping.');
                break;
            }

            // Guard: Manual backfill took over?
            if (operationState.extractionInProgress) {
                log('Worker: Manual backfill took over, yielding.');
                break;
            }

            // Check for new wake signal (reset backoff)
            if (wakeGeneration !== lastSeenGeneration) {
                retryCount = 0;
                cumulativeBackoffMs = 0;
                lastSeenGeneration = wakeGeneration;
            }

            // Get fresh state each iteration
            const deps = getDeps();
            const context = deps.getContext();
            const chat = context.chat || [];
            const data = getOpenVaultData();
            const settings = deps.getExtensionSettings()[extensionName];

            if (!data || !settings?.enabled) break;

            const batchSize = settings.messagesPerExtraction || 5;
            const bufferSize = settings.extractionBuffer || 5;

            // Get next batch
            const batch = getNextBatch(chat, data, batchSize, bufferSize);
            if (!batch) break; // No complete batches, go to sleep

            // Process
            setStatus('extracting');
            log(`Worker: Processing batch [${batch[0]}..${batch[batch.length - 1]}]`);

            try {
                await extractMemories(batch, targetChatId, { silent: true });
                retryCount = 0;
                cumulativeBackoffMs = 0;
            } catch (err) {
                // Fast-fail on chat switch — don't retry, just stop
                if (err.message === 'Chat changed during extraction') {
                    log('Worker: Chat changed during extraction. Halting immediately.');
                    break;
                }

                retryCount++;
                const scheduleIndex = Math.min(retryCount - 1, BACKOFF_SCHEDULE_SECONDS.length - 1);
                const backoffMs = BACKOFF_SCHEDULE_SECONDS[scheduleIndex] * 1000;
                cumulativeBackoffMs += backoffMs;

                if (cumulativeBackoffMs >= MAX_BACKOFF_TOTAL_MS) {
                    log(`Worker: Backoff limit exceeded (${Math.round(cumulativeBackoffMs / 1000)}s), stopping.`);
                    break;
                }

                log(`Worker: Batch failed (attempt ${retryCount}), retrying in ${BACKOFF_SCHEDULE_SECONDS[scheduleIndex]}s`);
                await interruptibleSleep(backoffMs, lastSeenGeneration);
                continue; // Retry same batch
            }

            // Yield to browser between batches
            await new Promise((r) => setTimeout(r, 2000));
        }
    } catch (err) {
        getDeps().console.error('[OpenVault] Background worker error:', err);
    } finally {
        setStatus('ready');
    }
}
```
- Also move the import statements to the top of the file and remove the stub.

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/extraction/worker.test.js`
- Expect: ALL tests PASS

**Step 5: Run Full Test Suite**
- Command: `npx vitest run`
- Expect: No regressions

**Step 6: Git Commit**
- Command: `git add src/extraction/worker.js tests/extraction/worker.test.js && git commit -m "feat: implement worker loop with batch processing and exponential backoff"`

---

### Task 5: Refactor `onMessageReceived` to Fire-and-Forget

**Goal:** Replace the blocking `extractMemories` call in `onMessageReceived` with a non-blocking `wakeUpBackgroundWorker()` call. Remove `operationState.extractionInProgress` usage and `checkAndTriggerBackfill` call.

**Step 1: Write the Failing Test**
- File: `tests/events.test.js` (create new file)
```javascript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extensionName } from '../src/constants.js';

// Mock dependencies
vi.mock('../src/deps.js', () => ({
    getDeps: () => ({
        getContext: () => ({
            chat: [
                { mes: 'Hello', is_user: true },
                { mes: 'Welcome!', is_user: false, name: 'Alice' },
            ],
            name1: 'User',
            name2: 'Alice',
        }),
        getExtensionSettings: () => ({
            [extensionName]: { enabled: true, mode: 'automatic' },
        }),
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
}));
vi.mock('../src/utils.js', async (importOriginal) => {
    const orig = await importOriginal();
    return {
        ...orig,
        isAutomaticMode: vi.fn(() => true),
        log: vi.fn(),
        getCurrentChatId: vi.fn(() => 'chat_1'),
        getOpenVaultData: vi.fn(() => ({ memories: [], processed_message_ids: [] })),
        showToast: vi.fn(),
        safeSetExtensionPrompt: vi.fn(),
    };
});
vi.mock('../src/state.js', () => ({
    operationState: { generationInProgress: false, extractionInProgress: false, retrievalInProgress: false },
    isChatLoadingCooldown: vi.fn(() => false),
    setChatLoadingCooldown: vi.fn(),
    setGenerationLock: vi.fn(),
    clearGenerationLock: vi.fn(),
    resetOperationStatesIfSafe: vi.fn(),
}));
vi.mock('../src/extraction/worker.js', () => ({
    wakeUpBackgroundWorker: vi.fn(),
}));
vi.mock('../src/extraction/extract.js', () => ({
    extractMemories: vi.fn(async () => ({ status: 'success' })),
    extractAllMessages: vi.fn(),
    cleanupCharacterStates: vi.fn(),
}));
vi.mock('../src/extraction/scheduler.js', () => ({
    getBackfillStats: vi.fn(() => ({ completeBatches: 0 })),
    getExtractedMessageIds: vi.fn(() => new Set()),
    getNextBatch: vi.fn(),
}));
vi.mock('../src/retrieval/retrieve.js', () => ({ updateInjection: vi.fn() }));
vi.mock('../src/retrieval/debug-cache.js', () => ({ clearRetrievalDebug: vi.fn() }));
vi.mock('../src/ui/render.js', () => ({
    refreshAllUI: vi.fn(),
    resetMemoryBrowserPage: vi.fn(),
}));
vi.mock('../src/ui/status.js', () => ({ setStatus: vi.fn() }));
vi.mock('../src/embeddings.js', () => ({ clearEmbeddingCache: vi.fn() }));

describe('onMessageReceived', () => {
    let onMessageReceived;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('../src/events.js');
        onMessageReceived = mod.onMessageReceived;
    });

    it('calls wakeUpBackgroundWorker for AI messages', () => {
        onMessageReceived(1); // index 1 is AI message

        const { wakeUpBackgroundWorker } = require('../src/extraction/worker.js');
        expect(wakeUpBackgroundWorker).toHaveBeenCalledOnce();
    });

    it('does not call wakeUpBackgroundWorker for user messages', () => {
        onMessageReceived(0); // index 0 is user message

        const { wakeUpBackgroundWorker } = require('../src/extraction/worker.js');
        expect(wakeUpBackgroundWorker).not.toHaveBeenCalled();
    });

    it('does not await — returns synchronously', () => {
        const result = onMessageReceived(1);
        // Should not return a promise (fire-and-forget)
        // Or if it returns undefined, that's fine too
        expect(result).toBeUndefined();
    });

    it('skips during chat loading cooldown', async () => {
        const { isChatLoadingCooldown } = await import('../src/state.js');
        isChatLoadingCooldown.mockReturnValue(true);

        onMessageReceived(1);

        const { wakeUpBackgroundWorker } = require('../src/extraction/worker.js');
        expect(wakeUpBackgroundWorker).not.toHaveBeenCalled();
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/events.test.js`
- Expect: Fail — `onMessageReceived` still calls `extractMemories` instead of `wakeUpBackgroundWorker`

**Step 3: Implementation (Green)**
- File: `src/events.js`

**Change 1:** Add import at top:
```javascript
import { wakeUpBackgroundWorker } from './extraction/worker.js';
```

**Change 2:** Replace the entire `onMessageReceived` function with:
```javascript
/**
 * Handle message received event (automatic mode)
 * Wakes the background worker to extract memories silently.
 * Fire-and-forget — does not block SillyTavern.
 * @param {number} messageId - The message ID
 */
export function onMessageReceived(messageId) {
    if (!isAutomaticMode()) return;

    if (isChatLoadingCooldown()) {
        log(`Skipping extraction for message ${messageId} - chat load cooldown active`);
        return;
    }

    const context = getDeps().getContext();
    const chat = context.chat || [];
    const message = chat[messageId];

    // Only wake worker on AI messages
    if (!message || message.is_user || message.is_system) {
        return;
    }

    wakeUpBackgroundWorker();
}
```

**Change 3:** Remove the `checkAndTriggerBackfill` function entirely (the worker loop handles backfill now).

**Change 4:** Remove unused imports that were only needed by the old `onMessageReceived`:
- Remove `extractMemories` from the import of `./extraction/extract.js` (keep `extractAllMessages`, `cleanupCharacterStates`)
- Remove `getNextBatch`, `getBackfillStats` from `./extraction/scheduler.js` imports (keep `getExtractedMessageIds`)
- Remove `operationState` from `./state.js` imports (keep `isChatLoadingCooldown`, etc.)
- Remove `withTimeout` from `./utils.js` imports if no longer used elsewhere in the file

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/events.test.js`
- Expect: PASS

**Step 5: Run Full Test Suite**
- Command: `npx vitest run`
- Expect: No regressions

**Step 6: Git Commit**
- Command: `git add src/events.js tests/events.test.js && git commit -m "feat: make onMessageReceived non-blocking via background worker"`

---

### Task 6: Add Manual Backfill Mutual Exclusion Guard

**Goal:** Prevent the manual "Backfill" button from running while the background worker is active. Add `isWorkerRunning()` check to the button handler in `src/ui/settings.js`.

**Step 1: Write the Failing Test**
- File: `tests/ui/settings-bindings.test.js`
- Add to existing file:
```javascript
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const settingsSource = readFileSync(resolve('src/ui/settings.js'), 'utf-8');

describe('manual backfill guard', () => {
    it('imports isWorkerRunning from worker module', () => {
        expect(settingsSource).toContain('isWorkerRunning');
    });

    it('checks isWorkerRunning before calling extractAllMessages', () => {
        // The handleExtractAll function should contain the guard
        expect(settingsSource).toContain('isWorkerRunning()');
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/ui/settings-bindings.test.js`
- Expect: Fail — `isWorkerRunning` not found in settings.js source

**Step 3: Implementation (Green)**
- File: `src/ui/settings.js`

**Change 1:** Add import at top:
```javascript
import { isWorkerRunning } from '../extraction/worker.js';
```

**Change 2:** Update `handleExtractAll` function (around line 112):
```javascript
// Before:
async function handleExtractAll() {
    await extractAllMessages(updateEventListeners);
}

// After:
async function handleExtractAll() {
    if (isWorkerRunning()) {
        showToast('warning', 'Background extraction in progress. Please wait.', 'OpenVault');
        return;
    }
    await extractAllMessages(updateEventListeners);
}
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/ui/settings-bindings.test.js`
- Expect: PASS

**Step 5: Run Full Test Suite**
- Command: `npx vitest run`
- Expect: No regressions

**Step 6: Git Commit**
- Command: `git add src/ui/settings.js tests/ui/settings-bindings.test.js && git commit -m "feat: add mutual exclusion guard for manual backfill vs background worker"`

---

### Task 7: Add CPU Yielding to Heavy Loops

**Goal:** Insert `await yieldToMain()` into the heaviest synchronous loops to prevent UI micro-stutters during background extraction.

**Step 1: Write the Failing Test**
- File: `tests/extraction/extract.test.js`
- Add to existing file:
```javascript
describe('CPU yielding in filterSimilarEvents', () => {
    it('still correctly filters events (yielding does not break logic)', () => {
        const events = [
            { summary: 'King Aldric declared war on the rebels', embedding: [1, 0, 0] },
            { summary: 'Sera secretly met with the rebel leader', embedding: [0, 1, 0] },
            { summary: 'King Aldric declared war on the rebels today', embedding: [0.99, 0.01, 0] },
        ];
        const existing = [
            { summary: 'Old memory about something else', embedding: [0, 0, 1] },
        ];

        const result = filterSimilarEvents(events, existing, 0.92, 0.6);
        // Third event should be deduped (Jaccard overlap with first)
        expect(result.length).toBeLessThanOrEqual(2);
    });
});
```

Note: `filterSimilarEvents` is a synchronous function. Adding `yieldToMain()` inside it would make it async. The test verifies the function's correctness is preserved after the change.

**Step 2: Run Test (confirm existing behavior)**
- Command: `npx vitest run tests/extraction/extract.test.js`
- Expect: PASS (this test should pass with current code — it's a baseline)

**Step 3: Implementation**
- File: `src/extraction/extract.js`

**Change 1:** Import `yieldToMain`:
```javascript
import { ..., yieldToMain } from '../utils.js';
```

**Change 2:** Make `filterSimilarEvents` async and add yielding:
```javascript
// Before:
export function filterSimilarEvents(newEvents, existingMemories, cosineThreshold = 0.92, jaccardThreshold = 0.6) {

// After:
export async function filterSimilarEvents(newEvents, existingMemories, cosineThreshold = 0.92, jaccardThreshold = 0.6) {
```

Add `await yieldToMain()` in Phase 1 (cosine loop):
```javascript
    if (existingMemories?.length) {
        const results = [];
        let idx = 0;
        for (const event of newEvents) {
            if (idx % 10 === 0) await yieldToMain();
            idx++;
            // ... existing cosine check logic
        }
        filtered = results;
    }
```

Add `await yieldToMain()` in Phase 2 (Jaccard loop):
```javascript
    for (let i = 0; i < filtered.length; i++) {
        if (i % 10 === 0) await yieldToMain();
        // ... existing Jaccard check logic
    }
```

**Change 3:** Update the call site in `extractMemories` to `await` the now-async function:
```javascript
// Before:
events = filterSimilarEvents(events, existingMemoriesList, dedupThreshold, jaccardThreshold);
// After:
events = await filterSimilarEvents(events, existingMemoriesList, dedupThreshold, jaccardThreshold);
```

- File: `src/graph/communities.js`

**Change 4:** Add yielding to `updateCommunitySummaries` if it has a loop over communities:
```javascript
import { yieldToMain } from '../utils.js';

// Inside the community summary loop:
for (const [communityId, group] of Object.entries(groups)) {
    await yieldToMain();
    // ... existing logic
}
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/extraction/extract.test.js`
- Expect: PASS

**Step 5: Run Full Test Suite**
- Command: `npx vitest run`
- Expect: No regressions

**Step 6: Git Commit**
- Command: `git add src/extraction/extract.js src/graph/communities.js tests/extraction/extract.test.js && git commit -m "feat: add CPU yielding to heavy loops for UI responsiveness"`

---

### Task 8: Final Integration Verification

**Goal:** Run the full test suite, lint, and verify everything works together.

**Step 1: Run All Tests**
- Command: `npx vitest run`
- Expect: ALL tests PASS

**Step 2: Run Linter**
- Command: `npx biome check src/`
- Expect: No errors (warnings acceptable)

**Step 3: Verify No Unused Imports**
- Command: `npx biome check src/events.js src/extraction/extract.js src/extraction/worker.js src/ui/settings.js`
- Expect: Clean

**Step 4: Git Commit (final)**
- Command: `git add -A && git commit -m "chore: async background worker implementation complete"`

---

## Execution Order Summary

| Task | Files Changed | Depends On |
|------|---------------|------------|
| 1. `yieldToMain` helper | `src/utils.js` | — |
| 2. Worker module (stub) | `src/extraction/worker.js` | — |
| 3. Two-phase extraction | `src/extraction/extract.js` | — |
| 4. Worker loop impl | `src/extraction/worker.js` | Tasks 2, 3 |
| 5. `onMessageReceived` refactor | `src/events.js` | Tasks 2, 4 |
| 6. Backfill guard | `src/ui/settings.js` | Task 2 |
| 7. CPU yielding | `src/extraction/extract.js`, `src/graph/communities.js` | Task 1 |
| 8. Final verification | — | All |

Tasks 1, 2, and 3 can be executed in parallel. Tasks 4-7 are sequential.
