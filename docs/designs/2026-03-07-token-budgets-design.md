# Design: Token-Based Budgets & Bot-Boundary Snapping

## 1. Problem Statement

**Extraction batching** uses a fixed message count (`messagesPerExtraction: 30`). A 30-message batch of short emotes is ~1k tokens; a 30-message batch of novel-length paragraphs is ~30k tokens. The LLM extraction prompt gets wildly inconsistent input sizes.

**Auto-hide** uses a fixed message count (`autoHideThreshold: 40`). Same problem — 40 short messages ≠ 40 long messages in terms of visible context.

**Split boundary bug**: Both extraction batching and auto-hide can split in the middle of a conversation turn. A batch ending with `User|Bot|Bot|User` leaves an orphaned User message — the Bot response gets separated from its prompt.

## 2. Goals & Non-Goals

**Must do:**
- Replace `messagesPerExtraction` with `extractionTokenBudget` (token-based)
- Replace `autoHideThreshold` with `visibleChatBudget` (token-based)
- Remove `extractionBuffer` entirely
- Use `gpt-tokenizer` (o200k encoding) for accurate token counting
- Cache per-message token counts in `chatMetadata.openvault` (compute once, never recalc)
- Ensure all batch/hide splits land on turn boundaries (shared utility)
- Wake background worker on user messages too (not just bot replies)
- Add two UI indicators showing budget fill levels with color coding
- Add setting hints explaining the budgets

**Won't do:**
- Recalculate tokens on message edit (YAGNI)
- Add tokenization as a separate pipeline stage
- Handle message deletion/reindexing (existing problem, out of scope)

## 3. Proposed Architecture

### 3.1. Token Counting Layer

New module `src/utils/tokens.js`:
- Imports `countTokens` from `https://esm.sh/gpt-tokenizer/encoding/o200k_base`
- `getMessageTokenCount(chat, index, data)` — returns cached count or computes + caches
- `getTokenSum(chat, indices, data)` — sums token counts for a list of message indices

Cache stored in `chatMetadata.openvault.message_tokens` (object keyed by message index).
Old messages without cached counts are computed lazily on first access.

### 3.2. Turn-Boundary Snapping (shared utility)

New function `snapToTurnBoundary(chat, messageIds)` in `src/utils/tokens.js`:
- Takes a list of message indices
- A split is valid when the **next message in chat** is a User message, or the split is at end-of-chat
- If the proposed endpoint is invalid, trims backward until a valid boundary is found
- Both extraction and auto-hide use this

**Rule: Split before the next User message, or at end of chat.**

Given `User(0)|Bot(1)|User(2)|Bot(3)|User(4)|User(5)|Bot(6)|Bot(7)`:

```
Split after index 1: next is User(2) ✓  → [U,B]
Split after index 3: next is User(4) ✓  → [U,B,U,B]
Split after index 7: end of chat     ✓  → [U,B,U,B,U,U,B,B]
Split after index 5: next is Bot(6)  ✗  → snap back to index 3
```

Implementation: walk backward from proposed endpoint until `chat[lastId + 1]?.is_user === true` or `lastId` is the last message in the chat.

### 3.3. Extraction Batching (scheduler.js changes)

