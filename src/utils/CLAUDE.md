# Shared Utilities

## MODULES (No Barrel File — Import Explicitly)

### `logging.js`

**Exported functions** (all auto-prefix `[OpenVault]`, all route through `getDeps().console`):

| Function | Visibility | Use for |
|---|---|---|
| `logDebug(msg, data?)` | `debugMode` only | Loop iterations, similarity scores, token math, sleep/wake cycles, per-item processing details |
| `logInfo(msg, data?)` | Always | Rare milestones that fire **at most once per user action**: init, backfill complete, model change, settings loaded |
| `logWarn(msg, data?)` | Always | Recovered errors, edge-case fallbacks (array-instead-of-object, stale lock cleared, unknown config key) |
| `logError(msg, error?, context?)` | Always | Unrecoverable failures. Pass the caught `Error` as second arg. Pass a context object (counts, model names, truncated inputs) as third arg for the 3 critical paths (JSON parse, embedding, extraction). |
| `logRequest(label, data)` | `requestLogging` only | LLM request/response logging. **Success**: compact summary (profile, tokens, char count, message count). **Failure**: full verbose output (messages, response, error). |

**Rules:**
- **Never** use bare `console.*` or `getDeps().console.*` outside `logging.js` and `deps.js`.
- **Import what you need**: `import { logDebug, logError } from '../utils/logging.js';`
- **`logInfo` budget**: If a message could fire inside a loop or more than once per user action, it MUST be `logDebug`, not `logInfo`.
- **Error context**: On critical paths (JSON parse, embedding, extraction top-level), always pass a `context` object to `logError`. Truncate raw text to 100-2000 chars. Never include full chat messages or API keys.
- **AbortError**: Always re-throw `AbortError` before logging — it signals intentional cancellation, not a failure.

### `embedding-codec.js`
- Base64 Float32Array encode/decode for embeddings.
- `getEmbedding(obj)`, `setEmbedding(obj, vec)`, `hasEmbedding(obj)`, `deleteEmbedding(obj)`.
- Lazy migration: reads legacy `embedding: number[]` transparently, writes only `embedding_b64: string`.
- ~33% storage reduction vs JSON arrays.
- **ST Sync Flags**: `markStSynced(obj)`, `isStSynced(obj)`, `clearStSynced(obj)` — track sync status to ST Vector Storage.
- **Cyrb53 Hash**: `cyrb53(str, seed?)` — 53-bit hash for ST Vector Storage compatibility (numeric hash IDs).

### `tokens.js` (gpt-tokenizer)
- Exact token counting replacing old heuristic estimators.
- **Top-level await**: Loads `gpt-tokenizer` from CDN via `cdnImport()`.
- **Test overrides**: In tests, CDN imports are mocked via `_setTestOverride()` stored on `globalThis.__openvault_cdn_test_overrides` to survive `vi.resetModules()`.
- **Turn-Boundary Snapping** (`snapToTurnBoundary`): Trims message index arrays backward until it finds a valid `Bot -> User` transition or End-of-Chat. **CRITICAL**: Prevents auto-hide or batching from splitting a User message from its Bot response.

### `cdn.js`
CDN import with version pinning, retry, and mirror fallback (esm.sh → skypack → esm.run → unpkg).
- **Version Pinning**: `CDN_VERSIONS` frozen map pins all CDN packages (kept in sync with `package.json`). `resolveVersion()` maps bare specs (`'zod'` → `'zod@4.3.6'`) and sub-path specs (`'gpt-tokenizer/encoding/o200k_base'` → `'gpt-tokenizer@3.4.0/encoding/o200k_base'`). When updating a package version, update BOTH `package.json` and `CDN_VERSIONS`.
- `_setTestOverride(spec, module)`: Test-only hook to mock CDN imports with local `node_modules/` packages.
- Test overrides stored on `globalThis.__openvault_cdn_test_overrides` to survive `vi.resetModules()`.
- **Why**: `vi.resetModules()` resets module-level state; global storage ensures overrides persist across test runs.

