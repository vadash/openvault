# Implementation Plan - Token-Based Budgets & Turn-Boundary Snapping

> **Reference:** `docs/designs/2026-03-07-token-budgets-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Create `src/utils/tokens.js` — `getMessageTokenCount` + `getTokenSum`

**Goal:** Provide token counting functions that use `gpt-tokenizer` (o200k) with per-message caching in `chatMetadata.openvault.message_tokens`.

**Step 1: Install gpt-tokenizer + add vitest alias**

- Command: `cd C:\projects\openvault && npm install gpt-tokenizer`
- File: `vitest.config.js`
- Action: Add alias mapping `https://esm.sh/gpt-tokenizer/encoding/o200k_base` to local `node_modules/gpt-tokenizer/encoding/o200k_base`.

```javascript
// Add to resolve.alias:
'https://esm.sh/gpt-tokenizer/encoding/o200k_base': path.resolve(
    __dirname,
    'node_modules/gpt-tokenizer/encoding/o200k_base'
),
```

**Step 2: Write the Failing Test**

- File: `tests/utils/tokens.test.js`

```javascript
import { describe, expect, it } from 'vitest';

const MESSAGE_TOKENS_KEY = 'message_tokens';

describe('getMessageTokenCount', () => {
    it('computes token count for a message and caches it in data', async () => {
        const { getMessageTokenCount } = await import('../../src/utils/tokens.js');

        const chat = [
            { mes: 'Hello, how are you today?', is_user: true },
            { mes: 'I am doing well, thank you for asking!', is_user: false },
        ];
        const data = {};

        const count = getMessageTokenCount(chat, 0, data);

        // Should be a positive integer
        expect(count).toBeGreaterThan(0);
        expect(Number.isInteger(count)).toBe(true);

        // Should cache the result
        expect(data[MESSAGE_TOKENS_KEY]).toBeDefined();
        expect(data[MESSAGE_TOKENS_KEY]['0']).toBe(count);
    });

    it('returns cached count on second call without recomputing', async () => {
        const { getMessageTokenCount } = await import('../../src/utils/tokens.js');

        const chat = [{ mes: 'Test message', is_user: true }];
        const data = { [MESSAGE_TOKENS_KEY]: { '0': 999 } };

        const count = getMessageTokenCount(chat, 0, data);

        // Should return the cached value, not recompute
        expect(count).toBe(999);
    });

    it('handles empty or missing message text', async () => {
        const { getMessageTokenCount } = await import('../../src/utils/tokens.js');

        const chat = [{ mes: '', is_user: true }, { is_user: false }];
        const data = {};

        expect(getMessageTokenCount(chat, 0, data)).toBe(0);
        expect(getMessageTokenCount(chat, 1, data)).toBe(0);
    });
});

describe('getTokenSum', () => {
    it('sums token counts for specified indices', async () => {
        const { getTokenSum } = await import('../../src/utils/tokens.js');

        const chat = [
            { mes: 'Hello world', is_user: true },
            { mes: 'How are you doing today my friend?', is_user: false },
            { mes: 'Great thanks', is_user: true },
        ];
        const data = {};

        const total = getTokenSum(chat, [0, 1, 2], data);

        expect(total).toBeGreaterThan(0);
        expect(Number.isInteger(total)).toBe(true);
    });

    it('returns 0 for empty index list', async () => {
        const { getTokenSum } = await import('../../src/utils/tokens.js');

        const chat = [{ mes: 'Hello', is_user: true }];
        const data = {};

        expect(getTokenSum(chat, [], data)).toBe(0);
    });
});
```

**Step 3: Run Test (Red)**

- Command: `npm test -- tests/utils/tokens.test.js`
- Expect: Fail — module `../../src/utils/tokens.js` not found.

**Step 4: Implementation (Green)**

- File: `src/utils/tokens.js`

```javascript
import { countTokens } from 'https://esm.sh/gpt-tokenizer/encoding/o200k_base';

const MESSAGE_TOKENS_KEY = 'message_tokens';

/**
 * Get token count for a single message. Uses cache, falls back to computation.
 * @param {Object[]} chat - Chat array
 * @param {number} index - Message index
 * @param {Object} data - OpenVault data (for cache read/write)
 * @returns {number} Token count
 */
export function getMessageTokenCount(chat, index, data) {
    if (!data[MESSAGE_TOKENS_KEY]) {
        data[MESSAGE_TOKENS_KEY] = {};
    }

    const key = String(index);
    if (data[MESSAGE_TOKENS_KEY][key] !== undefined) {
        return data[MESSAGE_TOKENS_KEY][key];
    }

    const text = chat[index]?.mes || '';
    const count = text.length === 0 ? 0 : countTokens(text);
    data[MESSAGE_TOKENS_KEY][key] = count;
    return count;
}

/**
 * Sum token counts for a list of message indices.
 * @param {Object[]} chat - Chat array
 * @param {number[]} indices - Message indices
 * @param {Object} data - OpenVault data
 * @returns {number} Total tokens
 */
export function getTokenSum(chat, indices, data) {
    let total = 0;
    for (const i of indices) {
        total += getMessageTokenCount(chat, i, data);
    }
    return total;
}
```

**Step 5: Run Test (Green)**

- Command: `npm test -- tests/utils/tokens.test.js`
- Expect: PASS

**Step 6: Git Commit**

- Command: `git add . && git commit -m "feat: add token counting with o200k cache (tokens.js)"`

---

## Task 2: Create `snapToTurnBoundary` in `src/utils/tokens.js`

**Goal:** Shared utility that trims a message index list to a valid turn boundary. A split is valid when the next message in chat is a User message, or at end-of-chat.

