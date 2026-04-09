# Fingerprint-Based Message Tracking

**Date**: 2026-03-22
**Status**: Draft → v2 → v3 → v4
**Scope**: `src/extraction/scheduler.js`, `src/extraction/extract.js`, `src/events.js`, `src/constants.js`

## Problem

Two issues compound into one bug:

### 1. DRY Violation — Two Tracking Mechanisms

The codebase has two independent systems deciding "is this message already processed?":

- **Scheduler** (worker path): Set-based. `getExtractedMessageIds()` builds a `Set<number>` from `PROCESSED_MESSAGES_KEY` + `memory.message_ids`, then `getUnextractedMessageIds()` checks index membership.
- **Extract.js** (incremental path): Watermark-based. Filters `chat.filter(m.id > data[LAST_PROCESSED_KEY])`.

They serve the same purpose but can disagree when the chat array is modified externally.

### 2. Index Fragility — Array Indices as Message Identity

Both systems store **array indices** as message identifiers. Any extension that splices `context.chat` (deleting, inserting, or reordering messages) makes those stored indices point at wrong messages.

**Concrete example** (InlineSummary extension):

1. OpenVault extracts messages at indices `[0, 1, ..., 37]`, stores them in `PROCESSED_MESSAGES_KEY`
2. InlineSummary summarizes messages 0–20 → deletes 21 messages, inserts 3 summaries
3. Chat shrinks from 100 to 82 messages. All indices after position 2 shift down by 18.
4. Message originally at index 50 is now at index 32
5. `PROCESSED_MESSAGES_KEY` contains `32` (from original processing) → OpenVault thinks index 32 is done
6. The message at new index 32 is a **completely different message** that gets silently skipped

**Note**: Real-time extraction (processing the latest 2 messages after user sends + bot replies) is mostly unaffected — new messages append at the end and their indices don't collide with the processed Set. The breakage affects **backfill** and any situation where stored indices become stale.

### Secondary DRY Issue — `is_system` Filter

- `extract.js` filters `!m.is_system` when selecting candidates
- `scheduler.js` does NOT filter system messages in `getUnextractedMessageIds`

System messages accumulate as "unextracted" in the scheduler's view, inflating batch counts.

## Design

### Core Idea

Replace array indices with **message fingerprints** as identifiers. A fingerprint is derived from stable message properties that don't change when the array is spliced. Use a single `Set<fingerprint>` as the sole source of truth for "has this message been processed?"

### Fingerprint Function

```js
import { cyrb53 } from '../utils/embedding-codec.js';

export function getFingerprint(msg) {
    if (msg.send_date) return String(msg.send_date);
    // Fallback: content hash for imported chats without send_date
    return `hash_${cyrb53((msg.name || '') + (msg.mes || ''))}`;
}
```

SillyTavern sets `send_date` on every message at creation time (millisecond-precision timestamp string). It never changes when the array is spliced. It's unique per message within a chat.

Fallback uses `cyrb53` (already in the codebase at `utils/embedding-codec.js`) to hash sender + content. This prevents imported chats (Character.ai, TavernAI, plain JSON) from collapsing all `send_date`-less messages into one fingerprint.

### Changes

#### `src/extraction/scheduler.js`

**Remove**: `getExtractedMessageIds(data)` (returns `Set<number>` from indices)

**Add**: `getProcessedFingerprints(data)` — returns `Set<string>` from stored fingerprints:

```js
export function getProcessedFingerprints(data) {
    return new Set(data[PROCESSED_MESSAGES_KEY] || []);
}
```

**Change**: `getUnextractedMessageIds(chat, processedFps)` — check fingerprint membership instead of index membership. Add `is_system` filter:

```js
export function getUnextractedMessageIds(chat, processedFps) {
    const unextracted = [];
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i].is_system && !processedFps.has(getFingerprint(chat[i]))) {
            unextracted.push(i);
        }
    }
    return unextracted;
}
```

