# Design: Backfill Phase 2 Defer

## 1. Problem Statement

Currently, `extract.js` triggers Phase 2 (Reflections & Communities) on **every batch** that crosses the message threshold during backfill. This is a massive waste of LLM tokens and API limits:

- **Reflections**: Triggered whenever `importance_sum >= 40` per character
- **Communities**: Triggered every 50 messages (configurable via `communityDetectionInterval`)

When backfilling 1,000 messages, this results in:
- ~20 Community LLM calls (one per 50-message batch)
- Multiple Reflection generation calls spread across batches
- Summarizing a partially-built graph multiple times wastes tokens

The root cause is treating backfill (machine-speed batch processing) the same as live operation (human-speed chat).

## 2. Goals & Non-Goals

### Must do:
- Add `isBackfill` flag to `extractMemories()` function
- Skip Phase 2 (Reflections and Community detection) during backfill loop
- Run **one** comprehensive Reflection generation at backfill completion
- Run **one** Louvain Community detection and summarization at backfill completion
- Keep background worker unchanged (per-batch Phase 2 for live chat)
- Extract Phase 2 logic into a reusable helper function

### Won't do:
- Change Phase 2 logic or algorithms
- Modify Phase 1 (Events + Entities) behavior
- Change community detection interval or reflection thresholds
- Modify the worker's normal operation behavior

## 3. Proposed Architecture

### High-level Approach

**Option A (Selected): Boolean Flag + Helper Extraction**
- Add `isBackfill: boolean` to the existing `options` parameter in `extractMemories()`
- Extract Phase 2 logic into `runPhase2Enrichment(data, settings, targetChatId)` helper
- In `extractAllMessages()`: Pass `{ isBackfill: true }` during loop, call helper after loop
- In worker: Continue calling `extractMemories()` without flag (default `isBackfill: false`)

**Why this approach:**
- Cleanest, most DRY implementation
- Minimal code changes (no duplication)
- Already have `options = {}` pattern with `options.silent`
- Preserves existing behavior for worker

### Key Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    extractMemories()                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ PHASE 1: Events + Graph (always runs)                     │  │
│  │  - Stage A: Event Extraction (LLM)                        │  │
│  │  - Stage B: Graph Extraction (LLM)                        │  │
│  │  - Graph Update: Upsert nodes/edges                       │  │
│  │  - INTERMEDIATE SAVE                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ PHASE 2: Enrichment                                       │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │ STEP 1: Cheap Math (ALWAYS runs, even in backfill)  │  │  │
│  │  │  - accumulateImportance() for reflection_state      │  │  │
│  │  │  - Track graph_message_count for communities        │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │ if (options.isBackfill === true) { SKIP LLM & RETURN }│ │  │
│  │  │  // Bail out AFTER math, BEFORE expensive LLM calls │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │ STEP 2: LLM Generation (Worker only)                │  │  │
│  │  │  - Reflection: If importance_sum >= threshold       │  │  │
│  │  │  - Communities: Every N messages (interval check)   │  │  │
│  │  │  - FINAL SAVE                                       │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    extractAllMessages()                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ while (batches remain) {                                  │  │
│  │   extractMemories(batch, chatId, { isBackfill: true })    │  │
│  │   // Phase 1 + Phase 2 Math (state accumulates)          │  │
│  │   // No LLM calls for Reflections/Communities            │  │
│  │ }                                                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ // UX: Update toast so user knows it's still working      │  │
│  │ $('.openvault-backfill-toast .toast-message').text(       │  │
│  │   `Backfill: 100% - Synthesizing world state...`          │  │
│  │ );                                                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ runPhase2Enrichment(data, settings, chatId)               │  │
│  │  // Reads global state (reflection_state, graph)          │  │
│  │  // Reflections: All chars with importance_sum >= thresh  │  │
│  │  // Communities: Force-run unconditionally                │  │
│  │  // ONE comprehensive synthesis, not per-batch            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Critical Implementation Detail: State Accumulation vs LLM Generation

**Why the `isBackfill` guard must come AFTER `accumulateImportance()`:**

Phase 2 has two distinct parts:
1. **Cheap Math** (CPU-only): `accumulateImportance()`, tracking `prevCount/currCount`
2. **Expensive LLM** (API calls): `generateReflections()`, `detectCommunities()`, `updateCommunitySummaries()`

If we skip Phase 2 entirely at the top, `importance_sum` never increments, and the final `runPhase2Enrichment()` won't know which characters need reflections.

**Solution:** Let the loop run the cheap math, bail out before LLM calls.

```javascript
// ===== PHASE 2: Enrichment (non-critical) =====
try {
    // 1. Always do the cheap math (even during backfill)
    if (events.length > 0) {
        initGraphState(data);
        accumulateImportance(data.reflection_state, events);
    }

    // --> NEW: Bail out here if backfilling <--
    if (options.isBackfill) {
        logDebug('Backfill mode: skipping LLM synthesis for this batch');
        return { status: 'success', events_created: events.length, messages_processed: messages.length };
    }

    // 2. Expensive LLM Generation (Worker only)
    // ... [shouldReflect check] ...
    // ... [generateReflections] ...
    // ... [detectCommunities] ...
```

