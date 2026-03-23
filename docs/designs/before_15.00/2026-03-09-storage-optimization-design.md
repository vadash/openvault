# Design: Storage Optimization (Base64 Embeddings + LRU Token Cache)

## 1. Problem Statement

Two storage inefficiencies in `chatMetadata.openvault`:

**A. Embedding bloat.** Embeddings are stored as JSON float arrays (`[0.1234, -0.5678, ...]`). Even with the optional `embeddingRounding` (4 decimal places), each 384-dim embedding takes ~2,848 chars. Base64-encoded `Float32Array` achieves the same in 2,048 chars — a 28% reduction with *better* precision (max error `3.7e-9` vs `5.0e-5` from rounding). The rounding setting and `maybeRoundEmbedding()` become dead code.

**B. Unbounded token cache.** `data.message_tokens` is a plain object persisted to `chatMetadata`. During marathon sessions it grows unboundedly — one entry per unique `${index}_${textLength}` key. This adds to serialization cost on every save. The cache doesn't *need* persistence: `gpt-tokenizer` counts are sub-millisecond, so re-counting on chat load is cheap.

## 2. Goals & Non-Goals

### Must do:
- Store all embeddings (memories, graph nodes, communities) as Base64 Float32Array strings
- Read legacy `number[]` embeddings transparently (lazy migration — no one-time conversion)
- Write new embeddings exclusively in Base64 format
- Remove `maybeRoundEmbedding()`, the `embeddingRounding` setting, and its UI checkbox
- Cap token cache at a fixed size with LRU eviction
- Stop persisting token cache to `chatMetadata`
- Delete legacy `message_tokens` key from existing chat data on load

### Won't do:
- Quantized int8/uint8 embeddings (Phase 3 concern — needs accuracy benchmarks)
- Hardware-accelerated vector math with `Float32Array` at runtime (Phase 3)
- Incremental BM25 IDF caching (pre-cached `memory.tokens` already makes this fast)
- Migration UI or manual conversion tools

## 3. Proposed Architecture

### 3.1 Embedding Codec (`src/utils/embedding-codec.js`)

A new pure-function module that all embedding read/write sites import. No state, no side effects. Fully testable.

Four functions form the public API:

| Function | Purpose |
|----------|---------|
| `getEmbedding(obj)` | Read: returns `number[]` from `obj.embedding_b64` (decode) or `obj.embedding` (legacy fallback), or `null` |
| `setEmbedding(obj, vec)` | Write: encodes `vec` → Base64, sets `obj.embedding_b64`, deletes `obj.embedding` |
| `hasEmbedding(obj)` | Check: returns `!!(obj.embedding_b64 \|\| obj.embedding)` |
| `deleteEmbedding(obj)` | Delete: removes both `embedding_b64` and `embedding` keys |

Internal helpers (not exported):

| Function | Purpose |
|----------|---------|
| `encode(number[])` | `Float32Array` → `Uint8Array` → `btoa()` → Base64 string |
| `decode(string)` | Base64 string → `atob()` → `Uint8Array` → `Float32Array` → `Array.from()` → `number[]` |

**Why return `number[]` from decode, not `Float32Array`?**
All existing math code (`cosineSimilarity`, `bm25Score`, `calculateScore`) uses standard array indexing which works on both types. However, keeping `number[]` as the runtime type avoids surprises with `JSON.stringify` behavior (Float32Array serializes as `{"0":..., "1":...}` instead of `[...]`). Phase 3's "Embedding Abstraction Layer" can later switch the runtime type to `Float32Array` for hardware-accelerated math.

**Lazy migration flow:**
```
getEmbedding(memory)
  ├─ memory.embedding_b64 exists? → decode(b64) → return number[]
  ├─ memory.embedding exists?     → return memory.embedding as-is (legacy)
  └─ neither?                     → return null

setEmbedding(memory, vec)
  ├─ memory.embedding_b64 = encode(vec)
  └─ delete memory.embedding  (garbage-collect legacy key)
```