**Update callers**: `isBatchReady`, `getNextBatch`, `getBackfillStats`, `getBackfillMessageIds` — all call `getProcessedFingerprints` instead of `getExtractedMessageIds`.

**Fix `getBackfillStats` extracted count**: Dead fingerprints (from messages deleted by extensions) inflate `processedFps.size`. Derive `extractedCount` from visible chat instead:

```js
// BEFORE:
extractedCount: extractedIds.size,

// AFTER:
const nonSystemCount = chat.filter(m => !m.is_system).length;
extractedCount: Math.max(0, nonSystemCount - unextractedIds.length),
```

Same fix needed in `src/ui/helpers.js:calculateExtractionStats` which also uses `extractedMessageIds.size` directly.

#### `src/extraction/extract.js`

**Remove**: Incremental mode (watermark path). The `if (messageIds) / else` branch currently has two paths. The watermark path is dead code (no caller invokes `extractMemories()` without IDs), but we replace both with a single path that falls through to the scheduler if no IDs are provided (defensive):

```js
// BEFORE (two paths, watermark is dead code):
if (messageIds && messageIds.length > 0) {
    messagesToExtract = messageIds.map(id => ({ id, ...chat[id] })).filter(m => m != null);
} else {
    const lastProcessedId = data[LAST_PROCESSED_KEY] || -1;
    // ... watermark logic ...
}

// AFTER (one path, scheduler fallback):
if (!messageIds || messageIds.length === 0) {
    const batch = getNextBatch(chat, data, settings.extractionTokenBudget);
    if (!batch) return { status: 'skipped', reason: 'no_new_messages' };
    messagesToExtract = batch.map(id => ({ id, ...chat[id] }));
} else {
    messagesToExtract = messageIds.map(id => ({ id, ...chat[id] })).filter(m => m != null);
}
```

This ensures any future caller (or test) that calls `extractMemories()` without IDs goes through the scheduler instead of crashing.

**Remove**: `LAST_PROCESSED_KEY` usage entirely.

**Change**: After processing, store fingerprints instead of indices:

```js
// BEFORE:
data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
data[PROCESSED_MESSAGES_KEY].push(...processedIds);           // indices
data[LAST_PROCESSED_KEY] = Math.max(data[LAST_PROCESSED_KEY] || -1, maxId);

// AFTER:
data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
const processedFps = messages.map(m => getFingerprint(m));
data[PROCESSED_MESSAGES_KEY].push(...processedFps);           // fingerprints
// No LAST_PROCESSED_KEY
```

**Keep unchanged**: `memory.message_ids` — stays as array indices. Used only for:
- `sequence` computation (`minMessageId * 1000 + index`)
- Informational metadata on events

It is **decoupled from tracking**. `getProcessedFingerprints` does NOT read `memory.message_ids`.

#### `src/constants.js`

**Remove**: `LAST_PROCESSED_KEY` export.

#### `src/utils/data.js` — Initializer Cleanup

Remove `[LAST_PROCESSED_KEY]: -1` from the `getOpenVaultData()` initializer (line 300).

#### `src/events.js` — Auto-Hide Fix + Migration Hook

`autoHideOldMessages()` imports `getExtractedMessageIds(data)` and checks `extractedMessageIds.has(idx)` where `idx` is a number. After the rename to `getProcessedFingerprints` (returns `Set<string>`), this would always return `false` — auto-hide silently stops hiding anything.

**Fix**: Update to use fingerprint-based checking:

```js
// BEFORE:
const extractedMessageIds = getExtractedMessageIds(data);
// ...
if (!extractedMessageIds.has(idx)) continue;  // idx is a number

// AFTER:
const processedFps = getProcessedFingerprints(data);
// ...
if (!processedFps.has(getFingerprint(chat[idx]))) continue;  // fingerprint is a string
```

**Migration hook**: Call `migrateProcessedMessages(chat, data)` inside `onChatChanged()` (after existing data initialization, before the worker wakes). This runs once per chat open — if migration detects old format, it converts and saves immediately.

