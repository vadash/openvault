# Swipe Protection: Tail-Trim Recent Turns from Extraction Batches

## Problem

When the main LLM produces a hallucinated response, and that response coincides with OpenVault hitting the extraction token threshold, the hallucinated content gets extracted into entities, community summaries, and memories. If the user swipes (regenerates), the damage is already done — there's no mechanism to undo extraction of a bad AI response.

## Solution

Exclude the last N complete turns from extraction batches by trimming the batch tail. This gives the user time to review and swipe before the content enters the vault.

Retrieval pipeline is **not affected** — this is purely an extraction-side change.

## Design

### Constant

Add to `src/constants.js`:

```js
/** Number of complete turns (User+Bot pairs) to exclude from the tail of extraction batches.
 *  Prevents hallucinated/swiped AI responses from being extracted before the user can review.
 *  Emergency Cut and backfill bypass this. */
const SWIPE_PROTECTION_TAIL_MESSAGES = 1;
```

Default of `1` covers the reported case: exclude the single most recent AI response and its paired user message.

### Helper: `trimTailTurns()`

New function in `src/extraction/scheduler.js`. Reuses the same Bot→User boundary logic that `snapToTurnBoundary()` already uses.

```js
/**
 * Trim N complete turns from the tail of a snapped batch.
 * A "turn" ends at a Bot→User boundary (bot message followed by user message or end of chat).
 * Returns the trimmed array, or the original if trimming would empty it.
 */
function trimTailTurns(chat, messageIds, turnsToTrim) {
    if (turnsToTrim <= 0 || messageIds.length === 0) return messageIds;

    let cutIndex = messageIds.length;
    let turnsFound = 0;

    for (let i = messageIds.length - 1; i >= 0; i--) {
        const id = messageIds[i];
        const msg = chat[id];
        const nextInChat = chat[id + 1];

        // Bot→User boundary (same logic as snapToTurnBoundary)
        if (msg && !msg.is_user && (!nextInChat || nextInChat.is_user)) {
            turnsFound++;
            if (turnsFound === turnsToTrim) {
                cutIndex = i;
                break;
            }
        }
    }

    // If trimming would empty the batch, return original (protect start-of-chat)
    const trimmed = messageIds.slice(0, cutIndex);
    return trimmed.length > 0 ? trimmed : messageIds;
}
```

### Integration Points

#### 1. `getNextBatch()` — Background worker batches

After `snapToTurnBoundary()` returns the snapped batch, apply tail-trim:

```js
let snapped = snapToTurnBoundary(chat, accumulated);

// ... existing edge-case handling ...

// Swipe protection: exclude recent turns from extraction
if (!isEmergencyCut) {
    snapped = trimTailTurns(chat, snapped, SWIPE_PROTECTION_TAIL_MESSAGES);
}

return snapped.length > 0 ? snapped : null;
```

#### 2. `getBackfillMessageIds()` — Manual backfill batches

Same logic, same bypass for Emergency Cut:

```js
// After accumulating all batches, trim tail turns from the final result
if (!isEmergencyCut && messageIds.length > 0) {
    const trimmed = trimTailTurns(chat, messageIds, SWIPE_PROTECTION_TAIL_MESSAGES);
    // Recalculate batchCount based on trimmed size
    // ... existing trim-incomplete-last-batch logic operates on trimmed list ...
}
```

Note: The tail-trim is applied **once** to the full accumulated list, not per-batch. This means backfill excludes the same last N turns as the background worker would.

### Exceptions

| Mode | Tail-trim applied? | Reason |
|---|---|---|
| Background worker (normal) | Yes | Core use case |
| Manual backfill | Yes | Can include recent messages |
| Emergency Cut | **No** | User explicitly wants everything extracted immediately |
| Start of chat (trim would empty batch) | **No** | `trimTailTurns` returns original if trimmed result is empty |

### What is NOT changed

- **Retrieval pipeline** — Scoring, injection, world context: all untouched
- **Prompt templates** — No changes to extraction prompts
- **Graph/merge logic** — Entity merging, dedup: untouched
- **Settings UI** — No new user-facing controls (constant-only for now)
- **Migration** — No schema changes, no data migration needed

## Testing Strategy

Unit tests in `tests/scheduler.test.js`:

1. **Trim 1 turn** from a 5-turn snapped batch → returns 4 turns
2. **Trim 0 turns** → returns original (no-op)
3. **Trim from single-turn batch** → returns original (won't empty)
4. **Emergency Cut flag bypasses** trim entirely
5. **Multi-message turns** (User, User, Bot, Bot) count as 1 turn
6. **Backfill integration** — tail-trim applied to `getBackfillMessageIds` output
7. **Batch boundary correctness** — trimmed batch still ends at a valid Bot→User boundary

## Files Changed

| File | Change |
|---|---|
| `src/constants.js` | Add `SWIPE_PROTECTION_TAIL_MESSAGES` constant |
| `src/extraction/scheduler.js` | Add `trimTailTurns()`, integrate into `getNextBatch()` and `getBackfillMessageIds()` |
| `tests/scheduler.test.js` | New test cases for `trimTailTurns()` and integration |
