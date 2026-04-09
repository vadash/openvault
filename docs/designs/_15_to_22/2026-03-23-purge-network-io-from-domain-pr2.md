# PR 2: Purge Network I/O from Domain Logic

## Goal

Remove all SillyTavern Vector Storage network calls (`syncItemsToST`, `deleteItemsFromST`) from domain files (`graph.js`, `communities.js`, `reflect.js`). Domain functions become pure data transformations that return **change sets**. The orchestrator (`extract.js`) collects these and performs bulk network I/O at phase boundaries.

**Non-goals:** No changes to ST Vector API payloads. No changes to Louvain, scoring, or merge math. No changes to `embeddings.js` (its `StVectorStrategy` is already a proper service boundary). No UI changes.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pattern | Full dirty lists | Every domain function explicitly returns what was created/modified/deleted. Orchestrator doesn't scan — it trusts the return value. |
| `consolidateGraph()` | Delete | Zero call sites in production. Dead code. |
| `reflect.js` scope | Include | Same layer violation as graph/communities. Clean it now while establishing the pattern. |
| ST text format (`[OV_ID:...]`) | Stays in domain functions | It's a data identity convention, not an ST-specific concern. Hashes and text are returned in change sets; orchestrator passes them through. |
| `markStSynced` | Moves to orchestrator | Domain never touches `_st_synced`. Orchestrator marks after successful network call. |

## Change Set Shape

All domain functions return a `stChanges` object alongside their existing return value:

```js
// Returned by functions that create/modify items
{ hash: number, text: string, item: object }   // item = live reference for markStSynced

// Returned by functions that delete items
{ hash: number }                                // hash = cyrb53 of the OV_ID text

// Aggregated change set
{
  toSync: Array<{ hash, text, item }>,
  toDelete: Array<{ hash }>
}
```

The orchestrator collects change sets, then:
```js
if (isStVectorSource()) {
    const chatId = getCurrentChatId();
    if (changes.toSync.length > 0) {
        const items = changes.toSync.map(c => ({ hash: c.hash, text: c.text, index: 0 }));
        const success = await syncItemsToST(items, chatId);
        if (success) {
            for (const c of changes.toSync) markStSynced(c.item);
        }
    }
    if (changes.toDelete.length > 0) {
        await deleteItemsFromST(changes.toDelete.map(c => c.hash), chatId);
    }
}
```

## File-by-File Changes

### 1. `src/graph/graph.js`

**Remove** imports: `syncItemsToST`, `deleteItemsFromST`, `isStVectorSource`, `getCurrentChatId` from `data.js`. Remove `markStSynced` from `embedding-codec.js` (keep `cyrb53`).

#### `mergeOrInsertEntity(graphData, name, type, description, cap, settings)`

**Current return:** `Promise<string>` (node key)

**New return:** `Promise<{ key: string, stChanges: { toSync: [], toDelete: [] } }>`

Changes:
- **New node created** (bottom of function, after `setEmbedding`): Instead of calling `syncItemsToST`, push to `stChanges.toSync`:
  ```js
  const text = `[OV_ID:${key}] ${node.description}`;
  stChanges.toSync.push({ hash: cyrb53(text), text, item: node });
  ```
