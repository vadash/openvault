# Deconstruct Extraction God-Function — Implementation Plan

**Goal:** Break `extractMemories` (413 lines) into 6 internal pipeline stages, unify duplicated Phase 2 code, and consolidate ST sync into a single `applySyncChanges` call.

**Architecture:** Extract 4 Phase 1 stages (`fetchEventsFromLLM`, `fetchGraphFromLLM`, `enrichAndDedupEvents`, `processGraphUpdates`) and 2 Phase 2 stages (`synthesizeReflections`, `synthesizeCommunities`) as internal functions in `extract.js`. Wire both `extractMemories` and `runPhase2Enrichment` to call the shared Phase 2 functions. No export signature changes.

**Tech Stack:** Vanilla JS (ESM), Vitest

**Common Pitfalls:**
- The inline Phase 2 shadows outer `characterName` (from `context.name2`) with a loop variable `for (const characterName of characters)`. The extracted `synthesizeReflections` has no such shadowing issue since it receives `characterNames` as a parameter.
- `existingMemories` (from `selectMemoriesForExtraction`) is for the LLM prompt context. Dedup comparison uses `data.memories || []` (ALL memories). Don't mix them up.
- The `validated` object and `_processedIds` variable become dead code after refactoring — delete them.
- `synthesizeCommunities` must use `data.graph_message_count || 0` for the message count param to `updateCommunitySummaries` (both callers already use this value).

**File Structure:**
- Modify: `src/extraction/extract.js` — extract 6 internal functions, rewire orchestrators
- Test: `tests/extraction/extract.test.js` — existing 7 tests, no changes needed

---

### Task 1: Extract `synthesizeReflections` and `synthesizeCommunities` as internal functions

**Files:**
- Modify: `src/extraction/extract.js`

These functions are added but NOT called yet. Zero risk — no behavior changes.

- [ ] Step 1: Run existing tests to establish baseline

Run: `npx vitest tests/extraction/extract.test.js --run`
Expected: all 7 tests PASS

- [ ] Step 2: Add `synthesizeReflections` function

Add this function between `filterSimilarEvents` and `extractMemories` (before line 591):

```js
// =============================================================================
// Pipeline Stage Functions (internal — called by orchestrators below)
// =============================================================================

/**
 * Run reflection synthesis for a list of characters.
 * Checks each character against the reflection threshold, generates reflections via LLM,
 * pushes results to data.memories, and resets the importance accumulator.
 *
 * @param {Object} data - OpenVault data object (mutated in-place)
 * @param {string[]} characterNames - Characters to check for reflection trigger
 * @param {Object} settings - Extension settings
 * @param {Object} [options={}]
 * @param {AbortSignal} [options.abortSignal=null] - Abort signal for cancellation
 */
async function synthesizeReflections(data, characterNames, settings, options = {}) {
    const { abortSignal = null } = options;
    const reflectionThreshold = settings.reflectionThreshold;
    const ladderQueue = await createLadderQueue(settings.maxConcurrency);
    const reflectionPromises = [];

    for (const characterName of characterNames) {
        if (abortSignal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        if (shouldReflect(data.reflection_state, characterName, reflectionThreshold)) {
            reflectionPromises.push(
                ladderQueue
                    .add(async () => {
                        const { reflections, stChanges } = await generateReflections(
                            characterName,
                            data[MEMORIES_KEY] || [],
                            data[CHARACTERS_KEY] || {}
                        );
                        if (reflections.length > 0) {
                            data[MEMORIES_KEY].push(...reflections);
                        }
                        // Reset accumulator after reflection
                        data.reflection_state[characterName].importance_sum = 0;
                        await applySyncChanges(stChanges);
                    })
                    .catch((error) => {
                        if (error.name === 'AbortError') throw error;
                        logError(`Reflection error for ${characterName}`, error);
                    })
            );
        }
    }

    await Promise.all(reflectionPromises);
}
```

- [ ] Step 3: Add `synthesizeCommunities` function

Add this directly after `synthesizeReflections`:

