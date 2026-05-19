# Remove ST Vector Storage & Simplify Embedding Architecture

**Date:** 2025-05-19
**Branch:** dev
**Scope:** ~40 files modified, 3 deleted, ~2000 lines removed

## Problem

ST Vector storage integration has two fundamental issues:

1. **Sync fragility** — Maintaining a parallel copy of all embeddings in SillyTavern's Vectra DB requires a complex `stChanges` contract that flows through every domain function (extraction, graph, reflection, communities, CRUD). This sync is hard to keep correct and breaks silently.
2. **Quality ceiling** — ST Vector's `/api/vector/query` returns ranked results but not actual similarity scores. We convert ranks to proxy scores via `rankToProxyScore()`, which is a poor approximation of real cosine similarity. We also cannot compare two vectors directly through ST's API.

Meanwhile, local embeddings (Transformers.js + Ollama) provide full control over similarity computation with no sync overhead.

## Decision

Remove ST Vector support entirely. Simplify the codebase by:

- Eliminating the strategy pattern (all remaining sources use local cosine similarity)
- Removing the `stChanges` contract from all domain functions
- Deleting the ST Vector service layer and all associated sync/proxy logic
- Showing a detailed toast error for users upgrading from ST Vector mode

Users who want ST Vector can use the `stable_23` branch.

## Design

### 1. User Migration

When the extension loads and detects `embeddingSource === 'st_vector'`:

- Display a detailed toast explaining the removal (two storage systems were unsustainable, sync was fragile, quality was subpar)
- Log an error to F12 console with the same explanation
- Auto-reset `embeddingSource` to the default local model (`multilingual-e5-small`)

### 2. Embedding Architecture

**Before:** `EmbeddingStrategy` class hierarchy with `LocalStrategy`, `OllamaStrategy`, `StVectorStrategy`.

**After:** Flat functions in `src/embeddings.js`:

- `getQueryEmbedding(text)` — generates query embedding from current source
- `getDocumentEmbedding(text)` — generates document embedding from current source
- `getOptimalChunkSize()` — returns chunk size for current model
- `isEmbeddingsEnabled()` — checks if valid source is configured

Source selection is a simple config read. Generation branches on source type:
- **Local models** (default): Transformers.js pipeline
- **Ollama**: HTTP call to Ollama API

Both produce `Float32Array` stored as Base64 locally. No external storage concept.

**Removed:**
- `EmbeddingStrategy` base class and all subclasses
- `usesExternalStorage()` method and all branching on it
- `getStrategy(source)` factory
- External storage operations: `insertItems()`, `searchItems()`, `deleteItems()`, `purgeCollection()`

### 3. Retrieval

**Single path** (existing `selectRelevantMemoriesSimple()` becomes `selectRelevantMemories()`):

1. Fast pass: Base score + BM25 on all candidates
2. Slow pass: Cosine similarity on top 200 candidates (`VECTOR_PASS_LIMIT`)
3. Alpha-blend: `Base + (α × Vector) + ((1-α) × BM25)`
4. Token budget via soft balancing

**Removed:**
- `selectRelevantMemoriesWithST()` — entire function
- `rankToProxyScore()` — proxy score conversion
- `_proxyVectorScore` field from all memory objects
- `OVER_FETCH_MULTIPLIER` constant
- `stCommunityIds` parameter from `retrieveWorldContext()`
- All `usesExternalStorage()` branching in retrieval

### 4. Domain Logic — stChanges Removal

The `stChanges` contract (`{ toSync, toDelete }`) is removed entirely. Domain functions return only their domain results:

| Function | Before | After |
|---|---|---|
| `extractMemories()` | `{ events, graph, stChanges }` | `{ events, graph }` |
| `mergeOrInsertEntity()` | `{ key, stChanges }` | `{ key }` |
| `consolidateEdges()` | `{ edges, stChanges }` | `{ edges }` |
| `generateReflections()` | `{ reflections, stChanges }` | `{ reflections }` |
| `updateCommunitySummaries()` | `{ communities, worldState, stChanges }` | `{ communities, worldState }` |
| `updateMemory()` | `{ memory, stChanges }` | `{ memory }` |
| `deleteMemory()` | `{ memory, stChanges }` | `{ memory }` |
| `updateEntity()` | `{ entity, stChanges }` | `{ entity }` |
| `deleteEntity()` | `{ entity, stChanges }` | `{ entity }` |
| `mergeEntities()` | `{ entity, stChanges }` | `{ entity }` |

