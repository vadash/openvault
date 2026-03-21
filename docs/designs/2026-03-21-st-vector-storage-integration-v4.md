# ST Vector Storage Integration v4

**Date:** 2026-03-21
**Status:** Approved
**Replaces:** 2026-03-21-st-vector-storage-integration-v2.md

## Summary

Add SillyTavern's Vector Storage as an optional embedding strategy in OpenVault. When selected, OpenVault delegates embedding generation, storage, and similarity search to ST's `/api/vector/*` endpoints instead of handling embeddings locally.

## Background

OpenVault currently supports:
- **Transformers.js**: Local WASM/WebGPU with customizable models
- **Ollama**: Local server with configurable model

SillyTavern's Vector Storage extension provides:
- Multiple embedding providers (OpenRouter, OpenAI, Cohere, Ollama, etc.)
- Persistent vector storage via Vectra
- Similarity search via `/api/vector/query`

**Problem:** Users must configure embedding settings twice - once in ST, once in OpenVault.

**Solution:** Allow OpenVault to use ST's configured embedding providers directly.

## Changes from v3

This version addresses critical issues identified in code review:

### 1. Vector Rank Ordering Preserved (CRITICAL)

**Problem:** v3's `selectRelevantMemories()` used `memories.filter()` which preserves chronological order, destroying ST's similarity-based ranking. A 99% match appearing later in chat could be discarded while a 50% match from earlier is kept.

**Solution:** Use Map-based approach that iterates over ST's results (sorted by similarity) rather than the memories array (sorted chronologically):

```javascript
// BEFORE (v3 - WRONG)
const idSet = new Set(results.map((r) => r.id));
const selectedMemories = memories.filter((m) => idSet.has(m.id)).slice(...);

// AFTER (v4 - CORRECT)
const memoriesById = new Map(memories.map((m) => [m.id, m]));
const selectedMemories = results
    .map((r) => memoriesById.get(r.id))
    .filter(Boolean) // Drops undefined (non-memory entities)
    .slice(...);
```

### 2. Deletion Hooks for Graph Consolidation (CRITICAL)

**Problem:** v3 only added insertion hooks. When nodes merge during `consolidateGraph()` or edges redirect during `redirectEdges()`, the removed items remain orphaned in ST's vector database.

**Solution:** Add deletion calls in:
- `src/graph/graph.js` - `consolidateGraph()` - delete merged nodes from ST
- `src/graph/graph.js` - `redirectEdges()` - delete removed edges from ST

**Edge ID Transformation:** Edge dictionary keys (`source__target`) must be transformed to ST Vector Storage IDs (`edge_source_target`) before deletion:

```javascript
// Edge dictionary key: "alice__bob"
// ST Vector ID: "edge_alice_bob"
const edgeIdsToDelete = edgesToRemove.map((key) => {
    const [source, target] = key.split('__');
    return `edge_${source}_${target}`;
});
await deleteItemsFromStStorage(edgeIdsToDelete);
```

### 3. Batching for Bulk Inserts (RISK)

**Problem:** v3's `backfillAllEmbeddings()` sent all items in a single POST request. Chats with 3000+ memories could cause network timeouts, memory spikes, or API rejections.

**Solution:** Use batch processing with configurable batch size (default: 100):

```javascript
const BATCH_SIZE = 100;
for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE);
    await strategy.insertItems(batch);
}
```

### 4. Infinite Re-Sync Loop Fix (from v2)

**Problem:** `hasEmbedding()` checks for `embedding_b64` property. ST Vector Storage never writes local embeddings, so `hasEmbedding()` always returns `false`, causing `backfillAllEmbeddings()` to re-upload all items on every run.

**Solution:** Add `_st_synced` flag to items successfully synced to ST. Update `hasEmbedding()` to return `true` for items with this flag.

### 5. Missing Sync Hooks for Graph Entities (from v2)

**Problem:** v2 only added sync hooks for events and reflections. Graph nodes (via `mergeOrInsertEntity`) and communities (via `updateCommunitySummaries`) were never synced during normal operation.

**Solution:** Add sync calls in:
- `src/graph/graph.js` - `mergeOrInsertEntity()` for new nodes
- `src/graph/graph.js` - `consolidateEdges()` for updated edges
- `src/graph/communities.js` - `updateCommunitySummaries()` for communities

### 6. User Threshold Respect (from v2)

**Problem:** v2 hardcoded `threshold: 0.0` in search calls, ignoring the user's `vectorSimilarityThreshold` setting (default 0.5).

**Solution:** Pass `settings.vectorSimilarityThreshold` to `searchItems()`.

### 7. ID Mapping Without Memory Leak (from v2)

**Problem:** v2 used `_st_hash_map` to store mappings between numeric hashes and string IDs. This map was never cleaned up when items were deleted, causing memory bloat.

**Solution:** Use text prefix approach instead of hash map. Embed the OpenVault ID directly in the text field:

```javascript
// Text format sent to ST
"[OV_ID:event_123] The actual memory summary..."

// On search results, extract ID from text prefix
const { id, text } = extractIdFromText(result.text);
// { id: "event_123", text: "The actual memory summary..." }
```

### 8. Model-Switching Bug Fix (from v2)

**Problem:** `deleteEmbedding()` was not updated to clear the `_st_synced` flag. When users switch from st-vectors back to a local strategy, `invalidateStaleEmbeddings()` calls `deleteEmbedding()`, but the flag remained, causing `hasEmbedding()` to return `true` even though there's no actual embedding.

**Solution:** Update `deleteEmbedding()` to clear all embedding-related flags.

### 9. Hash Collision Prevention (from v2)