```js
/**
 * Run community detection, edge consolidation, and community summarization.
 * Wrapped in try-catch — community errors are non-fatal and logged.
 *
 * @param {Object} data - OpenVault data object (mutated in-place)
 * @param {Object} settings - Extension settings
 * @param {string} characterName - Main character name (for main character key derivation)
 * @param {string} userName - User name (for main character key derivation)
 */
async function synthesizeCommunities(data, settings, characterName, userName) {
    try {
        const baseKeys = [normalizeKey(characterName), normalizeKey(userName)];
        const mainCharacterKeys = expandMainCharacterKeys(baseKeys, data.graph.nodes || {});
        const crossScriptKeys = findCrossScriptCharacterKeys(baseKeys, data.graph.nodes || {});
        mainCharacterKeys.push(...crossScriptKeys.filter((k) => !mainCharacterKeys.includes(k)));
        const communityResult = detectCommunities(data.graph, mainCharacterKeys);
        if (communityResult) {
            // Consolidate bloated edges before summarization
            if (data.graph._edgesNeedingConsolidation?.length > 0) {
                const { count: consolidated, stChanges: edgeChanges } = await consolidateEdges(data.graph, settings);
                if (consolidated > 0) {
                    logDebug(`Consolidated ${consolidated} graph edges before community summarization`);
                }
                await applySyncChanges(edgeChanges);
            }

            const groups = buildCommunityGroups(data.graph, communityResult.communities);
            const stalenessThreshold = settings.communityStalenessThreshold;
            const isSingleCommunity = communityResult.count === 1;
            const communityUpdateResult = await updateCommunitySummaries(
                data.graph,
                groups,
                data.communities || {},
                data.graph_message_count || 0,
                stalenessThreshold,
                isSingleCommunity
            );
            data.communities = communityUpdateResult.communities;
            if (communityUpdateResult.global_world_state) {
                data.global_world_state = communityUpdateResult.global_world_state;
            }
            await applySyncChanges(communityUpdateResult.stChanges);
            logDebug(`Community detection: ${communityResult.count} communities found`);
        }
    } catch (error) {
        logError('Community detection error', error);
    }
}
```

- [ ] Step 4: Run tests to verify no regressions

Run: `npx vitest tests/extraction/extract.test.js --run`
Expected: all 7 tests PASS (functions exist but are uncalled)

- [ ] Step 5: Commit

```bash
git add src/extraction/extract.js && git commit -m "$(cat <<'EOF'
refactor(extract): add synthesizeReflections and synthesizeCommunities internal functions

Pure code extraction — functions added but not wired to callers yet.
These will replace duplicated Phase 2 logic in extractMemories and runPhase2Enrichment.
EOF
)"
```

---

### Task 2: Refactor `runPhase2Enrichment` to use shared Phase 2 functions

**Files:**
- Modify: `src/extraction/extract.js`

Replace the 80+ lines of inline reflection + community code in `runPhase2Enrichment` with calls to `synthesizeReflections` and `synthesizeCommunities`.

- [ ] Step 1: Replace the `runPhase2Enrichment` function body

Replace the entire `runPhase2Enrichment` function (from `export async function runPhase2Enrichment` through its closing brace) with:

```js
export async function runPhase2Enrichment(data, settings, targetChatId, options = {}) {
    const { abortSignal = null } = options;

    // Guard: No memories to enrich
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

        // Update IDF cache before save — reflections may have been added
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

Delete both duplicate JSDoc blocks above the old function (there are two `@param` blocks due to a prior edit).

- [ ] Step 2: Run tests to verify behavioral parity

Run: `npx vitest tests/extraction/extract.test.js --run`
Expected: all 7 tests PASS

- [ ] Step 3: Commit

```bash
git add src/extraction/extract.js && git commit -m "$(cat <<'EOF'
refactor(extract): wire runPhase2Enrichment to shared Phase 2 functions