- **Semantic merge path** (node merged into existing): The merged-away node needs deletion. Currently handled by the `isStVectorSource()` block after `redirectEdges()`. Instead, capture before `delete graphData.nodes[removeKey]`:
  ```js
  const text = `[OV_ID:${removeKey}] ${removedNode.description}`;
  stChanges.toDelete.push({ hash: cyrb53(text) });
  ```
  Wait — this code path doesn't exist in `mergeOrInsertEntity`. The delete-after-merge only happens in `consolidateGraph`, which we're deleting. In `mergeOrInsertEntity`, the semantic merge path just calls `upsertEntity` on the existing node and returns `bestMatch`. No node is deleted, no ST delete is needed.

  **Correction:** In `mergeOrInsertEntity`, the only ST call is in the "new node" path. The delete-node-from-ST logic lives only in `consolidateGraph` (which we're deleting). So `stChanges.toDelete` will always be empty for this function. We still include it for type consistency.

- **Fast path / cross-script merge / no-embedding path**: These paths don't touch ST. Return `{ key, stChanges: { toSync: [], toDelete: [] } }`.

#### `redirectEdges(graphData, oldKey, newKey)`

**Current return:** `Promise<void>`

**New return:** `Promise<{ toDelete: Array<{ hash: number }> }>`

Changes:
- Delete the `if (isStVectorSource()) { ... deleteItemsFromST ... }` block.
- Compute deletion hashes from the removed edges (same logic, just collect instead of send):
  ```js
  const toDelete = [];
  for (const edgeKey of edgesToRemove) {
      const [source, target] = edgeKey.split('__');
      const edgeId = `edge_${source}_${target}`;
      const edge = edgesToAdd.find(e => e.source === source || e.target === target);
      if (edge) {
          const text = `[OV_ID:${edgeId}] ${edge.description}`;
          toDelete.push({ hash: cyrb53(text) });
      }
  }
  return { toDelete };
  ```
- `mergeOrInsertEntity` does NOT call `redirectEdges` — only `consolidateGraph` did, and we're deleting that. **Wait — let me re-check.**

  Actually, from the exploration: `redirectEdges` IS called inside `consolidateGraph` (line 680). But `consolidateGraph` is dead code. So `redirectEdges` is also dead code.

  **Decision: Delete `redirectEdges` too.** It has zero live callers.

#### `consolidateGraph(graphData, settings)` — **DELETE entirely**

Zero call sites. Remove the function and its JSDoc.

#### `consolidateEdges(graphData, _settings)`

**Current return:** `Promise<number>` (count of consolidated edges)

**New return:** `Promise<{ count: number, stChanges: { toSync: Array<{ hash, text, item }> } }>`

Changes:
- Delete the inner `if (isStVectorSource()) { ... syncItemsToST ... markStSynced ... }` block.
- Instead, collect the sync items:
  ```js
  // Inside the per-edge success path, after setEmbedding:
  const edgeId = `edge_${edge.source}_${edge.target}`;
  const text = `[OV_ID:${edgeId}] ${edge.description}`;
  stChanges.toSync.push({ hash: cyrb53(text), text, item: edge });
  ```
- Initialize `stChanges` at function top. Return it alongside `count`.

### 2. `src/graph/communities.js`

**Remove** imports: `syncItemsToST`, `isStVectorSource`, `getCurrentChatId` from `data.js`. Remove `isStSynced`, `markStSynced` from `embedding-codec.js` (keep `cyrb53`).

#### `updateCommunitySummaries(...)`

**Current return:** `Promise<{ communities, global_world_state }>`

**New return:** `Promise<{ communities, global_world_state, stChanges: { toSync: [] } }>`

Changes:
- Delete the entire `if (isStVectorSource()) { ... }` block at the bottom (lines ~297-310).
- Instead, after `await Promise.all(promises)`, build the sync list from `updatedCommunities`:
  ```js
  const stChanges = { toSync: [] };
  for (const [id, community] of Object.entries(updatedCommunities)) {
      if (community.summary) {
          const text = `[OV_ID:${id}] ${community.summary}`;
          stChanges.toSync.push({ hash: cyrb53(text), text, item: community });
      }
  }
  ```
- Return `{ communities: updatedCommunities, global_world_state, stChanges }`.
- Note: We push ALL communities with summaries, not just unsynced ones. The orchestrator's `markStSynced` handles idempotency — `syncItemsToST` is safe to call with already-synced hashes (ST upserts by hash).

### 3. `src/reflection/reflect.js`

**Remove** imports: `syncItemsToST`, `isStVectorSource`, `getCurrentChatId` from `data.js`. Remove `isStSynced`, `markStSynced` from `embedding-codec.js` (keep `cyrb53`).

#### `generateReflections(characterName, allMemories, characterStates)`

**Current return:** `Promise<Array>` (reflection objects)

**New return:** `Promise<{ reflections: Array, stChanges: { toSync: [] } }>`

Changes:
- Delete the entire `if (isStVectorSource()) { ... }` block (lines ~323-338).
- Before `return toAdd`, build the sync list:
  ```js
  const stChanges = { toSync: [] };
  for (const r of toAdd) {
      const text = `[OV_ID:${r.id}] ${r.summary}`;
      stChanges.toSync.push({ hash: cyrb53(text), text, item: r });
  }
  return { reflections: toAdd, stChanges };
  ```

### 4. `src/extraction/extract.js` (Orchestrator)

This file gains a helper and adds ST sync calls at phase boundaries.

#### New helper: `applySyncChanges(stChanges)`

```js
async function applySyncChanges(stChanges) {
    if (!isStVectorSource()) return;
    const chatId = getCurrentChatId();
    if (stChanges.toSync?.length > 0) {
        const items = stChanges.toSync.map(c => ({ hash: c.hash, text: c.text, index: 0 }));
        const success = await syncItemsToST(items, chatId);
        if (success) {
            for (const c of stChanges.toSync) markStSynced(c.item);
        }
    }
    if (stChanges.toDelete?.length > 0) {
        await deleteItemsFromST(stChanges.toDelete.map(c => c.hash), chatId);
    }
}
```

#### Phase 1 changes (`extractMemories`):

**Entity loop** (~line 638): Collect `stChanges` from each `mergeOrInsertEntity` call:
```js
const graphSyncChanges = { toSync: [], toDelete: [] };
for (const entity of validated.entities) {
    if (entity.name === 'Unknown') continue;
    const { key } = await mergeOrInsertEntity(data.graph, ...);
    // Destructure stChanges and merge into graphSyncChanges
}
```

After the existing event sync block (which stays as-is for events), add:
```js
await applySyncChanges(graphSyncChanges);
```

**Note:** The existing event sync block in extract.js stays unchanged — events are already synced at the orchestrator level. Only graph node syncing is new here.

#### Phase 2 changes (`extractMemories` + `runPhase2Enrichment`):

**Reflections** (~line 736): Unpack new return shape:
```js
const { reflections, stChanges } = await generateReflections(...);
if (reflections.length > 0) {
    data[MEMORIES_KEY].push(...reflections);
}
await applySyncChanges(stChanges);
```

**Edge consolidation** (~line 774): Unpack new return shape:
```js
const { count: consolidated, stChanges: edgeChanges } = await consolidateEdges(data.graph, settings);
if (consolidated > 0) {
    logDebug(`Consolidated ${consolidated} graph edges`);
}
await applySyncChanges(edgeChanges);
```

**Communities** (~line 783): Unpack new return shape:
```js
const communityUpdateResult = await updateCommunitySummaries(...);
data.communities = communityUpdateResult.communities;
// ... global_world_state handling unchanged ...
await applySyncChanges(communityUpdateResult.stChanges);
```

**Duplicate the same changes** in `runPhase2Enrichment` (~lines 874-935) for the Emergency Cut / backfill-finale path.

### 5. Dead Code Cleanup

| Item | Action |
|------|--------|
| `consolidateGraph()` | Delete function + JSDoc |
| `redirectEdges()` | Delete function + JSDoc (only caller was `consolidateGraph`) |
| `graph.js` imports of `deleteItemsFromST`, `isStVectorSource`, `getCurrentChatId` | Remove (no longer used after deletions) |
| `graph.js` import of `markStSynced` | Remove |
| Tests for `consolidateGraph` / `redirectEdges` | Delete corresponding test cases |

## Execution Order

| Step | File | Risk | Test impact |
|------|------|------|-------------|
| 1 | `graph.js`: Delete `consolidateGraph` + `redirectEdges` | Low | Delete dead tests |
| 2 | `graph.js`: Refactor `mergeOrInsertEntity` return shape | Medium | Update callers to destructure `{ key }`. Tests become sync assertions on `stChanges`. |
| 3 | `graph.js`: Refactor `consolidateEdges` return shape | Low | Tests assert `stChanges.toSync` contents instead of mocking `fetch`. |
| 4 | `communities.js`: Refactor `updateCommunitySummaries` | Low | Remove `fetch`/`data.js` mocks. Assert `stChanges.toSync` shape. |
| 5 | `reflect.js`: Refactor `generateReflections` | Low | Remove `data.js` mocks. Assert `stChanges.toSync` shape. |
| 6 | `extract.js`: Wire `applySyncChanges` at phase boundaries | Medium | Add spy on `syncItemsToST`/`deleteItemsFromST` to verify orchestrator fires sync once per phase. |

Steps 1-3 form a natural unit (graph pipeline). Steps 4-5 are independent. Step 6 ties everything together.

## Verification

- `npm run test` green after each step.
- No `syncItemsToST`, `deleteItemsFromST`, `isStVectorSource`, or `markStSynced` imports remaining in `graph.js`, `communities.js`, or `reflect.js`.
- `getDeps().fetch` not called from any of those three files.
- Manual verification in SillyTavern with ST Vector Storage enabled: new memories, entities, communities, and reflections still appear in ST's Data Bank UI.
- Biome lint/format passes (pre-commit hook).
