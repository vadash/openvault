# Review Bugfixes Implementation Plan

**Goal:** Fix three confirmed bugs from external code review (ST Vector community retrieval, graph extraction gating, merged edge sync).
**Architecture:** Each bug is an isolated fix in a single module. No cross-cutting changes. One CLAUDE.md documentation update for a non-bug design note.
**Tech Stack:** JavaScript (ESM, in-browser), Vitest

---

## File Structure Overview

- Modify: `src/retrieval/scoring.js` — Thread communities through ST retrieval
- Modify: `src/retrieval/retrieve.js` — Pass communities to scoring layer, use returned community results
- Modify: `src/retrieval/world-context.js` — Remove stale ST Vector early-return (dead code after fix)
- Modify: `src/extraction/extract.js` — Remove `rawEvents.length > 0` gate on graph extraction
- Modify: `src/store/chat-data.js` — Add edges to `toSync` after merge rewriting
- Modify: `src/retrieval/CLAUDE.md` — Fix stale ST Vector documentation
- Modify: `src/store/CLAUDE.md` — Add design note about `mergeEntities` edge sync
- Modify: `src/extraction/CLAUDE.md` — Add design note about backoff→Phase2 intent
- Modify: `tests/retrieval/st-scoring.test.js` — Test community passthrough in ST mode
- Modify: `tests/store/chat-data-merge.test.js` — Test edge toSync after merge
- Modify: `tests/extraction/extract.test.js` — Test graph extraction with zero events

---

### Task 1: Fix ST Vector community retrieval — scoring layer

**Files:**
- Modify: `src/retrieval/scoring.js`
- Test: `tests/retrieval/st-scoring.test.js`

- [ ] Step 1: Write the failing test

Add a test to `tests/retrieval/st-scoring.test.js` that verifies `selectRelevantMemoriesWithST` separates community results from memory results. The function must return community items alongside scored memories.

```javascript
describe('selectRelevantMemoriesWithST community routing', () => {
    it('separates community results from memory results', async () => {
        // Dynamically import to allow mocking
        vi.doMock('../../src/services/st-vector.js', () => ({
            querySTVector: vi.fn().mockResolvedValue([
                { id: 'event_1', hash: 111, text: '[OV_ID:event_1] test event' },
                { id: 'C0', hash: 222, text: '[OV_ID:C0] community summary' },
                { id: 'C1', hash: 333, text: '[OV_ID:C1] another community' },
            ]),
        }));

        const { selectRelevantMemoriesWithST } = await import('../../src/retrieval/scoring.js');
        const { getStrategy } = await import('../../src/embeddings.js');

        const memories = [
            { id: 'event_1', type: 'event', summary: 'test event', importance: 3, message_ids: [50] },
        ];
        const ctx = {
            recentContext: [],
            userMessages: 'test query',
            activeCharacters: [],
            chatLength: 100,
            scoringConfig: {
                embeddingSource: 'st_vector',
                vectorSimilarityThreshold: 0.3,
                forgetfulnessBaseLambda: 0.05,
                forgetfulnessImportance5Floor: 1.0,
                reflectionDecayThreshold: 750,
                alpha: 0.7,
                combinedBoostWeight: 3.0,
                transientDecayMultiplier: 1.0,
            },
            queryConfig: {},
            allAvailableMemories: memories,
        };
        const strategy = getStrategy('st_vector');

        const result = await selectRelevantMemoriesWithST(
            memories, ctx, 10, [], null, strategy
        );

        // Communities must be returned separately, not dropped
        expect(result.communityIds).toBeDefined();
        expect(result.communityIds).toContain('C0');
        expect(result.communityIds).toContain('C1');
        // Memories still scored normally
        expect(result.memories.length).toBeGreaterThan(0);
        expect(result.memories[0].id).toBe('event_1');

        vi.doUnmock('../../src/services/st-vector.js');
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/retrieval/st-scoring.test.js`
Expected: FAIL — `result.communityIds` is `undefined`

- [ ] Step 3: Write minimal implementation

In `src/retrieval/scoring.js`, modify `selectRelevantMemoriesWithST`:

1. Add a `communities` parameter (optional, defaults to `{}`).
2. Build a `communityById` Map alongside `memoriesById`.
3. When iterating `stResults`, separate items into memory candidates vs community results by checking both maps.
4. Return `communityIds` array alongside memories.

