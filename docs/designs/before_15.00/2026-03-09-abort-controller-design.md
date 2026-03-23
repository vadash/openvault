# Design: AbortController for Chat-Switch Cancellation

## 1. Problem Statement

When a user switches chats, all in-flight async operations (LLM API calls, embedding generation, retrieval queries) continue running to completion before being silently discarded. This wastes:

- **API credits**: LLM extraction calls take 30-120s and cost real money. Two back-to-back chat switches can leave 4+ orphaned requests running.
- **Local compute**: WebGPU/WASM embedding batches consume GPU/CPU for memories that will never be stored.
- **Network bandwidth**: Ollama embedding calls hit localhost but still block the connection pool.

The current `getCurrentChatId() !== targetChatId` guard in `worker.js` only fires at **loop iteration boundaries** — not mid-operation. A single `extractMemories()` call contains 2 LLM calls + embedding batches + reflection (3 more LLM calls) + community summarization (N more LLM calls). The guard can't interrupt any of them.

## 2. Goals & Non-Goals

### Must do:
- Abort in-flight LLM requests and embedding generation on `CHAT_CHANGED`
- Abort retrieval-path embedding queries on `CHAT_CHANGED`
- True cancellation for Transformers.js pipeline (native `signal` support) and Ollama fetch
- Logical cancellation for `connectionManager.sendRequest()` (race pattern — underlying HTTP continues but result is discarded)
- Clean worker exit on abort (no error toasts, no stale status)
- AbortError must not be swallowed by Phase 2 error handlers in `extractMemories()`
- Testable: signal overridable via function parameter, defaulting to module state

