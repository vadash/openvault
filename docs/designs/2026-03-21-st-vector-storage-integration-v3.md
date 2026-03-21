# ST Vector Storage Integration v3

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

## Changes from v2

This version addresses critical issues identified in code review:

### 1. Infinite Re-Sync Loop Fix

**Problem:** `hasEmbedding()` checks for `embedding_b64` property. ST Vector Storage never writes local embeddings, so `hasEmbedding()` always returns `false`, causing `backfillAllEmbeddings()` to re-upload all items on every run.

**Solution:** Add `_st_synced` flag to items successfully synced to ST. Update `hasEmbedding()` to return `true` for items with this flag.

```javascript
// In embedding-codec.js
export function hasEmbedding(obj) {
    if (!obj) return false;
    if (obj._st_synced) return true;  // NEW: Check sync flag first
    if (obj.embedding_b64) return true;
    if (obj.embedding && obj.embedding.length > 0) return true;
    return false;
}
```

### 2. Missing Sync Hooks for Graph Entities

**Problem:** v2 only added sync hooks for events and reflections. Graph nodes (via `mergeOrInsertEntity`) and communities (via `updateCommunitySummaries`) were never synced during normal operation.

**Solution:** Add sync calls in:
- `src/graph/graph.js` - `mergeOrInsertEntity()` for new nodes
- `src/graph/graph.js` - `consolidateEdges()` for updated edges
- `src/graph/communities.js` - `updateCommunitySummaries()` for communities

### 3. User Threshold Respect

**Problem:** v2 hardcoded `threshold: 0.0` in search calls, ignoring the user's `vectorSimilarityThreshold` setting (default 0.5).

**Solution:** Pass `settings.vectorSimilarityThreshold` to `searchItems()`.

```javascript
// Before (v2)
const results = await strategy.searchItems(queryText, 100, 0.0);

// After (v3)
const threshold = settings.vectorSimilarityThreshold;
const results = await strategy.searchItems(queryText, 100, threshold);
```

### 4. ID Mapping Without Memory Leak

**Problem:** v2 used `_st_hash_map` to store mappings between numeric hashes and string IDs. This map was never cleaned up when items were deleted, causing memory bloat.

**Solution:** Use text prefix approach instead of hash map. Embed the OpenVault ID directly in the text field:

```javascript
// Text format sent to ST
"[OV_ID:event_123] The actual memory summary..."

// On search results, extract ID from text prefix
const { id, text } = extractIdFromText(result.text);
// { id: "event_123", text: "The actual memory summary..." }
```

This eliminates the need for `_st_hash_map` entirely.

### 5. Model-Switching Bug Fix

**Problem:** `deleteEmbedding()` was not updated to clear the `_st_synced` flag. When users switch from st-vectors back to a local strategy, `invalidateStaleEmbeddings()` calls `deleteEmbedding()`, but the flag remained, causing `hasEmbedding()` to return `true` even though there's no actual embedding.

**Solution:** Update `deleteEmbedding()` to clear all embedding-related flags:

```javascript
export function deleteEmbedding(obj) {
    if (!obj) return;
    delete obj.embedding;
    delete obj.embedding_b64;
    delete obj._st_synced;  // NEW: Clear sync flag
}
```

### 6. Hash Collision Prevention

**Problem:** The djb2 hash produces 32-bit integers. With ~5,000 entities, there's ~0.3% chance of collision, which would silently overwrite vectors in ST's database.

**Solution:** Use Cyrb53 algorithm for 53-bit hashes, making collisions mathematically negligible:

```javascript
function hashStringToNumber(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return Math.abs(4294967296 * (2097151 & h2) + (h1 >>> 0));
}
```

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

This ensures:
- Each chat has isolated vector storage
- Switching chats creates new collection
- No cross-chat contamination

### Data Flow

**Current flow (Transformers/Ollama):**
```
Query Text → Generate Embedding → Compare against stored embeddings → Top-K results
```

**New flow (ST Vector Storage):**
```
Query Text → POST /api/vector/query → ST generates embedding + searches → Top-K results
         → Extract IDs from text prefix → Return results
```

### ID Embedding Strategy

OpenVault IDs are embedded in the text field using a prefix marker:

