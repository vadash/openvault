# Shared Utilities

## LOGGING (`logging.js`)
- **Use domain-specific loggers.** Route all logs through `getDeps().console`. Never use raw `console.log`.
- **`logDebug(msg, data)`:** Use inside loops, similarity scoring, or token math. (Only visible if `debugMode` is true).
- **`logInfo(msg, data)`:** Use for milestones that fire *once* per user action (e.g., Backfill complete).
- **`logWarn(msg, data)`:** Use for recovered errors and edge-case fallbacks.
- **`logError(msg, err, context)`:** Use for unrecoverable failures. Always pass a truncated context object for the 3 critical paths (JSON parse, embedding, extraction).

## PRODUCTION LOGGING RULE
- **Never use raw `console.log` in src/.** Always use `logDebug()` / `logInfo()` / `logWarn()` / `logError()` from `logging.js`. These route through `getDeps().console` and respect the `debugMode` toggle.

## JSON PARSING (`text.js`)
- **Execute the 5-Tier `safeParseJSON` waterfall:**
  1. Native `JSON.parse`.
  2. `extractJsonBlocks` + `jsonrepair`.
  3. Smart quote normalization + `extractJsonBlocks` + `jsonrepair`.
  4. `scrubConcatenation` (Fixes hallucinated `"a" + "b"` strings).
  5. Fatal Error.
- **Return Zod-style results.** Always return `{ success, data?, error?, errorContext? }`.

## DESCRIPTION MERGING (`text.js`)
- **`mergeDescriptions(targetDesc, sourceDesc, threshold)`** — Segmented Jaccard deduplication. Splits source by ` | ` (space-pipe-space), compares each segment against the accumulated target using `jaccardSimilarity()`, appends only segments below the threshold. Default threshold from `GRAPH_JACCARD_DUPLICATE_THRESHOLD`.

## EMBEDDING CODEC (`embedding-codec.js`)
- **Store as Base64 strings.** Convert `Float32Array` to `embedding_b64` to cut JSON storage size by 33%.
- **Read legacy arrays transparently.** Fall back to parsing `number[]` if `embedding_b64` is missing.

## TOKEN BOUNDARIES (`tokens.js`)
- **Snap arrays to turn boundaries.** Use `snapToTurnBoundary()` to trim message indices backward until reaching a valid `Bot -> User` transition. Never orphan a User message from its Bot response during auto-hide or batching.

## REGEX & MULTILINGUAL
- **Never use `\b` for non-ASCII text.** Word boundaries only match ASCII `[A-Za-z0-9_]`. Use `(?<![\p{L}\p{N}_])` / `(?![\p{L}\p{N}])` with the `u` flag instead.

## ASYNC UTILITIES (`st-helpers.js`)
- **Clear timers after `Promise.race`.** `Promise.race` does not cancel the losing promise. Always `clearTimeout` in a `.finally()` on the primary promise to prevent memory leaks.

## AIMD LADDER QUEUE (`queue.js`)
- **Manage Phase 2 parallelism.** Use `createLadderQueue()` for LLM tasks.
- **Decrease multiplicatively.** On 429 or Timeout, halve concurrency and pause for 4 seconds.
- **Increase additively.** On success, slowly add 0.5 to the concurrency ceiling.