Replaces ~80 lines of inline reflection + community code with calls to
synthesizeReflections and synthesizeCommunities. 113 → ~25 lines.
EOF
)"
```

---

### Task 3: Refactor `extractMemories` inline Phase 2 to use shared functions

**Files:**
- Modify: `src/extraction/extract.js`

Replace the inline Phase 2 block (~120 lines) in `extractMemories` with calls to `synthesizeReflections` and `synthesizeCommunities`.

- [ ] Step 1: Replace the Phase 2 block in `extractMemories`

Find the block starting with `// ===== PHASE 2: Enrichment (non-critical) =====` and ending just before `if (events.length > 0) { logInfo(`. Replace the entire Phase 2 try-catch block with:

```js
        // ===== PHASE 2: Enrichment (non-critical) =====
        try {
            // Stage 5: Reflection check (per character in new events)
            if (events.length > 0) {
                initGraphState(data); // Ensures reflection_state exists
                accumulateImportance(data.reflection_state, events);

                // ===== Backfill guard: skip Phase 2 LLM synthesis =====
                if (options.isBackfill) {
                    logDebug('Backfill mode: skipping Phase 2 LLM synthesis for this batch');
                    return { status: 'success', events_created: events.length, messages_processed: messages.length };
                }
                // ===== END BACKFILL GUARD =====

                // Collect unique characters from new events
                const characters = new Set();
                for (const event of events) {
                    for (const c of event.characters_involved || []) characters.add(c);
                    for (const w of event.witnesses || []) characters.add(w);
                }

                await synthesizeReflections(data, [...characters], settings, { abortSignal });
            }

            // Stage 6: Community detection (interval check)
            const communityInterval = settings.communityDetectionInterval;
            const prevCount = (data.graph_message_count || 0) - messages.length;
            const currCount = data.graph_message_count || 0;
            if (Math.floor(currCount / communityInterval) > Math.floor(prevCount / communityInterval)) {
                await synthesizeCommunities(data, settings, characterName, userName);
            }

            // Final save — Phase 2 enrichment persisted
            // Update IDF cache before save — reflections/communities may have been added
            updateIDFCache(data, data.graph?.nodes);
            await saveOpenVaultData(targetChatId);
        } catch (phase2Error) {
            // AbortError must propagate — it's not a Phase 2 failure, it's a session cancel
            if (phase2Error.name === 'AbortError') throw phase2Error;

            logError('Phase 2 error', phase2Error, { characterName });
            logDebug(`Phase 2 failed but Phase 1 data is safe: ${phase2Error.message}`);
            // Do NOT re-throw. Phase 1 data is already saved.
        }
```

- [ ] Step 2: Run tests to verify behavioral parity

Run: `npx vitest tests/extraction/extract.test.js --run`
Expected: all 7 tests PASS

- [ ] Step 3: Run full test suite to catch any cross-module regressions

Run: `npm run test`
Expected: all tests PASS

- [ ] Step 4: Commit

```bash
git add src/extraction/extract.js && git commit -m "$(cat <<'EOF'
refactor(extract): wire extractMemories Phase 2 to shared functions

Replaces ~120 lines of inline reflection + community code with calls to
synthesizeReflections and synthesizeCommunities. Phase 2 unification complete.
EOF
)"
```

---

### Task 4: Extract `fetchEventsFromLLM` and `fetchGraphFromLLM` as internal functions

**Files:**
- Modify: `src/extraction/extract.js`

These functions are added but NOT called yet. Zero risk.

- [ ] Step 1: Add `fetchEventsFromLLM` function

Add this in the "Pipeline Stage Functions" section (after `synthesizeCommunities`, before `extractMemories`):

```js
/**
 * Stage 1: Call LLM for event extraction and parse the response.
 *
 * @param {Object} contextParams - Shared context (messagesText, names, charDesc, personaDesc, preamble, prefill, outputLanguage)
 * @param {Array} existingMemories - Curated memory subset for prompt context
 * @param {AbortSignal} [abortSignal] - Abort signal for mid-request cancellation
 * @returns {Promise<{events: Array}>}
 */
async function fetchEventsFromLLM(contextParams, existingMemories, abortSignal) {
    const prompt = buildEventExtractionPrompt({
        messages: contextParams.messagesText,
        names: contextParams.names,
        context: {
            memories: existingMemories,
            charDesc: contextParams.charDesc,
            personaDesc: contextParams.personaDesc,
        },
        preamble: contextParams.preamble,
        prefill: contextParams.prefill,
        outputLanguage: contextParams.outputLanguage,
    });

    const t0 = performance.now();
    const eventJson = await callLLM(prompt, LLM_CONFIGS.extraction_events, {
        structured: true,
        signal: abortSignal,
    });
    record('llm_events', performance.now() - t0);
    return parseEventExtractionResponse(eventJson);
}
```