```javascript
// Change signature to accept communities
async function selectRelevantMemoriesWithST(memories, ctx, limit, allHiddenMemories, idfCache, strategy, communities = {}) {
    // ... existing stTopK and searchItems call ...

    const memoriesById = new Map(memories.map((m) => [m.id, m]));
    const communityById = new Map(Object.entries(communities));
    const communityResults = []; // Collect matched community IDs

    if (stResults && stResults.length > 0) {
        const candidates = [];
        for (let i = 0; i < stResults.length; i++) {
            const result = stResults[i];
            const item = memoriesById.get(result.id);

            if (item) {
                item._proxyVectorScore = rankToProxyScore(i, stResults.length);
                candidates.push(item);
            } else if (communityById.has(result.id)) {
                communityResults.push(result.id);
            }
        }

        // ... existing scoring logic unchanged ...

        return {
            memories: topScored.map((r) => r.memory),
            scoredResults: topScored,
            communityIds: communityResults,
        };
    }

    // ... existing BM25 fallback unchanged ...

    return {
        ...fallbackResult,
        communityIds: communityResults,
    };
}
```

Also update `selectRelevantMemoriesSimple` to pass `communities` through:

```javascript
if (strategy.usesExternalStorage()) {
    return selectRelevantMemoriesWithST(
        memories, ctx, limit, allHiddenMemories, idfCache, strategy, ctx.communities
    );
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/retrieval/st-scoring.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: route ST Vector community results through scoring layer"
```

---

### Task 2: Fix ST Vector community retrieval — wire into retrieve.js

**Files:**
- Modify: `src/retrieval/retrieve.js`
- Modify: `src/retrieval/world-context.js`

- [ ] Step 1: Write the failing test

Add a test to `tests/retrieval/st-scoring.test.js` that verifies the end-to-end flow: when ST Vector returns community IDs, they get formatted into world context text.

```javascript
it('ST Vector community IDs get formatted into world context', async () => {
    const { retrieveWorldContext } = await import('../../src/retrieval/world-context.js');

    const communities = {
        C0: { title: 'The Castle', summary: 'An ancient fortress on the hill.', findings: ['old'] },
        C1: { title: 'The Village', summary: 'A peaceful farming community.', findings: [] },
    };

    // Simulate: scoring layer returned these community IDs from ST Vector
    const result = retrieveWorldContext(communities, null, 'test query', null, 2000, ['C0', 'C1']);

    expect(result.text).toContain('world_context');
    expect(result.text).toContain('Castle');
    expect(result.text).toContain('Village');
    expect(result.communityIds).toEqual(['C0', 'C1']);
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/retrieval/st-scoring.test.js`
Expected: FAIL — function doesn't accept `stCommunityIds` parameter

- [ ] Step 3: Write minimal implementation

**In `src/retrieval/world-context.js`:**

Add a `stCommunityIds` parameter (optional, defaults to `null`). When provided in ST Vector mode, use it to select and format communities instead of returning empty.

```javascript
export function retrieveWorldContext(communities, globalState, userMessagesString, queryEmbedding, tokenBudget = 2000, stCommunityIds = null) {
    // Intent-based routing: check for macro intent first
    if (detectMacroIntent(userMessagesString) && globalState?.summary) {
        return {
            text: `<world_context>\n${globalState.summary}\n</world_context>`,
            communityIds: [],
            isMacroIntent: true,
        };
    }

    if (!communities) {
        return { text: '', communityIds: [], isMacroIntent: false };
    }

    // ST Vector mode: use pre-selected community IDs from scoring layer
    const settings = getSettings();
    const isStVectorMode = settings?.embeddingSource === 'st_vector';

    if (isStVectorMode && stCommunityIds && stCommunityIds.length > 0) {
        const selected = [];
        let usedTokens = 0;
        for (const id of stCommunityIds) {
            const community = communities[id];
            if (!community?.summary) continue;
            const entry = formatCommunityEntry(community);
            const tokens = countTokens(entry);
            if (usedTokens + tokens > tokenBudget) break;
            selected.push(entry);
            usedTokens += tokens;
        }
        if (selected.length === 0) return { text: '', communityIds: stCommunityIds, isMacroIntent: false };
        return {
            text: '<world_context>\n' + selected.join('\n\n') + '\n</world_context>',
            communityIds: stCommunityIds,
            isMacroIntent: false,
        };
    }

    // Local mode: requires queryEmbedding for cosine similarity
    if (!queryEmbedding) {
        return { text: '', communityIds: [], isMacroIntent: false };
    }

    // ... existing local scoring logic unchanged ...
```

