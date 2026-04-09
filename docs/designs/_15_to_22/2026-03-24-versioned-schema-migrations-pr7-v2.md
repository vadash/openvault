# PR 7: Versioned Schema Migrations

## Goal
Establish a centralized, version-tracked migration pipeline. Transition from scattered lazy data checks (handling legacy formats on-the-fly during reads) to eager migrations (running exactly once when a chat loads).

Designate the current target data shape as **v2**. Legacy shapes are implicitly **v1**:
- Index-based `processed_message_ids` (now fingerprint strings)
- Raw `embedding: number[]` arrays (now `embedding_b64` strings)
- Missing graph state fields

**Non-goal:** This does NOT replace `src/embeddings/migration.js`. Embedding model mismatch (switching from Ollama to WebGPU) is a runtime environment change, not a structural schema change. That stays separate.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Eager, run-on-load pipeline | Validating/migrating data on `onChatChanged` guarantees the rest of the application only ever interacts with the newest data shape. |
| Version Tracking | `schema_version` at root | `data.schema_version` (integer). If missing, assumed to be v1. |
| Isolation | `src/store/migrations/` folder | Keeps `store/chat-data.js` clean. Follows standard DB migration patterns. |
| Error Handling | Transactional rollback + session kill-switch | Backup via `structuredClone()` before migration. On failure: restore backup, set session-scoped flag (NOT global settings), show error toast. |
| Lazy Codec | Removed | Because v2 migration eagerly converts all `embedding: number[]` to `embedding_b64`, the codec becomes simpler and faster. |
| New Chat Schema | Eager instantiation | `getOpenVaultData()` creates complete v2 schema for new chats. Migration only backfills legacy data. |

## Architecture

```
src/store/migrations/
├── index.js      # Orchestrator: version check, migration loop, error handling
└── v2.js         # v1 → v2 migration logic
```

### Migration Orchestrator (`index.js`)

**Responsibilities:**
- Check `data.schema_version` against current target version
- Run required migrations sequentially
- Handle errors with transactional rollback

```javascript
const CURRENT_SCHEMA_VERSION = 2;
const MIGRATIONS = [
    { version: 2, run: migrateToV2 },
];

export function runSchemaMigrations(data, chat) {
    const currentVersion = data.schema_version || 1;

    // No migration needed
    if (currentVersion >= CURRENT_SCHEMA_VERSION) {
        return false;
    }

    for (const migration of MIGRATIONS) {
        if (currentVersion < migration.version) {
            migration.run(data, chat);
            data.schema_version = migration.version;
        }
    }

    return true;
}
```

### v2 Migration Logic (`v2.js`)

**Three operations, in order:**

1. **Processed Messages Migration**
   - Move `migrateProcessedMessages` from `scheduler.js`
   - Converts integer indices to string fingerprints
   - Includes temporal guard (skip indices pointing to messages sent after last memory)

2. **Embedding Array to Base64**
   - Loop over `data.memories`, `data.graph.nodes`, `data.communities`
   - If `obj.embedding` (Array) exists, call `encode()` from `embedding-codec.js` to convert to `embedding_b64`
   - Delete `obj.embedding`
   - **Note:** Uses exported `encode()` from codec — no duplicated logic

3. **Graph Initialization (Legacy Backfill)**
   - Ensure `data.graph`, `data.communities`, `data.graph_message_count` exist
   - Only runs for v1 chats — new chats already have these from `getOpenVaultData()`

### Transactional Rollback Pattern

```javascript
// In events.js onChatChanged()
if (data && (!data.schema_version || data.schema_version < 2)) {
    const backup = structuredClone(data);

    try {
        if (runSchemaMigrations(data, chat)) {
            showToast('info', 'OpenVault database optimized.', 'Data Migration');
            await saveOpenVaultData();
        }
    } catch (error) {
        // Rollback
        logError('Schema migration failed! Rolling back.', error);
        context.chatMetadata[METADATA_KEY] = backup;

        // Session kill-switch: set flag in state.js (NOT global settings!)
        setSessionDisabled(true);
        showToast('error', 'Data migration failed. OpenVault disabled for this chat session.');
        return;
    }
}
```