- [ ] Step 2: Add `fetchGraphFromLLM` function

Add this directly after `fetchEventsFromLLM`:

```js
/**
 * Stage 2: Call LLM for graph extraction and parse the response.
 * Graceful degradation — catches non-AbortError and returns empty arrays.
 *
 * @param {Object} contextParams - Shared context
 * @param {string[]} formattedEvents - Pre-formatted event strings for the prompt
 * @param {AbortSignal} [abortSignal] - Abort signal for mid-request cancellation
 * @returns {Promise<{entities: Array, relationships: Array}>}
 */
async function fetchGraphFromLLM(contextParams, formattedEvents, abortSignal) {
    try {
        const prompt = buildGraphExtractionPrompt({
            messages: contextParams.messagesText,
            names: contextParams.names,
            extractedEvents: formattedEvents,
            context: {
                charDesc: contextParams.charDesc,
                personaDesc: contextParams.personaDesc,
            },
            preamble: contextParams.preamble,
            prefill: contextParams.prefill,
            outputLanguage: contextParams.outputLanguage,
        });

        const t0 = performance.now();
        const graphJson = await callLLM(prompt, LLM_CONFIGS.extraction_graph, {
            structured: true,
            signal: abortSignal,
        });
        record('llm_graph', performance.now() - t0);
        return parseGraphExtractionResponse(graphJson);
    } catch (error) {
        // AbortError = session cancel (chat switch) — must propagate
        if (error.name === 'AbortError') throw error;
        logError('Graph extraction failed, continuing with events only', error);
        return { entities: [], relationships: [] };
    }
}
```

- [ ] Step 3: Run tests

Run: `npx vitest tests/extraction/extract.test.js --run`
Expected: all 7 tests PASS

- [ ] Step 4: Commit

```bash
git add src/extraction/extract.js && git commit -m "$(cat <<'EOF'
refactor(extract): add fetchEventsFromLLM and fetchGraphFromLLM internal functions

Pure code extraction — LLM I/O + parsing moved to focused functions.
Not wired to callers yet.
EOF
)"
```

---

### Task 5: Extract `enrichAndDedupEvents` as internal function

**Files:**
- Modify: `src/extraction/extract.js`

Function added but NOT called yet. Zero risk.

- [ ] Step 1: Add `enrichAndDedupEvents` function

Add this after `fetchGraphFromLLM`:

```js
/**
 * Stage 3: Stamp metadata on raw events, enrich with embeddings, and deduplicate.
 *
 * @param {Array} rawEvents - Events from LLM (no metadata yet)
 * @param {number[]} messageIdsArray - Source message IDs for this batch
 * @param {string} batchId - Unique batch identifier
 * @param {Array} existingMemories - All existing memories (for dedup comparison)
 * @param {Object} settings - Extension settings
 * @returns {Promise<{events: Array}>}
 */
async function enrichAndDedupEvents(rawEvents, messageIdsArray, batchId, existingMemories, settings) {
    const minMessageId = Math.min(...messageIdsArray);

    let events = rawEvents.map((event, index) => ({
        id: `event_${Date.now()}_${index}`,
        type: 'event',
        ...event,
        tokens: tokenize(event.summary || ''),
        message_ids: messageIdsArray,
        sequence: minMessageId * 1000 + index,
        created_at: Date.now(),
        batch_id: batchId,
        characters_involved: event.characters_involved || [],
        witnesses: event.witnesses || event.characters_involved || [],
        location: event.location || null,
        is_secret: event.is_secret || false,
        importance: event.importance || 3,
        emotional_impact: event.emotional_impact || {},
        relationship_impact: event.relationship_impact || {},
    }));

    if (events.length > 0) {
        await enrichEventsWithEmbeddings(events);

        const dedupThreshold = settings.dedupSimilarityThreshold;
        const jaccardThreshold = settings.dedupJaccardThreshold;
        const preDedupCount = events.length;
        events = await filterSimilarEvents(events, existingMemories, dedupThreshold, jaccardThreshold);

        if (events.length < preDedupCount) {
            logDebug(`Dedup: Filtered ${preDedupCount - events.length} similar events`);
        }
    }

    return { events };
}
```