```javascript
// Format
"[OV_ID:{string_id}] {summary_text}"

// Examples
"[OV_ID:event_123456789_0] Alice and Bob had a conversation about quantum physics"
"[OV_ID:Alice] PERSON: Alice - A quantum physicist from MIT"
"[OV_ID:C0] Community of researchers working on quantum computing"
```

This approach:
- Eliminates hash collision risk (no numeric conversion)
- Eliminates memory leak (no `_st_hash_map` to maintain)
- Works with any ID format (events, reflections, nodes, communities)

### Scoring Trade-off

**IMPORTANT:** When using ST Vector Storage, OpenVault's sophisticated scoring math is bypassed:

| Feature | Local Embeddings | ST Vector Storage |
|---------|-----------------|-------------------|
| Forgetfulness Curve | ✅ Lambda decay | ❌ Raw cosine |
| Alpha-Blend | ✅ Vector + BM25 | ❌ Vector only |
| Frequency Factor | ✅ Mentions boost | ❌ Not available |
| Reflection Decay | ✅ Level-based | ❌ Not available |
| BM25 Fallback | ✅ Lexical match | ❌ Not available |
| User Threshold | ✅ Respected | ✅ Respected (v3) |

**Mitigation:**
- UI grays out scoring-related settings when `st-vectors` is active
- Info tooltip explains the trade-off
- Mock `scoredResults` generated for debug cache compatibility
- User's `vectorSimilarityThreshold` is passed to ST search

### Entity Types

OpenVault embeds four types of entities. All must be synced to ST:

| Type | Source | ID Format | Sync Location |
|------|--------|-----------|---------------|
| Memories (events) | `MEMORIES_KEY` | `event_xxx` | `extract.js` after Phase 1 |
| Memories (reflections) | `MEMORIES_KEY` | `ref_xxx` | `reflect.js` after generation |
| Graph Nodes | `graph.nodes` | Entity name (normalized) | `graph.js` in `mergeOrInsertEntity` |
| Graph Edges | `graph.edges` | `edge_{source}_{target}` | `graph.js` in `consolidateEdges` |
| Communities | `communities` | `C0`, `C1`, etc. | `communities.js` in `updateCommunitySummaries` |

## Implementation

### StVectorStrategy Class

Location: `src/embeddings.js`

```javascript
const OV_ID_PREFIX_START = '[OV_ID:';
const OV_ID_PREFIX_END = '] ';

function createTextWithId(id, text) {
    return `${OV_ID_PREFIX_START}${id}${OV_ID_PREFIX_END}${text}`;
}

function extractIdFromText(text) {
    if (!text || !text.startsWith(OV_ID_PREFIX_START)) {
        return { id: null, text: text || '' };
    }
    const endIdx = text.indexOf(OV_ID_PREFIX_END);
    if (endIdx === -1) {
        return { id: null, text };
    }
    const id = text.slice(OV_ID_PREFIX_START.length, endIdx);
    const cleanText = text.slice(endIdx + OV_ID_PREFIX_END.length);
    return { id, text: cleanText };
}

function hashStringToNumber(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return Math.abs(4294967296 * (2097151 & h2) + (h1 >>> 0));
}

class StVectorStrategy extends EmbeddingStrategy {
    getId() { return 'st-vectors'; }

    isEnabled() {
        const settings = getDeps().getExtensionSettings()?.vectors;
        return !!(settings?.source);
    }

    getStatus() {
        const settings = getDeps().getExtensionSettings()?.vectors;
        const source = settings?.source || 'not configured';
        const model = settings?.[`${source}_model`] || '';
        return `ST: ${source}${model ? ` / ${model}` : ''}`;
    }

    usesExternalStorage() { return true; }

    async getQueryEmbedding() { return null; }
    async getDocumentEmbedding() { return null; }

    async insertItems(items, { signal } = {}) {
        const itemsForSt = items.map(item => ({
            hash: hashStringToNumber(item.id),
            text: createTextWithId(item.id, item.summary),
            index: 0,
        }));

        const response = await getDeps().fetch('/api/vector/insert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collectionId: await this.#getCollectionId(),
                source: this.#getSource(),
                items: itemsForSt,
            }),
            signal,
        });
        return response.ok;
    }

    async searchItems(queryText, topK, threshold, { signal } = {}) {
        const response = await getDeps().fetch('/api/vector/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collectionId: await this.#getCollectionId(),
                source: this.#getSource(),
                searchText: queryText,
                topK,
                threshold,
            }),
            signal,
        });

        if (!response.ok) return [];

        const data = await response.json();
        return data.hashes.map((hash, i) => {
            const rawText = data.metadata[i]?.text || '';
            const { id, text } = extractIdFromText(rawText);
            return { id: id || String(hash), text };
        });
    }

    async deleteItems(ids, { signal } = {}) {
        const numericHashes = ids.map(id => hashStringToNumber(id));

        const response = await getDeps().fetch('/api/vector/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collectionId: await this.#getCollectionId(),
                source: this.#getSource(),
                hashes: numericHashes,
            }),
            signal,
        });
        return response.ok;
    }

    async purgeCollection({ signal } = {}) {
        const response = await getDeps().fetch('/api/vector/purge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collectionId: await this.#getCollectionId(),
            }),
            signal,
        });
        return response.ok;
    }
}
```