On save, `embedding_b64` is a plain string — serializes natively. No save/load hooks needed.

Old chats are never bulk-migrated. They convert lazily as:
- New memories are extracted (→ `setEmbedding`)
- Existing memories get re-embedded (e.g., user clicks "Regenerate Embeddings")
- Manual edit invalidates embedding (→ `deleteEmbedding` + later `setEmbedding`)

### 3.2 Callsite Migration Map

~33 sites across 14 files need updating. Grouped by operation:

**Write sites (6) — change to `setEmbedding(obj, vec)`:**
| File | Line(s) | Current code |
|------|---------|-------------|
| `embeddings.js` | 619 | `validMemories[i].embedding = maybeRoundEmbedding(embeddings[i])` |
| `embeddings.js` | 659 | `validEvents[i].embedding = maybeRoundEmbedding(embeddings[i])` |
| `graph.js` | 329 | `graphData.nodes[key].embedding = maybeRoundEmbedding(newEmbedding)` |
| `graph.js` | 409 | `node.embedding = maybeRoundEmbedding(...)` |
| `communities.js` | 239 | `embedding: maybeRoundEmbedding(embedding) \|\| []` |
| `render.js` | 134 | `memory.embedding = embedding` |

**Read sites (10) — change to `getEmbedding(obj)`:**
| File | Current code |
|------|-------------|
| `math.js:199` | `cosineSimilarity(contextEmbedding, memory.embedding)` |
| `extract.js:260` | `cosineSimilarity(event.embedding, memory.embedding)` |
| `graph.js:304` | `cosineSimilarity(newEmbedding, node.embedding)` |
| `graph.js:450` | `cosineSimilarity(nodeA.embedding, nodeB.embedding)` |
| `reflect.js:102` | `cosineSimilarity(ref.embedding, existing.embedding)` |
| `reflect.js:163` | `cosineSimilarity(recent.embedding, reflection.embedding)` |
| `reflect.js:258` | `cosineSimilarity(queryEmb, m.embedding)` |
| `world-context.js:26` | `cosineSimilarity(queryEmbedding, community.embedding)` |

**Check sites (14) — change to `hasEmbedding(obj)`:**
| File | Current code |
|------|-------------|
| `embeddings.js:602` | `m.summary && !m.embedding` |
| `embeddings.js:637` | `e.summary && !e.embedding` |
| `extract.js:253` | `!event.embedding` |
| `extract.js:259` | `!memory.embedding` |
| `graph.js:295` | `!node.embedding` |
| `graph.js:407,412` | `!node.embedding` / `if (node.embedding)` |
| `reflect.js:87,92,150,162` | `m.embedding` / `!ref.embedding` |
| `render.js:131` | `!memory.embedding` |
| `settings.js:332` | `!m.embedding` |
| `status.js:111` | `m.embedding?.length > 0` |
| `templates.js:33` | `!memory.embedding` |
| `world-context.js:25` | `!community.embedding` |

**Delete sites (3) — change to `deleteEmbedding(obj)`:**
| File | Current code |
|------|-------------|
| `data.js:105` | `delete memory.embedding` |
| `data.js:167-168` | `if (memory.embedding) { delete memory.embedding }` |
| `export-debug.js:94` | `delete clone.embedding` |

### 3.3 Removals (Dead Code Cleanup)

| Item | File(s) | What |
|------|---------|------|
| `maybeRoundEmbedding()` | `embeddings.js` | Function definition + export |
| `maybeRoundEmbedding` import | `graph.js`, `communities.js` | Import statements |
| `embeddingRounding` default | `constants.js:47` | Default setting |
| `embeddingRounding` binding | `settings.js:477,664` | `bindSetting` + `.prop()` |
| Rounding checkbox | `settings_panel.html:136-140` | `<label>`, `<input>`, `<small>` hint |
| `graph/CLAUDE.md:26` | CLAUDE.md | Doc reference to rounding |
| Test mocks | `graph.test.js:18`, `communities.test.js:174` | `maybeRoundEmbedding: vi.fn(...)` |

