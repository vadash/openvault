# Fingerprint-Based Message Tracking Implementation Plan

**Goal:** Replace fragile array-index message tracking with stable fingerprint-based tracking to prevent data loss when chat arrays are modified by extensions.

**Architecture:** Use `send_date` (millisecond timestamp) as the primary fingerprint, with content-hash fallback for imported chats. Store fingerprints in `PROCESSED_MESSAGES_KEY` instead of indices. Single source of truth via `getProcessedFingerprints()` + `getUnextractedMessageIds()`.

**Tech Stack:** JavaScript (ES modules), Vitest for testing, Cyrb53 hash from existing codebase.

---

## File Structure Overview

- **Create:** None (all modifications to existing files)
- **Modify:** `src/extraction/scheduler.js` - Core fingerprint logic, migration, scheduler functions
- **Modify:** `src/extraction/extract.js` - Remove watermark, store fingerprints
- **Modify:** `src/events.js` - Auto-hide fix, migration hook
- **Modify:** `src/ui/settings.js` - Import rename
- **Modify:** `src/ui/status.js` - Import rename
- **Modify:** `src/ui/helpers.js` - Fix calculateExtractionStats signature
- **Modify:** `src/constants.js` - Remove LAST_PROCESSED_KEY
- **Modify:** `src/utils/data.js` - Remove initializer
- **Modify:** `tests/scheduler.test.js` - Update for fingerprints
- **Modify:** `tests/extraction/extract.test.js` - Update for fingerprint storage
- **Modify:** `tests/events.test.js` - Update mock data
- **Modify:** `tests/ui/ui-helpers.test.js` - Update calculateExtractionStats tests
- **Modify:** `tests/utils/data.test.js` - Remove LAST_PROCESSED_KEY references
- **Modify:** `tests/factories.js` - Remove last_processed_message_id

---

### Task 1: Add getFingerprint Function

**Purpose:** Create the core fingerprinting function that derives stable identifiers from messages.

**Common Pitfalls:**
- The `cyrb53` import path must match the actual file location (`../utils/embedding-codec.js`)
- Always return strings (not numbers) for consistent Set membership checks

**Files:**
- Modify: `src/extraction/scheduler.js`
- Test: `tests/scheduler.test.js`

- [ ] Step 1: Add failing test for getFingerprint

Add to `tests/scheduler.test.js` before existing tests:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getFingerprint,
    // ... existing imports
} from '../../src/extraction/scheduler.js';

// Add timestamp counter for test messages
let testTimestamp = 1000000;

// Update makeMessage helper to include send_date
function makeMessage(overrides = {}) {
    return {
        name: 'User',
        mes: 'Hello',
        send_date: String(testTimestamp++),  // Add this line
        ...overrides
    };
}