### Retrieval Integration

Location: `src/retrieval/scoring.js`

```javascript
export async function selectRelevantMemories(memories, ctx) {
    if (!memories || memories.length === 0) return [];

    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);

    if (strategy.usesExternalStorage()) {
        // Use user's threshold setting
        const threshold = settings.vectorSimilarityThreshold;
        const queryText = ctx.userMessages || ctx.recentContext?.slice(-500);
        const results = await strategy.searchItems(queryText, 100, threshold);

        // Map IDs back to memory objects
        const idSet = new Set(results.map(r => r.id));
        const selectedMemories = memories.filter(m => idSet.has(m.id));

        // Mark as synced to prevent re-sync
        for (const memory of selectedMemories) {
            markStSynced(memory);
        }

        // Mock scoredResults for debug cache compatibility
        // ... rest of implementation
    }

    // Existing local embedding + scoring logic...
}
```

### Sync Hook Pattern

All sync hooks follow the same pattern:

```javascript
// 1. Check if ST Vector Storage is active
if (settings?.embeddingSource === 'st-vectors') {
    // 2. Prepare items with ID and summary
    const items = entities.map(e => ({ id: e.id, summary: e.summary }));

    // 3. Sync to ST
    const success = await syncItemsToStStorage(items, { targetObjects: entities });

    // 4. Items are marked with _st_synced flag on success
}
```

## API Compatibility

### ST API Endpoints

| Endpoint | Method | Required Fields | Notes |
|----------|--------|-----------------|-------|
| `/api/vector/insert` | POST | `collectionId`, `items[{hash, text}]` | Bulk insert supported |
| `/api/vector/query` | POST | `collectionId`, `searchText`, `topK`, `threshold` | Returns `{hashes, metadata}` |
| `/api/vector/delete` | POST | `collectionId`, `hashes[]` | Hashes converted to numbers |
| `/api/vector/purge` | POST | `collectionId` | Deletes entire collection |

### Source Settings

Each embedding source requires specific settings passed in the request body:

| Source | Required Settings |
|--------|-------------------|
| `openrouter` | `model` (e.g., `openai/text-embedding-3-large`) |
| `openai` | `model` (e.g., `text-embedding-3-small`) |
| `ollama` | `apiUrl`, `model` |
| `cohere` | `model` |
| `transformers` | None (uses default model) |

Settings are read from ST's `extension_settings.vectors` and passed through to the API.

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
| `src/embeddings.js` | Add `StVectorStrategy` with text prefix, extend base class, update `backfillAllEmbeddings` |
| `src/retrieval/scoring.js` | Add branch for `usesExternalStorage()` with user threshold |
| `src/retrieval/world-context.js` | Add branch for ST search on communities |
| `src/extraction/extract.js` | Add sync hook after Phase 1 commit |
| `src/reflection/reflect.js` | Add sync hook after reflection generation |
| `src/graph/graph.js` | Add sync in `mergeOrInsertEntity` and `consolidateEdges` |
| `src/graph/communities.js` | Add sync in `updateCommunitySummaries` |
| `src/utils/data.js` | Add sync helpers, call on delete operations |

## Rollout

1. Implement `StVectorStrategy` with feature flag
2. Test with ST nightly/latest release
3. Add UI indicators for scoring trade-off
4. Document in user guide
5. Remove feature flag after validation