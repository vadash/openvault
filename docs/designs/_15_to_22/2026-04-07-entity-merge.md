# Entity Merging

Phase 2 of the Vault Editing Suite. Provides a manual mechanism to merge two entities — combining their descriptions, mentions, aliases, and relationships into a single node, then deleting the source.

## Problem

The automatic extraction pipeline can create duplicate entities when the same character is introduced under different names (e.g. "masked figure" and "Marcus Hale"). Phase 1 added aliases and editing, but there is no way to consolidate two separate entity nodes into one. The user can only edit each independently or delete one and lose its data.

## Solution

Add a merge action to entity cards. The user picks a target entity via a searchable picker, then the source entity is absorbed into the target: edges are rewritten or combined, aliases and mentions are merged, and a merge redirect is set so future extractions referencing the old name resolve to the survivor.

## Direction Convention

**Source → Target.** The source entity is deleted. The target entity survives and absorbs all data. The UI makes this clear with explanatory text.

## UI Flow

### Trigger

A "Merge" button (icon: `fa-code-merge`, class `openvault-merge-entity`) is added next to Edit and Delete on each entity card's action row in `renderEntityCard()`.

### Merge Picker Panel

Clicking Merge replaces the view-mode card with an inline merge picker (same in-place replacement pattern as edit mode).

```
┌─────────────────────────────────────────────┐
│ Merge "masked figure" into another entity    │
│                                               │
│ "masked figure" will be deleted. Its          │
│ relationships, aliases, and description will  │
│ be combined into the target entity below.     │
│                                               │
│ Target: [________________________]           │
│   ┌───────────────────────────────────┐      │
│   │ Marcus Hale          [PERSON]  ✓  │      │
│   │ Elena Voss           [PERSON]     │      │
│   │ The Tavern           [PLACE]      │      │
│   └───────────────────────────────────┘      │
│                                               │
│              [Cancel]  [Confirm Merge]        │
└─────────────────────────────────────────────┘
```

**Searchable target picker:**
- Text input with a filtered dropdown showing all entities except the source
- Filters by name and aliases (case-insensitive substring match)
- Dropdown only renders when input has 1+ characters
- Each item shows entity name + type badge
- Clicking an item selects it and populates the input with the display name
- The selected entity's normalized key is stored in a `data-target-key` attribute on the picker container (not re-derived from the text input)
- `[Confirm Merge]` is disabled until a valid target key is selected

### After Confirm

1. Show loading toast
2. Call `mergeEntities(sourceKey, targetKey)` from store
3. If `result.toDelete` is non-empty, call `deleteItemsFromST(hashes, chatId)`
4. Re-render entity list
5. Show success toast: `"Merged [Source] into [Target]"`

### Cancel

Clicking `[Cancel]` or pressing Escape replaces the picker with the view-mode card. No data is written.

## Domain Logic

### `mergeEntities(sourceKey, targetKey)` — `src/store/chat-data.js`

```js
/**
 * Merge source entity into target entity. Source is deleted.
 * @param {string} sourceKey - Entity to absorb (will be deleted)
 * @param {string} targetKey - Entity that survives
 * @returns {Promise<{ success: boolean, toDelete: string[] }>}
 */
async function mergeEntities(sourceKey, targetKey) { ... }
```

**Algorithm:**

1. **Validate**
   - Both `graph.nodes[sourceKey]` and `graph.nodes[targetKey]` must exist
   - `sourceKey !== targetKey`
   - Return `{ success: false, toDelete: [] }` on failure

2. **Combine node data onto target**
   - `target.mentions += source.mentions`
   - `target.aliases = unique([...target.aliases, ...source.aliases, source.name])`
   - `target.description` — merge using **segmented Jaccard dedup**:
     - Split `source.description` by ` | `
     - For each segment, compute `jaccardSimilarity(segment, target.description)`
     - If similarity < `GRAPH_JACCARD_DUPLICATE_THRESHOLD` (0.6), append segment to target with ` | ` separator
     - This prevents duplicating partial content when descriptions are compound strings

3. **Set merge redirect**
   - `graph._mergeRedirects[sourceKey] = targetKey`
   - Cascade: for any existing redirect where `value === sourceKey`, update to `targetKey`

4. **Rewrite & combine edges**

   Iterate over all `graph.edges`. For each edge where `source === sourceKey` or `target === sourceKey`:

   - Compute the proposed new edge (replace sourceKey with targetKey in the relevant field)
   - **Self-loop check:** If the proposed edge would be `targetKey → targetKey`, collect the edge's ST hash for deletion (if `_st_synced`), delete the edge, and skip
   - **Collision check:** If the proposed edge key (`newSource__newTarget`) already exists in `graph.edges`:
     - Sum weights: `existing.weight += oldEdge.weight`
     - Merge descriptions using **segmented Jaccard dedup** (same as step 2)
     - Recalculate `_descriptionTokens` on the existing edge
     - If over `CONSOLIDATION.TOKEN_THRESHOLD`, push edge key to `_edgesNeedingConsolidation`
     - `deleteEmbedding(existingEdge)` — edge description changed, embedding is stale
     - Collect old edge's ST hash for deletion (if `_st_synced`)
     - Delete the old edge
   - **No collision:** Rewrite `source`/`target` fields, delete old edge key, insert under new composite key