### Won't do:
- True network cancellation for `connectionManager.sendRequest()` (SillyTavern API doesn't expose signal)
- Per-operation AbortControllers (only trigger is `CHAT_CHANGED` — one session controller is sufficient)
- Abort for user-initiated manual actions (edit memory, single re-embed via UI button)
- Retry logic changes in worker/backfill (existing backoff schedule stays)

## 3. Proposed Architecture

### 3.1 Session-Scoped AbortController (`state.js`)

One `AbortController` per "active chat session". On `CHAT_CHANGED`, the old controller is aborted and a new one is created.

```
CHAT_CHANGED
  → resetSessionController()
      → old controller.abort()        // all in-flight ops see AbortError
      → new controller = new AbortController()
  → clear caches, reset UI (existing)
  → new worker starts with fresh signal
```

Two new exports in `state.js`:

| Function | Purpose |
|----------|---------|
| `getSessionSignal()` | Returns current `AbortController.signal`. Read by leaf I/O functions as default. |
| `resetSessionController()` | Aborts current controller, creates new one. Called by `onChatChanged()`. |

### 3.2 Dual Signal Pattern (Module Default + Param Override)

Leaf I/O functions (`callLLM`, `getQueryEmbedding`, `getDocumentEmbedding`) default to `getSessionSignal()` when no explicit signal is passed. Tests can override via parameter.

```js
// Production: reads module default automatically
await callLLM(prompt, LLM_CONFIGS.extraction_events, { structured: true });

// Test: explicit signal override
const ctrl = new AbortController();
await callLLM(prompt, LLM_CONFIGS.extraction_events, { structured: true, signal: ctrl.signal });
```

**Why this is minimally invasive:** Because the signal defaults at the leaf level, mid-level orchestrators (`mergeOrInsertEntity`, `generateReflections`, `updateCommunitySummaries`, all retrieval/scoring functions) need **zero signature changes**. The abort propagates through their `callLLM()`/`getQueryEmbedding()` calls automatically.

### 3.3 Signal Propagation Map

```
onChatChanged()
  └─ resetSessionController() ─── aborts signal ───┐
                                                    │
  ┌─────────────────────────────────────────────────┘
  │
  ▼ (AbortError propagates through)
  ┌──────────────────────────────────────────────────────┐
  │ EXTRACTION PATH                                      │
  │                                                      │
  │ worker.js:runWorkerLoop()                            │
  │   └─ extract.js:extractMemories()                    │
  │       ├─ llm.js:callLLM() ←── Promise.race ❌ net   │
  │       ├─ llm.js:callLLM() ←── Promise.race ❌ net   │
  │       ├─ embeddings.js:enrichEvents...()             │
  │       │   └─ Strategy.#embed() ←── { signal } ✅    │
  │       ├─ graph.js:mergeOrInsertEntity()              │
  │       │   └─ embeddings.js:getDocumentEmbedding()    │
  │       │       └─ Strategy.#embed() ←── { signal } ✅ │
  │       ├─ reflect.js:generateReflections()            │
  │       │   ├─ llm.js:callLLM() × 4  ←── race ❌ net  │
  │       │   └─ embeddings.js:enrichEvents...()         │
  │       │       └─ Strategy.#embed() ←── { signal } ✅ │
  │       └─ communities.js:updateCommunitySummaries()   │
  │           ├─ llm.js:callLLM() × N  ←── race ❌ net  │
  │           └─ embeddings.js:getQueryEmbedding()       │
  │               └─ Strategy.#embed() ←── { signal } ✅ │
  └──────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────┐
  │ RETRIEVAL PATH                                       │
  │                                                      │
  │ events.js:onBeforeGeneration()                       │
  │   └─ retrieve.js:updateInjection()                   │
  │       └─ scoring.js:selectRelevantMemories()         │
  │           └─ embeddings.js:getQueryEmbedding()       │
  │               └─ Strategy.#embed() ←── { signal } ✅ │
  │       └─ retrieve.js:selectFormatAndInject()         │
  │           └─ embeddings.js:getQueryEmbedding()       │
  │               └─ Strategy.#embed() ←── { signal } ✅ │
  └──────────────────────────────────────────────────────┘

Legend: ✅ = true cancellation   ❌ net = logical cancel (network continues)
```

### 3.4 Cancellation Mechanism per I/O Type

| I/O Type | Mechanism | True cancel? |
|----------|-----------|:------------:|
| `connectionManager.sendRequest()` | `Promise.race([request, abortPromise])` | No — HTTP continues server-side |
| Transformers.js `pipeline()` | Native `{ signal }` option in pipeline call | Yes — computation stops |
| Ollama `fetch()` | Native `{ signal }` option in fetch call | Yes — TCP connection dropped |
| `embeddings.js` cache hit | Early `signal.aborted` check before cache lookup | Yes — instant |

## 4. Callsite Migration Map

### 4.1 New Code in `state.js`

```js
let _sessionController = new AbortController();

/**
 * Get the current session's AbortSignal.
 * Leaf I/O functions (callLLM, embedding) read this as their default signal.
 * @returns {AbortSignal}
 */
export function getSessionSignal() {
    return _sessionController.signal;
}

/**
 * Abort all in-flight operations and create a fresh controller.
 * Called on CHAT_CHANGED before any new work starts.
 */
export function resetSessionController() {
    _sessionController.abort();
    _sessionController = new AbortController();
}
```

### 4.2 `llm.js:callLLM()` — Promise.race Pattern

```js
export async function callLLM(messages, config, options = {}) {
    const signal = options.signal ?? getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    // ... existing profile resolution ...

    async function executeRequest(targetProfileId) {
        const requestPromise = deps.connectionManager.sendRequest(/* existing args */);

        // Race: request vs abort
        const result = await raceAbort(requestPromise, signal);

        // ... existing response parsing ...
    }

    // ... existing main + backup failover ...
}
```

Helper (private to `llm.js`):
```js
function raceAbort(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
        // If already aborted, reject immediately
        if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            (val) => { signal.removeEventListener('abort', onAbort); resolve(val); },
            (err) => { signal.removeEventListener('abort', onAbort); reject(err); }
        );
    });
}
```

### 4.3 `embeddings.js` — Signal Threading

**Strategy base class** — add `{ signal }` to async method signatures:
```js
async getEmbedding(_text, { signal } = {}) { ... }
async getQueryEmbedding(_text, { signal } = {}) { ... }
async getDocumentEmbedding(_text, { signal } = {}) { ... }
```

**TransformersStrategy.#embed()** — pass signal to pipeline:
```js
async #embed(text, prefix, { signal } = {}) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    // ...
    const output = await pipe(input, { pooling: 'mean', normalize: true, signal });
    return Array.from(output.data);
}
```

**OllamaStrategy.getEmbedding()** — pass signal to fetch:
```js
async getEmbedding(text, { signal } = {}) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    // ...
    const response = await getDeps().fetch(`${cleanUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text.trim() }),
        signal,
    });
    // ...
}
```

**Public API functions** — add optional signal, default to session:
```js
export async function getQueryEmbedding(text, { signal } = {}) {
    signal ??= getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    // ... existing cache logic ...
    const result = await strategy.getQueryEmbedding(text, { signal });
    // ... existing cache store ...
}