**Step 1: Write the Failing Test**

- File: `tests/utils/tokens.test.js` (append)

```javascript
describe('snapToTurnBoundary', () => {
    it('keeps split valid when next message is User', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) U(2) B(3)
        const chat = [
            { mes: 'hi', is_user: true },
            { mes: 'hello', is_user: false },
            { mes: 'how are you', is_user: true },
            { mes: 'fine', is_user: false },
        ];

        // Split after index 1 → next is U(2) ✓
        const result = snapToTurnBoundary(chat, [0, 1]);
        expect(result).toEqual([0, 1]);
    });

    it('keeps split valid at end of chat', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        const chat = [
            { mes: 'hi', is_user: true },
            { mes: 'hello', is_user: false },
        ];

        // Split after index 1 → end of chat ✓
        const result = snapToTurnBoundary(chat, [0, 1]);
        expect(result).toEqual([0, 1]);
    });

    it('snaps back when next message is Bot', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) U(2) B(3) U(4) U(5) B(6) B(7)
        const chat = [
            { mes: 'u0', is_user: true },
            { mes: 'b1', is_user: false },
            { mes: 'u2', is_user: true },
            { mes: 'b3', is_user: false },
            { mes: 'u4', is_user: true },
            { mes: 'u5', is_user: true },
            { mes: 'b6', is_user: false },
            { mes: 'b7', is_user: false },
        ];

        // Split after index 5 → next is B(6) ✗ → snap back to index 3 (next is U(4) ✓)
        const result = snapToTurnBoundary(chat, [0, 1, 2, 3, 4, 5]);
        expect(result).toEqual([0, 1, 2, 3]);
    });

    it('handles consecutive user messages correctly', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) U(2) U(3) B(4)
        const chat = [
            { mes: 'u0', is_user: true },
            { mes: 'b1', is_user: false },
            { mes: 'u2', is_user: true },
            { mes: 'u3', is_user: true },
            { mes: 'b4', is_user: false },
        ];

        // Split after index 3 → next is B(4) ✗ → snap back to index 1 (next is U(2) ✓)
        const result = snapToTurnBoundary(chat, [0, 1, 2, 3]);
        expect(result).toEqual([0, 1]);
    });

    it('returns empty array if no valid boundary found', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // B(0) B(1)
        const chat = [
            { mes: 'b0', is_user: false },
            { mes: 'b1', is_user: false },
            { mes: 'b2', is_user: false },
        ];

        // [0, 1] → next is B(2) ✗ → snap back, but no index has a User next → []
        const result = snapToTurnBoundary(chat, [0, 1]);
        expect(result).toEqual([]);
    });

    it('returns empty array for empty input', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        const chat = [{ mes: 'hi', is_user: true }];
        expect(snapToTurnBoundary(chat, [])).toEqual([]);
    });

    it('handles non-contiguous indices', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) U(2) B(3) U(4) B(5)
        const chat = [
            { mes: 'u0', is_user: true },
            { mes: 'b1', is_user: false },
            { mes: 'u2', is_user: true },
            { mes: 'b3', is_user: false },
            { mes: 'u4', is_user: true },
            { mes: 'b5', is_user: false },
        ];

        // Non-contiguous: indices [0, 1, 4, 5]
        // Split after index 5 → end of chat ✓
        const result = snapToTurnBoundary(chat, [0, 1, 4, 5]);
        expect(result).toEqual([0, 1, 4, 5]);
    });

    it('snaps back non-contiguous to valid boundary', async () => {
        const { snapToTurnBoundary } = await import('../../src/utils/tokens.js');

        // U(0) B(1) U(2) B(3) U(4) B(5) B(6)
        const chat = [
            { mes: 'u0', is_user: true },
            { mes: 'b1', is_user: false },
            { mes: 'u2', is_user: true },
            { mes: 'b3', is_user: false },
            { mes: 'u4', is_user: true },
            { mes: 'b5', is_user: false },
            { mes: 'b6', is_user: false },
        ];

        // Non-contiguous: indices [2, 3, 4, 5]
        // Split after index 5 → next is B(6) ✗ → snap back to index 3 (next is U(4) ✓)
        const result = snapToTurnBoundary(chat, [2, 3, 4, 5]);
        expect(result).toEqual([2, 3]);
    });
});
```

**Step 2: Run Test (Red)**

- Command: `npm test -- tests/utils/tokens.test.js`
- Expect: Fail — `snapToTurnBoundary` is not exported.

**Step 3: Implementation (Green)**

- File: `src/utils/tokens.js` (append)

```javascript
/**
 * Snap a message index list to a valid turn boundary.
 * A split is valid when the next message in chat is a User message, or at end-of-chat.
 * Trims backward until a valid boundary is found. Returns [] if none found.
 * @param {Object[]} chat - Full chat array
 * @param {number[]} messageIds - Ordered message indices to snap
 * @returns {number[]} Snapped message indices
 */
export function snapToTurnBoundary(chat, messageIds) {
    if (messageIds.length === 0) return [];

    // Walk backward from the end of the list
    for (let i = messageIds.length - 1; i >= 0; i--) {
        const lastId = messageIds[i];
        const nextInChat = chat[lastId + 1];

        // Valid: end of chat, or next message is from user
        if (!nextInChat || nextInChat.is_user) {
            return messageIds.slice(0, i + 1);
        }
    }

    return [];
}
```

**Step 4: Run Test (Green)**

- Command: `npm test -- tests/utils/tokens.test.js`
- Expect: PASS

**Step 5: Git Commit**

- Command: `git add . && git commit -m "feat: add snapToTurnBoundary utility (tokens.js)"`

---