- [ ] Step 2: Run tests

Run: `npx vitest tests/extraction/extract.test.js --run`
Expected: all 7 tests PASS

- [ ] Step 3: Commit

```bash
git add src/extraction/extract.js && git commit -m "$(cat <<'EOF'
refactor(extract): add enrichAndDedupEvents internal function

Metadata stamping + embedding enrichment + dedup in one focused function.
Not wired to callers yet.
EOF
)"
```

---

### Task 6: Extract `processGraphUpdates` as internal function

**Files:**
- Modify: `src/extraction/extract.js`

Function added but NOT called yet. Zero risk.

- [ ] Step 1: Add `processGraphUpdates` function

Add this after `enrichAndDedupEvents`:

```js
/**
 * Stage 4: Upsert entities and relationships into the graph, collect ST sync changes.
 *
 * @param {Object} graphData - Graph data object (mutated in-place)
 * @param {Array} entities - Entities from graph extraction
 * @param {Array} relationships - Relationships from graph extraction
 * @param {Object} settings - Extension settings
 * @returns {Promise<{graphSyncChanges: {toSync: Array, toDelete: Array}}>}
 */
async function processGraphUpdates(graphData, entities, relationships, settings) {
    const graphSyncChanges = { toSync: [], toDelete: [] };

    if (entities?.length) {
        const entityCap = settings.entityDescriptionCap;
        const t0Merge = performance.now();
        const existingNodeCount = Object.keys(graphData.nodes).length;
        for (const entity of entities) {
            if (entity.name === 'Unknown') continue;
            const { stChanges: entityChanges } = await mergeOrInsertEntity(
                graphData,
                entity.name,
                entity.type,
                entity.description,
                entityCap,
                settings
            );
            graphSyncChanges.toSync.push(...entityChanges.toSync);
            graphSyncChanges.toDelete.push(...entityChanges.toDelete);
        }
        record(
            'entity_merge',
            performance.now() - t0Merge,
            `${entities.length}×${existingNodeCount} nodes`
        );
    }

    if (relationships?.length) {
        const edgeCap = settings.edgeDescriptionCap;
        for (const rel of relationships) {
            if (rel.source === 'Unknown' || rel.target === 'Unknown') continue;
            upsertRelationship(graphData, rel.source, rel.target, rel.description, edgeCap);
        }
    }

    // Clean up runtime-only merge redirects (don't persist to storage)
    delete graphData._mergeRedirects;
    return { graphSyncChanges };
}
```

- [ ] Step 2: Run tests

Run: `npx vitest tests/extraction/extract.test.js --run`
Expected: all 7 tests PASS

- [ ] Step 3: Commit

```bash
git add src/extraction/extract.js && git commit -m "$(cat <<'EOF'
refactor(extract): add processGraphUpdates internal function

Entity + relationship upserts with ST sync change collection.
Not wired to callers yet.
EOF
)"
```

---

### Task 7: Rewire `extractMemories` Phase 1 to use stage functions + ST sync cleanup

**Files:**
- Modify: `src/extraction/extract.js`

This is the big rewire. Replace the Phase 1 body of `extractMemories` (from "Stage 2: Prompt Building" through the ST sync block) with calls to the 4 stage functions.

- [ ] Step 1: Replace the Phase 1 body of `extractMemories`