export async function getDocumentEmbedding(summary, { signal } = {}) {
    signal ??= getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    // ... same pattern ...
}

export async function enrichEventsWithEmbeddings(events, { signal } = {}) {
    signal ??= getSessionSignal();
    // ... pass signal through to processInBatches callback ...
    const embeddings = await processInBatches(validEvents, 5, async (e) => {
        return strategy.getDocumentEmbedding(e.summary, { signal });
    });
    // ...
}

export async function generateEmbeddingsForMemories(memories, { signal } = {}) {
    signal ??= getSessionSignal();
    // ... same pattern as enrichEventsWithEmbeddings ...
}
```

### 4.4 `extract.js` — AbortError Propagation in Phase 2

The critical change: Phase 2's catch-all must re-throw `AbortError`.

```js
// ===== PHASE 2: Enrichment (non-critical) =====
try {
    // ... reflection + community detection (unchanged) ...
} catch (phase2Error) {
    // AbortError must propagate — it's not a Phase 2 failure, it's a session cancel
    if (phase2Error.name === 'AbortError') throw phase2Error;

    deps.console.error('[OpenVault] Phase 2 (reflection/community) error:', phase2Error);
    log(`Phase 2 failed but Phase 1 data is safe: ${phase2Error.message}`);
}
```

No signature change to `extractMemories()` — it already has `options = {}`. The signal flows through its `callLLM()` and embedding calls via the module default.

### 4.5 `extract.js:extractAllMessages()` — Handle AbortError in Backfill Loop

```js
} catch (error) {
    // AbortError = chat switched (same as existing chat-change detection)
    if (error.name === 'AbortError' || error.message === 'Chat changed during extraction') {
        log('Chat changed during backfill, aborting');
        $('.openvault-backfill-toast').remove();
        showToast('warning', 'Backfill aborted: chat changed', 'OpenVault');
        clearAllLocks();
        setStatus('ready');
        return;
    }
    // ... existing retry logic ...
}
```

### 4.6 `worker.js:runWorkerLoop()` — Clean Exit on Abort

Add AbortError handling to the outer catch:

```js
async function runWorkerLoop() {
    // ... existing code ...
    try {
        while (true) {
            // Existing guard + new signal check
            if (getSessionSignal().aborted || getCurrentChatId() !== targetChatId) {
                log('Worker: Session aborted or chat switched, stopping.');
                break;
            }
            // ... rest of loop unchanged ...
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            log('Worker: Aborted (chat switch). Clean exit.');
        } else {
            getDeps().console.error('[OpenVault] Background worker error:', err);
        }
    } finally {
        setStatus('ready');
    }
}
```

### 4.7 `events.js:onChatChanged()` — Trigger Point

`resetSessionController()` must be called **first**, before any new work starts:

```js
export async function onChatChanged() {
    if (!isExtensionEnabled()) return;

    // FIRST: abort all in-flight operations from previous chat
    resetSessionController();

    // ... existing: import modules, clear caches, reset UI ...
}
```

### 4.8 `events.js:onBeforeGeneration()` — Don't Error on Abort

```js
} catch (error) {
    if (error.name === 'AbortError') {
        log('Retrieval aborted (chat switch)');
        // Don't set error status — chat switch is not an error
    } else {
        getDeps().console.error('OpenVault: Error during pre-generation retrieval:', error);
        setStatus('error');
    }
} finally {
    operationState.retrievalInProgress = false;
}
```

### 4.9 Functions That Need NO Changes

These orchestrators call `callLLM()` / `getQueryEmbedding()` / `getDocumentEmbedding()` which read the session signal by default. No signature changes needed:

| Function | File | Why unchanged |
|----------|------|---------------|
| `mergeOrInsertEntity()` | `graph.js` | Calls `getDocumentEmbedding()` → reads default signal |
| `generateReflections()` | `reflect.js` | Calls `callLLM()` + `getQueryEmbedding()` + `enrichEventsWithEmbeddings()` → all read default |
| `updateCommunitySummaries()` | `communities.js` | Calls `callLLM()` + `getQueryEmbedding()` → read default |
| `updateInjection()` | `retrieve.js` | Calls `getQueryEmbedding()` → reads default |
| `selectFormatAndInject()` | `retrieve.js` | Calls `getQueryEmbedding()` → reads default |
| `selectRelevantMemories()` | `scoring.js` | Calls `getQueryEmbedding()` → reads default |
| `retrieveWorldContext()` | `world-context.js` | Pure math (cosine sim on pre-fetched embeddings) — no I/O |

## 5. Interface / API Design

### New exports from `state.js`

```js
/**
 * Get the current session's AbortSignal.
 * @returns {AbortSignal}
 */
