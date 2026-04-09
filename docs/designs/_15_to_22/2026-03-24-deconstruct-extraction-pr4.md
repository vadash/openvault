# PR 4: Deconstruct the Extraction God-Function

## Goal

Break `extractMemories` (413 lines) into discrete pipeline stages. Unify the duplicated Phase 2 code between `extractMemories` and `runPhase2Enrichment`. Transform `extract.js` from a dense procedural script into a readable orchestrator.

**Non-goals:** No changes to extraction prompts, LLM parameters, deduplication math, graph logic, or business rules. No new files — all functions stay internal to `extract.js`. No signature changes to the 3 exported orchestrators (`extractMemories`, `runPhase2Enrichment`, `extractAllMessages`).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | 6 internal functions + orchestrator rewire | 4 Phase 1 stages + 2 Phase 2 stages covers all major blocks. |
| Phase 2 unification | Extract `synthesizeReflections` + `synthesizeCommunities` | ~100 lines duplicated between inline Phase 2 and `runPhase2Enrichment`. Shared functions eliminate the copy. |
| Event ST sync | Consolidate into `applySyncChanges` | Currently manual inline code (17 lines) separate from graph sync. Use the same `stChanges` pattern for consistency. |
| `contextParams` | Plain object built once in orchestrator | Avoids repeating `characterName`, `preamble`, `prefill`, etc. across both fetch functions. |
| Exports | No changes | All 6 new functions are internal (not exported). External API is identical. |
| Testing | Existing tests cover via orchestrators | New functions are internal. Orchestrator integration tests (already locked at 3–5) validate the pipeline end-to-end. |

## `contextParams` Shape

Built once in `extractMemories`, passed to both fetch functions:

```js
const contextParams = {
    messagesText,                // formatted "[Speaker]: message" text
    names: { char, user },       // character + user display names
    charDesc,                    // character description from context
    personaDesc,                 // persona description from powerUserSettings
    preamble,                    // resolved extraction preamble (CN/EN)
    prefill,                     // resolved assistant prefill preset
    outputLanguage,              // resolved output language
};
```

## New Internal Functions

### Stage 1: `fetchEventsFromLLM(contextParams, existingMemories, abortSignal)`

**Responsibility:** Prompt building + LLM call + response parsing for events.

**Returns:** `{ events: Array }`

Moves:
- `buildEventExtractionPrompt(...)` call
- `callLLM(prompt, LLM_CONFIGS.extraction_events, ...)` call
- `record('llm_events', ...)` timing
- `parseEventExtractionResponse(json)` call

No settings needed — `contextParams` contains everything for the prompt. LLM config comes from `LLM_CONFIGS` constant.

### Stage 2: `fetchGraphFromLLM(contextParams, formattedEvents, abortSignal)`

**Responsibility:** Prompt building + LLM call + response parsing for graph entities/relationships. Graceful degradation on failure.

**Returns:** `{ entities: Array, relationships: Array }`

Moves:
- `buildGraphExtractionPrompt(...)` call
- `callLLM(prompt, LLM_CONFIGS.extraction_graph, ...)` call
- `record('llm_graph', ...)` timing
- `parseGraphExtractionResponse(json)` call

**Internal try-catch:** Catches non-AbortError, logs warning, returns `{ entities: [], relationships: [] }`. AbortError always re-thrown.

**Note:** `rpmDelay()` stays in the orchestrator (between stage 1 and stage 2 calls). The fetch function is pure I/O, not rate-limit-aware.

### Stage 3: `enrichAndDedupEvents(rawEvents, messageIdsArray, batchId, existingMemories, settings)`

**Responsibility:** Metadata stamping, embedding generation, and deduplication.

**Returns:** `{ events: Array }`

Moves:
- The `events.map(...)` block that adds `id`, `type`, `tokens`, `message_ids`, `sequence`, `created_at`, `batch_id`, defaults for optional fields
- `enrichEventsWithEmbeddings(events)` call
- `filterSimilarEvents(events, existingMemories, ...)` call
- Dedup logging (`Dedup: Filtered N similar events`)

**Does NOT move:** The `embedding_model_id` stamping — that mutates the data store and stays in the orchestrator.

### Stage 4: `processGraphUpdates(graphData, entities, relationships, settings)`

**Responsibility:** Entity upserts, relationship upserts, merge redirect cleanup.

**Returns:** `{ graphSyncChanges: { toSync: Array, toDelete: Array } }`

Moves:
- Entity loop with `mergeOrInsertEntity(...)` + stChanges collection
- `record('entity_merge', ...)` timing
- Relationship loop with `upsertRelationship(...)`
- `delete graphData._mergeRedirects`

**Does NOT move:** `initGraphState(data)` (precondition — orchestrator calls it), `data.graph_message_count` increment (data store mutation — orchestrator owns it).

### Stage 5: `synthesizeReflections(data, characterNames, settings, options)`

**Responsibility:** Check each character for reflection trigger, generate reflections via LLM, push to memories.

