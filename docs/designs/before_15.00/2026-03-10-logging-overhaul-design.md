# Design: Logging Overhaul

## 1. Problem Statement

OpenVault's logging is inconsistent. Some files call `log()`, some call `getDeps().console.error()`, and some use bare `console.error()`. Errors are logged without the state that caused them, making production debugging guesswork. There is no middle tier between "hidden debug spam" and "error".

## 2. Goals & Non-Goals

### Must do
- Standardize all logging through `src/utils/logging.js` -- no bare `console.*` or `getDeps().console.*` outside that module and `deps.js`.
- Introduce `logInfo` tier: always-visible, rare lifecycle milestones.
- Enrich error context on the 3-4 hardest-to-debug paths (JSON parse, embedding, extraction top-level).
- Rename all `log()` call sites to `logDebug()` for explicit intent.
- Maintain `getDeps().console` indirection for testability.

### Won't do
- Structured/machine-readable logging (JSON lines, log levels as numbers).
- Persistent log file or log export UI.
- Enriching *every* catch block -- only critical paths get context objects now.
- Changing `logRequest` -- it already works well with `groupCollapsed`.

## 3. Proposed Architecture

### Central module: `src/utils/logging.js`

Four exported functions, all prefixed `[OpenVault]`, all routing through `getDeps().console`:

| Function | When visible | Purpose |
|---|---|---|
| `logDebug(msg, data?)` | `settings.debugMode === true` only | Loop iterations, scores, token math, sleep/wake |
| `logInfo(msg, data?)` | Always | Extension init, backfill complete, embedding model changed |
| `logWarn(msg, data?)` | Always | Recovered errors, edge cases (array-instead-of-object, stale lock) |
| `logError(msg, error?, context?)` | Always | Failures. Formats message + stack + stringified context |

`logRequest` is unchanged.

### `logError` signature detail

```js
/**
 * @param {string} msg - Human description of what failed
 * @param {Error} [error] - The caught error object (stack will be printed)
 * @param {Record<string, unknown>} [context] - Key-value state for debugging
 */
export function logError(msg, error, context) { ... }
```

When `context` is provided, it is printed as a collapsed group beneath the error so it doesn't dominate the console but is one click away.

### File-level changes

#### Phase A: Rewrite `logging.js`

Replace the current `log` + `logRequest` with `logDebug`, `logInfo`, `logWarn`, `logError`, `logRequest`.

#### Phase B: Eradicate bare console calls (10 files)

Every `getDeps().console.*` and bare `console.*` outside `deps.js` becomes an import from `logging.js`. Mapping:

| Current pattern | New call |
|---|---|
| `getDeps().console.error('[OpenVault]...', error)` | `logError('...', error)` |
| `getDeps().console.warn('[OpenVault]...')` | `logWarn('...')` |
| `console.error('[OpenVault]...', err)` | `logError('...', err)` |
| `console.warn('[OpenVault]...')` | `logWarn('...')` |
| `console.log('[OpenVault]...')` | `logInfo('...')` or `logDebug('...')` |

Files with bare `console.*` that must be fixed:
- `src/ui/settings.js` (3 bare calls)
- `src/extraction/structured.js` (1 bare `console.warn`)
- `src/extraction/extract.js:800` (1 bare `console.error`)

Files using `getDeps().console.*` that must be migrated:
- `src/extraction/worker.js`
- `src/utils/text.js`
- `src/state.js`
- `src/utils/data.js`
- `src/utils/st-helpers.js`
- `src/embeddings.js`
- `src/retrieval/retrieve.js`
- `src/events.js`
- `src/extraction/extract.js`

#### Phase C: Rename `log()` to `logDebug()` (14 files)

All files currently importing `log` from `logging.js` switch to `import { logDebug } from '...'` and replace every `log(...)` call with `logDebug(...)`.

Files:
- `src/embeddings.js`
- `src/llm.js`
- `src/events.js`
- `src/graph/communities.js`
- `src/graph/graph.js`
- `src/extraction/extract.js`
- `src/extraction/worker.js`
- `src/perf/store.js`
- `src/pov.js`
- `src/reflection/reflect.js`
- `src/retrieval/retrieve.js`
- `src/retrieval/scoring.js`
- `src/ui/status.js`
- `src/utils/data.js`

#### Phase D: Enrich critical-path error context (3 targets)

1. **`src/utils/text.js` -- JSON parse failures**
   - `cleanAndParseJSON` catch: `logError('JSON parse failed', e, { rawInput: input.slice(0, 2000) })`
   - Non-object result: `logError('JSON parse returned non-object/array', null, { type: typeof parsed, rawInput: input.slice(0, 500) })`