export function getSessionSignal() {}

/**
 * Abort all in-flight operations and create a fresh controller.
 * Called on CHAT_CHANGED.
 */
export function resetSessionController() {}
```

### Changed signatures

```js
// llm.js — signal added to existing options object
export async function callLLM(messages, config, options = {}) {}
// options: { structured?: boolean, signal?: AbortSignal }

// embeddings.js — new optional second argument
export async function getQueryEmbedding(text, { signal } = {}) {}
export async function getDocumentEmbedding(summary, { signal } = {}) {}
export async function enrichEventsWithEmbeddings(events, { signal } = {}) {}
export async function generateEmbeddingsForMemories(memories, { signal } = {}) {}

// Strategy methods — new optional options argument
class EmbeddingStrategy {
    async getEmbedding(_text, { signal } = {}) {}
    async getQueryEmbedding(_text, { signal } = {}) {}
    async getDocumentEmbedding(_text, { signal } = {}) {}
}
```

### Unchanged signatures (abort flows through defaults)

```js
// These all work unchanged — their callees read getSessionSignal()
export async function mergeOrInsertEntity(graphData, name, type, description, cap, settings) {}
export async function generateReflections(characterName, allMemories, characterStates) {}
export async function updateCommunitySummaries(_graphData, groups, existing, count, threshold, isSingle) {}
export async function updateInjection(pendingUserMessage = '') {}
export async function selectRelevantMemories(memories, ctx) {}
export async function extractMemories(messageIds = null, targetChatId = null, options = {}) {}
```

## 6. Risks & Edge Cases

| Risk | Mitigation |
|------|------------|
| **`connectionManager.sendRequest()` continues server-side after abort** | Unavoidable without ST API changes. Only the result is discarded. API costs are incurred but execution time is reclaimed. Logged at debug level. |
| **Signal aborted between Phase 1 save and Phase 2 start** | Phase 1 data is already persisted. Phase 2 catch re-throws AbortError. No data loss. Phase 2 enrichment (reflections, communities) will run on the next extraction cycle. |
| **Rapid chat switching (A→B→C in <1s)** | Each `CHAT_CHANGED` calls `resetSessionController()`. Controller B aborts A's work, controller C aborts B's. Each controller is independent. No accumulation or leak. |
| **`Promise.all` in `generateReflections()` with 3 parallel insight calls** | All 3 promises race against the same signal. `Promise.all` rejects with the first AbortError. Other pending calls also abort. Clean propagation. |
| **Backfill progress toast left dangling on abort** | `extractAllMessages()` catch block already removes `.openvault-backfill-toast` on chat change. AbortError is now handled identically. |
| **`processInBatches` mid-batch abort** | `Promise.all` within a batch rejects on first AbortError. Outer loop in `enrichEventsWithEmbeddings` propagates it. Partial batch results are discarded (no half-embedded state). |
| **Manual re-embed from UI (`render.js`)** | Calls `getDocumentEmbedding()` which reads session signal. If user switches chat during manual re-embed, it aborts. This is correct — the UI for the old chat is gone. |
| **Signal already aborted on function entry** | Every leaf function checks `signal.aborted` before starting work. Fast-fail, no wasted computation. |
| **`raceAbort` listener leak** | Listener is removed in both resolve and reject paths. `{ once: true }` is belt-and-suspenders. |
| **Worker `isRunning` flag stuck after AbortError** | `.finally()` on `runWorkerLoop()` already clears it. AbortError is caught inside the try block, so finally always runs. |

## 7. Testing Strategy

### Unit Tests (`tests/state.test.js`)

- `getSessionSignal()` returns an `AbortSignal`
- `resetSessionController()` aborts the previous signal
- `resetSessionController()` creates a fresh non-aborted signal
- Multiple resets don't throw

### Unit Tests (`tests/llm.test.js` — new cases)

- `callLLM()` with pre-aborted signal → throws `AbortError` without calling `sendRequest`
- `callLLM()` with signal that aborts mid-request → throws `AbortError`, `sendRequest` result ignored
- `callLLM()` without signal → reads from `getSessionSignal()` (mock via `setDeps` or direct import)
- `raceAbort` listener cleanup: resolve path removes listener, reject path removes listener

### Unit Tests (`tests/embeddings.test.js` — new cases)

- `getQueryEmbedding()` with pre-aborted signal → throws `AbortError`, no pipeline call
- `getDocumentEmbedding()` with pre-aborted signal → same
- `TransformersStrategy.#embed()` passes signal to pipeline (verify via mock)
- `OllamaStrategy.getEmbedding()` passes signal to fetch (verify via mock)
- Cache hit with aborted signal → throws `AbortError` (signal checked before cache)