**In `src/retrieval/retrieve.js`:**

Thread `communityIds` from `selectRelevantMemories` → `selectRelevantMemoriesSimple` → `selectRelevantMemoriesWithST`, then pass to `retrieveWorldContext`.

In `selectFormatAndInject`:
```javascript
// selectRelevantMemories now returns { memories, communityIds? } in ST mode
const selectionResult = await selectRelevantMemories(memoriesToUse, ctx);
const relevantMemories = selectionResult;

// ... later, when calling retrieveWorldContext:
const worldResult = retrieveWorldContext(
    worldCommunities,
    data.global_world_state || null,
    userMessages || '',
    worldQueryEmbedding,
    ctx.worldContextBudget,
    selectionResult.communityIds || null  // ST Vector community IDs from scoring
);
```

In `selectRelevantMemories` (scoring.js), return the `communityIds` alongside the memories array.

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/retrieval/st-scoring.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: inject ST Vector community results as world context"
```

---

### Task 3: Fix graph extraction gated on zero events

**Files:**
- Modify: `src/extraction/extract.js` (lines 973-978)
- Test: `tests/extraction/extract.test.js`

- [ ] Step 1: Write the failing test

Add a test to `tests/extraction/extract.test.js` that verifies graph extraction runs when zero events are returned.

```javascript
it('runs graph extraction even when zero events are extracted', async () => {
    const zeroEventsResponse = JSON.stringify({
        reasoning: null,
        events: [],
    });

    const graphResponse = JSON.stringify({
        entities: [
            { name: 'Shadow Guild', type: 'ORGANIZATION', description: 'A secret thieves guild' },
        ],
        relationships: [],
    });

    const sendRequest = vi.fn()
        .mockResolvedValueOnce({ content: zeroEventsResponse })
        .mockResolvedValueOnce({ content: graphResponse });

    // ... standard setup (settings, connectionManager, data, etc.) ...

    const result = await extractMemories(messages, data, settings, { sendRequest, ... });

    // Graph extraction should have been called (2 LLM calls, not 1)
    expect(sendRequest).toHaveBeenCalledTimes(2);

    // Entity should exist in the graph
    expect(data.graph.nodes['Shadow Guild']).toBeDefined();
    expect(data.graph.nodes['Shadow Guild'].type).toBe('ORGANIZATION');
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/extraction/extract.test.js`
Expected: FAIL — `sendRequest` called only once (graph extraction skipped)

- [ ] Step 3: Write minimal implementation

In `src/extraction/extract.js`, remove the `if (rawEvents.length > 0)` gate:

```javascript
// Stage 2: Graph extraction (LLM call)
let graphResult = { entities: [], relationships: [] };
await rpmDelay(settings, 'Inter-call rate limit');
const formattedEvents = rawEvents.map((e, i) => `${i + 1}. [${e.importance}★] ${e.summary}`);
graphResult = await fetchGraphFromLLM(contextParams, formattedEvents, abortSignal);
```

When `rawEvents.length === 0`, `formattedEvents` is `[]`, which the prompt builder already handles (omits `<extracted_events>` section, adjusts instruction text).

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/extraction/extract.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: run graph extraction independently of event count"
```

---

### Task 4: Fix merged edges losing ST Vector sync

**Files:**
- Modify: `src/store/chat-data.js`
- Test: `tests/store/chat-data-merge.test.js`

- [ ] Step 1: Write the failing test

Add tests to `tests/store/chat-data-merge.test.js` in the existing `describe('ST Vector Storage sync')` block:

```javascript
it('queues rewritten edge for re-sync in toSync after merge', async () => {
    const saveFn = vi.fn(async () => true);
    setupTestContext({
        context: {
            chatMetadata: {
                openvault: {
                    schema_version: 3,
                    memories: [],
                    character_states: {},
                    processed_message_ids: [],
                    graph: {
                        nodes: {
                            alice: {
                                name: 'Alice', type: 'PERSON',
                                description: 'A young woman', mentions: 3, aliases: [],
                                _st_synced: true,
                            },
                            bob: {
                                name: 'Bob', type: 'PERSON',
                                description: 'A tall man', mentions: 2, aliases: [],
                                _st_synced: true,
                            },
                            charlie: {
                                name: 'Charlie', type: 'PERSON',
                                description: 'Quiet guy', mentions: 1, aliases: [],
                            },
                        },
                        edges: {
                            alice__charlie: {
                                source: 'alice', target: 'charlie',
                                weight: 2, description: 'Alice mentors Charlie',
                                _st_synced: true,
                            },
                        },
                        _mergeRedirects: {},
                    },
                },
            },
        },
        deps: { saveChatConditional: saveFn },
    });

    const { mergeEntities: mergeEntitiesImported } = await import('../../src/store/chat-data.js');
    const result = await mergeEntitiesImported('alice', 'bob');

    expect(result.success).toBe(true);
    // The rewritten edge bob__charlie must be in toSync
    const edgeSync = result.stChanges.toSync.find(
        (s) => s.text.includes('edge_bob__charlie')
    );
    expect(edgeSync).toBeDefined();
    expect(edgeSync.item).toBe(mockGraph.edges['bob__charlie']); // same object reference
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/store/chat-data-merge.test.js`
Expected: FAIL — `edgeSync` is `undefined`

- [ ] Step 3: Write minimal implementation

In `src/store/chat-data.js` `mergeEntities`, add edge toSync entries in both the collision and rewrite branches:

**Collision branch** (after `deleteEmbedding(existingEdge)` and before `delete g.edges[oldKey]`):
```javascript
// Queue merged edge for re-sync
const mergedEdgeId = `edge_${newSource}_${newTarget}`;
const mergedEdgeText = `[OV_ID:${mergedEdgeId}] ${existingEdge.description}`;
toSync.push({ hash: cyrb53(mergedEdgeText), text: mergedEdgeText, item: existingEdge });
```

**Rewrite branch** (after `deleteEmbedding(edge)` and before `delete g.edges[oldKey]`):
```javascript
// Queue rewritten edge for re-sync
const rewrittenEdgeId = `edge_${newSource}_${newTarget}`;
const rewrittenEdgeText = `[OV_ID:${rewrittenEdgeId}] ${edge.description}`;
toSync.push({ hash: cyrb53(rewrittenEdgeText), text: rewrittenEdgeText, item: edge });
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/store/chat-data-merge.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: queue merged edges for ST Vector re-sync"
```

---

### Task 5: Update CLAUDE.md files

**Files:**
- Modify: `src/retrieval/CLAUDE.md`
- Modify: `src/store/CLAUDE.md`
- Modify: `src/extraction/CLAUDE.md`

- [ ] Step 1: Fix stale ST Vector docs in `src/retrieval/CLAUDE.md`

Replace the incorrect ST Vector section:
```markdown
### ST Vector Retrieval
- **`selectRelevantMemoriesWithST` returns all item types.** Build lookup maps for memories, graph nodes (`graphNodes`), AND communities. Results include `communityIds` field for downstream world context injection.
- **Community retrieval uses scoring-layer IDs in ST Vector mode.** `retrieveWorldContext` accepts `stCommunityIds` parameter — communities pre-selected by the scoring layer. Returns empty when no IDs provided (avoids duplicate local embedding computation).
```

- [ ] Step 2: Add merge edge sync note to `src/store/CLAUDE.md`

In the ST CHANGES CONTRACT section, after the `syncNode(key)` bullet, add:
```markdown
- **Queue edges for re-sync after merge rewriting.** Both collision and rewrite branches in `mergeEntities` must push modified edges to `toSync` after calling `deleteEmbedding()`. Follow the same `[OV_ID:edge_{source}_{target}] ${description}` + `cyrb53` pattern as `consolidateEdges`.
```

- [ ] Step 3: Add backoff design note to `src/extraction/CLAUDE.md`

In the BACKFILL OPTIMIZATION section, after "Run Phase 2 once at the end", add:
```markdown
- **Max-backoff `break` is intentional, not a bug.** When `cumulativeBackoffMs >= MAX_BACKOFF_TOTAL_MS`, `break` exits the retry loop. Phase 2 then runs as best-effort enrichment on already-saved data (has its own guard: `if (!data.memories?.length) return`). This is by design — partial Phase 1 data is valuable and Phase 2 failure does not throw.
```

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "docs: update CLAUDE.md for review bugfixes and design notes"
```

---

### Task 6: Full test suite validation

- [ ] Step 1: Run full test suite

Run: `npx vitest run`
Expected: All tests PASS

- [ ] Step 2: Run pre-commit checks

Run: `npm run check`
Expected: All checks PASS (lint, typecheck, sync-version, generate-types, jsdoc, css)
