# Design: Lazy-Load ES Module Imports

## 1. Problem Statement

All 6 esm.sh CDN dependencies are fetched at startup due to static import chains rooted in `events.js`. None are needed at module evaluation time — they're only called inside event handlers, UI callbacks, and background processing. The cascade:

```
index.js → events.js → extract.js → structured.js  → jsonrepair, zod
                                   → communities.js → graphology (×3)
                                   → graph.js       → stemmer.js → snowball-stemmers
                                                     → stopwords.js → stopword
                      → scheduler.js → tokens.js    → gpt-tokenizer
```

## 2. Goals & Non-Goals

**Must do:**
- Defer all 6 CDN fetches until first use via dynamic `import()`
- Zero API changes — no function signatures change, no new exports

**Won't do:**
- Restructure the module tree or move files
- Add preloading/warming patterns
- Change `tokens.js` internals (keep its static import of gpt-tokenizer; defer *tokens.js itself* from consumers)

## 3. Proposed Architecture

Convert 15 static imports to dynamic `import()` across 4 files. ES module caching guarantees that after first load, subsequent `import()` calls return instantly (same module instance).

### Pattern

Every lazy-loaded import follows the same pattern inside an already-async function (or a sync function that becomes fire-and-forget async):

```js
// BEFORE (static — forces module load at startup)
import { foo } from './heavy-module.js';

export async function handler() {
    foo();
}

// AFTER (dynamic — loads on first call, cached thereafter)
export async function handler() {
    const { foo } = await import('./heavy-module.js');
    foo();
}
```

For sync functions that become async (`refreshStats`, `updateBudgetIndicators`): callers already use them fire-and-forget (no return value checked), so returning a Promise is transparent.

## 4. Changes by File

### 4.1 `index.js` — 2 imports

| Remove static import | Used in | First needed |
|---|---|---|
| `extractMemories` from `./src/extraction/extract.js` | `/openvault-extract` callback | Manual slash command |
| `retrieveAndInjectContext` from `./src/retrieval/retrieve.js` | `/openvault-retrieve` callback | Manual slash command |

Both callbacks are already `async`. Dynamic `import()` drops directly in.

### 4.2 `src/events.js` — 7 imports

| Remove static import | Lazy-load inside | First needed |
|---|---|---|
| `clearEmbeddingCache` from `./embeddings.js` | `onChatChanged()` | First chat switch |
| `cleanupCharacterStates` from `./extraction/extract.js` | `onChatChanged()` | First chat switch |
| `clearRetrievalDebug` from `./retrieval/debug-cache.js` | `onChatChanged()` | First chat switch |
| `wakeUpBackgroundWorker` from `./extraction/worker.js` | `onMessageReceived()` | First MESSAGE_RECEIVED |
| `updateInjection` from `./retrieval/retrieve.js` | `onBeforeGeneration()` | First generation |
| `getExtractedMessageIds` from `./extraction/scheduler.js` | `autoHideOldMessages()` | First generation |
| `getMessageTokenCount`, `getTokenSum`, `snapToTurnBoundary` from `./utils/tokens.js` | `autoHideOldMessages()` | First generation |

`onChatChanged()` becomes `async` (was sync). Callers: `eventSource.on()` — fire-and-forget, safe.

`onMessageReceived()` becomes `async` (was sync). Same — fire-and-forget event handler.

`autoHideOldMessages()` and `onBeforeGeneration()` are already `async`.

### 4.3 `src/ui/settings.js` — 4 imports

| Remove static import | Lazy-load inside | First needed |
|---|---|---|
| `extractAllMessages` from `../extraction/extract.js` | `#openvault_extract_all_btn` click handler | User clicks button |
| `isWorkerRunning` from `../extraction/worker.js` | Same handler (guard check) | User clicks button |
| `getTokenSum` from `../utils/tokens.js` | `updateBudgetIndicators()` | `refreshAllUI()` call |
| `getExtractedMessageIds`, `getUnextractedMessageIds` from `../extraction/scheduler.js` | `updateBudgetIndicators()` | `refreshAllUI()` call |

`updateBudgetIndicators()` becomes `async` (was sync). Sole caller: `refreshAllUI()` in `render.js` — fire-and-forget, safe.

### 4.4 `src/ui/status.js` — 2 imports

| Remove static import | Lazy-load inside | First needed |
|---|---|---|
| `getTokenSum` from `../utils/tokens.js` | `refreshStats()` | `refreshAllUI()` call |
| `getExtractedMessageIds`, `getUnextractedMessageIds` from `../extraction/scheduler.js` | `refreshStats()` | `refreshAllUI()` call |

`refreshStats()` becomes `async` (was sync). Callers: `refreshAllUI()` and two `async` functions in `render.js` — all fire-and-forget, safe.

## 5. CDN Deps Deferred

| CDN dep | Module | Deferred by breaking chain in |
|---|---|---|
| `graphology` + louvain + operators | `graph/communities.js` | `events.js` → `extract.js` |
| `jsonrepair` | `extraction/structured.js`, `utils/text.js` | `events.js` → `extract.js` |
| `zod` | `extraction/structured.js` | `events.js` → `extract.js` |
| `snowball-stemmers` | `utils/stemmer.js` | `events.js` → `extract.js` |
| `stopword` | `utils/stopwords.js` | `events.js` → `extract.js` |
| `gpt-tokenizer` | `utils/tokens.js` | `events.js` + `status.js` + `settings.js` |

Module-level side effects also deferred: `stemmer.js` stemmer instantiation, `stopwords.js` Set construction.

## 6. Risks & Edge Cases

**Race conditions:** Two event handlers firing simultaneously and both lazy-importing the same module. Safe — ES module spec guarantees a single module instance; the second `import()` returns the cached Promise.

**First-call latency:** The first invocation of each handler incurs a CDN fetch. Acceptable because:
- Extraction/retrieval handlers already do LLM calls (seconds) — a module fetch (ms) is negligible
- `autoHideOldMessages` and `refreshStats` run on first CHAT_CHANGED/GENERATION — the user is already waiting for ST to load the chat

**CDN failure:** If esm.sh is unreachable, `import()` throws. Existing `try/catch` in `onBeforeGeneration` and `onChatChanged` already handle errors. `refreshStats` / `updateBudgetIndicators` silently fail (DOM stays at default "0" values) — acceptable degradation.

**Fire-and-forget async:** `onChatChanged`, `onMessageReceived`, `refreshStats`, `updateBudgetIndicators` become async but callers don't await them. This is safe for event handlers and UI updates — SillyTavern doesn't expect return values from these. The DOM updates still complete; they're just non-blocking.

**Testing:** Existing tests use `deps.js` injection boundary and mock LLM/embeddings. Lazy imports don't affect this — test harnesses can pre-import modules or the dynamic imports resolve from the same module cache.

## 7. Verification

1. **Startup:** Open browser DevTools Network tab. Reload SillyTavern. Confirm no esm.sh requests until first user action.
2. **First generation:** Send a message. Confirm gpt-tokenizer, jsonrepair, zod load on demand. autoHide and retrieval work correctly.
3. **Chat switch:** Switch chats. Confirm embeddings cache clears, character states clean up, UI refreshes.
4. **Extract All button:** Click Extract All in settings. Confirm extraction runs normally.
5. **Stats display:** Open settings panel. Confirm batch progress bar and budget indicators render correctly.
6. **Run existing tests:** `npm test` — all should pass unchanged.