#### Other Consumers (Safe — No Changes Needed)

These import `getExtractedMessageIds` + `getUnextractedMessageIds` together and pass the result of one into the other. After renaming both functions, they continue to work because the types stay consistent:

- `src/ui/settings.js:887-892` — extraction progress indicator
- `src/ui/status.js:108-143` — status bar counts

These just need import name updates (`getExtractedMessageIds` → `getProcessedFingerprints`).

`src/extraction/extract.js:970` — backfill guard (`alreadyExtractedIds`). Same rename.

### Migration

Map existing indices to fingerprints using the current chat array. This avoids re-extracting the entire chat through the LLM (which would burn API credits before dedup catches duplicates in Phase 4).

Includes a temporal safety check: if an index now points at a message that was sent *after* the newest memory was created, that index has shifted onto a new message — skip it to prevent data loss.

ST's `send_date` can be ISO 8601 (`"2023-10-01T12:00:00.000Z"`), a localized string (`"October 1, 2023 12:00 PM"`), a numeric string (`"1710928374823"`), or an actual Number. A helper handles all formats:

```js
/** Parse ST's send_date (ISO, localized, numeric string, or Number) into ms. */
function parseSendDate(sendDate) {
    const val = String(sendDate);
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    return Date.parse(val) || 0;
}

export function migrateProcessedMessages(chat, data) {
    const processed = data[PROCESSED_MESSAGES_KEY];
    if (!processed?.length || typeof processed[0] !== 'number') return false;

    const fps = new Set();

    // Temporal boundary: messages sent after our last extraction are definitely new
    const lastMemoryTime = Math.max(0, ...(data[MEMORIES_KEY] || []).map(m => m.created_at || 0));

    // 1. Map PROCESSED_MESSAGES_KEY indices to fingerprints
    for (const idx of processed) {
        const msg = chat[idx];
        if (!msg) continue;
        // Safety: if this message was sent after our last memory, the index
        // has shifted onto a NEW message. Skip it to force extraction.
        if (lastMemoryTime > 0 && msg.send_date) {
            const sendTime = parseSendDate(msg.send_date);
            if (sendTime && sendTime > lastMemoryTime) continue;
        }
        fps.add(getFingerprint(msg));
    }

    // 2. Map memory.message_ids indices as safety net (same temporal guard)
    for (const memory of data[MEMORIES_KEY] || []) {
        for (const idx of memory.message_ids || []) {
            const msg = chat[idx];
            if (!msg) continue;
            if (lastMemoryTime > 0 && msg.send_date) {
                const sendTime = parseSendDate(msg.send_date);
                if (sendTime && sendTime > lastMemoryTime) continue;
            }
            fps.add(getFingerprint(msg));
        }
    }

    data[PROCESSED_MESSAGES_KEY] = Array.from(fps);
    delete data[LAST_PROCESSED_KEY];
    return true;
}
```

**User notification**: Show a toast so the user understands any one-time re-processing:

```js
if (migrateProcessedMessages(chat, data)) {
    getDeps().showToast('info', 'OpenVault upgraded tracking format.', 'Data Migration');
    await saveOpenVaultData();
}
```

### Data Flow (After)

```
new message arrives
  → worker wakes
  → getNextBatch(chat, data, tokenBudget)
      → getProcessedFingerprints(data) → Set<send_date>
      → getUnextractedMessageIds(chat, fps) → [indices of unprocessed messages]
      → accumulate oldest until token budget → return batch indices
  → extractMemories(batch, chatId, { silent: true })
      → process messages via LLM
      → store fingerprints in PROCESSED_MESSAGES_KEY
      → save
  → next iteration: those fingerprints in Set → messages skipped
```

One path. One source of truth. No watermark.

## What Stays Unchanged

- **`memory.message_ids`** — indices, metadata only, not used for tracking
- **Worker loop** — still calls `getNextBatch()` → `extractMemories(batch, ...)`
- **Backfill flow** — still calls `getBackfillMessageIds()` → processes batches
- **Dedup, embeddings, graph, reflections, communities** — untouched
- **UI, settings, prompts** — untouched

