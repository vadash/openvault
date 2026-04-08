# Extraction, GraphRAG, and Reflection

## WORKER LIFECYCLE
- **Trigger via fire-and-forget.** Call `wakeUpBackgroundWorker()` on message receive. Ensure singleton execution via `isWorkerRunning()`.
- **Interrupt sleep dynamically.** Use an interruptible sleep loop that checks `wakeGeneration` every 500ms. Abort sleep if new messages arrive.
- **Use the 6-stage extraction pipeline:** 
  1. `fetchEventsFromLLM`
  2. `fetchGraphFromLLM`
  3. `enrichAndDedupEvents`
  4. `processGraphUpdates`
  5. `synthesizeReflections` (Deferred on backfill)
  6. `synthesizeCommunities` (Deferred on backfill)

## TURN BOUNDARY FALLBACK
- **Skip `is_system` messages in forward look.** Both `snapToTurnBoundary` and `trimTailTurns` must walk past system messages (Author's Notes, hidden system prompts) when scanning forward for Bot→User boundaries. System messages are not real conversation turns — treating them as such causes boundary misdetection.
- **`snapToTurnBoundary` accepts `allowUserOnly` flag.** When true (Emergency Cut), returns the accumulated messages as-is even if no Bot→User boundary exists. Prevents extraction stall on all-User message queues.

## BACKFILL OPTIMIZATION
- **Defer Phase 2 enrichment during manual backfills.** Pass `{ isBackfill: true }` to `extractMemories` to skip reflections and communities. 
- **Run Phase 2 once at the end.** Execute `runPhase2Enrichment()` over all accumulated data to save API calls and UI lockups.

## GRAPH & COMMUNITIES
- **Filter archived memories before IDF calculation.** `updateIDFCache` must use `memories.filter(m => !m.archived)` — the raw array includes archived items, producing stale IDF values and causing BM25 score mismatches.
- **Apply `.max(5)` to Graph Zod schemas.** Force the LLM to extract deltas (new entities/changes) rather than re-evaluating the whole world.
- **Merge PERSON entities on high cosine similarity.** Names are unique identifiers. 
- **Require token-overlap for OBJECT/CONCEPT/PLACE.** Prevent false merges caused by similar contextual embeddings.
- **Transliterate for cross-script merges.** Match Cyrillic to Latin character nodes using `levenshteinDistance <= 2` on transliterated names.
- **Consolidate bloated edges.** Track `_descriptionTokens`. Trigger LLM consolidation when tokens `> 150`.
- **Prevent Louvain hairballs.** Attenuate edges involving User/Char by 95% (`MAIN_CHARACTER_ATTENUATION`) to allow secondary clusters to form without breaking hub-and-spoke RP structures.

## REFLECTION ACCUMULATOR LIFECYCLE
- **Reset `importance_sum` BEFORE the LLM call, restore on failure.** If reset happens only on success, a failing LLM causes infinite retries that burn tokens. The pattern: capture → reset → try → catch restores if still 0.

## SWIPE PROTECTION
- **Trim tail turns from extraction batches.** `trimTailTurns(chat, ids, N)` removes N complete User+Bot turns from the tail using the same Bot→User boundary logic as `snapToTurnBoundary()`.
- **Emergency Cut bypasses trimming.** Pass `isEmergencyCut=true` to skip swipe protection — emergency extractions need all available data.
- **Never trim to empty.** If trimming would empty the batch, return the original array (start-of-chat protection).
- **Trim once on the full list for backfill.** In `getBackfillMessageIds()`, apply `trimTailTurns` after the incomplete-last-batch trim, then recalculate `batchCount`.

## REFLECTION ENGINE
- **Trigger at importance >= 40.** Accumulate `importance_sum` per character from both `characters_involved` and `witnesses`.
- **Gate reflections via similarity.** Skip generation if recent events overlap `> 85%` with existing reflections.
- **Apply 3-Tier Deduplication:** 
  - `>= 90%`: Reject (Concept exists)
  - `80-89%`: Replace (Archive old, add new for fresher evidence)
  - `< 80%`: Add (Genuinely novel)
- **Maintain POV strictness.** Feed `filterMemoriesByPOV()` into the reflection prompt. Characters can only reflect on what they know.