### Session Kill-Switch (`state.js`)

**Why not mutate settings?** SillyTavern's settings object is global. Setting `enabled = false` would disable OpenVault for ALL chats until manually toggled.

**Solution:** Add a session-scoped runtime flag:

```javascript
// In src/state.js
let _sessionDisabled = false;

export function isSessionDisabled() {
    return _sessionDisabled;
}

export function setSessionDisabled(value) {
    _sessionDisabled = value;
}
```

**Guard locations:** Add `isSessionDisabled()` check to entry points:
- `onBeforeGeneration()` in `events.js`
- `onMessageReceived()` in `events.js`
- `extractAllMessages()` in `extract.js`
- Reset on `onChatChanged()` (new chat = fresh start)
```

## File-by-File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/store/migrations/index.js` | Orchestrator: version check, migration loop |
| `src/store/migrations/v2.js` | v1 → v2 conversion logic |
| `tests/store/migrations.test.js` | Unit tests with mock v1 data |

### Modified Files

| File | Change |
|------|--------|
| `src/store/chat-data.js` | New chats get complete v2 schema: `schema_version`, `memories`, `character_states`, `graph`, `communities`, `graph_message_count` |
| `src/state.js` | Add `isSessionDisabled()`, `setSessionDisabled()` for migration failure handling |
| `src/events.js` | Replace `migrateProcessedMessages` with `runSchemaMigrations` + rollback; add session disabled guards |
| `src/extraction/scheduler.js` | Delete `migrateProcessedMessages` |
| `src/utils/embedding-codec.js` | Export `encode()` for migration; remove legacy array fallbacks |
| `src/extraction/extract.js` | Delete `initGraphState` — repository guarantees shape |

### Deleted Code

| Location | What's Removed |
|----------|----------------|
| `scheduler.js` | `migrateProcessedMessages` function |
| `embedding-codec.js` | `obj.embedding && obj.embedding.length` fallbacks, `hasEmbedding()` legacy array check |
| `extract.js` | `initGraphState` function (repository guarantees shape) |

## Execution Order

| Step | File | Risk | Test Impact |
|------|------|------|-------------|
| 1 | `migrations/v2.js` & `migrations/index.js` | Low | Create test file. Mock v1 data, assert v2 output. |
| 2 | `embedding-codec.js` | Low | Export `encode()`. Add unit test for exported function. |
| 3 | `store/chat-data.js` | Low | Instantiate full v2 schema. Assert all fields present on new chats. |
| 4 | `state.js` | Low | Add session disabled flag. Unit test getters/setters. |
| 5 | `events.js` | Medium | Wire rollback + session kill-switch. Manual testing. |
| 6 | `scheduler.js` | Low | Delete function and its tests. |
| 7 | `embedding-codec.js` | Medium | Remove legacy fallbacks. Update tests to expect null on old arrays. |
| 8 | `extract.js` | Low | Delete `initGraphState`. Verify extraction still works (repo guarantees shape). |

## Verification

**Code search:**
```bash
grep -r "obj.embedding &&" src/       # Must return 0 hits
grep -r "\.embedding\.length" src/    # Must return 0 hits
grep -r "initGraphState" src/         # Must return 0 hits (deleted)
```

**Test suite:**
```bash
npm run test  # All green
```

**Manual verification:**
1. Find old SillyTavern chat with v1 data (raw embedding arrays)
2. Load the chat
3. Verify "OpenVault database optimized" toast
4. Inspect `chatMetadata.openvault` — `schema_version: 2`, fingerprints as strings, embeddings as `_b64`

## Future Migrations

When adding features that change the data structure (e.g., adding `tags: []` to memories):

1. Create `migrations/v3.js` with the transformation
2. Add to `MIGRATIONS` array in `index.js`
3. Bump `CURRENT_SCHEMA_VERSION` to 3
4. Domain code assumes v3 shape — no defensive `if (!memory.tags)` checks

This eliminates future debt at the source.