describe('getFingerprint', () => {
    it('returns send_date as string when present', () => {
        const msg = makeMessage({ send_date: '1710928374823' });
        const result = getFingerprint(msg);
        expect(result).toBe('1710928374823');
    });

    it('returns content hash when send_date is missing', () => {
        const msg = makeMessage({ send_date: undefined, name: 'TestUser', mes: 'Test message' });
        const result = getFingerprint(msg);
        expect(result).toMatch(/^hash_\d+$/);
    });

    it('returns consistent hash for same content', () => {
        const msg1 = makeMessage({ send_date: undefined, name: 'User', mes: 'Hello' });
        const msg2 = makeMessage({ send_date: undefined, name: 'User', mes: 'Hello' });
        expect(getFingerprint(msg1)).toBe(getFingerprint(msg2));
    });

    it('returns different hashes for different content', () => {
        const msg1 = makeMessage({ send_date: undefined, name: 'User1', mes: 'Hello' });
        const msg2 = makeMessage({ send_date: undefined, name: 'User2', mes: 'Hello' });
        expect(getFingerprint(msg1)).not.toBe(getFingerprint(msg2));
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/scheduler.test.js --reporter=verbose 2>&1 | head -50`

Expected: FAIL with "getFingerprint is not defined" or "getFingerprint is not a function"

- [ ] Step 3: Add import and implement getFingerprint in scheduler.js

Add to `src/extraction/scheduler.js` at the top of the file (after imports):

```javascript
import { cyrb53 } from '../utils/embedding-codec.js';

/**
 * Get a stable fingerprint for a message.
 * Uses send_date (timestamp) when available, falls back to content hash.
 * @param {object} msg - Message object
 * @returns {string} Fingerprint string
 */
export function getFingerprint(msg) {
    if (msg.send_date) return String(msg.send_date);
    // Fallback: content hash for imported chats without send_date
    return `hash_${cyrb53((msg.name || '') + (msg.mes || ''))}`;
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/scheduler.test.js --reporter=verbose -t "getFingerprint" 2>&1`

Expected: 4 passing tests for getFingerprint

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(scheduler): add getFingerprint function with send_date + hash fallback

- Returns send_date string when available (primary fingerprint)
- Falls back to cyrb53 content hash for imported chats
- Ensures stable message identity across array mutations"
```

---

### Task 2: Add migrateProcessedMessages Function

**Purpose:** One-time migration from index-based to fingerprint-based storage. Includes temporal guard to detect shifted indices.

**Common Pitfalls:**
- Must handle ISO dates, localized dates, numeric strings, and Number types
- Temporal guard skips indices that point to messages sent after last memory creation
- Literal string 'last_processed_message_id' used instead of constant (constant will be deleted later)

**Files:**
- Modify: `src/extraction/scheduler.js`
- Test: `tests/scheduler.test.js`

- [ ] Step 1: Add failing tests for migrateProcessedMessages

Add to `tests/scheduler.test.js` after getFingerprint tests:

```javascript
import {
    getFingerprint,
    migrateProcessedMessages,
    PROCESSED_MESSAGES_KEY,
    MEMORIES_KEY,
    // ... existing imports
} from '../../src/extraction/scheduler.js';

describe('migrateProcessedMessages', () => {
    let chat;
    let data;

    beforeEach(() => {
        testTimestamp = 1000000;  // Reset timestamp counter
        chat = [
            makeMessage({ send_date: '1000000', name: 'User1', mes: 'Hello' }),
            makeMessage({ send_date: '1000001', name: 'Bot', mes: 'Hi there' }),
            makeMessage({ send_date: '1000002', name: 'User1', mes: 'How are you?' }),
            makeMessage({ send_date: '1000003', name: 'Bot', mes: 'Doing well!' }),
        ];
        data = {
            [PROCESSED_MESSAGES_KEY]: [0, 2],  // Old format: indices
            [MEMORIES_KEY]: [
                { created_at: 1000002, message_ids: [0] },
                { created_at: 1000003, message_ids: [2] },
            ],
        };
    });

    it('returns false when already migrated (fingerprints)', () => {
        data[PROCESSED_MESSAGES_KEY] = ['1000000', '1000002'];
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(false);
    });

    it('returns false when no processed messages exist', () => {
        data[PROCESSED_MESSAGES_KEY] = [];
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(false);
    });

    it('migrates indices to fingerprints', () => {
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000000');
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000002');
        expect(data[PROCESSED_MESSAGES_KEY]).not.toContain(0);
        expect(data[PROCESSED_MESSAGES_KEY]).not.toContain(2);
    });

    it('includes fingerprints from memory.message_ids', () => {
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        // Should include both processed indices and memory indices
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000000');
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000002');
    });

    it('handles out-of-bounds indices gracefully', () => {
        data[PROCESSED_MESSAGES_KEY] = [0, 5, 10];  // 5 and 10 out of bounds
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000000');
        expect(data[PROCESSED_MESSAGES_KEY].length).toBe(1);
    });

    it('applies temporal guard - skips messages sent after last memory', () => {
        // Message at index 3 was sent at 1000003, but last memory was at 1000002
        data[PROCESSED_MESSAGES_KEY] = [0, 3];  // 3 should be skipped due to temporal guard
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000000');
        expect(data[PROCESSED_MESSAGES_KEY]).not.toContain('1000003');
    });

    it('deletes last_processed_message_id key', () => {
        data['last_processed_message_id'] = 2;
        migrateProcessedMessages(chat, data);
        expect(data['last_processed_message_id']).toBeUndefined();
    });

    it('handles messages without send_date using hash fallback', () => {
        chat[0].send_date = undefined;
        const expectedHash = getFingerprint(chat[0]);
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        expect(data[PROCESSED_MESSAGES_KEY]).toContain(expectedHash);
    });

    it('handles empty memories array', () => {
        data[MEMORIES_KEY] = [];
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        // Should still migrate processed indices
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000000');
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000002');
    });

    it('handles memories without message_ids', () => {
        data[MEMORIES_KEY] = [{ created_at: 1000002 }];
        const result = migrateProcessedMessages(chat, data);
        expect(result).toBe(true);
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000000');
        expect(data[PROCESSED_MESSAGES_KEY]).toContain('1000002');
    });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run tests/scheduler.test.js --reporter=verbose -t "migrateProcessedMessages" 2>&1 | head -60`

Expected: FAIL with "migrateProcessedMessages is not defined"

- [ ] Step 3: Implement migrateProcessedMessages in scheduler.js

Add to `src/extraction/scheduler.js` after getFingerprint:

```javascript
import { MEMORIES_KEY } from '../constants.js';

/**
 * Parse ST's send_date (ISO, localized, numeric string, or Number) into ms.
 * @param {string|number} sendDate
 * @returns {number}
 */
function parseSendDate(sendDate) {
    const val = String(sendDate);
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    return Date.parse(val) || 0;
}

/**
 * Migrate index-based processed messages to fingerprint-based.
 * Called once per chat when old format is detected.
 * Includes temporal guard to skip indices that point to messages
 * sent after the last memory was created (indicates index shift).
 * @param {Array} chat - Chat array
 * @param {Object} data - OpenVault data object
 * @returns {boolean} True if migration occurred
 */
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
    delete data['last_processed_message_id'];
    return true;
}
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run tests/scheduler.test.js --reporter=verbose -t "migrateProcessedMessages" 2>&1`

Expected: 10 passing tests for migrateProcessedMessages

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(scheduler): add migrateProcessedMessages with temporal guard

- Migrates index-based storage to fingerprint-based
- Temporal guard skips indices pointing to messages sent after last memory
- Handles out-of-bounds, missing send_date, and edge cases"
```

---

### Task 3: Refactor Scheduler Core Functions

**Purpose:** Replace index-based tracking with fingerprint-based tracking throughout scheduler.

**Common Pitfalls:**
- Tests must add `send_date` to mock messages for fingerprints to work
- Old tests use numeric indices in PROCESSED_MESSAGES_KEY - need updating
- is_system filter now applied in getUnextractedMessageIds

**Files:**
- Modify: `src/extraction/scheduler.js`
- Modify: `tests/scheduler.test.js`

- [ ] Step 1: Update test helpers and existing tests

Update `tests/scheduler.test.js`:

```javascript
// At top of file, add beforeEach to reset timestamp:
beforeEach(() => {
    testTimestamp = 1000000;
});

// Update existing makeMessage calls to ensure send_date is set:
// (Already done in Task 1)

// Update existing scheduler tests to use fingerprint strings instead of indices.
// Find existing tests that set data[PROCESSED_MESSAGES_KEY] and update them:

// Example conversion for existing test "isBatchReady returns true when budget met":
// BEFORE: data[PROCESSED_MESSAGES_KEY] = [0, 1];
// AFTER:  data[PROCESSED_MESSAGES_KEY] = [chat[0].send_date, chat[1].send_date];
```

Full updated test section for scheduler core:

```javascript
describe('scheduler with fingerprints', () => {
    let chat;
    let data;
    let settings;

    beforeEach(() => {
        testTimestamp = 1000000;
        chat = [
            makeMessage({ mes: 'Short', send_date: '1000000' }),
            makeMessage({ mes: LONG_USER_MESSAGE, send_date: '1000001' }),
            makeMessage({ mes: LONG_USER_MESSAGE, send_date: '1000002' }),
            makeMessage({ mes: LONG_USER_MESSAGE, send_date: '1000003' }),
        ];
        data = { [PROCESSED_MESSAGES_KEY]: [], [MEMORIES_KEY]: [] };
        settings = { extractionTokenBudget: 2000 };
    });

    describe('getProcessedFingerprints', () => {
        it('returns empty set when no processed messages', () => {
            const result = getProcessedFingerprints(data);
            expect(result.size).toBe(0);
        });

        it('returns set of fingerprint strings', () => {
            data[PROCESSED_MESSAGES_KEY] = ['1000000', '1000002'];
            const result = getProcessedFingerprints(data);
            expect(result.has('1000000')).toBe(true);
            expect(result.has('1000002')).toBe(true);
            expect(result.has('1000001')).toBe(false);
        });
    });

    describe('getUnextractedMessageIds', () => {
        it('returns all indices when no processed messages', () => {
            const fps = getProcessedFingerprints(data);
            const result = getUnextractedMessageIds(chat, fps);
            expect(result).toEqual([0, 1, 2, 3]);
        });

        it('excludes processed messages by fingerprint', () => {
            data[PROCESSED_MESSAGES_KEY] = [chat[0].send_date, chat[2].send_date];
            const fps = getProcessedFingerprints(data);
            const result = getUnextractedMessageIds(chat, fps);
            expect(result).toEqual([1, 3]);
        });

        it('excludes system messages', () => {
            chat[1].is_system = true;
            const fps = getProcessedFingerprints(data);
            const result = getUnextractedMessageIds(chat, fps);
            expect(result).toEqual([0, 2, 3]);
        });

        it('handles messages without send_date using hash', () => {
            chat[0].send_date = undefined;
            const fp = getFingerprint(chat[0]);
            data[PROCESSED_MESSAGES_KEY] = [fp];
            const fps = getProcessedFingerprints(data);
            const result = getUnextractedMessageIds(chat, fps);
            expect(result).toEqual([1, 2, 3]);
        });
    });

    describe('isBatchReady', () => {
        it('returns true when unextracted messages meet token budget', () => {
            const result = isBatchReady(chat, data, settings.extractionTokenBudget);
            expect(result).toBe(true);
        });

        it('returns false when processed messages reduce count below budget', () => {
            // Process first 3 messages
            data[PROCESSED_MESSAGES_KEY] = [chat[0].send_date, chat[1].send_date, chat[2].send_date];
            const result = isBatchReady(chat, data, settings.extractionTokenBudget);
            expect(result).toBe(false);
        });
    });

    describe('getNextBatch', () => {
        it('returns batch starting from first unextracted message', () => {
            data[PROCESSED_MESSAGES_KEY] = [chat[0].send_date, chat[1].send_date];
            const batch = getNextBatch(chat, data, settings.extractionTokenBudget);
            expect(batch).toEqual([2, 3]);
        });

        it('returns null when no unextracted messages', () => {
            data[PROCESSED_MESSAGES_KEY] = chat.map(m => m.send_date);
            const batch = getNextBatch(chat, data, settings.extractionTokenBudget);
            expect(batch).toBeNull();
        });
    });

    describe('getBackfillStats', () => {
        it('calculates correct stats with no processed messages', () => {
            const stats = getBackfillStats(chat, data);
            expect(stats.totalMessages).toBe(4);
            expect(stats.extractedCount).toBe(0);
            expect(stats.unextractedCount).toBe(4);
        });

        it('calculates correct stats with some processed messages', () => {
            data[PROCESSED_MESSAGES_KEY] = [chat[0].send_date, chat[1].send_date];
            const stats = getBackfillStats(chat, data);
            expect(stats.totalMessages).toBe(4);
            expect(stats.extractedCount).toBe(2);
            expect(stats.unextractedCount).toBe(2);
        });

        it('excludes system messages from total', () => {
            chat[0].is_system = true;
            const stats = getBackfillStats(chat, data);
            expect(stats.totalMessages).toBe(3);
        });

        it('handles dead fingerprints (deleted messages)', () => {
            // Simulate dead fingerprint from deleted message
            data[PROCESSED_MESSAGES_KEY] = ['9999999', chat[0].send_date];
            const stats = getBackfillStats(chat, data);
            // extractedCount should be 1 (only chat[0] visible), not 2
            expect(stats.extractedCount).toBe(1);
            expect(stats.unextractedCount).toBe(3);
        });
    });
});
```

- [ ] Step 2: Run new tests to verify they fail

Run: `npx vitest run tests/scheduler.test.js --reporter=verbose -t "scheduler with fingerprints" 2>&1 | head -80`

Expected: Multiple FAILs for undefined functions

- [ ] Step 3: Update scheduler.js core functions

Replace the following in `src/extraction/scheduler.js`:

```javascript
// Replace getExtractedMessageIds with getProcessedFingerprints:
export function getProcessedFingerprints(data) {
    return new Set(data[PROCESSED_MESSAGES_KEY] || []);
}

// Keep old name as alias for backward compatibility during transition:
export const getExtractedMessageIds = getProcessedFingerprints;

// Update getUnextractedMessageIds to use fingerprints and filter is_system:
export function getUnextractedMessageIds(chat, processedFps) {
    const unextracted = [];
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (msg.is_system) continue;
        if (!processedFps.has(getFingerprint(msg))) {
            unextracted.push(i);
        }
    }
    return unextracted;
}

// Update isBatchReady:
export function isBatchReady(chat, data, tokenBudget) {
    const processedFps = getProcessedFingerprints(data);
    const unextractedIds = getUnextractedMessageIds(chat, processedFps);

    const totalTokens = unextractedIds.reduce((sum, id) => {
        return sum + estimateMessageTokens(chat[id]);
    }, 0);

    return totalTokens >= tokenBudget;
}

// Update getNextBatch:
export function getNextBatch(chat, data, tokenBudget) {
    const processedFps = getProcessedFingerprints(data);
    const unextractedIds = getUnextractedMessageIds(chat, processedFps);

    if (unextractedIds.length === 0) return null;

    let tokenCount = 0;
    const batch = [];

    for (const id of unextractedIds) {
        const msg = chat[id];
        const tokens = estimateMessageTokens(msg);

        if (tokenCount + tokens > tokenBudget && batch.length > 0) {
            break;
        }

        batch.push(id);
        tokenCount += tokens;

        if (tokenCount >= tokenBudget) {
            break;
        }
    }

    return batch.length > 0 ? batch : null;
}

// Update getBackfillStats:
export function getBackfillStats(chat, data) {
    const processedFps = getProcessedFingerprints(data);
    const unextractedIds = getUnextractedMessageIds(chat, processedFps);
    const nonSystemCount = chat.filter(m => !m.is_system).length;

    return {
        totalMessages: nonSystemCount,
        extractedCount: Math.max(0, nonSystemCount - unextractedIds.length),
        unextractedCount: unextractedIds.length,
    };
}

// Update getBackfillMessageIds:
export function getBackfillMessageIds(chat, data, options = {}) {
    const { maxMessages = 100, resume = false } = options;
    const processedFps = getProcessedFingerprints(data);
    const unextractedIds = getUnextractedMessageIds(chat, processedFps);

    return unextractedIds.slice(0, maxMessages);
}
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run tests/scheduler.test.js --reporter=verbose 2>&1`

Expected: All tests passing (getFingerprint + migrateProcessedMessages + scheduler tests)

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "refactor(scheduler): replace index tracking with fingerprint tracking

- Rename getExtractedMessageIds to getProcessedFingerprints
- Update getUnextractedMessageIds to use fingerprints + is_system filter
- Fix getBackfillStats extractedCount to handle dead fingerprints
- Keep backward compatibility alias during transition"
```

---

### Task 4: Update extract.js - Remove Watermark, Store Fingerprints

**Purpose:** Remove the watermark-based incremental mode and store fingerprints instead of indices.

**Common Pitfalls:**
- The messageIds parameter may be undefined - handle with scheduler fallback
- memory.message_ids still stores indices (for sequence calculation)
- Update the backfill guard that checks already-extracted messages

**Files:**
- Modify: `src/extraction/extract.js`
- Modify: `tests/extraction/extract.test.js`

- [ ] Step 1: Update extract.js imports and remove watermark

Update imports at top of `src/extraction/extract.js`:

```javascript
// Remove LAST_PROCESSED_KEY from import
import { PROCESSED_MESSAGES_KEY } from '../constants.js';
// Add new imports from scheduler
import {
    getProcessedFingerprints,
    getFingerprint,
    getNextBatch,
} from './scheduler.js';
```

Update the backfill guard around line 970:

```javascript
// BEFORE:
// const alreadyExtractedIds = getExtractedMessageIds(data);
// if (alreadyExtractedIds.has(messageId)) {

// AFTER:
const processedFps = getProcessedFingerprints(data);
if (processedFps.has(getFingerprint(chat[messageId]))) {
    console.log(`[extract] Skipping already-processed message ${messageId}`);
    skippedCount++;
    continue;
}
```

Update the processing section to remove watermark and store fingerprints:

```javascript
// Find and replace the section that stores processedIds:

// BEFORE:
// data[PROCESSED_MESSAGES_KEY].push(...processedIds);
// data[LAST_PROCESSED_KEY] = Math.max(data[LAST_PROCESSED_KEY] || -1, maxId);

// AFTER:
const processedFps = messages.map(m => getFingerprint(m));
data[PROCESSED_MESSAGES_KEY].push(...processedFps);
```

Remove the incremental mode / watermark fallback:

```javascript
// Find the section with:
// if (messageIds && messageIds.length > 0) { ... } else { watermark logic }

// Replace with:
if (!messageIds || messageIds.length === 0) {
    // Defensive: use scheduler to get next batch if no IDs provided
    const batch = getNextBatch(chat, data, settings?.extractionTokenBudget || 2000);
    if (!batch) {
        console.log('[extract] No messages to extract (scheduler returned empty batch)');
        return { status: 'skipped', reason: 'no_new_messages' };
    }
    messagesToExtract = batch.map(id => ({ id, ...chat[id] }));
} else {
    messagesToExtract = messageIds.map(id => ({ id, ...chat[id] })).filter(m => m != null);
}
```

- [ ] Step 2: Update extract.test.js

Update `tests/extraction/extract.test.js`:

```javascript
// Update mock data to remove last_processed_message_id:
const mockData = {
    [PROCESSED_MESSAGES_KEY]: [],
    [MEMORIES_KEY]: [],
    // Remove: last_processed_message_id: -1,
};

// Ensure mockChat messages have send_date:
const mockChat = [
    { name: 'User1', mes: 'Hello', send_date: '1000000' },
    { name: 'Bot', mes: 'Hi there', send_date: '1000001' },
    // ... etc
];

// Update any assertions that check specific indices in processed_message_ids
// The assertion checking length > 0 still works:
expect(mockData[PROCESSED_MESSAGES_KEY].length).toBeGreaterThan(0);
```

- [ ] Step 3: Run extract tests

Run: `npx vitest run tests/extraction/extract.test.js --reporter=verbose 2>&1`

Expected: All tests passing

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "refactor(extract): remove watermark, store fingerprints

- Remove LAST_PROCESSED_KEY usage
- Remove incremental mode fallback (replaced with scheduler batch)
- Store fingerprints instead of indices in PROCESSED_MESSAGES_KEY
- Update backfill guard to use fingerprint matching"
```

---

### Task 5: Update events.js - Auto-Hide Fix and Migration Hook

**Purpose:** Fix autoHideOldMessages to use fingerprints and add migration hook to onChatChanged.

**Common Pitfalls:**
- autoHideOldMessages needs getFingerprint imported
- Migration hook should run after data init but before worker wake
- Use showToast from existing import, not getDeps()

**Files:**
- Modify: `src/events.js`
- Modify: `tests/events.test.js`

- [ ] Step 1: Update events.js imports

Update imports in `src/events.js`:

```javascript
// Replace getExtractedMessageIds with getProcessedFingerprints + getFingerprint
import {
    getProcessedFingerprints,
    getFingerprint,
    migrateProcessedMessages,
} from './extraction/scheduler.js';
```

- [ ] Step 2: Update autoHideOldMessages function

Find `autoHideOldMessages` in `src/events.js` and update:

```javascript
// BEFORE:
// const extractedMessageIds = getExtractedMessageIds(data);
// ...
// if (!extractedMessageIds.has(idx)) continue;

// AFTER:
const processedFps = getProcessedFingerprints(data);
// ...
if (!processedFps.has(getFingerprint(chat[idx]))) continue;
```

- [ ] Step 3: Add migration hook to onChatChanged

Find `onChatChanged` in `src/events.js`. After the data initialization and cleanup, add:

```javascript
async function onChatChanged(...args) {
    // ... existing code (imports, setup) ...

    const data = getOpenVaultData();
    const chat = getContext().chat;

    // Run migration if needed
    if (migrateProcessedMessages(chat, data)) {
        showToast('info', 'OpenVault upgraded tracking format.', 'Data Migration');
        const { saveOpenVaultData } = await import('./utils/data.js');
        await saveOpenVaultData();
    }

    // ... rest of existing code (worker wake, etc) ...
}
```

- [ ] Step 4: Update events.test.js

Update `tests/events.test.js` to use fingerprint strings:

```javascript
// Update mock messages to have send_date:
const mockChat = [
    { name: 'User1', mes: 'Hello', send_date: '1000000' },
    { name: 'Bot', mes: 'Hi there', send_date: '1000001' },
    { name: 'User1', mes: 'How are you?', send_date: '1000002' },
    { name: 'Bot', mes: 'Good!', send_date: '1000003' },
    // ... etc
];

// Update mockData to use fingerprint strings instead of indices:
// BEFORE: processed_message_ids: [0, 1, 2, 3, 4, 5, 6, 7]
// AFTER:  processed_message_ids: ['1000000', '1000001', '1000002', '1000003', ...]

const mockData = {
    processed_message_ids: mockChat.map(m => m.send_date),
    memories: [],
};

// For "skips unextracted messages" test, only include some fingerprints:
const partialData = {
    processed_message_ids: ['1000000', '1000001'],  // Only first 2 processed
    memories: [],
};
```

- [ ] Step 5: Run events tests

Run: `npx vitest run tests/events.test.js --reporter=verbose 2>&1`

Expected: All tests passing

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "feat(events): fingerprint-based autoHide and migration hook

- Update autoHideOldMessages to use fingerprints
- Add migrateProcessedMessages hook to onChatChanged
- Show toast notification when migration occurs"
```

---

### Task 6: Update UI Files

**Purpose:** Update imports and fix calculateExtractionStats in UI helpers.

**Files:**
- Modify: `src/ui/settings.js`
- Modify: `src/ui/status.js`
- Modify: `src/ui/helpers.js`
- Modify: `tests/ui/ui-helpers.test.js`

- [ ] Step 1: Update settings.js imports

In `src/ui/settings.js`, update the import:

```javascript
// BEFORE:
// import { getExtractedMessageIds, getUnextractedMessageIds } from '../extraction/scheduler.js';

// AFTER:
import { getProcessedFingerprints, getUnextractedMessageIds } from '../extraction/scheduler.js';
```

Find usage and update variable name:

```javascript
// BEFORE:
// const extractedIds = getExtractedMessageIds(data);

// AFTER:
const processedFps = getProcessedFingerprints(data);
// (Keep using processedFps with getUnextractedMessageIds as before)
```

- [ ] Step 2: Update status.js imports

In `src/ui/status.js`, update the import:

```javascript
// BEFORE:
// import { getExtractedMessageIds, getUnextractedMessageIds } from '../extraction/scheduler.js';

// AFTER:
import { getProcessedFingerprints, getUnextractedMessageIds } from '../extraction/scheduler.js';
```

Update the usage similarly to settings.js.

- [ ] Step 3: Update helpers.js calculateExtractionStats

In `src/ui/helpers.js`, update the function signature:

```javascript
// BEFORE:
// export function calculateExtractionStats(chat, extractedMessageIds) {
//     const extractedCount = extractedMessageIds.size;
//     ...
// }

// AFTER:
/**
 * Calculate extraction statistics for UI display.
 * @param {Array} chat - Chat array
 * @param {number} extractedCount - Number of extracted messages (computed by caller)
 * @returns {Object} Statistics object
 */
export function calculateExtractionStats(chat, extractedCount) {
    const totalMessages = chat.length;
    const unextractedCount = totalMessages - extractedCount;

    return {
        totalMessages,
        extractedCount,
        unextractedCount,
        extractionProgress: totalMessages > 0
            ? Math.round((extractedCount / totalMessages) * 100)
            : 0,
    };
}
```

- [ ] Step 4: Update ui-helpers.test.js

In `tests/ui/ui-helpers.test.js`, update tests to pass numbers:

```javascript
// BEFORE:
// const extractedIds = new Set([0, 1, 2]);
// const stats = calculateExtractionStats(chat, extractedIds);

// AFTER:
const extractedCount = 3;
const stats = calculateExtractionStats(chat, extractedCount);
```

- [ ] Step 5: Run UI helper tests

Run: `npx vitest run tests/ui/ui-helpers.test.js --reporter=verbose 2>&1`

Expected: All tests passing

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "refactor(ui): update imports and fix calculateExtractionStats

- Rename getExtractedMessageIds to getProcessedFingerprints in settings.js, status.js
- Change calculateExtractionStats to accept extractedCount number instead of Set
- Fixes inflated count issue from dead fingerprints"
```

---

### Task 7: Remove LAST_PROCESSED_KEY Constant

**Purpose:** Clean up the deprecated LAST_PROCESSED_KEY constant and all references.

**Files:**
- Modify: `src/constants.js`
- Modify: `src/utils/data.js`
- Modify: `tests/utils/data.test.js`
- Modify: `tests/factories.js`

- [ ] Step 1: Remove from constants.js

In `src/constants.js`, remove:

```javascript
// REMOVE this line:
// export const LAST_PROCESSED_KEY = 'last_processed_message_id';
```

- [ ] Step 2: Remove from data.js

In `src/utils/data.js`, find `getOpenVaultData()` and remove:

```javascript
// REMOVE from the returned object:
// [LAST_PROCESSED_KEY]: -1,
```

Also remove the import of `LAST_PROCESSED_KEY` if it's no longer used.

- [ ] Step 3: Remove from data.test.js

In `tests/utils/data.test.js`, remove any references to `LAST_PROCESSED_KEY`.

- [ ] Step 4: Remove from factories.js

In `tests/factories.js`, remove:

```javascript
// REMOVE:
// last_processed_message_id: -1,
```

- [ ] Step 5: Remove alias from scheduler.js

In `src/extraction/scheduler.js`, remove the backward compatibility alias:

```javascript
// REMOVE:
// export const getExtractedMessageIds = getProcessedFingerprints;
```

- [ ] Step 6: Run all tests

Run: `npx vitest run --reporter=verbose 2>&1 | tail -30`

Expected: All tests passing

- [ ] Step 7: Commit

```bash
git add -A && git commit -m "chore: remove deprecated LAST_PROCESSED_KEY constant

- Remove from constants.js, data.js
- Update tests to not reference deprecated key
- Remove backward compatibility alias"
```

---

### Task 8: Full Test Suite Verification

**Purpose:** Ensure all tests pass and the implementation is complete.

- [ ] Step 1: Run full test suite

Run: `npx vitest run --reporter=verbose 2>&1`

Expected output:
```
 ✓ tests/scheduler.test.js (XX tests)
 ✓ tests/extraction/extract.test.js (XX tests)
 ✓ tests/events.test.js (XX tests)
 ✓ tests/ui/ui-helpers.test.js (XX tests)
 ✓ tests/utils/data.test.js (XX tests)
 ✓ ... other test files

Test Files  XX passed
     Tests  XXX passed
```

- [ ] Step 2: Run lint check (if available)

Run: `npm run lint 2>&1 || echo "No lint command configured"`

- [ ] Step 3: Final commit

```bash
git add -A && git commit -m "feat: fingerprint-based message tracking (complete)

Replaces fragile array-index tracking with stable fingerprints:
- Primary: send_date timestamp (unique per message, survives array mutations)
- Fallback: cyrb53 content hash (for imported chats without send_date)

Changes:
- scheduler.js: getFingerprint(), migrateProcessedMessages(), fingerprint-based filtering
- extract.js: Remove watermark, store fingerprints
- events.js: Migration hook, fingerprint-based autoHide
- UI files: Updated imports, fixed calculateExtractionStats
- Removed: LAST_PROCESSED_KEY constant and watermark logic

Migration:
- One-time conversion from indices to fingerprints on chat open
- Temporal guard prevents data loss from shifted indices
- Toast notification informs user of upgrade"
```

---

## Verification Checklist

After completing all tasks, verify:

- [ ] `getFingerprint` returns send_date when present, hash otherwise
- [ ] `migrateProcessedMessages` correctly converts old index format
- [ ] `getUnextractedMessageIds` filters `is_system` messages
- [ ] `getBackfillStats` extractedCount excludes dead fingerprints
- [ ] `extract.js` no longer references `LAST_PROCESSED_KEY`
- [ ] `events.js` autoHide uses fingerprints
- [ ] Migration hook runs on chat change
- [ ] All tests pass
- [ ] No references to `LAST_PROCESSED_KEY` remain
- [ ] `getExtractedMessageIds` alias removed

---

## Notes for Implementer

1. **Test Commands:** All test commands use `npx vitest run` for deterministic output. Use `npx vitest watch` during development for faster feedback.

2. **Order Matters:** Tasks 1-2 are independent. Tasks 3-6 form a dependent batch where intermediate states may have broken imports. Task 7 is cleanup that must come last.

3. **Type Safety:** The fingerprint Set contains strings (send_date or hash). The Set membership check `processedFps.has(getFingerprint(msg))` always compares strings.

4. **Temporal Guard:** The migration safety check compares message send_date to memory created_at. Messages sent AFTER the last memory was created are assumed to be new (index shifted) and are not migrated.

5. **Dead Fingerprints:** Fingerprints from deleted messages remain in storage harmlessly. The `getBackfillStats` fix computes extractedCount from visible messages, not Set.size.

6. **Memory.message_ids:** These still store indices for sequence calculation and metadata. They are NOT used for tracking and are NOT migrated.