## Known Limitations

### Narrative Distance Anomaly with Chat-Modifying Extensions

`getMemoryPosition(memory)` in `text.js:270` uses `memory.message_ids` (original indices) to compute average position for bucket assignment (old/mid/recent). If an extension shrinks the chat, `chatLength` drops but stored `message_ids` don't adjust — memories artificially appear "more recent" and decay slower than expected.

**Impact**: Marginal. Bucket thresholds are wide (100/500 messages). A memory shifting from "old" to "mid" due to chat shrinkage has minimal effect on retrieval quality.

**Why not fix now**: Would require O(N) lookups to map `send_date` back to current chat indices during the scoring loop. Performance cost outweighs the edge-case benefit. Accept as known anomaly.

## Edge Cases

| Case | Behavior |
|------|----------|
| Extension inserts summary messages | Summary has its own `send_date` → treated as new unprocessed message → extracted if in a batch → dedup catches overlap with already-extracted events |
| Extension deletes messages | Fingerprints of deleted messages stay in Set (dead entries, harmless). No incorrect skipping of other messages. |
| Two messages with identical `send_date` | Extremely unlikely (ms precision in ST). If it happens, second message is skipped. Acceptable risk. |
| Message content edited by user | `send_date` unchanged → stays "processed". Same behavior as before. Correct — the message identity didn't change. |
| Old data with index-based format | Indices mapped to fingerprints via current chat. Shifted indices produce harmless dead entries. No full re-extraction. |
| `send_date` missing on a message | Content-hash fallback (`cyrb53(name + mes)`) guarantees unique fingerprints per distinct message. Handles imported chats from Character.ai, TavernAI, etc. |

## Testing Strategy

- **Unit**: `getFingerprint` — returns `send_date` when present, content hash when missing
- **Unit**: `getProcessedFingerprints` — builds Set from stored fingerprints
- **Unit**: `getUnextractedMessageIds` — fingerprint checking, `is_system` filtering
- **Unit**: `migrateProcessedMessages(chat, data)` — maps old indices to fingerprints, handles shifted indices, handles out-of-bounds indices
- **Unit**: `getNextBatch` / `isBatchReady` / `getBackfillStats` — work with fingerprints
- **Integration**: Simulate chat modified by extension (spliced array), verify correct messages identified as unextracted
- **Regression**: Existing scheduler and extract tests updated for new function signatures

## Files Changed

| File | Nature of Change |
|------|-----------------|
| `src/extraction/scheduler.js` | Add `getFingerprint`, `migrateProcessedMessages` (with temporal guard), rename `getExtractedMessageIds` → `getProcessedFingerprints`, update `getUnextractedMessageIds` to use fingerprints + `is_system` filter, fix `getBackfillStats` extracted count |
| `src/extraction/extract.js` | Remove watermark/incremental path (replace with scheduler fallback), store fingerprints instead of indices, update backfill guard import |
| `src/events.js` | Update `autoHideOldMessages` to use fingerprints; hook `migrateProcessedMessages` into `onChatChanged` |
| `src/ui/helpers.js` | Fix `calculateExtractionStats` to derive `extractedCount` from visible chat, not `Set.size` |
| `src/ui/settings.js` | Import rename: `getExtractedMessageIds` → `getProcessedFingerprints` |
| `src/ui/status.js` | Import rename: `getExtractedMessageIds` → `getProcessedFingerprints` |
| `src/utils/data.js` | Remove `[LAST_PROCESSED_KEY]: -1` from `getOpenVaultData()` initializer |
| `src/constants.js` | Remove `LAST_PROCESSED_KEY` export |
| `tests/scheduler.test.js` | Update for new function signatures, fingerprint tracking, migration with temporal guard |
| `tests/extract.test.js` | Update for removed incremental mode, fingerprint storage |