## Task 3: Convert `scheduler.js` to token-based batching

**Goal:** Replace `batchSize`/`bufferSize`/`maxTokens` parameters with a single `tokenBudget` parameter. Use `getTokenSum` + `snapToTurnBoundary`.

**Step 1: Write the Failing Tests**

- File: `tests/scheduler.test.js` — **Replace entire file**.

```javascript
import { describe, expect, it } from 'vitest';
import { PROCESSED_MESSAGES_KEY } from '../src/constants.js';
import {
    getBackfillMessageIds,
    getBackfillStats,
    getNextBatch,
    isBatchReady,
} from '../src/extraction/scheduler.js';

// Helper: build chat with known token sizes.
// Each 'x'.repeat(N) ≈ N/3.5 tokens with estimateTokens, but with gpt-tokenizer
// we need actual text. Use repeated words for predictable counts.
// "word " is 1 token in o200k. We'll use a helper that creates N-token messages.
function makeMessage(isUser, text) {
    return { mes: text, is_user: isUser };
}

// o200k tokenizes "hello " as roughly 1 token per word.
// For predictable tests, use pre-cached data instead.
function makeChatWithCachedTokens(messages, tokenCounts) {
    const chat = messages.map(([text, isUser]) => makeMessage(isUser, text));
    const data = {
        message_tokens: Object.fromEntries(tokenCounts.map((count, i) => [String(i), count])),
    };
    return { chat, data };
}

describe('isBatchReady (token-based)', () => {
    it('returns true when unextracted tokens >= budget', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [['u0', true], ['b1', false], ['u2', true], ['b3', false]],
            [500, 500, 500, 500] // total: 2000
        );

        expect(isBatchReady(chat, data, 2000)).toBe(true);
        expect(isBatchReady(chat, data, 1999)).toBe(true);
    });

    it('returns false when unextracted tokens < budget', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [['u0', true], ['b1', false]],
            [500, 500] // total: 1000
        );

        expect(isBatchReady(chat, data, 1001)).toBe(false);
    });

    it('excludes already-extracted messages', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [['u0', true], ['b1', false], ['u2', true], ['b3', false]],
            [500, 500, 500, 500]
        );
        data[PROCESSED_MESSAGES_KEY] = [0, 1]; // 1000 tokens extracted

        expect(isBatchReady(chat, data, 1000)).toBe(true); // 1000 unextracted
        expect(isBatchReady(chat, data, 1001)).toBe(false);
    });
});

describe('getNextBatch (token-based)', () => {
    it('accumulates messages until token budget met, then snaps to turn boundary', () => {
        // U(0):500 B(1):500 U(2):500 B(3):500 U(4):500 B(5):500
        const { chat, data } = makeChatWithCachedTokens(
            [['u0', true], ['b1', false], ['u2', true], ['b3', false], ['u4', true], ['b5', false]],
            [500, 500, 500, 500, 500, 500]
        );

        // Budget 1000: accumulate [0,1] (1000 tokens) → next is U(2) ✓
        const batch = getNextBatch(chat, data, 1000);
        expect(batch).toEqual([0, 1]);
    });

    it('returns null when total unextracted < budget', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [['u0', true], ['b1', false]],
            [400, 400] // total 800
        );

        expect(getNextBatch(chat, data, 1000)).toBeNull();
    });

    it('always includes at least 1 message even if it exceeds budget', () => {
        // Single huge message
        const { chat, data } = makeChatWithCachedTokens(
            [['huge', true], ['reply', false], ['next', true]],
            [50000, 100, 100] // total > 1000
        );

        const batch = getNextBatch(chat, data, 1000);
        // Should include at least message 0, then snap
        // After 0: next is B(1) ✗ → but we can't snap further back → []
        // Actually, accumulate: [0] = 50000 ≥ 1000 → snap [0]
        // After index 0: next is B(1) ✗ → snap back → []
        // Since batch would be empty, include the full turn: [0, 1]
        // After index 1: next is U(2) ✓
        expect(batch).not.toBeNull();
        expect(batch.length).toBeGreaterThan(0);
    });

    it('skips already-extracted messages', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [['u0', true], ['b1', false], ['u2', true], ['b3', false], ['u4', true], ['b5', false]],
            [500, 500, 500, 500, 500, 500]
        );
        data[PROCESSED_MESSAGES_KEY] = [0, 1];

        // Budget 1000: accumulate from unextracted [2,3] (1000) → next is U(4) ✓
        const batch = getNextBatch(chat, data, 1000);
        expect(batch).toEqual([2, 3]);
    });

    it('snaps back when boundary lands mid-turn', () => {
        // U(0):100 B(1):100 U(2):100 B(3):100 U(4):100 B(5):100 B(6):100
        const { chat, data } = makeChatWithCachedTokens(
            [
                ['u0', true], ['b1', false], ['u2', true], ['b3', false],
                ['u4', true], ['b5', false], ['b6', false],
            ],
            [100, 100, 100, 100, 100, 100, 100]
        );

        // Budget 500: accumulate [0,1,2,3,4] (500 tokens)
        // After index 4: next is B(5) ✗ → snap back to index 3 (next is U(4) ✓)
        const batch = getNextBatch(chat, data, 500);
        expect(batch).toEqual([0, 1, 2, 3]);
    });
});

describe('getBackfillStats (token-based)', () => {
    it('counts complete batches by token budget', () => {
        // 6 messages × 500 tokens = 3000 total
        const { chat, data } = makeChatWithCachedTokens(
            [['u0', true], ['b1', false], ['u2', true], ['b3', false], ['u4', true], ['b5', false]],
            [500, 500, 500, 500, 500, 500]
        );

        const stats = getBackfillStats(chat, data, 1000);
        expect(stats.totalUnextracted).toBe(6);
        expect(stats.extractedCount).toBe(0);
        // At least 1 complete batch of 1000 tokens
        expect(stats.completeBatches).toBeGreaterThanOrEqual(1);
    });

    it('excludes already-extracted from count', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [['u0', true], ['b1', false], ['u2', true], ['b3', false]],
            [500, 500, 500, 500]
        );
        data[PROCESSED_MESSAGES_KEY] = [0, 1];

        const stats = getBackfillStats(chat, data, 1000);
        expect(stats.extractedCount).toBe(2);
        expect(stats.totalUnextracted).toBe(2);
    });
});

describe('getBackfillMessageIds (token-based)', () => {
    it('returns complete batches worth of message IDs', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [['u0', true], ['b1', false], ['u2', true], ['b3', false], ['u4', true], ['b5', false]],
            [500, 500, 500, 500, 500, 500]
        );

        const result = getBackfillMessageIds(chat, data, 1000);
        expect(result.batchCount).toBeGreaterThanOrEqual(1);
        expect(result.messageIds.length).toBeGreaterThan(0);
    });

    it('returns empty for insufficient tokens', () => {
        const { chat, data } = makeChatWithCachedTokens(
            [['u0', true], ['b1', false]],
            [100, 100] // 200 total
        );

        const result = getBackfillMessageIds(chat, data, 1000);
        expect(result.batchCount).toBe(0);
        expect(result.messageIds).toEqual([]);
    });
});
```

