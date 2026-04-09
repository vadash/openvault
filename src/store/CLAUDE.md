# Storage, State, and Migrations

## REPOSITORY PATTERN
Mutate chat data exclusively through repository methods in `store/chat-data.js`. Never `push()` to arrays from domain code.
For the full method list see `include/DATA_SCHEMA.md` Section 2.

- **Protect async saves with chat-change guards.** Pass `expectedChatId` to `saveOpenVaultData()`. Abort if user switched chats mid-operation.
- **Isolate background extraction from manual backfills.** `operationState.extractionInProgress` flags manual backfills. `isWorkerRunning()` flags the background worker. Ensure they mutually exclude.
- **Scope kill-switches to current session.** Use `isSessionDisabled()` for catastrophic migration failures. Never mutate global extension settings.

## ST CHANGES CONTRACT (canonical)
Every store mutation that touches embeddings must return `{ toSync?, toDelete? }` alongside its primary result. Missing either causes orphaned embeddings.

- **toDelete items:** Always `{ hash: number }` objects, never plain strings.
- **Hash computation:** `cyrb53(text)` (returns number), never `.toString()`.
- **Schema contract:** `StSyncChangesSchema` in `schemas.js` validates shapes — keep in sync.
- **Affected functions:** `updateEntity`, `mergeEntities`/`mergeOrInsertEntity`, `updateMemory`, `deleteMemory`, `consolidateEdges`.
- **Check all early-return paths.** Most leaks come from `return` statements before sync logic runs. Use a local `stChanges` object initialized at function top and returned at every exit.
- **Use `syncNode(key)` helper** (from `graph.js`) to avoid duplicating the `[OV_ID:${key}] ${description}` + `cyrb53` boilerplate in every merge path.
- **Queue edges for re-sync after merge rewriting.** Both collision and rewrite branches in `mergeEntities` must push modified edges to `toSync` after calling `deleteEmbedding()`. Follow the same `[OV_ID:edge_{source}_{target}] ${description}` + `cyrb53` pattern as `consolidateEdges`.
- **Filter archived memories before cache operations.** `updateIDFCache` must count only `!m.archived` memories.

## ENTITY GRAPH MUTATIONS
- **Guard `_mergeRedirects` before access.** `if (!graph._mergeRedirects) graph._mergeRedirects = {};` — older data may lack this field.
- **Rewrite edges on rename.** Edge keys are `sourceKey__targetKey`. On rename, iterate all edges, rebuild keys, delete old, write new.
- **Set merge redirect on rename.** `graph._mergeRedirects[oldKey] = newKey`. Also update redirects pointing to `oldKey`. `_resolveKey()` follows redirect chains up to `MAX_REDIRECT_DEPTH` (10) with circular-reference guard.
- **Delete ST Vector orphans on rename/delete.** If `node._st_synced === true`, hash via `cyrb53(\`[OV_ID:${key}] ${node.description}\`)` and return as `stChanges.toDelete`. Hash format must match `graph.js:486` — no `|| node.name` fallback.
- **Return structured results.** Use `{ success, stChanges? }` for delete, `{ key, stChanges? }` for update.

## SCHEMA MIGRATIONS
See `src/store/migrations/CLAUDE.md` for migration anatomy and rollback patterns.
- **Three-point updates:** When adding fields, update: (1) `getOpenVaultData()` for new chats, (2) migration backfill, (3) Zod schemas in `schemas.js`.
- **No defensive domain checks.** Migrations must fully backfill so domain code can trust schema shape.

## ENTITY MERGE TESTS
- **`tests/store/chat-data-merge.test.js`** uses inline objects, not `buildMockGraphNode()`. Merge tests need explicit control over field combinations where factory defaults obscure test intent.
- **Uses `setDeps()` alongside `setupTestContext()`.** Merge module imports `getDeps()` internally, so tests must call `setDeps()` directly.