### `text.js`
- `normalizeText()`: Fixes invisible chars - strips control chars (preserves 
	), replaces smart quotes, removes Unicode line/paragraph separators.
- `stripMarkdownFences()`: Strips ``` and ~~~ fences (with/without `json` specifier). Called BEFORE parsing - mid-tier LLMs output valid JSON in fences 90% of the time.
- `extractJsonBlocks()`: Robust balanced bracket extraction. Handles strings, escape sequences, nested structures. Returns `[{ start, end, text, isObject }]`. Correctly handles `\` before quotes (escaped backslash).
- `scrubConcatenation()`: Fixes LLM string concatenation hallucinations (`"a" + "b"` -> `"ab"`). Only at Tier 4 (desperation) to avoid damaging valid math.
- `safeParseJSON()`: 5-tier waterfall returning `{ success, data?, error?, errorContext? }`. Tier 1: JSON.parse → Tier 2: Extract + jsonrepair → Tier 3: Normalize + Extract → Tier 4: Aggressive Scrub → Tier 5: Fatal. **Domain-agnostic** - no wrapping of bare arrays. Domain logic (e.g., wrap bare arrays in `{ events: [] }`) goes in `structured.js` parsers.
- `stripThinkingTags()`: Strips LLM reasoning tags before parsing. Handles paired XML/bracket tags, orphaned closings from prefills.
- `jaccardSimilarity(setA, setB, tokenizeFn?)`: Computes Jaccard index (intersection/union) between two token sets. Accepts strings, Sets, or arrays. Optional custom tokenizer. Used for deduplication: event dedup in extraction, edge description dedup in graph. Default tokenizer filters single-char letters but preserves single-digit numbers.
- `getMemoryPosition(memory)`: Returns average position from `message_ids` for bucket assignment.
- `assignMemoriesToBuckets(memories, chatLength)`: Assigns memories to old/mid/recent buckets. Old: < (len-500), Mid: (len-500) to (len-100), Recent: >= (len-100). Used by soft balance budgeting.

### `st-helpers.js`
- `safeSetExtensionPrompt()`: Wraps ST's injection with try/catch.
- `yieldToMain()`: Polyfills `scheduler.yield()` with a `setTimeout(0)` fallback. Mandatory in heavy loops (communities, extraction dedup) to unfreeze the ST UI.

### `stemmer.js` & `stopwords.js`
- Language detection: Cyrillic -> Russian, Latin -> English.
- **Cyrillic Over-Stem Guard**: Snowball often over-strips Russian (e.g., `елена` -> `ел`). Guard limits stripping to max 3 chars, falling back to 1 char.
- **Entity Stemming**: `stemName()` intentionally DOES NOT filter stopwords (e.g., "The Castle" retains the "the" stem, because entity names are exact).
- **Stopwords**: Base EN+RU lists from `stopword` package only. No custom lists.

### `transliterate.js`
- `transliterateCyrToLat(str)`: Cyrillic→Latin via `cyrillic-to-translit-js` (CDN import, Russian preset). Always lowercased.
- `levenshteinDistance(a, b)`: Standard O(n*m) edit distance. Used for fuzzy cross-script name matching (threshold: ≤ 2).
- **Use case**: Detecting that "Сузи" = "Suzy" and "Вова" = "Vova" across Cyrillic/Latin scripts for character deduplication.

### `queue.js`
- `createLadderQueue(maxConcurrency)`: AIMD-governed wrapper around `p-queue`. Implements Additive Increase / Multiplicative Decrease concurrency scaling.
  - **Additive Increase**: On success, climbs by +0.5 toward `maxConcurrency` ceiling.
  - **Multiplicative Decrease**: On 429/timeout, halves concurrency (floor 1) and pauses queue for 4000ms cooloff.
- **Use case**: Phase 2 enrichment parallelism (community summarization, edge consolidation, reflection generation). Phase 1 extraction remains sequential — do NOT use there.