**Callers updated:**
- `src/extraction/extract.js` — remove `applySyncChanges()` and all sync calls
- `src/graph/graph.js` — remove `syncNode()` helper and sync logic
- `src/graph/communities.js` — remove sync from community updates
- `src/reflection/reflect.js` — remove `stChanges` from return
- `src/store/chat-data.js` — remove ST sync from CRUD operations
- `src/ui/render.js` — remove `applySyncChanges()` calls in delete/save handlers

### 5. Schema, Constants, Codec, Migration

**Schemas (`src/store/schemas.js`):**
- Delete: `StSyncChangesSchema`, `StVectorItemSchema`, `StVectorQueryResultSchema`
- Remove fields: `_st_synced` (from Memory, GraphNode, GraphEdge, CommunitySummary), `_proxyVectorScore` (from Memory), `stChanges` (from all result schemas)

**Constants (`src/constants.js`):**
- Remove: `EMBEDDING_SOURCES.ST_VECTOR`, `ST_API_ENDPOINTS`, `OVER_FETCH_MULTIPLIER`

**Codec (`src/utils/embedding-codec.js`):**
- Remove: `isStSynced()`, `markStSynced()`, `clearStSynced()`
- Keep: `encodeEmbedding()`, `decodeEmbedding()`, `hasEmbedding()`, `deleteEmbedding()`

**Migration (`src/embeddings/migration.js`):**
- Remove: `getStVectorFingerprint()`, `stampStVectorFingerprint()`, `_hasStVectorMismatch()`, `_hasSyncedItems()`, `_clearAllStSyncFlags()`
- Simplify `invalidateStaleEmbeddings()` to handle only local model fingerprints
- Remove `st_vector_source`, `st_vector_model` data field handling

**Types (`src/types.d.ts`):**
- Regenerated via `npm run generate-types` — no manual edits

### 6. Files Deleted

- `src/services/st-vector.js` — entire ST Vector REST API service
- `tests/services/st-vector.test.js` — ST Vector service tests
- `tests/retrieval/st-scoring.test.js` — proxy score tests

### 7. Test Updates

**Delete entirely:** 2 test files (listed above)

**Modify (remove ST-specific assertions/mocks):**
- `tests/store/chat-data.test.js` — remove `stChanges` assertions
- `tests/store/chat-data-merge.test.js` — remove ST sync verification
- `tests/graph/graph.test.js` — remove `syncNode()` and `stChanges` tests
- `tests/graph/communities.test.js` — remove `stChanges` checks
- `tests/reflection/reflect.test.js` — remove `stChanges` from mock returns
- `tests/retrieval/retrieve.test.js` — remove ST Vector mode test cases
- `tests/embeddings/migration.test.js` — remove ST fingerprint test cases
- `tests/extraction/extract.test.js` — remove `applySyncChanges()` test cases
- `tests/integration/phase2-e2e.test.js` — remove ST sync verification
- `tests/embeddings/embeddings.test.js` — remove strategy pattern tests
- `tests/setup.js` — remove ST Vector mocking
- `tests/factories.js` — remove `_st_synced` from factory defaults

No new tests needed — surviving tests already cover local cosine similarity, Ollama, and BM25 scoring.

## Implementation Order

1. **Infrastructure** — delete `st-vector.js`, remove ST constants, remove ST schemas
2. **Embeddings** — flatten strategy pattern to flat functions
3. **Domain logic** — remove `applySyncChanges()`, `stChanges` returns, sync helpers
4. **Retrieval** — remove `selectRelevantMemoriesWithST()`, proxy scores, ST branching
5. **Storage & migration** — clean schemas, codec, migration fingerprint logic
6. **UI** — add migration toast, remove sync calls from handlers
7. **Types** — `npm run generate-types`
8. **Tests** — delete ST test files, update remaining tests
9. **Verify** — `npm run check` passes