**Options:** `{ abortSignal }`

**Mutates:** `data[MEMORIES_KEY]` (pushes reflections), `data.reflection_state[name].importance_sum` (resets to 0).

**Returns:** `Promise<void>`

Moves the shared logic from both:
- Inline Phase 2 (lines 892–916): reflection per-character from new events
- `runPhase2Enrichment` (lines 1023–1055): reflection for all characters

Differences unified via the `characterNames` parameter:
- Inline caller passes: characters derived from new events
- `runPhase2Enrichment` caller passes: `Object.keys(data.reflection_state)`

Includes:
- `createLadderQueue(settings.maxConcurrency)` for concurrency control
- `shouldReflect()` check per character
- `generateReflections()` call
- `applySyncChanges(stChanges)` per character
- Error handling: per-character catch (log and continue), AbortError re-thrown

### Stage 6: `synthesizeCommunities(data, settings, characterName, userName)`

**Responsibility:** Louvain community detection, edge consolidation, community summarization.

**Mutates:** `data.communities`, `data.global_world_state`

**Returns:** `Promise<void>`

Moves the shared logic from both:
- Inline Phase 2 (lines 927–981): community detection with interval check
- `runPhase2Enrichment` (lines 1061–1097): community detection (unconditional)

The **interval check** stays in the orchestrator — this function always runs when called. The orchestrator decides whether to call it:
- `extractMemories`: checks `Math.floor(currCount / interval) > Math.floor(prevCount / interval)`
- `runPhase2Enrichment`: always calls (post-backfill comprehensive run)

Includes:
- `normalizeKey` + `expandMainCharacterKeys` + `findCrossScriptCharacterKeys` for main character derivation
- `detectCommunities(data.graph, mainCharacterKeys)`
- Conditional `consolidateEdges` (if `_edgesNeedingConsolidation` non-empty)
- `buildCommunityGroups` + `updateCommunitySummaries`
- `applySyncChanges` for edge changes and community changes
- Wrapped in try-catch (community errors are non-fatal, logged and swallowed)

## Event ST Sync Cleanup

Currently, event sync is manual inline code (17 lines) separate from the graph sync that uses `applySyncChanges`. Consolidate:

**Before:**
```js
if (isStVectorSource()) {
    const chatId = getCurrentChatId();
    const unsyncedEvents = events.filter((e) => !isStSynced(e));
    if (unsyncedEvents.length > 0) {
        const items = unsyncedEvents.map(e => ({
            hash: cyrb53(`[OV_ID:${e.id}] ${e.summary}`),
            text: `[OV_ID:${e.id}] ${e.summary}`,
            index: 0,
        }));
        const success = await syncItemsToST(items, chatId);
        if (success) {
            for (const e of unsyncedEvents) markStSynced(e);
        }
    }
    await applySyncChanges(graphSyncChanges);
}
```

**After:**
```js
// Build event sync changes using same pattern as graph
const eventSyncChanges = { toSync: [], toDelete: [] };
for (const e of events.filter(e => !isStSynced(e))) {
    const text = `[OV_ID:${e.id}] ${e.summary}`;
    eventSyncChanges.toSync.push({ hash: cyrb53(text), text, item: e });
}

// Single applySyncChanges call for all Phase 1 changes
await applySyncChanges({
    toSync: [...eventSyncChanges.toSync, ...graphSyncChanges.toSync],
    toDelete: [...graphSyncChanges.toDelete],
});
```

`applySyncChanges` already handles the `isStVectorSource()` guard internally. The outer check becomes unnecessary.

## The Orchestrators After Refactoring

### `extractMemories` (~100 lines, down from 413)