2. **`src/embeddings.js` -- Embedding strategy failures**
   - `TransformersStrategy.embed` catch: `logError('Transformers embedding failed', error, { modelName, textSnippet: text.slice(0, 100) })`
   - `OllamaStrategy.embed` catch: `logError('Ollama embedding failed', error, { modelName, textSnippet: text.slice(0, 100) })`
   - Top-level backfill catch: `logError('Backfill embeddings error', error, { strategy: currentStrategyName })`

3. **`src/extraction/extract.js` -- Extraction failures**
   - `extractMemories` top-level catch: `logError('Extraction error', error, { messageCount: messages.length })`
   - Phase 2 catch: `logError('Phase 2 error', phase2Error, { characterName })`

#### Phase E: Promote lifecycle logs to `logInfo`

- `src/ui/settings.js:387` -- `console.log('[OpenVault] Settings loaded')` -> `logInfo('Settings loaded')`
- `src/embeddings.js` backfill complete line -> `logInfo('Backfill complete: ...')`
- `src/extraction/extract.js` final `log('Extracted N events')` -> `logInfo('Extracted N events ...')`

## 4. Data Models / Schema

No schema changes. The `context` parameter on `logError` is an ad-hoc `Record<string, unknown>` -- no new types needed.

## 5. Interface / API Design

```js
// src/utils/logging.js

/** Debug-only. Hidden unless settings.debugMode is true. */
export function logDebug(msg: string, data?: unknown): void;

/** Always visible. Rare lifecycle milestones only. */
export function logInfo(msg: string, data?: unknown): void;

/** Always visible. Recovered errors, edge cases. */
export function logWarn(msg: string, data?: unknown): void;

/** Always visible. Failures with optional context. */
export function logError(msg: string, error?: Error, context?: Record<string, unknown>): void;

/** Grouped request log. Unchanged. */
export function logRequest(label: string, data: RequestLogData): void;
```

## 6. Update `src/utils/CLAUDE.md` Logging Guidelines

After implementing the new module, update the `logging.js` section in `src/utils/CLAUDE.md` to serve as the authoritative reference for any future code changes (human or AI). Replace the current two-bullet section with:

```markdown
### `logging.js`

**Exported functions** (all auto-prefix `[OpenVault]`, all route through `getDeps().console`):

| Function | Visibility | Use for |
|---|---|---|
| `logDebug(msg, data?)` | `debugMode` only | Loop iterations, similarity scores, token math, sleep/wake cycles, per-item processing details |
| `logInfo(msg, data?)` | Always | Rare milestones that fire **at most once per user action**: init, backfill complete, model change, settings loaded |
| `logWarn(msg, data?)` | Always | Recovered errors, edge-case fallbacks (array-instead-of-object, stale lock cleared, unknown config key) |
| `logError(msg, error?, context?)` | Always | Unrecoverable failures. Pass the caught `Error` as second arg. Pass a context object (counts, model names, truncated inputs) as third arg for the 3 critical paths (JSON parse, embedding, extraction). |
| `logRequest(label, data)` | `requestLogging` only | Full LLM request/response payloads inside `groupCollapsed`. Already well-designed -- do not change. |

**Rules:**
- **Never** use bare `console.*` or `getDeps().console.*` outside `logging.js` and `deps.js`.
- **Import what you need**: `import { logDebug, logError } from '../utils/logging.js';`
- **`logInfo` budget**: If a message could fire inside a loop or more than once per user action, it MUST be `logDebug`, not `logInfo`.
- **Error context**: On critical paths (JSON parse, embedding, extraction top-level), always pass a `context` object to `logError`. Truncate raw text to 100-2000 chars. Never include full chat messages or API keys.
- **AbortError**: Always re-throw `AbortError` before logging -- it signals intentional cancellation, not a failure.
```

## 7. Risks & Edge Cases

### Risk: Breaking tests
- **Mitigation:** All functions route through `getDeps().console`, so test mocks via `setDeps()` continue to work. Tests that assert on `getDeps().console.error` calls will need their assertions updated to match the new `[OpenVault]` prefixed format from `logError`. Run `npm run test` after each phase.

### Risk: `logInfo` pollution
- **Mitigation:** Design rule: `logInfo` is for events that happen **at most once per user action** (init, backfill complete, model change). If a message could fire in a loop, it must be `logDebug`.

### Risk: `context` objects leaking sensitive data
- **Mitigation:** Context should contain structural data (counts, model names, truncated text) -- never full chat messages or API keys. Truncation to 100-2000 chars is enforced at the call site.

### Edge case: `logError` called without an Error object
- `logError('something went wrong')` should still work -- `error` and `context` are optional. The function checks for `error?.stack` before printing stack traces.

### Edge case: `getDeps().console` missing groupCollapsed
- Already handled in `logRequest`. `logError`'s context group should use the same fallback pattern: `const group = c.groupCollapsed?.bind(c) ?? c.log.bind(c)`.