Find the block from `// Stage 2: Prompt Building` (the line `const characterName = context.name2;`) through the end of the ST sync block (the line `await applySyncChanges(graphSyncChanges);` inside the `if (isStVectorSource())` block, plus the closing brace `}`). Replace this entire section with:

```js
        // Build context params once
        const characterName = context.name2;
        const userName = context.name1;

        const messagesText = messages
            .map((m) => {
                const speaker = m.is_user ? userName : m.name || characterName;
                return `[${speaker}]: ${m.mes}`;
            })
            .join('\n\n');

        const characterDescription = context.characters?.[context.characterId]?.description || '';
        const personaDescription = context.powerUserSettings?.persona_description || '';
        const contextParams = {
            messagesText,
            names: { char: characterName, user: userName },
            charDesc: characterDescription,
            personaDesc: personaDescription,
            preamble: resolveExtractionPreamble(settings),
            prefill: resolveExtractionPrefill(settings),
            outputLanguage: resolveOutputLanguage(settings),
        };

        // Stage 1: Event extraction (LLM call)
        const existingMemories = selectMemoriesForExtraction(data, settings);
        const { events: rawEvents } = await fetchEventsFromLLM(contextParams, existingMemories, abortSignal);

        // Stage 2: Graph extraction (LLM call, skip if no events)
        let graphResult = { entities: [], relationships: [] };
        if (rawEvents.length > 0) {
            await rpmDelay(settings, 'Inter-call rate limit');
            const formattedEvents = rawEvents.map((e, i) => `${i + 1}. [${e.importance}★] ${e.summary}`);
            graphResult = await fetchGraphFromLLM(contextParams, formattedEvents, abortSignal);
        }

        // Stage 3: Enrich & dedup events
        const messageIdsArray = messages.map((m) => m.id);
        logDebug(`LLM returned ${rawEvents.length} events from ${messages.length} messages`);
        const { events } = await enrichAndDedupEvents(rawEvents, messageIdsArray, batchId, data.memories || [], settings);

        // Stamp embedding model ID on first successful embedding generation
        if (events.length > 0 && !data.embedding_model_id && events.some((e) => hasEmbedding(e))) {
            data.embedding_model_id = settings.embeddingSource;
            if (settings.embeddingSource === 'st_vector') {
                const { stampStVectorFingerprint } = await import('../utils/data.js');
                stampStVectorFingerprint(data);
            }
        }

        // Stage 4: Graph updates
        initGraphState(data);
        const { graphSyncChanges } = await processGraphUpdates(
            data.graph, graphResult.entities, graphResult.relationships, settings
        );
        data.graph_message_count = (data.graph_message_count || 0) + messages.length;

        // ===== PHASE 1 COMMIT: Events + Graph are done =====
        if (events.length > 0) {
            // Canonicalize cross-script character names before downstream consumption
            canonicalizeEventCharNames(events, [characterName, userName], data.graph?.nodes);
            data[MEMORIES_KEY] = data[MEMORIES_KEY] || [];
            data[MEMORIES_KEY].push(...events);
            updateCharacterStatesFromEvents(events, data, [characterName, userName]);
        }

        // Mark processed AFTER events are committed to memories
        const processedFps = messages.map((m) => getFingerprint(m));
        data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
        data[PROCESSED_MESSAGES_KEY].push(...processedFps);
        logDebug(`Phase 1 complete: ${events.length} events, ${processedFps.length} messages processed`);

        // Update IDF cache after Phase 1 commit — corpus has changed
        updateIDFCache(data, data.graph?.nodes);

        // Intermediate save — Phase 1 data is now persisted
        const phase1Saved = await saveOpenVaultData(targetChatId);
        if (!phase1Saved && targetChatId) {
            throw new Error('Chat changed during extraction');
        }

        // Sync events + graph to ST Vector Storage (single applySyncChanges call)
        const eventSyncChanges = { toSync: [], toDelete: [] };
        for (const e of events.filter((e) => !isStSynced(e))) {
            const text = `[OV_ID:${e.id}] ${e.summary}`;
            eventSyncChanges.toSync.push({ hash: cyrb53(text), text, item: e });
        }
        await applySyncChanges({
            toSync: [...eventSyncChanges.toSync, ...graphSyncChanges.toSync],
            toDelete: [...graphSyncChanges.toDelete],
        });
```

