# Memory Extraction Subsystem

> For the big picture of how this fits into the whole app, see `docs/ARCHITECTURE.md`.

## WHAT
Extracts events, entities, and relationships from chat. Converts raw messages into structured JSON, deduplicates, embeds. Triggers reflection and community detection pipelines. Runs in the background via a single-instance worker loop.

## HOW: Background Worker (`worker.js`)
- `wakeUpBackgroundWorker()` — fire-and-forget entry point called from `onMessageReceived`. No `await`.
- **Single-instance**: Boolean `isRunning` flag. Multiple wake calls are no-ops; running loop picks up new batches naturally.
- **Wake generation**: Monotonic counter incremented on each wake. Worker checks during backoff sleep — if changed, resets retry state and re-attempts immediately.
- **Interruptible sleep**: Checks `wakeGeneration` every 500ms. New messages cut backoff short.
- **Guards**: Halts on chat switch, extension disabled, or `operationState.extractionInProgress` (manual backfill).
- **Backoff**: Exponential schedule `[1, 2, 3, 10, 20, 30, 30, 60, 60]` seconds. Caps at 15min cumulative. Only Phase 1 failures trigger backoff.
- **Chat-switch fast-fail**: `"Chat changed during extraction"` error breaks loop immediately (no retry).

## HOW: Two-Phase Extraction (`extract.js`)
**Phase 1 (critical — gates auto-hide):**
1. **Message Selection**: `scheduler.js` determines unextracted batches.
2. **Stage A - Event Extraction**: `buildEventExtractionPrompt()` builds event-only prompt. LLM reasons in `<think>` XML tags (stripped before parse), then returns `EventExtractionSchema` (events only).
3. **Inter-call delay**: `rpmDelay(settings, 'Inter-call rate limit')` — shared utility that waits `ceil(60000/RPM)` ms. Same function used for batch delays in `extractAllMessages`.
4. **Stage B - Graph Extraction**: If events found, `buildGraphExtractionPrompt()` builds graph prompt with extracted events as context. LLM returns `GraphExtractionSchema` (entities + relationships).
4. **Processing**: `parseEventExtractionResponse()` / `parseGraphExtractionResponse()` strip tags, validate via Zod.
5. **Graph Update**: Semantic entity merge via `mergeOrInsertEntity()`, relationships via `upsertRelationship()`.
6. **Commit**: Events pushed to `MEMORIES_KEY`, character states updated, `PROCESSED_MESSAGES_KEY` set.
7. **Intermediate save**: `saveOpenVaultData()` — Phase 1 data persisted even if Phase 2 crashes.

**Phase 2 (enrichment — non-critical, errors swallowed):**
8. **Reflection Check**: Per-character importance accumulation; triggers at threshold 40.
9. **Community Detection**: Every 50 messages, runs Louvain via `src/graph/communities.js`.
10. **Final save**: `saveOpenVaultData()`.

Phase 2 is wrapped in try/catch — failures are logged but do NOT propagate to the worker's backoff loop.

## GOTCHAS & RULES
- **Two-Stage Extraction**: Events extracted first (Stage A), then entities/relationships (Stage B) using events as context. Reduces LLM cognitive load and JSON failures.
- **Split Schemas**: `EventExtractionSchema` (events only), `GraphExtractionSchema` (entities + relationships). No unified `ExtractionResponseSchema`. Reasoning happens outside JSON via `<think>` XML tags, stripped by `stripThinkingTags()`.
- **JSON Array Recovery**: If LLM returns malformed JSON (e.g., missing wrapping array), attempts to recover via regex before failing. Expected retry via backoff scheduler.
- **Markdown Fence Stripping**: `stripMarkdown()` handles complete fences, unclosed opening fences (`\`\`\`json\n{...}`), and orphan closing fences (`{...}\n\`\`\``). Exported as `_testStripMarkdown` for testing.
- **Event Summary Minimum**: 30 characters strictly enforced via Zod schema. LLM failures here are expected — scheduler retries automatically.
- **Entity Keys**: Always normalize via `normalizeKey()` (lowercase, strips possessives) before graph operations. LLM outputs original casing.
- **Key Normalization**: `source`/`target` in relationships resolved via `_resolveKey()` to handle entity merge redirects.
- **Zod Schemas**: Defined in `structured.js`, converted to JSON Schema Draft-04 for ST. Use `getEventExtractionJsonSchema()` / `getGraphExtractionJsonSchema()`.
- **LLM Configs**: `LLM_CONFIGS.extraction_events` (4000 tokens), `LLM_CONFIGS.extraction_graph` (2000 tokens). No unified `extraction` config.
- **Settings Values**: All thresholds/interval values read from `settings` object (defaults provided): `reflectionThreshold` (40), `communityDetectionInterval` (50), `entityDescriptionCap` (3), `edgeDescriptionCap` (5).
- **Reflections are Memories**: Stored with `type: 'reflection'`, retrieved alongside events.
- **Character Validation**: `updateCharacterStatesFromEvents()` and `cleanupCharacterStates()` prevent corrupted state entries from invalid names.
- **Two-Phase Dedup**: `filterSimilarEvents` (exported, **async**) first filters vs existing via cosine, then intra-batch via Jaccard token overlap. Catches near-duplicates with orthogonal embeddings. Uses `await yieldToMain()` every 10 iterations.
- **`options.silent`**: `extractMemories` accepts optional 3rd arg `{ silent: true }` — suppresses toasts. Used by background worker.
- **`PROCESSED_MESSAGES_KEY` timing**: Updated AFTER events are pushed to `MEMORIES_KEY` and graph is upserted. Events + graph are treated as an atomic unit to prevent inconsistent state.
- **Phase 2 isolation**: Reflection/community errors do NOT propagate from `extractMemories`. Only Phase 1 failures throw.
- **Testing**: Test parsers heavily. See `tests/extraction/structured.test.js`. Worker tests use `vi.resetModules()` to reset module-level state (`isRunning`, `wakeGeneration`).