### 3.4 In-Memory LRU Token Cache

Replace the persisted `data.message_tokens` object with a module-scoped `Map` in `tokens.js`.

**Current flow:**
```
getMessageTokenCount(chat, index, data)
  → reads/writes data.message_tokens[key]
  → persisted to chatMetadata on every save
```

**New flow:**
```
getMessageTokenCount(chat, index)
  → reads/writes module-scoped tokenCache Map
  → never persisted
  → LRU eviction at MAX_CACHE_SIZE (2000 entries)
```

**Key changes to `tokens.js`:**
1. Replace `data[MESSAGE_TOKENS_KEY]` with a module-scoped `const tokenCache = new Map()`
2. Max size: 2000 entries (covers typical long sessions)
3. LRU via the standard Map pattern (delete + re-set on read, evict oldest on insert)
4. Export `clearTokenCache()` — called on `CHAT_CHANGED`
5. Remove `data` parameter from `getMessageTokenCount()` and `getTokenSum()` (signature change)
6. Remove `pruneTokenCache()` entirely (no longer needed — cache is ephemeral)
7. On first `getOpenVaultData()` call, delete `data.message_tokens` if present (legacy cleanup)

**Callers that pass `data` to token functions (must update signatures):**
- `extract.js` — `getMessageTokenCount(chat, candidates[i].id, data)`
- `scheduler.js` — uses token functions (check usage)
- `retrieve.js` — if it calls token functions

**LRU implementation — hand-rolled, matching existing pattern in `embeddings.js`:**
```js
const MAX_CACHE_SIZE = 2000;
const tokenCache = new Map();

function cacheGet(key) {
    if (!tokenCache.has(key)) return undefined;
    const value = tokenCache.get(key);
    tokenCache.delete(key);
    tokenCache.set(key, value);
    return value;
}

function cacheSet(key, value) {
    if (tokenCache.size >= MAX_CACHE_SIZE) {
        const oldest = tokenCache.keys().next().value;
        tokenCache.delete(oldest);
    }
    tokenCache.set(key, value);
}

export function clearTokenCache() {
    tokenCache.clear();
}
```

No CDN dependency needed — the pattern is 15 lines and already proven in `embeddings.js`.

## 4. Data Models / Schema

### Before (current `chatMetadata.openvault`):
```json
{
  "memories": [{
    "embedding": [0.1234, -0.5678, 0.9012, ...],
    "summary": "..."
  }],
  "graph": {
    "nodes": {
      "alice": { "embedding": [0.1234, ...], "name": "Alice" }
    }
  },
  "communities": {
    "C0": { "embedding": [0.1234, ...], "summary": "..." }
  },
  "message_tokens": { "42_1503": 387, "43_892": 215 }
}
```

### After:
```json
{
  "memories": [{
    "embedding_b64": "AAAAAD+AAAA/gAAAv4AAAD...",
    "summary": "..."
  }],
  "graph": {
    "nodes": {
      "alice": { "embedding_b64": "AAAAAD+AAAA...", "name": "Alice" }
    }
  },
  "communities": {
    "C0": { "embedding_b64": "AAAAAD+AAAA...", "summary": "..." }
  }
}
```

Note: `message_tokens` key is gone entirely. Legacy `embedding` keys may coexist with `embedding_b64` during migration — `getEmbedding()` prefers `embedding_b64`.

## 5. Interface / API Design

### `src/utils/embedding-codec.js`

```js
/**
 * Read embedding from an object. Prefers Base64 format, falls back to legacy array.
 * @param {Object} obj - Object with embedding_b64 or embedding property
 * @returns {number[]|null} Embedding vector or null
 */
export function getEmbedding(obj) {}

/**
 * Write embedding to an object in Base64 format. Removes legacy key.
 * @param {Object} obj - Target object (mutated)
 * @param {number[]|Float32Array} vec - Embedding vector
 */
export function setEmbedding(obj, vec) {}

/**
 * Check if an object has an embedding (either format).
 * @param {Object} obj - Object to check
 * @returns {boolean}
 */
export function hasEmbedding(obj) {}

/**
 * Remove embedding from an object (both formats).
 * @param {Object} obj - Object to clean (mutated)
 */
export function deleteEmbedding(obj) {}
```