**Problem:** The djb2 hash produces 32-bit integers. With ~5,000 entities, there's ~0.3% chance of collision, which would silently overwrite vectors in ST's database.

**Solution:** Use Cyrb53 algorithm for 53-bit hashes, making collisions mathematically negligible.

## Architecture

### Strategy Pattern Extension

Add `StVectorStrategy` to the existing strategy pattern in `src/embeddings.js`:

```
┌─────────────────────────────────────────────────────────────────┐
│ EMBEDDING STRATEGIES                                            │
│                                                                 │
│  [TransformersStrategy]  →  Local WASM/WebGPU, custom models    │
│  [OllamaStrategy]        →  Local Ollama server                 │
│  [StVectorStrategy] NEW  →  ST Vector Storage (insert + query)  │
└─────────────────────────────────────────────────────────────────┘
```

### Interface Adaptation

Extend `EmbeddingStrategy` base class with storage-related methods:

```javascript
class EmbeddingStrategy {
    // Existing methods
    async getQueryEmbedding(text, options) { throw new Error('Not implemented'); }
    async getDocumentEmbedding(text, options) { throw new Error('Not implemented'); }

    // NEW: Methods for storage-backed strategies
    async insertItems(items, options) { return false; }
    async searchItems(query, topK, threshold, options) { return null; }
    async deleteItems(ids, options) { return false; }
    async purgeCollection(options) { return false; }
    usesExternalStorage() { return false; }
}
```

### Collection Isolation

**CRITICAL:** Collection ID includes chat ID to prevent cross-chat data leakage:

```javascript
#getCollectionId() {
    const chatId = getCurrentChatId();
    const source = this.#getSource();
    return `openvault-${chatId}-${source}`;
}
```

### Data Flow

**Current flow (Transformers/Ollama):**
```
Query Text → Generate Embedding → Compare against stored embeddings → Top-K results
```

**New flow (ST Vector Storage):**
```
Query Text → POST /api/vector/query → ST generates embedding + searches → Top-K results
         → Map results by ID (preserving similarity order) → Return results
```

### Scoring Trade-off

**IMPORTANT:** When using ST Vector Storage, OpenVault's sophisticated scoring math is bypassed:

| Feature | Local Embeddings | ST Vector Storage |
|---------|-----------------|-------------------|
| Forgetfulness Curve | ✅ Lambda decay | ❌ Raw cosine |
| Alpha-Blend | ✅ Vector + BM25 | ❌ Vector only |
| Frequency Factor | ✅ Mentions boost | ❌ Not available |
| Reflection Decay | ✅ Level-based | ❌ Not available |
| BM25 Fallback | ✅ Lexical match | ❌ Not available |
| User Threshold | ✅ Respected | ✅ Respected |
| Similarity Ranking | ✅ Preserved | ✅ Preserved (v4) |

### Entity Types

OpenVault embeds four types of entities. All must be synced to ST:

| Type | Source | ID Format | Sync Location |
|------|--------|-----------|---------------|
| Memories (events) | `MEMORIES_KEY` | `event_xxx` | `extract.js` after Phase 1 |
| Memories (reflections) | `MEMORIES_KEY` | `ref_xxx` | `reflect.js` after generation |
| Graph Nodes | `graph.nodes` | Entity name (normalized) | `graph.js` in `mergeOrInsertEntity` |
| Graph Edges | `graph.edges` | `edge_{source}_{target}` | `graph.js` in `consolidateEdges` |
| Communities | `communities` | `C0`, `C1`, etc. | `communities.js` in `updateCommunitySummaries` |

## API Compatibility

### ST API Endpoints

| Endpoint | Method | Required Fields | Notes |
|----------|--------|-----------------|-------|
| `/api/vector/insert` | POST | `collectionId`, `items[{hash, text}]` | Bulk insert supported |
| `/api/vector/query` | POST | `collectionId`, `searchText`, `topK`, `threshold` | Returns `{hashes, metadata}` |
| `/api/vector/delete` | POST | `collectionId`, `hashes[]` | Hashes converted to numbers |
| `/api/vector/purge` | POST | `collectionId` | Deletes entire collection |

## Error Handling

| Scenario | Handling |
|----------|----------|
| ST not reachable | Log warning, return empty results, show toast |
| 404 on `/api/vector/*` | ST version too old, show toast with version requirement |
| Invalid source/model | Log and return empty results |
| Network timeout | AbortSignal propagation, return empty |
| Chat ID unavailable | Use 'default' as fallback, log warning |
| Missing ID prefix in result | Fall back to numeric hash as ID |

## Files Changed

| File | Change |
|------|--------|
| `src/utils/embedding-codec.js` | Add `_st_synced` check, add `markStSynced`, `isStSynced`, `clearStSynced` |
| `src/embeddings.js` | Add `StVectorStrategy` with text prefix, extend base class, update `backfillAllEmbeddings` with batching |
| `src/retrieval/scoring.js` | Add branch for `usesExternalStorage()` with Map-based ordering |
| `src/retrieval/world-context.js` | Add branch for ST search on communities |
| `src/extraction/extract.js` | Add sync hook after Phase 1 commit |
| `src/reflection/reflect.js` | Add sync hook after reflection generation |
| `src/graph/graph.js` | Add sync in `mergeOrInsertEntity`, `consolidateEdges`; add deletion in `consolidateGraph`, `redirectEdges` |
| `src/graph/communities.js` | Add sync in `updateCommunitySummaries` |
| `src/utils/data.js` | Add sync helpers, call on delete operations |

## Rollout

1. Implement `StVectorStrategy` with feature flag
2. Test with ST nightly/latest release
3. Add UI indicators for scoring trade-off
4. Document in user guide
5. Remove feature flag after validation