### Integration Tests (`tests/extraction/extract.test.js` — new cases)

- Phase 2 AbortError propagation: mock `callLLM` to throw AbortError during reflection → `extractMemories` throws (not swallowed)
- Phase 1 AbortError: mock `callLLM` to throw AbortError during event extraction → `extractMemories` throws

### Worker Tests (`tests/extraction/worker.test.js` — new cases)

- Worker loop exits cleanly when signal aborts
- Worker sets status to 'ready' after abort exit

## 8. File Change Summary

| File | Type of change |
|------|---------------|
| `state.js` | Add `_sessionController`, `getSessionSignal()`, `resetSessionController()` |
| `llm.js` | Add `raceAbort()` helper, wire signal into `callLLM()` |
| `embeddings.js` | Add `{ signal }` to strategy methods, public API, batch functions |
| `extract.js` | Re-throw AbortError in Phase 2 catch; handle AbortError in backfill loop |
| `worker.js` | Check `signal.aborted` in loop; catch AbortError for clean exit |
| `events.js` | Call `resetSessionController()` in `onChatChanged()`; handle AbortError in `onBeforeGeneration()` |
| Tests (4 files) | New test cases for abort behavior |

**Total: 6 source files changed, ~4 test files updated. Zero signature changes to mid-level orchestrators.**