### `src/utils/tokens.js` (changed signatures)

```js
// REMOVED: data parameter
export function getMessageTokenCount(chat, index) {}
export function getTokenSum(chat, indices) {}

// REMOVED entirely:
// export function pruneTokenCache(data, chat) {}

// NEW:
export function clearTokenCache() {}
```

## 6. Risks & Edge Cases

### Embedding Codec

| Risk | Mitigation |
|------|-----------|
| **Endianness**: Float32Array uses platform byte order. Data created on little-endian won't decode on big-endian. | All modern browsers on all modern desktop/mobile CPUs are little-endian. SillyTavern is desktop-only. Non-issue in practice. |
| **Downgrade**: User rolls back to old OpenVault version that doesn't know `embedding_b64`. | Old code ignores `embedding_b64` and treats memories as having no embedding. Graceful degradation — BM25-only scoring. Embeddings regenerate when user upgrades again. |
| **Partial migration**: Chat has mix of `embedding` and `embedding_b64` memories. | `getEmbedding()` handles both. `setEmbedding()` garbage-collects legacy key. Convergence is guaranteed as memories are touched. |
| **`export-debug.js`**: Debug export strips embeddings — needs to strip `embedding_b64` too. | `deleteEmbedding(clone)` handles both keys. |
| **Empty/null embeddings**: Some objects have `embedding: []` or `embedding: null`. | `getEmbedding()` returns `null` for empty/null/missing. `hasEmbedding()` returns `false`. |
| **Large spread syntax**: `atob()` of large Base64 strings uses `String.fromCharCode(...spread)` which can hit stack limits. | For 384-dim: 1536 bytes — well under any stack limit. For 768-dim: 3072 bytes — still safe. Only a concern above ~100K elements. Not applicable here. |

### Token Cache

| Risk | Mitigation |
|------|-----------|
| **Cold cache on chat load**: Every message token count must be recomputed. | `gpt-tokenizer` is sub-millisecond per message. 5000 messages ≈ 50-200ms one-time cost. Acceptable. |
| **Signature change**: `getMessageTokenCount(chat, index)` drops `data` param. All callers must update. | Compiler-like search: grep for `getMessageTokenCount` and `getTokenSum` — limited callsites. |
| **Legacy cleanup**: Old chats have `message_tokens` in metadata. | On `getOpenVaultData()`, delete `data.message_tokens` if present. One-line cleanup. |

## 7. Testing Strategy

### Embedding Codec (`tests/utils/embedding-codec.test.js`)

- **Roundtrip**: encode → decode produces identical `number[]` (within Float32 precision)
- **Lazy migration**: `getEmbedding({ embedding: [...] })` returns the legacy array
- **New format**: `getEmbedding({ embedding_b64: '...' })` decodes correctly
- **Precedence**: object with both keys → `embedding_b64` wins
- **Cleanup**: `setEmbedding(obj, vec)` deletes `obj.embedding`
- **Null safety**: `getEmbedding(null)`, `getEmbedding({})`, `getEmbedding({ embedding: null })`
- **hasEmbedding**: true for either format, false for neither

### Token Cache

- **LRU eviction**: insert MAX_CACHE_SIZE + 1 → oldest is evicted
- **clearTokenCache**: empties the cache
- **No data dependency**: `getMessageTokenCount(chat, index)` works without `data` param

### Existing tests that mock `maybeRoundEmbedding`

- `graph.test.js:18` — remove mock, verify graph operations use `setEmbedding`
- `communities.test.js:174` — remove mock, verify community embeddings use `setEmbedding`