`getNextBatch(chat, data, tokenBudget)`:
1. Get unextracted message IDs (no buffer exclusion — removed)
2. Sum all unextracted tokens → if total < `tokenBudget`, return `null` (not ready)
3. Accumulate messages from oldest until token sum ≥ budget (don't overshoot by more than 1 message)
4. `snapToTurnBoundary()` the result
5. Return the snapped batch

`isBatchReady(chat, data, tokenBudget)`:
- Returns `true` when total unextracted tokens ≥ budget

`getBackfillStats` and `getBackfillMessageIds`:
- Updated to count batches by token budget instead of message count

### 3.4. Auto-Hide (events.js changes)

`autoHideOldMessages()`:
1. Check `autoHideEnabled`
2. Get visible messages (non-`is_system`) with their token counts
3. Sum total visible tokens → if ≤ `visibleChatBudget`, return
4. Calculate excess = total − budget
5. Collect oldest visible messages until accumulated tokens ≥ excess
6. **Only include messages in `extractedMessageIds`** (skip unextracted, continue past them)
7. `snapToTurnBoundary()` the hide list
8. Mark as `is_system = true`, save

### 3.5. Worker Wake on User Messages

**Current behavior**: `onMessageReceived` skips user messages (`events.js:225`). Worker only wakes on bot replies.

**New behavior**: Wake worker on **both** user and bot messages. This lets extraction start processing accumulated content while the bot is still generating its response.

Flow:
1. User sends message → `wakeUpBackgroundWorker()` fires
2. Worker checks for ready batch → if ≥ `extractionTokenBudget` unextracted tokens, starts processing
3. Bot generates in parallel (no conflict — extraction uses separate LLM calls)
4. Bot reply arrives → `wakeGeneration++` → worker resets backoff if sleeping, re-checks after current batch
5. User sends next message → `wakeGeneration++` → same reset

The existing `wakeGeneration` + `interruptibleSleep` mechanism already handles the "timer refresh" pattern. When a new message arrives, any backoff sleep breaks early and retry counters reset.

Token counts for all messages (old and new) are computed lazily on first access via `getMessageTokenCount()` and cached in metadata. No eager pre-computation needed.

## 4. Data Models / Schema

### Settings Changes

| Old Setting | New Setting | Type | Range | Default |
|---|---|---|---|---|
| `messagesPerExtraction: 30` | `extractionTokenBudget: 16000` | slider | 4k–64k, step 1k | 16k |
| `autoHideThreshold: 40` | `visibleChatBudget: 16000` | slider | 4k–64k, step 1k | 16k |
| `extractionBuffer: 5` | *(removed)* | — | — | — |
| `autoHideEnabled: true` | *(unchanged)* | toggle | — | true |

### Metadata Schema Addition

```typescript
chatMetadata.openvault.message_tokens: {
  [messageIndex: string]: number  // o200k token count, computed once
}
// Example: { "0": 145, "1": 287, "2": 52, "3": 412, ... }
```

### UI Hint Text

- **Extraction Token Budget**: "Token threshold for extraction batches. When unextracted messages accumulate past this budget, a batch is processed. Larger = fewer LLM calls, smaller = more frequent extraction."
- **Visible Chat Budget**: "Maximum tokens visible in chat history. Oldest already-extracted messages are auto-hidden when exceeded. Acts as a minimum guarantee — chat may temporarily exceed this until extraction catches up."

## 5. Interface / API Design

### New: `src/utils/tokens.js`

```javascript
import { countTokens } from 'https://esm.sh/gpt-tokenizer/encoding/o200k_base'

const MESSAGE_TOKENS_KEY = 'message_tokens';

/**
 * Get token count for a single message. Uses cache, falls back to computation.
 * @param {Object[]} chat - Chat array
 * @param {number} index - Message index
 * @param {Object} data - OpenVault data (for cache read/write)
 * @returns {number} Token count
 */
export function getMessageTokenCount(chat, index, data) { ... }

/**
 * Sum token counts for a list of message indices.
 * @param {Object[]} chat - Chat array
 * @param {number[]} indices - Message indices
 * @param {Object} data - OpenVault data
 * @returns {number} Total tokens
 */
export function getTokenSum(chat, indices, data) { ... }

/**
 * Snap a message index list to a valid turn boundary.
 * A split is valid when the next message in chat is a User message, or at end-of-chat.
 * Trims backward until a valid boundary is found. Returns [] if none found.
 * @param {Object[]} chat - Chat array
 * @param {number[]} messageIds - Ordered message indices
 * @returns {number[]} Snapped message indices
 */
export function snapToTurnBoundary(chat, messageIds) { ... }
```

### Changed: `src/extraction/scheduler.js`

```javascript
// BEFORE:
getNextBatch(chat, data, batchSize, bufferSize = 0, maxTokens)
isBatchReady(chat, data, batchSize)
getBackfillStats(chat, data, batchSize, excludeLastN)
getBackfillMessageIds(chat, data, batchSize)

// AFTER:
getNextBatch(chat, data, tokenBudget)
isBatchReady(chat, data, tokenBudget)
getBackfillStats(chat, data, tokenBudget)
getBackfillMessageIds(chat, data, tokenBudget)
```

### Changed: `src/extraction/worker.js`

```javascript
// BEFORE:
const batchSize = settings.messagesPerExtraction || 5;
const bufferSize = settings.extractionBuffer || 5;
const batch = getNextBatch(chat, data, batchSize, bufferSize);

// AFTER:
const tokenBudget = settings.extractionTokenBudget || 16000;
const batch = getNextBatch(chat, data, tokenBudget);
```

### Changed: `src/events.js` — `autoHideOldMessages()`

Replaces count-based logic with token-sum logic using `getTokenSum`, `getMessageTokenCount`, and `snapToTurnBoundary`.

## 6. Budget Interaction: Extraction vs. Visible Chat

These two budgets are **independent controls** that interact safely:

| Scenario | Behavior |
|---|---|
| Extraction = 16k, Visible = 16k | Balanced. Once 16k unextracted accumulates → extract → auto-hide trims to 16k visible. |
| Extraction = 64k, Visible = 4k | Large batches, tiny visible window. Chat grows past 4k until 64k unextracted accumulates. After extraction, auto-hide aggressively trims. |
| Extraction = 4k, Visible = 64k | Frequent small extractions, large visible window. Auto-hide rarely triggers. |

**Key invariant**: Auto-hide only hides already-extracted messages. If `visibleChatBudget < extractionTokenBudget`, the visible chat will temporarily exceed the budget until extraction catches up. This is safe — it means the user sees more context, not less.

**Architecture note for `ARCHITECTURE.md`**: Messages must be extracted BEFORE they can be hidden. Hiding unextracted messages would cause a gap in the narrative — the extraction pipeline would never see those messages, and the memories they would have produced are permanently lost.

## 7. UI Indicators

Replace the `extractionBuffer` slider with two read-only indicators:

```
Extraction:   ████████░░░░  8.2k / 16k tokens
Visible Chat: ████████████  15.1k / 16k tokens
```

Color thresholds:
- `< 50%`: neutral/gray
- `50–80%`: yellow/amber
- `> 80%`: green (extraction close to triggering) / orange (visible close to hiding)

Update on: chat change, after extraction, after auto-hide.

## 8. Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| `gpt-tokenizer` CDN unavailable | Same risk as existing `esm.sh` imports (zod, graphology). Browser caches aggressively. |
| Very long single message exceeds budget | `getNextBatch` always includes at least 1 message (existing behavior preserved). |
| All unextracted messages are user-only | `snapToTurnBoundary` returns `[]` → batch skipped → waits for bot reply. |
| Old chats have no cached token counts | Lazy computation on first access. One-time cost, then cached. |
| Message deletion shifts indices | Existing problem (affects `processed_message_ids` too). Out of scope. |
| `extractionBuffer` removal means recent messages get extracted immediately | By design. Worker now wakes on both user and bot messages. |

## 9. Files to Modify

| File | Change |
|---|---|
| `src/utils/tokens.js` | **New** — token counting, caching, bot-boundary snapping |
| `src/constants.js` | Replace settings, update hints |
| `src/extraction/scheduler.js` | Token-based batching, remove buffer param |
| `src/extraction/worker.js` | Use `extractionTokenBudget` |
| `src/extraction/extract.js` | Update backfill to use token budget |
| `src/events.js` | Token-based auto-hide, pre-compute on MESSAGE_RECEIVED |
| `src/ui/settings.js` | New sliders, remove old ones, add indicators |
| `settings_panel.html` | Update UI elements |
| `tests/scheduler.test.js` | Update tests for token-based API |
| `include/ARCHITECTURE.md` | Document hide-before-extract invariant |
