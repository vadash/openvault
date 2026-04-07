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

## SCHEMA VS EMBEDDING MIGRATIONS
**Different pipelines, different triggers:**
- **Schema Migrations** (`src/store/migrations/`): Structural changes. Run on chat load.
- **Embedding Migrations** (`src/embeddings/migration.js`): Runtime environment changes (Ollama→WebGPU, model switches). Run on `CHAT_CHANGED` and embedding source dropdown change.

## GOTCHAS & RULES
- **Three-Point Updates**: When adding fields, update: (1) `getOpenVaultData()` for new chats, (2) migration backfill for existing chats, (3) tests in `tests/store/chat-data.test.js` and `tests/store/migrations.test.js`.
- **Fingerprint migrations need chat.** Migrations that convert `message_ids` indices to `message_fingerprints` must accept the `chat` array as a parameter (already threaded through `runSchemaMigrations`). Import `getFingerprint` from `../../extraction/scheduler.js`. Skip out-of-bounds indices gracefully.
- **No Defensive Checks**: Domain code assumes schema shape — migrations must backfill all fields.
- **Chat Context**: Pass `chat` array to migrations that need message data (e.g., fingerprint conversion).
- **Test Coverage**: Every migration needs test cases for: fresh data, already-migrated data, partial migration recovery.