**Step 2: Run Test (Red)**

- Command: `npm test -- tests/scheduler.test.js`
- Expect: Fail — `isBatchReady` signature changed, `getNextBatch` expects different params.

**Step 3: Implementation (Green)**

- File: `src/extraction/scheduler.js` — **Rewrite**. Replace the `estimateTokens` import with `getMessageTokenCount`, `getTokenSum`, `snapToTurnBoundary` from `../utils/tokens.js`.

New signatures:
```javascript
export function isBatchReady(chat, data, tokenBudget)
export function getNextBatch(chat, data, tokenBudget)
export function getBackfillStats(chat, data, tokenBudget)
export function getBackfillMessageIds(chat, data, tokenBudget)
```

Key logic for `getNextBatch`:
1. `getUnextractedMessageIds(chat, extractedIds, 0)` — no buffer exclusion.
2. `getTokenSum(chat, unextractedIds, data)` → if total < tokenBudget, return `null`.
3. Accumulate oldest messages until sum ≥ budget (always include at least 1).
4. `snapToTurnBoundary(chat, accumulated)` → if result is `[]`, extend forward through the full turn (include bot messages until next User or end-of-chat) then re-snap.
5. Return snapped batch.

Key logic for `isBatchReady`:
```javascript
export function isBatchReady(chat, data, tokenBudget) {
    const extractedIds = getExtractedMessageIds(data);
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds, 0);
    return getTokenSum(chat, unextractedIds, data) >= tokenBudget;
}
```

Key logic for `getBackfillStats`:
```javascript
export function getBackfillStats(chat, data, tokenBudget) {
    const extractedIds = getExtractedMessageIds(data);
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds, 0);
    const totalTokens = getTokenSum(chat, unextractedIds, data);

    return {
        completeBatches: totalTokens >= tokenBudget ? Math.floor(totalTokens / tokenBudget) : 0,
        totalUnextracted: unextractedIds.length,
        extractedCount: extractedIds.size,
    };
}
```

Key logic for `getBackfillMessageIds`:
```javascript
export function getBackfillMessageIds(chat, data, tokenBudget) {
    const extractedIds = getExtractedMessageIds(data);
    const allUnextracted = getUnextractedMessageIds(chat, extractedIds, 0);
    const totalTokens = getTokenSum(chat, allUnextracted, data);

    if (totalTokens < tokenBudget) {
        return { messageIds: [], batchCount: 0 };
    }

    // Accumulate complete batches
    const messageIds = [];
    let currentSum = 0;
    let batchCount = 0;

    for (const id of allUnextracted) {
        currentSum += getMessageTokenCount(chat, id, data);
        messageIds.push(id);

        if (currentSum >= tokenBudget) {
            batchCount++;
            currentSum = 0;
        }
    }

    // Trim incomplete last batch
    if (currentSum > 0 && currentSum < tokenBudget) {
        while (messageIds.length > 0 && currentSum > 0) {
            const removed = messageIds.pop();
            currentSum -= getMessageTokenCount(chat, removed, data);
        }
    }

    return { messageIds, batchCount };
}
```

Remove `import { estimateTokens }` — no longer needed.

**Step 4: Run Test (Green)**

- Command: `npm test -- tests/scheduler.test.js`
- Expect: PASS

**Step 5: Git Commit**

- Command: `git add . && git commit -m "feat: convert scheduler to token-based batching"`

---

## Task 4: Update `worker.js` to use `extractionTokenBudget`

**Goal:** Replace `messagesPerExtraction` and `extractionBuffer` reads with `extractionTokenBudget`.

**Step 1: No new test** — Worker is intentionally untested (per `ARCHITECTURE.md` §3.5). Verified via integration.

**Step 2: Implementation**

- File: `src/extraction/worker.js`
- Lines 96–100: Replace settings reads and `getNextBatch` call.

Old code (lines 96–100):
```javascript
const batchSize = settings.messagesPerExtraction || 5;
const bufferSize = settings.extractionBuffer || 5;

// Get next batch
const batch = getNextBatch(chat, data, batchSize, bufferSize);
```