Note: The `events` variable changes from `let` to `const` (destructured from `enrichAndDedupEvents` return). The reassignment `events = events.map(...)` and `events = await filterSimilarEvents(...)` now happen inside `enrichAndDedupEvents`. Verify no later code reassigns `events` — the Phase 1 commit and Phase 2 sections only read it.

- [ ] Step 2: Remove dead variables

Delete the unused `_processedIds` line and the `validated` object. These are now handled inside the stage functions.

The `_processedIds` line was:
```js
        // Track processed message IDs (will be committed in Phase 1)
        const _processedIds = messages.map((m) => m.id);
```

The `validated` object was:
```js
        // Merge into unified validated object for downstream stages
        const validated = {
            events,
            entities: graphResult.entities,
            relationships: graphResult.relationships,
        };
```

Both should already be gone after Step 1's replacement. Verify they don't appear anywhere in `extractMemories`.

- [ ] Step 3: Run extraction tests

Run: `npx vitest tests/extraction/extract.test.js --run`
Expected: all 7 tests PASS

- [ ] Step 4: Run full test suite

Run: `npm run test`
Expected: all tests PASS

- [ ] Step 5: Verify unused imports

Check if `syncItemsToST` and `isStVectorSource` are still used in `extractMemories`. They are:
- `isStVectorSource` — used inside `applySyncChanges` (defined in this file)
- `syncItemsToST` — used inside `applySyncChanges`
- `getCurrentChatId` — used inside `applySyncChanges`
- `isStSynced` — used in the new event sync changes builder

No import changes needed. The `markStSynced` import is used inside `applySyncChanges`. All existing imports remain valid.

Also verify `let events` vs `const events`: since `events` is now destructured from `enrichAndDedupEvents`'s return value and never reassigned in the orchestrator, it should be `const`. The destructuring `const { events } = await enrichAndDedupEvents(...)` handles this naturally.

- [ ] Step 6: Commit

```bash
git add src/extraction/extract.js && git commit -m "$(cat <<'EOF'
refactor(extract): rewire extractMemories to use pipeline stage functions

extractMemories now calls fetchEventsFromLLM, fetchGraphFromLLM,
enrichAndDedupEvents, and processGraphUpdates as discrete stages.
Event ST sync consolidated into single applySyncChanges call.
Removes dead validated object and _processedIds variable.
EOF
)"
```

---

### Task 8: Final verification and cleanup

**Files:**
- Modify: `src/extraction/extract.js` (if needed)

- [ ] Step 1: Run full test suite

Run: `npm run test`
Expected: all tests PASS

- [ ] Step 2: Verify line count reduction

Run: `wc -l src/extraction/extract.js`

Expected: significant reduction from original ~1383 lines. The `extractMemories` function should be ~100-110 lines (down from ~413). `runPhase2Enrichment` should be ~25 lines (down from ~113).

- [ ] Step 3: Verify no `isStVectorSource()` check outside `applySyncChanges` in `extractMemories`

Search `extractMemories` for `isStVectorSource`. Should only appear in `applySyncChanges` (lines 48-61). The old `if (isStVectorSource()) { ... }` block in `extractMemories` should be gone, replaced by the unconditional `await applySyncChanges(...)` call.

- [ ] Step 4: Verify Biome passes

Run: `npx biome check src/extraction/extract.js`
Expected: no errors

- [ ] Step 5: Move design to completed

```bash
mv docs/designs/2026-03-24-deconstruct-extraction-pr4.md docs/designs/ 2>/dev/null; git add -A && git commit -m "$(cat <<'EOF'
refactor(extract): PR 4 complete — deconstruct extraction god-function

extractMemories: 413 → ~100 lines
runPhase2Enrichment: 113 → ~25 lines
6 internal stage functions extracted, Phase 2 unified, ST sync consolidated.
EOF
)"
```
