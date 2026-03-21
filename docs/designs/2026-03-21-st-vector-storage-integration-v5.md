# ST Vector Storage Integration v5

**Date:** 2026-03-21
**Status:** Draft
**Replaces:** 2026-03-21-st-vector-storage-integration-v4.md

## Summary

Add SillyTavern's Vector Storage as an optional embedding strategy using a **dual-storage, retrieve-then-rerank** architecture. Vectors are stored in ST's Vectra database; all other data (timestamps, importance, mention counts, summaries) remains in chat metadata. This preserves OpenVault's full Alpha-Blend scoring pipeline (forgetfulness curve, BM25, frequency factor) while leveraging ST's embedding providers.

## Background

OpenVault currently supports:
- **Transformers.js**: Local WASM/WebGPU with customizable models
- **Ollama**: Local server with configurable model

SillyTavern's Vector Storage extension provides:
- Multiple embedding providers (OpenRouter, OpenAI, Cohere, Ollama, etc.)
- Persistent vector storage via Vectra (file-based local index)
- Similarity search via `/api/vector/query`

**Problem:** Users must configure embedding settings twice — once in ST, once in OpenVault.

**Solution:** Allow OpenVault to use ST's configured embedding providers for vector storage, while keeping all scoring metadata local.

## Critical Fix from v4

### v4 Flaw: Alpha-Blend Scoring Bypassed

v4 delegated both storage AND retrieval to ST, completely bypassing OpenVault's scoring:

| Feature | v4 ST Vector Storage |
|---------|---------------------|
| Forgetfulness Curve | ❌ Bypassed |
| Alpha-Blend (Vector + BM25) | ❌ Bypassed |
| Frequency Factor | ❌ Bypassed |
| Reflection Decay | ❌ Bypassed |
| BM25 Fallback | ❌ Bypassed |

v4 used fake scores (`1.0 - i * 0.01`) — a complete loss of retrieval quality.

### v5 Fix: Dual-Storage with Retrieve-Then-Rerank

v5 uses ST only as a **candidate retrieval** step. The full Alpha-Blend scoring pipeline runs locally on the retrieved candidates:

| Feature | v5 ST Vector Storage |
|---------|---------------------|
| Forgetfulness Curve | ✅ Full lambda decay |
| Alpha-Blend (Vector + BM25) | ✅ Rank-proxy + BM25 |
| Frequency Factor | ✅ Mentions boost |
| Reflection Decay | ✅ Level-based |
| BM25 Fallback | ✅ Lexical match |
| User Threshold | ✅ Respected |

## Architecture

### Dual-Storage Model

```
┌──────────────────────────────────────────────────────────────────────┐
│ DUAL STORAGE                                                         │
│                                                                      │
│  ST Vectra DB          Chat Metadata (local)                         │
│  ┌─────────────┐       ┌──────────────────────────────────────────┐  │
│  │ Vectors      │       │ Timestamps, importance, mention counts,  │  │
│  │ (embeddings) │       │ summaries (for BM25), graph structure,   │  │
│  │              │       │ reflection levels, community data        │  │
│  └─────────────┘       └──────────────────────────────────────────┘  │
│                                                                      │
│  OpenVault has NO access to raw vectors.                             │
│  OpenVault has FULL access to all scoring metadata.                  │
└──────────────────────────────────────────────────────────────────────┘
```

### Strategy Pattern Extension

```
┌─────────────────────────────────────────────────────────────────┐
│ EMBEDDING STRATEGIES                                            │
│                                                                 │
│  [TransformersStrategy]  →  Local WASM/WebGPU, custom models    │
│  [OllamaStrategy]        →  Local Ollama server                 │
│  [StVectorStrategy] NEW  →  ST Vector Storage (insert + query)  │
└─────────────────────────────────────────────────────────────────┘
```

### Retrieve-Then-Rerank Data Flow

**Current flow (Transformers/Ollama):**
```
Query → Generate Embedding → Cosine compare all local vectors → Alpha-Blend score → Top-K
```

**New flow (ST Vector Storage):**
```
Query → POST /api/vector/query (3× limit candidates, low threshold)
     → Get candidate IDs (ordered by cosine similarity)
     → Map IDs to local metadata
     → Assign rank-position proxy scores as vector component
     → Feed into Alpha-Blend: proxy_cosine × α + BM25 × (1-α) + forgetfulness + frequency
     → Return properly scored Top-K
```