New code:
```javascript
const tokenBudget = settings.extractionTokenBudget || 16000;

// Get next batch
const batch = getNextBatch(chat, data, tokenBudget);
```

**Step 3: Verify**

- Command: `npm test`
- Expect: All tests PASS (no worker tests to break, scheduler tests already updated).

**Step 4: Git Commit**

- Command: `git add . && git commit -m "feat: worker uses extractionTokenBudget"`

---

## Task 5: Update `extract.js` backfill to use token budget

**Goal:** Replace `messagesPerExtraction` usage in `extractAllMessages` and incremental mode with `extractionTokenBudget`.

**Step 1: No new test** — `extractAllMessages` is integration-tested via existing extract.test.js. Changes are parameter-passing only.

**Step 2: Implementation**

- File: `src/extraction/extract.js`

**Change 1** (line 328, incremental mode): Replace `messagesPerExtraction` with `extractionTokenBudget`. The incremental path uses `lastProcessedId` and is only called when `messageIds` is null. Replace:

```javascript
const messageCount = settings.messagesPerExtraction || 5;

messagesToExtract = chat
    .map((m, idx) => ({ id: idx, ...m }))
    .filter((m) => !m.is_system && m.id > lastProcessedId)
    .slice(-messageCount);
```

With token-budget based selection:
```javascript
import { getMessageTokenCount } from '../utils/tokens.js';
import { getOpenVaultData } from '../utils/data.js';

// Accumulate from newest backward until we hit the token budget
const tokenBudget = settings.extractionTokenBudget || 16000;
const candidates = chat
    .map((m, idx) => ({ id: idx, ...m }))
    .filter((m) => !m.is_system && m.id > lastProcessedId);

// Take from the end (newest), accumulate until budget
let accumulated = 0;
let startIdx = candidates.length;
for (let i = candidates.length - 1; i >= 0; i--) {
    const tokens = getMessageTokenCount(chat, candidates[i].id, data);
    if (accumulated + tokens > tokenBudget && startIdx < candidates.length) break;
    accumulated += tokens;
    startIdx = i;
}
messagesToExtract = candidates.slice(startIdx);
```

**Change 2** (line 597, backfill): Replace `messagesPerExtraction` with `extractionTokenBudget`:

```javascript
// Old:
const messageCount = settings.messagesPerExtraction || 5;
// New:
const tokenBudget = settings.extractionTokenBudget || 16000;
```

**Change 3** (lines 605, 667): Update `getBackfillMessageIds` calls:

```javascript
// Old:
getBackfillMessageIds(chat, data, messageCount)
// New:
getBackfillMessageIds(chat, data, tokenBudget)
```

**Change 4** (line 670+): Update batch slicing. Currently:
```javascript
if (freshIds.length < messageCount) { ... break; }
currentBatch = freshIds.slice(0, messageCount);
```

Replace with `getNextBatch`:
```javascript
import { getNextBatch as getNextBackfillBatch } from './scheduler.js';
// ...
currentBatch = getNextBackfillBatch(freshChat, freshData, tokenBudget);
if (!currentBatch) {
    log('Backfill: No more complete batches available');
    break;
}
```

**Step 3: Verify**

- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**

- Command: `git add . && git commit -m "feat: extract.js backfill uses token budget"`

---

## Task 6: Convert `autoHideOldMessages` to token-based with turn-boundary snapping

**Goal:** Replace count-based auto-hide in `events.js` with token-sum logic using `getTokenSum`, `getMessageTokenCount`, and `snapToTurnBoundary`.

**Step 1: Write the Failing Test**

- File: `tests/events.test.js` (new file)