```js
export async function extractMemories(messageIds = null, targetChatId = null, options = {}) {
    // Guards (unchanged, ~20 lines)
    // ...

    // Message selection (unchanged, ~25 lines)
    // ...

    const batchId = `batch_${deps.Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const { isBackfill = false, silent = false, abortSignal = null } = options;

    try {
        // Build context params once
        const contextParams = { messagesText, names, charDesc, personaDesc, preamble, prefill, outputLanguage };
        const existingMemories = selectMemoriesForExtraction(data, settings);

        // Stage 1: Event extraction
        const { events: rawEvents } = await fetchEventsFromLLM(contextParams, existingMemories, abortSignal);

        // Stage 2: Graph extraction (skip if no events)
        let graphResult = { entities: [], relationships: [] };
        if (rawEvents.length > 0) {
            await rpmDelay(settings, 'Inter-call rate limit');
            const formattedEvents = rawEvents.map((e, i) => `${i + 1}. [${e.importance}★] ${e.summary}`);
            graphResult = await fetchGraphFromLLM(contextParams, formattedEvents, abortSignal);
        }

        // Stage 3: Enrich & dedup events
        const { events } = await enrichAndDedupEvents(rawEvents, messageIdsArray, batchId, data.memories || [], settings);

        // Stamp embedding model ID (data store concern, stays in orchestrator)
        if (!data.embedding_model_id && events.some(e => hasEmbedding(e))) { /* ... */ }

        // Stage 4: Graph updates
        initGraphState(data);
        const { graphSyncChanges } = await processGraphUpdates(data.graph, graphResult.entities, graphResult.relationships, settings);
        data.graph_message_count = (data.graph_message_count || 0) + messages.length;

        // ===== PHASE 1 COMMIT =====
        if (events.length > 0) {
            canonicalizeEventCharNames(events, [characterName, userName], data.graph?.nodes);
            data[MEMORIES_KEY] = data[MEMORIES_KEY] || [];
            data[MEMORIES_KEY].push(...events);
            updateCharacterStatesFromEvents(events, data, [characterName, userName]);
        }
        // Mark processed, update IDF, save (unchanged, ~10 lines)
        // ST sync: single applySyncChanges call (~6 lines)

        // ===== PHASE 2: Enrichment =====
        try {
            if (events.length > 0) {
                accumulateImportance(data.reflection_state, events);
                if (options.isBackfill) {
                    return { status: 'success', events_created: events.length, messages_processed: messages.length };
                }
                const characters = [...new Set(events.flatMap(e => [...(e.characters_involved || []), ...(e.witnesses || [])]))];
                await synthesizeReflections(data, characters, settings, { abortSignal });
            }
            // Community detection (interval check)
            if (shouldRunCommunityDetection(data, messages.length, settings)) {
                await synthesizeCommunities(data, settings, characterName, userName);
            }
            updateIDFCache(data, data.graph?.nodes);
            await saveOpenVaultData(targetChatId);
        } catch (phase2Error) {
            if (phase2Error.name === 'AbortError') throw phase2Error;
            logError('Phase 2 error', phase2Error);
        }

        return { status: 'success', events_created: events.length, messages_processed: messages.length };
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        logError('Extraction error', error);
        throw error;
    }
}
```

**Note:** `shouldRunCommunityDetection(data, batchMessageCount, settings)` is a tiny inline helper (3 lines) that extracts the `Math.floor` interval check. Optional — could stay inline.

### `runPhase2Enrichment` (~25 lines, down from 113)

```js
export async function runPhase2Enrichment(data, settings, targetChatId, options = {}) {
    const { abortSignal = null } = options;
    if (!data[MEMORIES_KEY]?.length) {
        logDebug('runPhase2Enrichment: No memories to enrich');
        return;
    }
    logDebug('runPhase2Enrichment: Starting comprehensive Phase 2 synthesis');

    try {
        initGraphState(data);
        const characterNames = Object.keys(data.reflection_state || {});
        await synthesizeReflections(data, characterNames, settings, { abortSignal });

        const context = getDeps().getContext();
        await synthesizeCommunities(data, settings, context.name2, context.name1);

        updateIDFCache(data, data.graph?.nodes);
        await saveOpenVaultData(targetChatId);
        logInfo('runPhase2Enrichment: Complete');
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        logError('runPhase2Enrichment failed', error);
        throw error;
    }
}
```

## Execution Order

| Step | Action | Risk | Test Impact |
|------|--------|------|-------------|
| 1 | Extract `synthesizeReflections` + `synthesizeCommunities` | Low | Pure code movement of shared blocks. No export changes. |
| 2 | Refactor `runPhase2Enrichment` to use stages 5-6 | Low | Thin wrapper. Existing 2 tests pass unchanged. |
| 3 | Refactor inline Phase 2 in `extractMemories` to use stages 5-6 | Medium | Behavioral parity with old inline code. Existing 3 tests pass unchanged. |
| 4 | Extract `fetchEventsFromLLM` + `fetchGraphFromLLM` | Low | Pure code movement of prompt + LLM + parse blocks. |
| 5 | Extract `enrichAndDedupEvents` | Medium | Data flow change — events flow through new function. |
| 6 | Extract `processGraphUpdates` | Low | Straightforward loop extraction. |
| 7 | Rewire `extractMemories` orchestrator + event ST sync cleanup | Medium | All stages composed. Tests validate end-to-end. |

Steps 1-3 form a natural unit (Phase 2 unification). Steps 4-6 are independent extractions. Step 7 ties everything together.

## Verification

- `npm run test` green after each step.
- `extractMemories` shrinks from ~413 lines to ~100 lines.
- `runPhase2Enrichment` shrinks from ~113 lines to ~25 lines.
- No export signature changes — external API identical.
- Graceful degradation intact (graph failure → events-only, Phase 2 failure → Phase 1 safe).
- AbortError propagation intact (mid-request cancellation still bubbles up).
- Backfill guard intact (`isBackfill` returns after `accumulateImportance`, before reflections).
- Event + graph ST sync consolidated into single `applySyncChanges` call.
- No `isStVectorSource()` check outside `applySyncChanges` in `extractMemories`.
- Biome lint/format passes (pre-commit hook).