### Rank-Position Proxy Scoring

ST's `/api/vector/query` does **not** return similarity scores (scores are used internally for threshold filtering, then stripped from the response). The response only contains `{ hashes, metadata }` where metadata is `{ hash, text, index }`.

To provide a vector similarity component for Alpha-Blend, we use rank position as a proxy:

```javascript
/**
 * Convert ST rank position to a cosine similarity proxy.
 * ST results are pre-sorted by cosine similarity and pre-filtered by threshold.
 *
 * @param {number} rank - 0-based rank position from ST results
 * @param {number} totalResults - Total number of results returned
 * @returns {number} Proxy score in [0.5, 1.0] range
 */
function rankToProxyScore(rank, totalResults) {
    if (totalResults <= 1) return 1.0;
    // Linear decay from 1.0 to 0.5 across the result set
    // Floor of 0.5 because ST already filtered below-threshold items
    return 1.0 - (rank / (totalResults - 1)) * 0.5;
}
```

**Why this works:**
1. ST already filters results below `vectorSimilarityThreshold` — all returned items passed the user's quality bar
2. ST returns results sorted by cosine similarity — rank order is meaningful
3. The proxy feeds into Alpha-Blend alongside BM25, forgetfulness, and frequency — even imprecise vector scores are useful when combined with other signals
4. Over-fetching (3× limit) ensures enough candidates for local reranking to be effective

**Why floor at 0.5 (not 0.0):**
Items that passed ST's threshold filter are genuinely similar. A proxy of 0.0 would tell Alpha-Blend "this item is irrelevant" — which contradicts ST's threshold-based pre-filtering. The 0.5 floor keeps all candidates in the "relevant" range while still preserving rank differentiation.

### Over-Fetch Ratio

The over-fetch multiplier determines how many candidates we request from ST relative to the final limit:

```javascript
const OVER_FETCH_MULTIPLIER = 3;
const stTopK = limit * OVER_FETCH_MULTIPLIER;
```

- **Too low (1×):** No room for reranking — Alpha-Blend can't improve on ST's order
- **Too high (10×):** Wastes ST compute on candidates that will be discarded
- **3× sweet spot:** Enough diversity for BM25/forgetfulness to reorder meaningfully

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

### Scoring Integration Point

In `selectRelevantMemories()`, the ST branch:

1. Calls `strategy.searchItems()` with `topK = limit * 3` and user's threshold
2. Maps returned IDs to local memory objects via `Map` (preserving ST's rank order)
3. Assigns rank-position proxy scores to each candidate
4. Injects proxy scores as the `vectorSimilarity` component
5. Calls `scoreMemories()` with the candidate subset + proxy scores
6. Returns Alpha-Blend scored top-K

```javascript
// In selectRelevantMemories, ST branch:
const stResults = await strategy.searchItems(query, limit * 3, threshold);
const memoriesById = new Map(memories.map(m => [m.id, m]));

// Build candidates with proxy scores
const candidates = stResults
    .map((r, i) => {
        const memory = memoriesById.get(r.id);
        if (!memory) return null;
        memory._proxyVectorScore = rankToProxyScore(i, stResults.length);
        return memory;
    })
    .filter(Boolean);

// Feed into existing Alpha-Blend pipeline
// scoreMemories() uses _proxyVectorScore instead of computing cosine locally
const scored = await scoreMemories(candidates, null, chatLength, constants, settings, queryTokens, ...);
```

The `scoreMemories()` function checks for `_proxyVectorScore` on each memory. If present, it uses that instead of computing cosine similarity from a local embedding vector. This is the **only change** to the scoring math.

## Fixes Carried Forward from v4

All non-scoring fixes from v4 remain valid:

### 1. Deletion Hooks for Graph Consolidation
Add deletion calls in `consolidateGraph()` and `redirectEdges()` to clean orphaned vectors from ST.

### 2. Batching for Bulk Inserts
`backfillAllEmbeddings()` uses batch processing (default: 100 items per batch).

### 3. Infinite Re-Sync Loop Prevention
`_st_synced` flag on items successfully synced to ST. `hasEmbedding()` returns `true` for flagged items.

### 4. Missing Sync Hooks for Graph Entities
Sync calls added for nodes (`mergeOrInsertEntity`), edges (`consolidateEdges`), and communities (`updateCommunitySummaries`).

### 5. User Threshold Respect
Pass `settings.vectorSimilarityThreshold` to ST's query endpoint.

### 6. ID Mapping via Text Prefix
Embed OpenVault ID in text field: `[OV_ID:event_123] The actual memory summary...`

### 7. Model-Switching Bug Fix
`deleteEmbedding()` clears `_st_synced` flag.

### 8. Hash Collision Prevention
Cyrb53 algorithm for 53-bit hashes.

## Entity Types

All entity types synced to ST (vectors only — metadata stays local):

| Type | ID Format | Text Sent to ST | Sync Location |
|------|-----------|-----------------|---------------|
| Events | `event_xxx` | `[OV_ID:event_xxx] {summary}` | `extract.js` after Phase 1 |
| Reflections | `ref_xxx` | `[OV_ID:ref_xxx] {summary}` | `reflect.js` after generation |
| Graph Nodes | entity name | `[OV_ID:{name}] {summary}` | `graph.js` in `mergeOrInsertEntity` |
| Graph Edges | `edge_{src}_{tgt}` | `[OV_ID:edge_{src}_{tgt}] {summary}` | `graph.js` in `consolidateEdges` |
| Communities | `C0`, `C1`, etc. | `[OV_ID:C0] {summary}` | `communities.js` in `updateCommunitySummaries` |

## ST API Compatibility

### Endpoints Used

| Endpoint | Method | Request | Response | Notes |
|----------|--------|---------|----------|-------|
| `/api/vector/insert` | POST | `{collectionId, items[{hash, text}], source}` | HTTP 200 | Bulk insert |
| `/api/vector/query` | POST | `{collectionId, searchText, topK, threshold, source}` | `{hashes, metadata}` | **No scores returned** |
| `/api/vector/delete` | POST | `{collectionId, hashes[], source}` | HTTP 200 | Hashes as numbers |
| `/api/vector/purge` | POST | `{collectionId}` | HTTP 200 | Deletes entire collection |

### Key Constraint: No Scores in Query Response

ST's query endpoint filters by cosine threshold and sorts by similarity internally, but strips scores from the response. Only `{ hash, text, index }` metadata is returned. This is why we use rank-position proxy scoring instead of real cosine values.

## Error Handling

| Scenario | Handling |
|----------|----------|
| ST not reachable | Log warning, return empty results, show toast |
| 404 on `/api/vector/*` | ST version too old, show toast with version requirement |
| Network timeout | AbortSignal propagation, return empty |
| Chat ID unavailable | Use 'default' as fallback, log warning |
| Missing ID prefix in result | Fall back to numeric hash as ID |
| ST returns 0 candidates | Fall through to BM25-only scoring (graceful degradation) |

## Files Changed

| File | Change |
|------|--------|
| `src/utils/embedding-codec.js` | Add `_st_synced` flag support, `markStSynced`, `isStSynced`, `clearStSynced`; update `deleteEmbedding` |
| `src/embeddings.js` | Add `StVectorStrategy` with text prefix + Cyrb53 hash; extend base class; batched backfill |
| `src/retrieval/math.js` | Check `_proxyVectorScore` before computing cosine similarity |
| `src/retrieval/scoring.js` | Add ST branch: over-fetch → assign proxy scores → feed into `scoreMemories()` |
| `src/retrieval/world-context.js` | Add ST search branch for communities |
| `src/extraction/extract.js` | Add sync hook after Phase 1 commit |
| `src/reflection/reflect.js` | Add sync hook after reflection generation |
| `src/graph/graph.js` | Sync in `mergeOrInsertEntity`, `consolidateEdges`; deletion in `consolidateGraph`, `redirectEdges` |
| `src/graph/communities.js` | Sync in `updateCommunitySummaries` |
| `src/utils/data.js` | Add sync/delete helpers for ST storage |

## Rollout

1. Implement `StVectorStrategy` with feature flag
2. Test with ST nightly/latest release
3. Validate Alpha-Blend reranking improves over raw ST ordering
4. Document scoring behavior in user guide
5. Remove feature flag after validation
