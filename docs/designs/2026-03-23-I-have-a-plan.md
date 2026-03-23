You have executed a textbook, systematic rescue of a tightly-coupled vanilla JS codebase. By pushing dependencies (`getDeps()`) and side-effects (`fetch`, ST Vector syncing) to the orchestrator edges, you are successfully implementing the **Hexagonal Architecture (Ports and Adapters)** pattern. 

As you noted, the remaining complexity is concentrated in a few "God functions" and "Junk drawer" files that violate the Single Responsibility Principle (SRP). 

Here is the high-level roadmap for the next three phases, followed by the detailed design document for **PR 4**.

---

### Refactoring Roadmap

*   **Phase 4 (Next): Deconstruct the Extraction God-Function.** `extract.js:extractMemories` is a ~200-line procedural script that interleaves LLM network calls, JSON parsing, data enrichment, deduplication math, graph mutations, and storage syncing. It needs to be shattered into cohesive, testable pipeline stages.
*   **Phase 5: Nuke the `data.js` Junk Drawer.** `data.js` currently mixes local JSON storage manipulation (`getOpenVaultData`, `updateMemory`) with external REST API wrappers (`querySTVector`, `syncItemsToST`). The REST wrappers belong in a dedicated `services/st-vector-api.js` adapter.
*   **Phase 6: Unify State Management.** Concurrency locks are split. `worker.js` tracks `isRunning`, while `state.js` tracks `operationState.extractionInProgress`. Consolidating this into a single State Machine will prevent race conditions between background extraction and UI-triggered Emergency Cuts.

---

Here is the actionable design document for PR 4.

# PR 4: Deconstruct the Extraction God-Function

## Goal
Break down the monolithic `extract.js:extractMemories` function into discrete pipeline stages. Transform `extract.js` from a dense procedural script into a clean, high-level orchestrator. 

**Non-goals:** No changes to extraction prompts, LLM parameters, deduplication math, or graph logic. The actual business rules remain identical; we are purely reorganizing the code blocks into pure(r) functions. No new files required (keep it within `extract.js`).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pipeline Pattern | Extract 4 internal functions | Separates LLM I/O from local data enrichment and deduplication. Makes each stage independently unit-testable. |
| Scope | `extract.js` only | Avoids creating a sprawling `pipeline/` directory structure. Internal functions are perfectly fine for this phase. |
| Error Handling | Bubble up to Orchestrator | The orchestrator (`extractMemories`) retains the `try/catch` blocks to manage the `status: 'failed'` vs `status: 'success'` lifecycle. |
| Test Impact | Unlocks pure unit testing | You will be able to test event enrichment, ID stamping, and Graph processing without mocking `callLLM` or `fetch`. |

## File-by-File Changes

### 1. `src/extraction/extract.js`

We will create four new `async function` blocks above or below `extractMemories`. 

#### Stage 1: `fetchEventsFromLLM`
**Responsibility:** Pure LLM I/O and Parsing.
**Signature:**
```javascript
async function fetchEventsFromLLM(messagesText, contextParams, settings, abortSignal)
// Returns: { events }
```
*   Moves `buildEventExtractionPrompt`, `callLLM`, and `parseEventExtractionResponse`.

#### Stage 2: `fetchGraphFromLLM`
**Responsibility:** Pure LLM I/O and Parsing.
**Signature:**
```javascript
async function fetchGraphFromLLM(messagesText, formattedEvents, contextParams, settings, abortSignal)
// Returns: { entities, relationships }
// Internal: Wraps its own try/catch to swallow graph errors (graceful degradation), returning empty arrays on fail.
```

#### Stage 3: `processAndDedupEvents`
**Responsibility:** Data enrichment, ID stamping, Embedding generation, and Deduplication.
**Signature:**
```javascript
async function processAndDedupEvents(rawEvents, messageIdsArray, batchId, existingMemories, settings, abortSignal)
// Returns: { processedEvents }
```
*   Moves the `event.map(...)` block (adding `id`, `sequence`, `created_at`, `tokens`).
*   Moves the `enrichEventsWithEmbeddings` call.
*   Moves the `filterSimilarEvents` (dedup) call.

#### Stage 4: `processGraphUpdates`
**Responsibility:** Iterating over entities/relationships, applying them to the graph, and collecting sync payloads.
**Signature:**
```javascript
async function processGraphUpdates(graphData, entities, relationships, settings)
// Returns: { graphSyncChanges: { toSync: [], toDelete: [] } }
```
*   Moves the `mergeOrInsertEntity` and `upsertRelationship` loops.

#### The Orchestrator: `extractMemories`
With the heavy lifting extracted, `extractMemories` becomes a beautiful, readable orchestrator:

```javascript
export async function extractMemories(messageIds = null, targetChatId = null, options = {}) {
    // ... initial guards and batch setup ...
    
    try {
        // 1. Fetch Events
        const { events: rawEvents } = await fetchEventsFromLLM(messagesText, contextParams, settings, abortSignal);
        
        // 2. Fetch Graph (only if events found)
        let rawGraph = { entities: [], relationships: [] };
        if (rawEvents.length > 0) {
            await rpmDelay(settings, 'Inter-call rate limit');
            const formattedEvents = rawEvents.map((e, i) => `${i + 1}. [${e.importance}★] ${e.summary}`);
            rawGraph = await fetchGraphFromLLM(messagesText, formattedEvents, contextParams, settings, abortSignal);
        }

        // 3. Process & Dedup Events
        const finalEvents = await processAndDedupEvents(rawEvents, messageIdsArray, batchId, data.memories, settings, abortSignal);
        
        // 4. Process Graph Updates
        let graphSyncChanges = { toSync: [], toDelete: [] };
        if (finalEvents.length > 0) {
            // Only update graph if we actually kept events after dedup
            graphSyncChanges = await processGraphUpdates(data.graph, rawGraph.entities, rawGraph.relationships, settings);
            data.graph_message_count = (data.graph_message_count || 0) + messages.length;
            delete data.graph._mergeRedirects;
        }

        // 5. Phase 1 Commit (Memory push, processed IDs push, ST Sync)
        // ... (Commit logic stays here, it's short and orchestrator-focused) ...

        // 6. Phase 2 (Reflections & Communities)
        // ... (Already cleanly separated into runPhase2Enrichment) ...
        
        return { status: 'success', events_created: finalEvents.length, messages_processed: messages.length };
        
    } catch (error) {
        // ... error handling ...
    }
}
```

## Execution Order

| Step | Action | Risk | Test Impact |
|------|--------|------|-------------|
| 1 | Extract `processGraphUpdates` | Low | Move graph loops out. Update `extract.test.js` to ensure graph nodes still populate. |
| 2 | Extract `processAndDedupEvents` | Medium | Move ID stamping, `enrichEventsWithEmbeddings`, and `filterSimilarEvents`. Verify properties like `batch_id` and `sequence` are still assigned correctly. |
| 3 | Extract `fetchEventsFromLLM` & `fetchGraphFromLLM` | Low | Pure code movement of prompt building and `callLLM`. |
| 4 | Refactor `extractMemories` | Medium | Rewire the function to call the 4 new steps. Tests should pass immediately if steps 1-3 were done correctly. |

## Verification

- `npm run test:extract` stays green throughout.
- The `extractMemories` function shrinks from ~200 lines to ~50 lines of highly readable orchestration logic.
- Graceful degradation remains intact (if `fetchGraphFromLLM` throws, it catches internally and returns empty arrays, allowing `extractMemories` to proceed with just the events).
- `AbortError` propagation remains intact (mid-request cancellations from Emergency Cut still bubble up correctly).