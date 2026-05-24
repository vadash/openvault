# Schema Migrations

## WHAT
Version-controlled schema transformations for OpenVault data structure evolution. Located in `src/store/migrations/`.

## VERSIONING STRATEGY
- **Schema Version**: Integer stored in `data.schema_version`. Missing = v1.
- **Sequential Application**: Migrations run in order (v1→v2, v2→v3, etc.) on chat load.
- **New Chats**: Get current version from `getOpenVaultData()` in `store/chat-data.js`.

## WHEN TO ADD A MIGRATION
1. **New Field**: Adding a new field to the data schema
2. **Field Rename/Move**: Changing field names or structure
3. **Data Transformation**: Converting existing data to new format (e.g., indices→fingerprints)
4. **Backfill**: Initializing new fields from existing data

## MIGRATION ANATOMY (`vN.js`)
```javascript
export function migrateToV2(data, chat) {
    let changed = false;
    // Transform data...
    return changed;
}
```

## TRANSACTIONAL ROLLBACK PATTERN
```javascript
const backup = structuredClone(data);
try {
    if (runSchemaMigrations(data, chat)) { await saveOpenVaultData(); }
} catch (error) {
    context.chatMetadata[METADATA_KEY] = backup;  // Restore
    setSessionDisabled(true);  // Per-session, NOT global settings
}
```

## EMBEDDING MIGRATION ITEM TYPES
- **Always include graph edges.** `_countEmbeddings`, `_hasSyncedItems`, `_clearAllStSyncFlags`, and `invalidateStaleEmbeddings` must iterate all 3 types: memories, nodes, edges. Missing edges causes desync on model changes.

## SCHEMA VS EMBEDDING MIGRATIONS
**Different pipelines, different triggers:**
- **Schema Migrations** (`src/store/migrations/`): Structural changes. Run on chat load.
- **Embedding Migrations** (`src/embeddings/migration.js`): Runtime environment changes (Ollama→WebGPU, model switches). Run on `CHAT_CHANGED` and embedding source dropdown change.

## GOTCHAS & RULES
- **Fingerprint migrations need chat.** Migrations that convert `message_ids` indices to `message_fingerprints` must accept the `chat` array as a parameter (already threaded through `runSchemaMigrations`). Import `getFingerprint` from `../../extraction/scheduler.js`. Skip out-of-bounds indices gracefully.
- **No Defensive Checks**: Domain code assumes schema shape — migrations must backfill all fields.
- **Chat Context**: Pass `chat` array to migrations that need message data (e.g., fingerprint conversion).
- **Test Coverage**: Every migration needs test cases for: fresh data, already-migrated data, partial migration recovery.