```javascript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDeps } from '../src/deps.js';

describe('autoHideOldMessages (token-based)', () => {
    let mockChat;
    let mockData;
    let saveFn;

    beforeEach(() => {
        saveFn = vi.fn(async () => true);

        // 8 messages: U B U B U B U B
        // Each with 500 cached tokens = 4000 total visible
        mockChat = [
            { mes: 'u0', is_user: true, is_system: false },
            { mes: 'b1', is_user: false, is_system: false },
            { mes: 'u2', is_user: true, is_system: false },
            { mes: 'b3', is_user: false, is_system: false },
            { mes: 'u4', is_user: true, is_system: false },
            { mes: 'b5', is_user: false, is_system: false },
            { mes: 'u6', is_user: true, is_system: false },
            { mes: 'b7', is_user: false, is_system: false },
        ];

        mockData = {
            memories: [],
            processed_message_ids: [0, 1, 2, 3, 4, 5, 6, 7], // All extracted
            message_tokens: {
                '0': 500, '1': 500, '2': 500, '3': 500,
                '4': 500, '5': 500, '6': 500, '7': 500,
            },
        };

        setupTestContext({
            context: {
                chat: mockChat,
                chatMetadata: { openvault: mockData },
                name1: 'User',
                name2: 'Bot',
                chatId: 'test',
            },
            settings: {
                enabled: true,
                autoHideEnabled: true,
                visibleChatBudget: 2000, // 4 messages worth (2000 of 4000)
            },
            deps: {
                saveChatConditional: saveFn,
            },
        });
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('hides oldest extracted messages to bring visible tokens under budget', async () => {
        // Import after setup so deps are injected
        const { autoHideOldMessages } = await import('../src/events.js');

        await autoHideOldMessages();

        // 4000 total, budget 2000 → excess 2000 → hide first 4 messages (2000 tokens)
        // Snap: after index 3, next is U(4) ✓
        expect(mockChat[0].is_system).toBe(true);
        expect(mockChat[1].is_system).toBe(true);
        expect(mockChat[2].is_system).toBe(true);
        expect(mockChat[3].is_system).toBe(true);
        // Rest stay visible
        expect(mockChat[4].is_system).toBe(false);
        expect(mockChat[5].is_system).toBe(false);
        expect(mockChat[6].is_system).toBe(false);
        expect(mockChat[7].is_system).toBe(false);

        expect(saveFn).toHaveBeenCalled();
    });

    it('does not hide when under budget', async () => {
        // Set budget higher than total
        const { extensionName } = await import('../src/constants.js');
        const { getDeps } = await import('../src/deps.js');
        getDeps().getExtensionSettings()[extensionName].visibleChatBudget = 5000;

        const { autoHideOldMessages } = await import('../src/events.js');
        await autoHideOldMessages();

        // Nothing hidden
        for (const msg of mockChat) {
            expect(msg.is_system).toBe(false);
        }
        expect(saveFn).not.toHaveBeenCalled();
    });

    it('skips unextracted messages and continues past them', async () => {
        // Mark messages 2,3 as NOT extracted
        mockData.processed_message_ids = [0, 1, 4, 5, 6, 7];
        mockData.memories = [];

        const { autoHideOldMessages } = await import('../src/events.js');
        await autoHideOldMessages();

        // excess = 2000 tokens. Hide 0,1 (extracted, 1000 tokens), skip 2,3 (unextracted),
        // continue with 4,5 (extracted, 1000 tokens) → total hidden = 2000
        // Snap after 1: next is U(2) ✓. Snap after 5: next is U(6) ✓.
        expect(mockChat[0].is_system).toBe(true);
        expect(mockChat[1].is_system).toBe(true);
        expect(mockChat[2].is_system).toBe(false); // Unextracted, skipped
        expect(mockChat[3].is_system).toBe(false); // Unextracted, skipped
        expect(mockChat[4].is_system).toBe(true);
        expect(mockChat[5].is_system).toBe(true);
    });

    it('respects turn boundaries — does not split mid-turn', async () => {
        // Budget 2500: excess = 1500. Accumulate oldest: 0(500), 1(500), 2(500) = 1500
        // But after index 2 (User), next is B(3) ✗ → snap back to index 1 (next is U(2) ✓)
        // So only 0,1 hidden (1000 tokens)
        const { extensionName } = await import('../src/constants.js');
        const { getDeps } = await import('../src/deps.js');
        getDeps().getExtensionSettings()[extensionName].visibleChatBudget = 2500;

        const { autoHideOldMessages } = await import('../src/events.js');
        await autoHideOldMessages();

        expect(mockChat[0].is_system).toBe(true);
        expect(mockChat[1].is_system).toBe(true);
        expect(mockChat[2].is_system).toBe(false); // Not hidden (would break turn)
    });
});
```

**Step 2: Run Test (Red)**

- Command: `npm test -- tests/events.test.js`
- Expect: Fail — `autoHideOldMessages` is not exported / uses old logic.

**Step 3: Implementation (Green)**

- File: `src/events.js`
- Add imports at top:

```javascript
import { getMessageTokenCount, getTokenSum, snapToTurnBoundary } from './utils/tokens.js';
```

- Replace `autoHideOldMessages` function (lines 39–73) with:

```javascript
export async function autoHideOldMessages() {
    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    if (!settings.autoHideEnabled) return;

    const context = deps.getContext();
    const chat = context.chat || [];
    const visibleChatBudget = settings.visibleChatBudget || 16000;

    const data = getOpenVaultData();
    const extractedMessageIds = getExtractedMessageIds(data);

    // Get visible (non-system) message indices
    const visibleIndices = [];
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i].is_system) visibleIndices.push(i);
    }

    // Sum visible tokens
    const totalVisibleTokens = getTokenSum(chat, visibleIndices, data);
    if (totalVisibleTokens <= visibleChatBudget) return;

    // Calculate excess
    const excess = totalVisibleTokens - visibleChatBudget;

    // Collect oldest visible messages to hide, skipping unextracted
    const toHide = [];
    let accumulated = 0;

    for (const idx of visibleIndices) {
        if (accumulated >= excess) break;

        // Only hide already-extracted messages; skip unextracted
        if (!extractedMessageIds.has(idx)) continue;

        toHide.push(idx);
        accumulated += getMessageTokenCount(chat, idx, data);
    }

    // Snap to turn boundary
    const snapped = snapToTurnBoundary(chat, toHide);

    if (snapped.length === 0) return;

    // Hide
    for (const idx of snapped) {
        chat[idx].is_system = true;
    }

    await getDeps().saveChatConditional();
    log(`Auto-hid ${snapped.length} messages (token-based) — budget: ${visibleChatBudget}, was: ${totalVisibleTokens}`);
    showToast('info', `Auto-hid ${snapped.length} old messages`);
}
```

**Step 4: Run Test (Green)**

- Command: `npm test -- tests/events.test.js`
- Expect: PASS

**Step 5: Verify all tests still pass**

- Command: `npm test`
- Expect: PASS

**Step 6: Git Commit**

- Command: `git add . && git commit -m "feat: token-based auto-hide with turn-boundary snapping"`

---

## Task 7: Wake worker on user messages

**Goal:** Remove the `is_user` guard in `onMessageReceived` so the worker wakes on both user and bot messages.

**Step 1: No new test** — Event wiring is intentionally untested (per `ARCHITECTURE.md` §3.5).

**Step 2: Implementation**

- File: `src/events.js`, function `onMessageReceived` (line 225–231).

Replace:
```javascript
// Only wake worker on AI messages
if (!message || message.is_user || message.is_system) {
    return;
}
```

With:
```javascript
// Wake worker on any real message (user or bot)
if (!message || message.is_system) {
    return;
}
```