**Final Phase 2 reads from global state, not passed events:**
- `runPhase2Enrichment()` iterates `Object.keys(data.reflection_state)`
- For any char with `importance_sum >= threshold`, run `generateReflections()`
- For communities: Force-run unconditionally (skip interval check) because we know the graph just changed massively

## 4. Data Models / Schema

No schema changes required. Uses existing `chatMetadata.openvault`:

```typescript
// Existing fields, no changes
{
  memories: [...],           // Events and reflections
  graph: { nodes, edges },
  communities: { ... },
  reflection_state: { "Name": { importance_sum: number } },
  processed_message_ids: number[],
  graph_message_count: number
}
```

## 5. Interface / API Design

### Function Signature Changes

**Before:**
```typescript
export async function extractMemories(
    messageIds: number[] | null,
    targetChatId: string | null,
    options: { silent?: boolean }
): Promise<Result>
```

**After:**
```typescript
export async function extractMemories(
    messageIds: number[] | null,
    targetChatId: string | null,
    options: {
        silent?: boolean;
        isBackfill?: boolean;  // NEW: Skip Phase 2 if true
    }
): Promise<Result>
```

### New Helper Function

```typescript
/**
 * Run Phase 2 enrichment (Reflections & Communities) independently
 * Used after backfill completes to run comprehensive synthesis once
 *
 * @param {Object} data - OpenVault data object
 * @param {Object} settings - Extension settings
 * @param {string} targetChatId - Chat ID for change detection
 * @returns {Promise<void>}
 */
export async function runPhase2Enrichment(data, settings, targetChatId): Promise<void>
```

### Usage in Backfill

```typescript
// In extractAllMessages() - during loop
const result = await extractMemories(
    currentBatch,
    targetChatId,
    { isBackfill: true, silent: true }
);

// In extractAllMessages() - after loop
logInfo("Backfill Phase 1 complete. Running final Phase 2 synthesis...");
await runPhase2Enrichment(data, settings, targetChatId);
```

### Usage in Worker (unchanged behavior)

```typescript
// In worker.js - normal operation
await extractMemories(batch, targetChatId, { silent: true });
// isBackfill defaults to false, Phase 2 runs per-batch
```

## 6. Risks & Edge Cases

### Edge Cases

1. **Chat switch during final Phase 2**
   - Risk: User switches chats while backfill Phase 2 runs
   - Mitigation: `runPhase2Enrichment()` uses `saveOpenVaultData(targetChatId)` which throws on chat change
   - Result: Partial Phase 2 data saved, Phase 1 (events) safe

2. **Abort during final Phase 2**
   - Risk: User aborts during final Reflection/Community generation
   - Mitigation: `AbortError` propagates, logged as "Phase 2 failed but Phase 1 data is safe"
   - Result: Phase 1 complete, Phase 2 can be re-run manually later

3. **Empty memories at backfill completion**
   - Risk: No events extracted, calling Phase 2 with empty data
   - Mitigation: Guard check in `runPhase2Enrichment()` - return early if `memories.length === 0`
   - Result: No-op, no wasted API calls

4. **API failure during final Phase 2**
   - Risk: Large Phase 2 call fails (timeout, rate limit)
   - Mitigation: Phase 2 already wrapped in try/catch, errors logged, Phase 1 committed
   - Result: User can manually trigger "Backfill Embeddings" or re-run backfill

5. **Concurrent backfill + worker interaction**
   - Risk: Worker wakes up during backfill and processes a batch
   - Mitigation: `operationState.extractionInProgress` guard in worker (already exists)
   - Result: Worker yields, doesn't interfere

### What happens if...

| Scenario | Behavior |
|----------|----------|
| Network fails during batch | Retry with exponential backoff (existing behavior) |
| Network fails during final Phase 2 | Error logged, Phase 1 data safe, user can re-run |
| Input messageIds is empty | Returns `{ status: 'skipped', reason: 'no_new_messages' }` |
| Settings change mid-backfill | Uses settings from start of batch (acceptable) |
| No events extracted in entire backfill | Toast shows "No significant events found", Phase 2 skipped |

## 7. Implementation Checklist

- [ ] **CRITICAL**: Place `isBackfill` check **AFTER** `accumulateImportance()` but **BEFORE** LLM calls
- [ ] Extract Phase 2 LLM logic (lines ~373-435) into `runPhase2Enrichment()` helper
- [ ] `runPhase2Enrichment()` reads from `data.reflection_state` (no events parameter needed)
- [ ] `runPhase2Enrichment()` force-runs community detection (skip `communityInterval` check)
- [ ] Update `extractAllMessages()` to pass `{ isBackfill: true, silent: true }`
- [ ] Add `runPhase2Enrichment()` call after backfill loop completes
- [ ] **UX**: Update toast before final Phase 2: `"Backfill: 100% - Synthesizing world state and reflections..."`
- [ ] Add guard check for empty memories in `runPhase2Enrichment()`
- [ ] Test with small backfill (~100 messages) - verify `importance_sum` accumulates
- [ ] Test with large backfill (~1000 messages) - verify only ONE Phase 2 at end
- [ ] Verify worker still runs Phase 2 per-batch during live chat
