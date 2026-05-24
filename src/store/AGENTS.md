# Storage, State, and Migrations

## REPOSITORY PATTERN
Mutate chat data exclusively through repository methods in `store/chat-data.js`. Never `push()` to arrays from domain code.
For the full method list see `include/DATA_SCHEMA.md` Section 2.

- **Protect async saves with chat-change guards.** Pass `expectedChatId` to `saveOpenVaultData()`. Abort if user switched chats mid-operation.
- **Isolate background extraction from manual backfills.** `operationState.extractionInProgress` flags manual backfills. `isWorkerRunning()` flags the background worker. Ensure they mutually exclude.
- **Scope kill-switches to current session.** Use `isSessionDisabled()` for catastrophic migration failures. Never mutate global extension settings.

## EMBEDDING STORAGE
All embeddings are stored locally as Base64-encoded Float32Array. No external storage or sync contracts.

## ENTITY GRAPH MUTATIONS
- **Guard `_mergeRedirects` before access.** `if (!graph._mergeRedirects) graph._mergeRedirects = {};` — older data may lack this field.
- **Rewrite edges on rename.** Edge keys are `sourceKey__targetKey`. On rename, iterate all edges, rebuild keys, delete old, write new.
- **Set merge redirect on rename.** `graph._mergeRedirects[oldKey] = newKey`. Also update redirects pointing to `oldKey`. `_resolveKey()` follows redirect chains up to `MAX_REDIRECT_DEPTH` (10) with circular-reference guard.
- **Delete embeddings on rename/delete.** Call `deleteEmbedding()` from codec to remove Base64 vector.
- **Return structured results.** Use `{ success }` for delete, `{ key }` for update.

## SCHEMA MIGRATIONS
See `src/store/migrations/CLAUDE.md` for migration anatomy and rollback patterns.
- **Three-point updates:** When adding fields, update: (1) `getOpenVaultData()` for new chats, (2) migration backfill, (3) Zod schemas in `schemas.js`.
- **No defensive domain checks.** Migrations must fully backfill so domain code can trust schema shape.

## ENTITY MERGE TESTS
- **`tests/store/chat-data-merge.test.js`** uses inline objects, not `buildMockGraphNode()`. Merge tests need explicit control over field combinations where factory defaults obscure test intent.
- **Uses `setDeps()` alongside `setupTestContext()`.** Merge module imports `getDeps()` internally, so tests must call `setDeps()` directly.

## SCHEMA FACTORY
`schemas.js` exports `getSchemas()` async function, not individual constants. Use `const { MemorySchema, ... } = await getSchemas()` to access schemas. The type generator (`scripts/generate-types.js`) calls `getSchemas()` in Node.js.