**Step 3: Verify**

- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**

- Command: `git add . && git commit -m "feat: wake worker on user messages too"`

---

## Task 8: Update settings in `constants.js`

**Goal:** Replace `messagesPerExtraction`, `extractionBuffer`, `autoHideThreshold` with `extractionTokenBudget` and `visibleChatBudget`. Update `UI_DEFAULT_HINTS`.

**Step 1: No new test** — Constants are data declarations, tested via consumers.

**Step 2: Implementation**

- File: `src/constants.js`

**In `defaultSettings`** (lines 28–32): Remove three settings, add two:

```javascript
// Remove:
messagesPerExtraction: 30,
extractionBuffer: 5,
autoHideThreshold: 40,

// Add:
extractionTokenBudget: 16000,
visibleChatBudget: 16000,
```

**In `UI_DEFAULT_HINTS`** (lines ~93–96): Remove old keys, add new:

```javascript
// Remove:
messagesPerExtraction: defaultSettings.messagesPerExtraction,
autoHideThreshold: defaultSettings.autoHideThreshold,

// Add:
extractionTokenBudget: defaultSettings.extractionTokenBudget,
visibleChatBudget: defaultSettings.visibleChatBudget,
```

**Step 3: Verify**

- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**

- Command: `git add . && git commit -m "feat: replace message-count settings with token budgets"`

---

## Task 9: Update settings panel HTML

**Goal:** Replace `messages_per_extraction` slider and `auto_hide_threshold` slider with new token-budget sliders. Remove extraction buffer. Add budget fill indicators.

**Step 1: No new test** — HTML templates are UI-only, tested visually.

**Step 2: Implementation**

- File: `templates/settings_panel.html`

**Change 1:** In the "Extraction & Graph Rules" `<details>`, replace the "Messages per Extraction" slider block (around line 195–197) with:

```html
<label for="openvault_extraction_token_budget">
    Extraction Token Budget: <span id="openvault_extraction_token_budget_value">16000</span> tokens
    <small class="openvault-default-hint" data-default-key="extractionTokenBudget"></small>
</label>
<input type="range" id="openvault_extraction_token_budget" min="4000" max="64000" step="1000" value="16000" />
<small class="openvault-hint">Token threshold for extraction batches. When unextracted messages accumulate past this budget, a batch is processed. Larger = fewer LLM calls, smaller = more frequent extraction.</small>

<div class="openvault-budget-indicator">
    <span class="openvault-budget-label">Unextracted:</span>
    <div class="openvault-budget-bar">
        <div class="openvault-budget-fill" id="openvault_extraction_budget_fill"></div>
    </div>
    <span class="openvault-budget-text" id="openvault_extraction_budget_text">0 / 16k</span>
</div>
```

**Change 2:** In "Retrieval & Injection" `<details>`, replace the "Messages to keep visible" slider block (around line 399–401) with:

```html
<label for="openvault_visible_chat_budget">
    Visible Chat Budget: <span id="openvault_visible_chat_budget_value">16000</span> tokens
    <small class="openvault-default-hint" data-default-key="visibleChatBudget"></small>
</label>
<input type="range" id="openvault_visible_chat_budget" min="4000" max="64000" step="1000" value="16000" />
<small class="openvault-hint">Maximum tokens visible in chat history. Oldest already-extracted messages are auto-hidden when exceeded. Acts as a minimum guarantee — chat may temporarily exceed this until extraction catches up.</small>

<div class="openvault-budget-indicator">
    <span class="openvault-budget-label">Visible:</span>
    <div class="openvault-budget-bar">
        <div class="openvault-budget-fill" id="openvault_visible_budget_fill"></div>
    </div>
    <span class="openvault-budget-text" id="openvault_visible_budget_text">0 / 16k</span>
</div>
```

**Step 3: Verify**

- Command: `npm test`
- Expect: PASS (no test changes, just HTML)

**Step 4: Git Commit**

- Command: `git add . && git commit -m "feat: settings panel HTML for token budget sliders + indicators"`

---

## Task 10: Update `settings.js` bindings and indicator logic

**Goal:** Replace old slider bindings with new ones. Add budget indicator update functions. Remove `extractionBuffer` binding.

**Step 1: No new test** — UI bindings are wiring code, tested visually.

**Step 2: Implementation**

- File: `src/ui/settings.js`

**Change 1:** In `bindUIElements()`, remove old bindings and add new:

Remove:
```javascript
bindSetting('messages_per_extraction', 'messagesPerExtraction');
bindSetting('auto_hide_threshold', 'autoHideThreshold');
```

Add:
```javascript
bindSetting('extraction_token_budget', 'extractionTokenBudget');
bindSetting('visible_chat_budget', 'visibleChatBudget');
```

**Change 2:** In `updateUI()`, remove old sync and add new:

Remove:
```javascript
$('#openvault_messages_per_extraction').val(settings.messagesPerExtraction);
$('#openvault_messages_per_extraction_value').text(settings.messagesPerExtraction);
// ...
$('#openvault_auto_hide_threshold').val(settings.autoHideThreshold);
$('#openvault_auto_hide_threshold_value').text(settings.autoHideThreshold);
```

Add:
```javascript
$('#openvault_extraction_token_budget').val(settings.extractionTokenBudget ?? 16000);
$('#openvault_extraction_token_budget_value').text(settings.extractionTokenBudget ?? 16000);

$('#openvault_visible_chat_budget').val(settings.visibleChatBudget ?? 16000);
$('#openvault_visible_chat_budget_value').text(settings.visibleChatBudget ?? 16000);
```

**Change 3:** Add budget indicator update function. Add these imports at top:

```javascript
import { getExtractedMessageIds, getUnextractedMessageIds } from '../extraction/scheduler.js';
import { getTokenSum } from '../utils/tokens.js';
```

Add function before `populateProfileSelector`:

```javascript
/**
 * Update budget fill indicators with color coding.
 * Called from refreshAllUI.
 */
export function updateBudgetIndicators() {
    const data = getOpenVaultData();
    const context = getDeps().getContext?.();
    const chat = context?.chat || [];
    const settings = getSettings();

    if (!data || chat.length === 0) {
        $('#openvault_extraction_budget_text').text('No chat');
        $('#openvault_visible_budget_text').text('No chat');
        return;
    }

    // Extraction indicator
    const extractionBudget = settings.extractionTokenBudget || 16000;
    const extractedIds = getExtractedMessageIds(data);
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds, 0);
    const unextractedTokens = getTokenSum(chat, unextractedIds, data);
    const extractionPct = Math.min((unextractedTokens / extractionBudget) * 100, 100);

    $('#openvault_extraction_budget_fill').css('width', `${extractionPct}%`);
    $('#openvault_extraction_budget_text').text(
        `${(unextractedTokens / 1000).toFixed(1)}k / ${(extractionBudget / 1000).toFixed(0)}k`
    );
    updateBudgetColor('openvault_extraction_budget_fill', extractionPct);

    // Visible chat indicator
    const visibleBudget = settings.visibleChatBudget || 16000;
    const visibleIndices = [];
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i].is_system) visibleIndices.push(i);
    }
    const visibleTokens = getTokenSum(chat, visibleIndices, data);
    const visiblePct = Math.min((visibleTokens / visibleBudget) * 100, 100);

    $('#openvault_visible_budget_fill').css('width', `${visiblePct}%`);
    $('#openvault_visible_budget_text').text(
        `${(visibleTokens / 1000).toFixed(1)}k / ${(visibleBudget / 1000).toFixed(0)}k`
    );
    updateBudgetColor('openvault_visible_budget_fill', visiblePct);
}

function updateBudgetColor(elementId, pct) {
    const el = $(`#${elementId}`);
    el.removeClass('budget-low budget-mid budget-high');
    if (pct < 50) el.addClass('budget-low');
    else if (pct < 80) el.addClass('budget-mid');
    else el.addClass('budget-high');
}
```

**Change 4:** Call `updateBudgetIndicators` from `refreshAllUI`. In `src/ui/render.js`, add import and call:

```javascript
import { updateBudgetIndicators } from './settings.js';
// In refreshAllUI():
updateBudgetIndicators();
```

**Step 3: Verify**

- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**

- Command: `git add . && git commit -m "feat: settings UI bindings for token budgets + indicators"`

---

## Task 11: Update `ARCHITECTURE.md` with hide-before-extract invariant

**Goal:** Document the key invariant that messages must be extracted before they can be hidden.

**Step 1: No test** — Documentation only.

**Step 2: Implementation**

- File: `include/ARCHITECTURE.md`
- Location: After "### 3.5. Testing Architecture" section, add new section:

```markdown
### 3.6. Message Visibility Invariant

**Messages must be extracted BEFORE they can be hidden.** Auto-hide (`events.js`) only marks messages as `is_system = true` if they appear in `processed_message_ids`. Hiding an unextracted message would create a permanent gap in the narrative — the extraction pipeline would never see that message, and any memories it would have produced are permanently lost.

Both extraction batching and auto-hide use **turn-boundary snapping** (`snapToTurnBoundary` in `src/utils/tokens.js`): splits only occur where the next message in chat is a User message, or at end-of-chat. This prevents orphaned User messages from being separated from their Bot responses.
```

**Step 3: Git Commit**

- Command: `git add . && git commit -m "docs: add message visibility invariant to ARCHITECTURE.md"`

---

## Task 12: Add budget indicator CSS

**Goal:** Style the budget fill bars and color classes.

**Step 1: No test** — CSS only.

**Step 2: Implementation**

- Find the existing CSS file for OpenVault styles.
- Add:

```css
.openvault-budget-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0 12px 0;
    font-size: 0.85em;
}

.openvault-budget-label {
    white-space: nowrap;
    color: var(--SmartThemeEmColor, #888);
    min-width: 70px;
}

.openvault-budget-bar {
    flex: 1;
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
}

.openvault-budget-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease, background-color 0.3s ease;
    width: 0%;
}

.openvault-budget-fill.budget-low {
    background-color: var(--SmartThemeEmColor, #888);
}

.openvault-budget-fill.budget-mid {
    background-color: #f0ad4e;
}

.openvault-budget-fill.budget-high {
    background-color: #5cb85c;
}

.openvault-budget-text {
    white-space: nowrap;
    color: var(--SmartThemeEmColor, #888);
    min-width: 80px;
    text-align: right;
}
```

**Step 3: Verify**

- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**

- Command: `git add . && git commit -m "feat: CSS for budget fill indicators"`

---

## Task 13: Final integration verification

**Goal:** Run full test suite and verify no regressions.

**Step 1: Run all tests**

- Command: `npm test`
- Expect: All tests PASS.

**Step 2: Verify no references to removed settings remain**

- Search for `messagesPerExtraction` — should only appear in migration/compat code if any.
- Search for `extractionBuffer` — should be gone entirely.
- Search for `autoHideThreshold` — should be gone entirely.
- Search for `estimateTokens` — should only remain in `src/utils/text.js` (definition) and `src/retrieval/` (unrelated retrieval budget usage).

**Step 3: Git Commit**

- Command: `git add . && git commit -m "chore: verify clean migration to token budgets"`
