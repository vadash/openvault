# Remove ST Vector Storage Implementation Plan

**Goal:** Remove SillyTavern vector storage integration and simplify the embedding architecture from a strategy pattern to flat functions with a single local cosine similarity retrieval path.
**Testing Conventions:** Tests mirror `src/` structure. Integration tests limited to 3-5 orchestrator scenarios. Never mock internal modules (exceptions for isolated `embeddings.js` edge cases). Use factory builders from `tests/factories.js` for structural tests, inline objects for math tests. Use `vi.useFakeTimers()` for timer-dependent tests but switch to real timers when testing promise rejection. Use `it.each()` for same-pattern-different-input tests.

---

### Task 1: Delete ST Vector Service and Constants

**Objective:** Remove the ST Vector REST API service layer and its associated constants/schemas. This is the foundation — everything else depends on these being gone.

**Files to modify/delete:**
- Delete: `src/services/st-vector.js` (entire file — ST Vector REST API)
- Delete: `tests/services/st-vector.test.js` (entire file — ST Vector service tests)
- Modify: `src/constants.js` (remove `EMBEDDING_SOURCES.ST_VECTOR`, `ST_API_ENDPOINTS`, `OVER_FETCH_MULTIPLIER`)
- Modify: `src/store/schemas.js` (remove `StVectorItemSchema`, `StVectorQueryResultSchema`, `StSyncChangesSchema`; remove `_st_synced` field from `MemorySchema`, `GraphNodeSchema`, `GraphEdgeSchema`; remove `_proxyVectorScore` field from `MemorySchema`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read outlines of `src/constants.js` and `src/store/schemas.js`. Read full content of `src/services/st-vector.js` to understand what's being deleted.
2. **Delete files:** Delete `src/services/st-vector.js` and `tests/services/st-vector.test.js`.
3. **Clean constants:** In `src/constants.js`, remove the `ST_VECTOR` entry from `EMBEDDING_SOURCES`, remove the entire `ST_API_ENDPOINTS` frozen object, and remove `OVER_FETCH_MULTIPLIER`.
4. **Clean schemas:** In `src/store/schemas.js`, remove the `StVectorItemSchema`, `StVectorQueryResultSchema`, and `StSyncChangesSchema` exports entirely. Remove the `_st_synced: z.boolean().optional()` field from `MemorySchema`, `GraphNodeSchema`, and `GraphEdgeSchema`. Remove the `_proxyVectorScore: z.number().optional()` field from `MemorySchema`.
5. **Regenerate types:** Run `npm run generate-types` to update `src/types.d.ts`.
6. **Verify:** Run `npm run check` to confirm no broken imports yet (there will be broken imports in files that imported st-vector.js — those are fixed in later tasks). Focus on confirming the schema and constant changes don't break anything in isolation.
7. **Commit:** `refactor: delete ST vector service, constants, and schemas`

---

### Task 2: Flatten Embedding Strategy Pattern

**Objective:** Remove the `EmbeddingStrategy` class hierarchy and replace it with flat functions. Keep only `TransformersStrategy` logic (local models) and `OllamaStrategy` logic (HTTP call) as simple branching inside the embedding functions.

**Depends on:** Task 1

**Files to modify:**
- Modify: `src/embeddings.js` (remove `EmbeddingStrategy` base class, `StVectorStrategy` class, `OllamaStrategy` class, `TransformersStrategy` class, `getStrategy()` factory; flatten `getQueryEmbedding()` and `getDocumentEmbedding()` to handle source branching directly; remove `usesExternalStorage()` concept; keep `backfillAllEmbeddings()` but remove ST sync references like `isStSynced`/`markStSynced` imports and usage)
- Modify: `src/utils/embedding-codec.js` (remove `isStSynced()`, `markStSynced()`, `clearStSynced()` exports; keep `cyrb53` since it may be used elsewhere; in `deleteEmbedding()`, remove the line that deletes `_st_synced`)
- Modify: `src/embeddings/migration.js` (remove `getStVectorFingerprint()`, `stampStVectorFingerprint()`, `_hasStVectorMismatch()`, `_hasSyncedItems()`, `_clearAllStSyncFlags()`; simplify `invalidateStaleEmbeddings()` to only handle local model fingerprint changes; remove `st_vector_source` and `st_vector_model` data field handling)
- Modify: `tests/embeddings/embeddings.test.js` (remove strategy pattern tests, update remaining tests to work with flat functions)
- Modify: `tests/embeddings/migration.test.js` (remove ST fingerprint test cases)
- Modify: `tests/utils/embedding-codec.test.js` (remove tests for `isStSynced`, `markStSynced`, `clearStSynced`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read outlines of `src/embeddings.js`, `src/utils/embedding-codec.js`, and `src/embeddings/migration.js`.
2. **Write failing tests first:** In `tests/embeddings/embeddings.test.js`, remove tests for `StVectorStrategy`, `getStrategy()`, `EmbeddingStrategy` base class, and `usesExternalStorage()`. Update remaining tests that call `getStrategy()` to call the flat functions (`getQueryEmbedding`, `getDocumentEmbedding`) directly. In `tests/embeddings/migration.test.js`, remove test cases referencing `getStVectorFingerprint`, `stampStVectorFingerprint`, `_hasStVectorMismatch`. In `tests/utils/embedding-codec.test.js`, remove test blocks for `isStSynced`, `markStSynced`, `clearStSynced`.
3. **Flatten embeddings.js:** Remove the `EmbeddingStrategy` base class, `StVectorStrategy`, `OllamaStrategy`, and `TransformersStrategy` classes. Remove `getStrategy()`. Inline the Transformers.js and Ollama embedding generation logic directly into `getQueryEmbedding()` and `getDocumentEmbedding()` with a simple source check (`if (source === 'ollama')`). Remove the `strategies` registry. Remove all imports from `../services/st-vector.js`. Remove `isStSynced`/`markStSynced` imports from `../utils/embedding-codec.js`. In `backfillAllEmbeddings()`, remove all ST sync logic (no `isStSynced` checks, no `markStSynced` calls, no external storage sync).
4. **Clean codec:** In `src/utils/embedding-codec.js`, remove the `isStSynced()`, `markStSynced()`, and `clearStSynced()` function exports. In `deleteEmbedding()`, remove the line that deletes `obj._st_synced`.
5. **Clean migration:** In `src/embeddings/migration.js`, remove all ST Vector fingerprint functions (`getStVectorFingerprint`, `stampStVectorFingerprint`, `_hasStVectorMismatch`, `_hasSyncedItems`, `_clearAllStSyncFlags`). Remove imports from `../services/st-vector.js`. Remove imports of `clearStSynced`, `isStSynced` from `../utils/embedding-codec.js`. Simplify `invalidateStaleEmbeddings()` to only check local model fingerprints and no longer reference `EMBEDDING_SOURCES.ST_VECTOR`.
6. **Verify:** Run `npm run check`.
7. **Commit:** `refactor: flatten embedding strategy pattern to flat functions`

---

### Task 3: Remove stChanges from Domain Functions

**Objective:** Remove the `stChanges` return value and all ST sync logic from domain functions: graph merge, edge consolidation, communities, reflection, and the `applySyncChanges()` orchestrator.

**Depends on:** Task 2

**Files to modify:**
- Modify: `src/extraction/extract.js` (remove `applySyncChanges()` function entirely; remove all `stChanges` accumulation and sync calls in `extractMemories()`; remove imports from `../services/st-vector.js`; remove `isStSynced`/`markStSynced`/`cyrb53` imports; remove `stampStVectorFingerprint` import and usage)
- Modify: `src/graph/graph.js` (remove `syncNode()` helper; remove `stChanges` from return values of `mergeOrInsertEntity()` and `consolidateEdges()`; remove all internal `toSync`/`toDelete` accumulation; remove imports from `../services/st-vector.js` and `isStSynced`/`markStSynced` from codec)
- Modify: `src/graph/communities.js` (remove `stChanges` from return value of `updateCommunitySummaries()`; remove sync logic; remove `isStSynced`/`markStSynced` imports)
- Modify: `src/reflection/reflect.js` (remove `stChanges` from return value of `generateReflections()`; remove sync logic)
- Modify: `tests/extraction/extract.test.js` (remove `applySyncChanges()` test cases; remove `stChanges` assertions from extraction tests)
- Modify: `tests/graph/graph.test.js` (remove `syncNode()` tests; remove `stChanges` assertions)
- Modify: `tests/graph/communities.test.js` (remove `stChanges` assertions)
- Modify: `tests/reflection/reflect.test.js` (remove `stChanges` from mock return values and assertions)

**Instructions for Execution Agent:**
1. **Context Setup:** Read outlines of `src/extraction/extract.js`, `src/graph/graph.js`, `src/graph/communities.js`, `src/reflection/reflect.js`.
2. **Update tests first:** In each test file, remove assertions that check `stChanges` shape or content. Remove mock return values that include `stChanges`. Remove any test cases specifically testing `applySyncChanges()`. For `extract.test.js`, remove tests for `applySyncChanges()` function. The test CLAUDE.md states orchestrator tests should be 3-5 max (happy path, graceful degradation, fast-fail) — keep within this limit.
3. **Remove stChanges from graph:** In `src/graph/graph.js`, remove the `syncNode()` helper function. In `mergeOrInsertEntity()`, remove all `toSync`/`toDelete` accumulation logic, remove `markStSynced` calls, and change return from `{ key, stChanges }` to just `{ key }`. In `consolidateEdges()`, same treatment — remove sync accumulation, return `{ count }` or `{ edges }` without `stChanges`. Remove imports of `syncItemsToST`, `isStSynced`, `markStSynced`.
4. **Remove stChanges from communities:** In `src/graph/communities.js`, remove `stChanges` from `updateCommunitySummaries()` return value (returns `{ communities, global_world_state }`). Remove sync accumulation logic. Remove `isStSynced`/`markStSynced` imports.
5. **Remove stChanges from reflection:** In `src/reflection/reflect.js`, remove `stChanges` from `generateReflections()` return value (returns `{ reflections }`). Remove any sync logic.
6. **Remove applySyncChanges:** In `src/extraction/extract.js`, delete the `applySyncChanges()` function entirely. In `extractMemories()`, remove all `eventSyncChanges`/`graphSyncChanges` accumulation, remove calls to `applySyncChanges()`, remove `stampStVectorFingerprint()` calls, remove the `isStVectorSource()` check. Remove imports from `../services/st-vector.js`. Remove imports of `isStSynced`, `markStSynced`, `cyrb53` from codec (unless `cyrb53` is used elsewhere in the file — check before removing).
7. **Verify:** Run `npm run check`.
8. **Commit:** `refactor: remove stChanges contract from domain functions`

---

### Task 4: Remove stChanges from Store CRUD and UI

**Objective:** Remove `stChanges` from the data repository layer (`chat-data.js`) and clean up all UI handler references to `applySyncChanges`.

**Depends on:** Task 3

**Files to modify:**
- Modify: `src/store/chat-data.js` (remove `stChanges` from return values of `updateMemory()`, `deleteMemory()`, `updateEntity()`, `deleteEntity()`, `mergeEntities()`; remove all `toSync`/`toDelete` accumulation and `purgeSTCollection`/`syncItemsToST` calls; remove `isStSynced`/`cyrb53` imports)
- Modify: `src/ui/render.js` (remove all 5 blocks that check `result.stChanges` and call `applySyncChanges()` — these are at lines ~100, ~145, ~590, ~637, ~795; remove the dynamic `import('../extraction/extract.js')` for `applySyncChanges`)
- Modify: `tests/store/chat-data.test.js` (remove `stChanges` assertions)
- Modify: `tests/store/chat-data-merge.test.js` (remove ST sync verification and `stChanges` assertions)
- Modify: `tests/integration/entity-crud.test.js` (remove `stChanges` assertions if present)
- Modify: `tests/integration/phase2-e2e.test.js` (remove ST sync verification steps)

**Instructions for Execution Agent:**
1. **Context Setup:** Read outlines of `src/store/chat-data.js` and `src/ui/render.js`.
2. **Update tests first:** In `tests/store/chat-data.test.js` and `tests/store/chat-data-merge.test.js`, remove all assertions on `stChanges` (e.g., `expect(result.stChanges.toDelete[0]).toHaveProperty('hash')`). Update test expectations to match new return shapes (`{ success }` or `{ memory }` without `stChanges`). In integration tests, remove any ST sync verification steps.
3. **Clean chat-data.js:** In each CRUD function (`updateMemory`, `deleteMemory`, `updateEntity`, `deleteEntity`, `mergeEntities`), remove all `stChanges` accumulation (`const stChanges = { toSync: [], toDelete: [] }`), remove `syncItemsToST`/`deleteItemsFromST`/`purgeSTCollection` calls, remove `cyrb53` hash computation for ST sync, and remove `stChanges` from return objects. Remove imports from `../services/st-vector.js` and `isStSynced`/`cyrb53` from codec.
4. **Clean render.js:** Remove all 5 blocks that check `if (result.stChanges)` and dynamically import + call `applySyncChanges`. These are around lines 100-102, 145-147, 590-592, 637-639, and 795-797. Each block is approximately 3 lines: the `if` check, the dynamic import, and the `await applySyncChanges(...)` call.
5. **Verify:** Run `npm run check`.
6. **Commit:** `refactor: remove stChanges from store CRUD and UI handlers`

---

### Task 5: Simplify Retrieval to Single Path

**Objective:** Remove the ST Vector retrieval path and proxy score logic. Rename `selectRelevantMemoriesSimple()` to `selectRelevantMemories()` as the single retrieval function. Remove proxy scores from `calculateScore()`.

**Depends on:** Task 4

**Files to modify:**
- Modify: `src/retrieval/scoring.js` (delete `selectRelevantMemoriesWithST()` entirely; remove the `usesExternalStorage()` branch in the current `selectRelevantMemories()`/`selectRelevantMemoriesSimple()` — the simple path becomes the only path; rename `selectRelevantMemoriesSimple` to `selectRelevantMemories` if they are separate exports; remove `_proxyVectorScore` assignment and cleanup logic; remove `OVER_FETCH_MULTIPLIER` usage)
- Modify: `src/retrieval/math.js` (delete `rankToProxyScore()` function; remove `_proxyVectorScore` fallback branch in `calculateScore()` — the `if (!contextEmbedding && memory._proxyVectorScore != null)` block)
- Modify: `src/retrieval/world-context.js` (remove `stCommunityIds` parameter from `retrieveWorldContext()`; remove the `settings?.embeddingSource === 'st_vector'` branching; communities always scored via local cosine similarity)
- Delete: `tests/retrieval/st-scoring.test.js` (entire file — proxy score tests)
- Modify: `tests/retrieval/retrieve.test.js` (remove ST Vector mode test cases)
- Modify: `tests/retrieval/math.test.js` (remove `rankToProxyScore` test cases if present; remove `_proxyVectorScore` test cases)

**Instructions for Execution Agent:**
1. **Context Setup:** Read outlines of `src/retrieval/scoring.js`, `src/retrieval/math.js`, and `src/retrieval/world-context.js`.
2. **Delete ST scoring test:** Delete `tests/retrieval/st-scoring.test.js`.
3. **Update remaining tests:** In `tests/retrieval/retrieve.test.js`, remove test cases that specifically test ST Vector retrieval mode or `selectRelevantMemoriesWithST`. In `tests/retrieval/math.test.js`, remove tests for `rankToProxyScore`.
4. **Clean scoring.js:** Delete the `selectRelevantMemoriesWithST()` function entirely. In the main retrieval entry point, remove the `if (strategy.usesExternalStorage())` branch that delegates to `selectRelevantMemoriesWithST`. The existing simple/local path (fast pass BM25 → slow pass cosine → alpha blend) becomes the only path. Remove all `_proxyVectorScore` assignment and deletion logic. Remove any imports related to ST vector.
5. **Clean math.js:** Delete the `rankToProxyScore()` function. In `calculateScore()`, remove the branch that checks `memory._proxyVectorScore != null` — since embeddings are always local, `contextEmbedding` will always be available for valid scoring.
6. **Clean world-context.js:** In `retrieveWorldContext()`, remove the `stCommunityIds` parameter and the ST Vector mode branching for community selection. Communities are always scored via local cosine similarity.
7. **Verify:** Run `npm run check`.
8. **Commit:** `refactor: simplify retrieval to single local cosine similarity path`

---

### Task 6: Add ST Vector Migration Toast

**Objective:** Add a startup check that detects users with `embeddingSource === 'st_vector'` and shows a detailed toast + console error, then auto-resets to the default local model.

**Depends on:** Task 5

**Files to modify:**
- Modify: `src/settings.js` (in `loadSettings()`, after settings are loaded, check if `embeddingSource` is `'st_vector'`; if so, log a console error explaining the removal, display a toast via the ST toast API, and reset `embeddingSource` to `'multilingual-e5-small'`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/settings.js` to understand the `loadSettings()` function and how toasts are displayed in the ST extension context.
2. **Add migration check:** In `loadSettings()`, after the default settings are applied and merged, add a check: if the resolved `embeddingSource` is `'st_vector'`, then:
   - Log a detailed error to `console` (obtained via `getDeps()`) explaining: "OpenVault: ST Vector storage has been removed. Maintaining two parallel storage systems (local + ST Vectra DB) was unsustainable due to fragile sync and subpar similarity quality. Local embeddings now provide full cosine similarity control. If you need ST Vector, switch to the stable_23 branch."
   - Show a toast with a shorter version of this message using the ST toast API (`toastr` via deps).
   - Reset `embeddingSource` to `'multilingual-e5-small'` in settings.
3. **Verify:** Run `npm run check`.
4. **Commit:** `feat: add ST Vector migration toast with auto-reset to local model`

---

### Task 7: Clean Up Test Infrastructure

**Objective:** Remove remaining ST-specific test infrastructure: update `tests/setup.js` mocking, clean `tests/factories.js` defaults, and remove `_st_synced` from test factories.

**Depends on:** Task 6

**Files to modify:**
- Modify: `tests/setup.js` (remove any ST Vector mocking, `purgeSTCollection` mocks, or ST API endpoint mocks)
- Modify: `tests/factories.js` (remove `_st_synced: false` from factory default objects like `buildMockMemory()`, `buildMockGraphNode()`, etc.)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `tests/setup.js` and `tests/factories.js`.
2. **Clean setup.js:** Remove any mock setup for ST Vector API endpoints (`/api/vector/insert`, etc.), `purgeSTCollection` function mocks, or `isStVectorSource` mocks. Ensure `global.registerCdnOverrides()` calls don't reference ST vector modules.
3. **Clean factories.js:** Remove `_st_synced: false` (or `true`) from all factory default objects. Remove `_proxyVectorScore` if present in memory factories.
4. **Verify:** Run `npm run check` and `npx vitest run` to ensure all tests pass.
5. **Commit:** `test: clean up ST Vector test infrastructure`

---

### Task 8: Final Verification and Cleanup

**Objective:** Run full verification suite, ensure no dangling ST Vector references remain, and clean up any residual documentation.

**Depends on:** Task 7

**Files to modify:**
- Modify: `include/DATA_SCHEMA.md` (remove any ST Vector sections if present)
- Modify: `src/services/CLAUDE.md` (remove ST Vector service documentation)
- Modify: `src/store/CLAUDE.md` (update stChanges contract section to note it's removed)
- Modify: `src/retrieval/CLAUDE.md` (remove ST Vector retrieval notes)
- Modify: `tests/CLAUDE.md` (remove the "Verify ST sync shapes" section from store test rules)

**Instructions for Execution Agent:**
1. **Grep for residuals:** Search the entire `src/` and `tests/` directories for any remaining references to: `st_vector`, `stVector`, `StVector`, `st_synced`, `stChanges`, `stChanges`, `proxyVectorScore`, `rankToProxyScore`, `ST_API_ENDPOINTS`, `OVER_FETCH_MULTIPLIER`, `applySyncChanges`. Report any findings.
2. **Fix any residuals found.**
3. **Update docs:** In `include/DATA_SCHEMA.md`, remove sections describing ST Vector storage fields (`_st_synced`, `_proxyVectorScore`). In domain CLAUDE.md files, remove references to ST Vector, `stChanges` contract, and sync patterns. In `tests/CLAUDE.md`, remove the "Verify ST sync shapes" rule.
4. **Run full check:** Run `npm run check` to confirm all pre-commit checks pass (sync-version, generate-types, lint, jsdoc, css, typecheck).
5. **Run full test suite:** Run `npx vitest run` and confirm all tests pass.
6. **Commit:** `docs: update documentation after ST Vector removal`
