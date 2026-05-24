# Extraction Pipeline

For event dedup thresholds (cross-batch/intra-batch Jaccard) see `include/DATA_SCHEMA.md` Section 4.

## WORKER LIFECYCLE
- **Trigger via fire-and-forget.** Call `wakeUpBackgroundWorker()` on message receive. Ensure singleton execution via `isWorkerRunning()`.
- **Interrupt sleep dynamically.** Use an interruptible sleep loop that checks `wakeGeneration` every 500ms. Abort sleep if new messages arrive.
- **Use the 6-stage extraction pipeline:**
  1. `fetchEventsFromLLM`
  2. `fetchGraphFromLLM`
  3. `enrichAndDedupEvents`
  4. `processGraphUpdates`
  5. `synthesizeReflections` (Deferred on backfill)
  6. `synthesizeWorldState` (Deferred on backfill)

## TURN BOUNDARY FALLBACK
- **Skip `is_system` messages in forward look.** Both `snapToTurnBoundary` and `trimTailTurns` must walk past system messages (Author's Notes, hidden system prompts) when scanning forward for Bot→User boundaries. System messages are not real conversation turns — treating them as such causes boundary misdetection.
- **`snapToTurnBoundary` accepts `allowUserOnly` flag.** When true (Emergency Cut), returns the accumulated messages as-is even if no Bot→User boundary exists. Prevents extraction stall on all-User message queues.

## BACKFILL OPTIMIZATION
- **Defer Phase 2 enrichment during manual backfills.** Pass `{ isBackfill: true }` to `extractMemories` to skip reflections and communities.
- **Run Phase 2 once at the end.** Execute `runPhase2Enrichment()` over all accumulated data to save API calls and UI lockups.
- **Max-backoff `break` is intentional, not a bug.** When `cumulativeBackoffMs >= MAX_BACKOFF_TOTAL_MS`, `break` exits the retry loop. Phase 2 then runs as best-effort enrichment on already-saved data (has its own guard: `if (!data.memories?.length) return`). This is by design — partial Phase 1 data is valuable and Phase 2 failure does not throw.

## IDF CACHE
- **Filter archived memories before IDF calculation.** `updateIDFCache` must use `memories.filter(m => !m.archived)` — the raw array includes archived items, producing stale IDF values and causing BM25 score mismatches.
- **Apply `.max(5)` to Graph Zod schemas.** Force the LLM to extract deltas (new entities/changes) rather than re-evaluating the whole world.

## SWIPE PROTECTION
- **Trim tail turns from extraction batches.** `trimTailTurns(chat, ids, N)` removes N complete User+Bot turns from the tail using the same Bot→User boundary logic as `snapToTurnBoundary()`.
- **Emergency Cut bypasses trimming.** Pass `isEmergencyCut=true` to skip swipe protection — emergency extractions need all available data.
- **Never trim to empty.** If trimming would empty the batch, return the original array (start-of-chat protection).
- **Trim once on the full list for backfill.** In `getBackfillMessageIds()`, apply `trimTailTurns` after the incomplete-last-batch trim, then recalculate `batchCount`.

## CROSS-MODULE REFERENCES
Graph merge logic, top-K entity selection, and reflection synthesis have dedicated CLAUDE.md files:
- `src/graph/CLAUDE.md` - Semantic merge, edge consolidation, world-state summarization
- `src/reflection/CLAUDE.md` - Reflection pipeline, accumulator lifecycle, 3-tier dedup