5. **Cleanup**
   - Delete `graph.nodes[sourceKey]`
   - `deleteEmbedding(targetNode)` — description changed, force re-embed
   - Collect source node's ST hash for deletion (if `_st_synced`)

6. **Save & return**
   - `saveChatConditional()`
   - Return `{ success: true, toDelete: [...] }` with all collected ST vector hashes

### ST Vector Hash Formats

For hash collection, use `cyrb53(text)` where `text` follows the insertion format:

- **Node:** `[OV_ID:${key}] ${node.description}` (matches `graph.js:519`)
- **Edge:** `[OV_ID:edge_${source}_${target}] ${edge.description}` (matches `graph.js:571`)

Collect hashes for:
- The source node itself (deleted)
- Any edge that is deleted (self-loops, old edge in collision)
- Do NOT collect hashes for edges that are merely rewritten (their key changes but the ST entry is updated by the next sync cycle)

## Segmented Jaccard Dedup

A helper function `mergeDescriptions(targetDesc, sourceDesc)` (in `src/store/chat-data.js` or `src/utils/text.js`) that:

1. Splits `sourceDesc` by ` | `
2. For each segment:
   - Compute `jaccardSimilarity(segment, currentTargetDesc)` against the full current target string
   - If < `GRAPH_JACCARD_DUPLICATE_THRESHOLD`: append ` | ${segment}` to target
3. Returns the combined string

This handles the case where `"Loves apples | Hates dogs"` merged with `"Loves apples | Fears heights"` produces `"Loves apples | Hates dogs | Fears heights"` (skipping the duplicate segment).

## Event Binding

In `src/ui/render.js`, add to `initEntityEventBindings()`:

```js
// Merge button on entity card
$container.on('click', '.openvault-merge-entity', (e) => {
    const key = $(e.currentTarget).data('key');
    enterEntityMergeMode(key);
});

// Cancel merge picker
$container.on('click', '.openvault-cancel-entity-merge', (e) => {
    const key = $(e.currentTarget).data('key');
    cancelEntityMerge(key);
});

// Confirm merge
$container.on('click', '.openvault-confirm-entity-merge', async (e) => {
    const sourceKey = $(e.currentTarget).data('source-key');
    const targetKey = $(pickerContainer).data('target-key');
    await confirmEntityMerge(sourceKey, targetKey);
});

// Target selection from filtered list
$container.on('click', '.openvault-merge-target-item', (e) => {
    const targetKey = $(e.currentTarget).data('key');
    selectMergeTarget(targetKey);
});

// Filter target list as user types
$container.on('input', '.openvault-merge-search', (e) => {
    filterMergeTargets(e.target.value);
});
```

## Files Changed

| File | Change |
|---|---|
| `src/store/chat-data.js` | Add `mergeEntities()`, add `mergeDescriptions()` helper |
| `src/ui/templates.js` | Add merge button to `renderEntityCard()`, add `renderEntityMergePicker()` |
| `src/ui/render.js` | Add merge event bindings, merge flow, ST vector cleanup |
| `css/entities.css` | Add styles for merge picker panel, target list, disabled confirm state |
| `tests/store/chat-data-merge.test.js` | New test file |

## What is NOT Changed

- **Extraction pipeline** — Entity extraction, automatic merge, graph building: untouched
- **Retrieval pipeline** — Scoring, injection, world context: untouched
- **Entity CRUD** — Edit, delete, alias management from Phase 1: untouched
- **Community summaries** — Still read-only (Phase 3)
- **Edges display** — Not in this phase (Phase 4)
- **Schema** — No schema changes. `_mergeRedirects`, `aliases`, edge fields all exist

## Testing Strategy

Dedicated test file `tests/store/chat-data-merge.test.js`:

1. **Basic merge** — source data moves to target, source deleted, redirect set
2. **Redirect cascading** — existing redirects pointing to source updated to target
3. **Edge rewriting** — edges from source now point to target
4. **Edge collision** — source→C and target→C both exist; weights summed, descriptions combined
5. **Edge collision with Jaccard dedup** — near-duplicate edge descriptions not duplicated
6. **Self-loop prevention** — source→target edge deleted, not turned into target→target
7. **Alias preservation** — source name added as target alias, existing aliases merged, no duplicates
8. **Mentions accumulation** — `target.mentions += source.mentions`
9. **Embedding invalidation (node)** — target node embedding cleared after merge
10. **Embedding invalidation (edge)** — colliding edge embedding cleared when description changes
11. **ST vector cleanup** — source node + deleted edge hashes returned in `toDelete`
12. **Edge consolidation flagging** — combined edge description over threshold pushed to `_edgesNeedingConsolidation`
13. **Validation: same key** — `sourceKey === targetKey` rejected
14. **Validation: missing node** — non-existent key rejected
15. **Segmented Jaccard** — compound descriptions with partial overlap deduped correctly
16. **Merge picker rendering** — search filters by name and alias, excludes source entity
17. **Target key storage** — picker stores explicit normalized key, not re-derived from text input
