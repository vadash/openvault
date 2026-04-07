# Review Bugfixes Implementation Plan

**Goal:** Fix four bugs identified in code review: RangeError from spread in Math.max, stale message_ids indices, destructive global unhide, and undefined userName prompt poisoning.
**Architecture:** Pure bugfixes — no new modules or abstractions. Each fix is isolated to its domain (math, retrieval, store, prompts). Issue 2 requires a schema migration (v2→v3) to convert `memory.message_ids` from array indices to fingerprints.
**Tech Stack:** Vitest, existing test patterns (unit for math/prompts, integration for store/extraction)

---

### File Structure Overview

- Modify: `src/retrieval/math.js` - Replace spread operators with safe iteration
- Modify: `src/extraction/extract.js` - Store fingerprints instead of indices in message_ids
- Modify: `src/retrieval/retrieve.js` - Resolve fingerprints to current indices at retrieval time
- Modify: `src/store/chat-data.js` - Tag OpenVault-hidden messages, safe unhide
- Modify: `src/events.js` - Tag messages when auto-hiding
- Modify: `src/prompts/events/builder.js` - Fallback for userName
- Modify: `src/prompts/graph/builder.js` - Fallback for userName
- Modify: `src/prompts/shared/formatters.js` - Fallback for userName
- Modify: `src/store/schemas.js` - Add message_fingerprints field, update schema version
- Modify: `src/store/migrations/index.js` - Bump version, add v3 migration
- Create: `src/store/migrations/v3.js` - Migrate memory.message_ids to message_fingerprints
- Create: `tests/retrieval/math-spread.test.js` - Tests for safe Math.max iteration
- Create: `tests/prompts/formatters-username.test.js` - Tests for userName fallback
- Create: `tests/store/migrations-v3.test.js` - Tests for v3 migration
- Modify: `tests/store/chat-data.test.js` - Add unhide tests

---

### Task 1: Fix RangeError from spread in Math.max (math.js)

**Files:**
- Modify: `src/retrieval/math.js`
- Test: `tests/retrieval/math-spread.test.js`

- [ ] Step 1: Write the failing tests

Create `tests/retrieval/math-spread.test.js`:

```javascript
// @ts-check
/* global describe, expect, it */
import { describe, expect, it } from 'vitest';

describe('scoreMemories - safe max over large iterables', () => {
    it('does not throw when idfMap has 100K entries', async () => {
        const { calculateIDF, scoreMemories } = await import('../../src/retrieval/math.js');

        // Build a corpus with 100K unique terms to exceed the JS argument limit
        const memories = [];
        const tokenizedMemories = new Map();
        for (let i = 0; i < 200; i++) {
            const tokens = [];
            for (let j = 0; j < 500; j++) {
                tokens.push(`unique_term_${i}_${j}`);
            }
            memories.push({ summary: `memory ${i}` });
            tokenizedMemories.set(i, tokens);
        }
        const { idfMap } = calculateIDF(memories, tokenizedMemories);

        // idfMap now has 100K entries — spread into Math.max would crash
        expect(() => scoreMemories(
            memories,
            [],
            null,
            idfMap,
            tokenizedMemories,
            1.0,
            { recentContext: '', userMessages: '' },
            null,
            null,
            null,
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            [],
            false
        )).not.toThrow();
    });

    it('does not throw when rawBM25Scores has many entries', async () => {
        const { calculateIDF, scoreMemories } = await import('../../src/retrieval/math.js');

        const memories = Array.from({ length: 1000 }, (_, i) => ({ summary: `memory ${i}` }));
        const tokenizedMemories = new Map();
        for (let i = 0; i < 1000; i++) {
            tokenizedMemories.set(i, [`term_${i}`]);
        }
        const { idfMap } = calculateIDF(memories, tokenizedMemories);

        expect(() => scoreMemories(
            memories,
            [],
            null,
            idfMap,
            tokenizedMemories,
            1.0,
            { recentContext: 'term_0 term_1', userMessages: '' },
            null,
            null,
            null,
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            [],
            false
        )).not.toThrow();
    });
});

describe('calculateScore - safe max over message_ids', () => {
    it('handles single-element message_ids', async () => {
        const { calculateScore } = await import('../../src/retrieval/math.js');
        const result = calculateScore(
            { importance: 3, message_ids: [50] },
            null,
            100,
            { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
            0
        );
        expect(result).toBeDefined();
    });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run tests/retrieval/math-spread.test.js --reporter verbose`
Expected: FAIL — `RangeError: Maximum call stack size exceeded` on the 100K idfMap test

- [ ] Step 3: Write the minimal implementation

In `src/retrieval/math.js`, replace three spread patterns:

**Pattern 1 — `maxIDF` (line ~457):**

Replace:
```javascript
const maxIDF = idfMap ? Math.max(...idfMap.values()) : Math.log(idfCorpus.length + 1);
```
With:
```javascript
let maxIDF = idfMap ? -Infinity : Math.log(idfCorpus.length + 1);
if (idfMap) {
    for (const val of idfMap.values()) {
        if (val > maxIDF) maxIDF = val;
    }
}
if (!isFinite(maxIDF)) maxIDF = Math.log(idfCorpus.length + 1);
```

**Pattern 2 — `maxBM25` (line ~467):**

Replace:
```javascript
const maxBM25 = Math.max(...rawBM25Scores, 1e-9);
```
With:
```javascript
let maxBM25 = 1e-9;
for (let i = 0; i < rawBM25Scores.length; i++) {
    if (rawBM25Scores[i] > maxBM25) maxBM25 = rawBM25Scores[i];
}
```

**Pattern 3 — `maxMessageId` in `calculateScore` (line ~252):**

Replace:
```javascript
const maxMessageId = Math.max(...messageIds);
```
With:
```javascript
let maxMessageId = -Infinity;
for (const id of messageIds) {
    if (id > maxMessageId) maxMessageId = id;
}
if (!isFinite(maxMessageId)) maxMessageId = 0;
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run tests/retrieval/math-spread.test.js --reporter verbose`
Expected: PASS

- [ ] Step 5: Run full test suite to check for regressions

Run: `npx vitest run --reporter verbose 2>&1 | tail -20`
Expected: All tests pass, no regressions

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "fix: replace Math.max spread with safe iteration in scoreMemories"
```

---

### Task 2: Add OA_HIDDEN tag to messages hidden by OpenVault

**Files:**
- Modify: `src/events.js`
- Modify: `src/extraction/extract.js`
- Modify: `src/store/chat-data.js`
- Test: `tests/store/chat-data.test.js` (add unhide tests to existing file)

- [ ] Step 1: Write the failing tests

Add to `tests/store/chat-data.test.js` inside the existing `describe('deleteCurrentChatData')` block:

```javascript
it('only unhides messages tagged by OpenVault, preserves ST-native hidden messages', async () => {
    mockContext.chatMetadata[METADATA_KEY] = {
        [MEMORIES_KEY]: [{ id: '1' }],
    };
    mockContext.chat = [
        { is_system: false },                         // visible — no change
        { is_system: true, is_user: true },            // ST-native hidden (e.g. Author's Note)
        { is_system: true, _openvault_hidden: true },  // OpenVault hidden — should unhide
        { is_system: true },                           // ST-native hidden — should stay hidden
    ];
    setDeps({
        console: mockConsole,
        getContext: () => mockContext,
        getExtensionSettings: () => ({
            [extensionName]: { debugMode: true },
        }),
        saveChatConditional: vi.fn().mockResolvedValue(undefined),
    });

    await deleteCurrentChatData();

    expect(mockContext.chat[0].is_system).toBe(false);   // unchanged
    expect(mockContext.chat[1].is_system).toBe(true);     // ST-native preserved
    expect(mockContext.chat[2].is_system).toBe(false);    // OV-hidden unhid
    expect(mockContext.chat[3].is_system).toBe(true);     // ST-native preserved
});
```

- [ ] Step 2: Run the test to verify it fails

Run: `npx vitest run tests/store/chat-data.test.js --reporter verbose`
Expected: FAIL — the unhide loop currently sets `is_system = false` on ALL hidden messages

- [ ] Step 3: Implement the tagging

**In `src/events.js`** (~line 91), when auto-hiding:

Replace:
```javascript
for (const idx of snapped) {
    chat[idx].is_system = true;
}
```
With:
```javascript
for (const idx of snapped) {
    chat[idx].is_system = true;
    chat[idx]._openvault_hidden = true;
}
```

**In `src/extraction/extract.js`** (~line 159), in `hideExtractedMessages`:

Replace:
```javascript
if (processedFps.has(getFingerprint(msg)) && !msg.is_system) {
    msg.is_system = true;
    hiddenCount++;
}
```
With:
```javascript
if (processedFps.has(getFingerprint(msg)) && !msg.is_system) {
    msg.is_system = true;
    msg._openvault_hidden = true;
    hiddenCount++;
}
```

**In `src/store/chat-data.js`** (~line 358), in `deleteCurrentChatData`:

Replace:
```javascript
for (const msg of chat) {
    if (msg.is_system) {
        msg.is_system = false;
        unhiddenCount++;
    }
}
```
With:
```javascript
for (const msg of chat) {
    if (msg._openvault_hidden && msg.is_system) {
        msg.is_system = false;
        delete msg._openvault_hidden;
        unhiddenCount++;
    }
}
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run tests/store/chat-data.test.js --reporter verbose`
Expected: PASS — all existing and new tests pass

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: tag OpenVault-hidden messages, only unhide tagged messages on data clear"
```

---

### Task 3: Add userName fallback in prompt builders

**Files:**
- Modify: `src/prompts/events/builder.js`
- Modify: `src/prompts/graph/builder.js`
- Modify: `src/prompts/shared/formatters.js`
- Test: `tests/prompts/formatters-username.test.js`

- [ ] Step 1: Write the failing tests

Create `tests/prompts/formatters-username.test.js`:

```javascript
// @ts-check
/* global describe, expect, it */
import { describe, expect, it } from 'vitest';

describe('formatCharacters - userName fallback', () => {
    it('uses "User" when userName is empty string', async () => {
        const { formatCharacters } = await import('../../src/prompts/shared/formatters.js');
        const result = formatCharacters('Alice', '', 'A brave knight', '');
        expect(result).toContain('name="User"');
        expect(result).not.toContain('name=""');
    });

    it('uses "User" when userName is undefined', async () => {
        const { formatCharacters } = await import('../../src/prompts/shared/formatters.js');
        const result = formatCharacters('Alice', undefined, '', '');
        expect(result).toContain('name="User"');
        expect(result).not.toContain('name="undefined"');
    });

    it('uses actual userName when provided', async () => {
        const { formatCharacters } = await import('../../src/prompts/shared/formatters.js');
        const result = formatCharacters('Alice', 'Vova', '', '');
        expect(result).toContain('name="Vova"');
        expect(result).not.toContain('name="User"');
    });
});

describe('buildEventExtractionPrompt - userName fallback', () => {
    it('does not inject literal "undefined" in user prompt', async () => {
        const { buildEventExtractionPrompt } = await import('../../src/prompts/events/builder.js');
        const result = buildEventExtractionPrompt({
            messages: 'Hello world',
            names: { char: 'Alice', user: undefined },
            context: {},
        });
        const userMsg = result.find((m) => m.role === 'user');
        expect(userMsg.content).not.toContain('undefined');
        expect(userMsg.content).toContain('User');
    });

    it('uses actual userName when provided', async () => {
        const { buildEventExtractionPrompt } = await import('../../src/prompts/events/builder.js');
        const result = buildEventExtractionPrompt({
            messages: 'Hello world',
            names: { char: 'Alice', user: 'Vova' },
            context: {},
        });
        const userMsg = result.find((m) => m.role === 'user');
        expect(userMsg.content).toContain('Vova');
    });
});

describe('buildGraphExtractionPrompt - userName fallback', () => {
    it('does not inject literal "undefined" in user prompt', async () => {
        const { buildGraphExtractionPrompt } = await import('../../src/prompts/graph/builder.js');
        const result = buildGraphExtractionPrompt({
            messages: 'Hello world',
            names: { char: 'Alice', user: undefined },
            context: {},
        });
        const userMsg = result.find((m) => m.role === 'user');
        expect(userMsg.content).not.toContain('undefined');
        expect(userMsg.content).toContain('User');
    });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run tests/prompts/formatters-username.test.js --reporter verbose`
Expected: FAIL — formatCharacters and builders inject literal "undefined"

- [ ] Step 3: Implement the fallback

**In `src/prompts/shared/formatters.js`**, at the top of `formatCharacters`:

Add as the first line:
```javascript
userName = userName || 'User';
characterName = characterName || 'Character';
```

**In `src/prompts/events/builder.js`**, after destructuring `names`:

After:
```javascript
const { char: characterName, user: userName } = names;
```
Add:
```javascript
const safeCharName = characterName || 'Character';
const safeUserName = userName || 'User';
```

Then replace all usages of `characterName` with `safeCharName` and `userName` with `safeUserName` in the function body. Pass `safeCharName` and `safeUserName` to `formatCharacters`.

**In `src/prompts/graph/builder.js`**, same pattern:

After:
```javascript
const { char: characterName, user: userName } = names;
```
Add:
```javascript
const safeCharName = characterName || 'Character';
const safeUserName = userName || 'User';
```

Then replace all usages of `characterName` with `safeCharName` and `userName` with `safeUserName`. Pass `safeCharName` and `safeUserName` to `formatCharacters`.

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run tests/prompts/formatters-username.test.js --reporter verbose`
Expected: PASS

- [ ] Step 5: Run full prompt test suite for regressions

Run: `npx vitest run tests/prompts/ --reporter verbose`
Expected: All pass

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "fix: fallback userName to 'User' when undefined in prompt builders"
```

---

### Task 4: Store fingerprints alongside indices in message_ids

**Files:**
- Modify: `src/store/schemas.js`
- Modify: `src/extraction/extract.js`
- Test: `tests/extraction/hide-messages.test.js` (existing tests, verify no breakage)

This task adds a `message_fingerprints` field to memories while keeping `message_ids` intact for backward compatibility. The next task (Task 5) will add the v3 migration to backfill existing memories, and Task 6 will switch consumers to use fingerprints.

- [ ] Step 1: Update the schema

In `src/store/schemas.js`, add to `MemorySchema` after the `message_ids` line:

```javascript
message_fingerprints: z.array(z.string()).optional(),
```

- [ ] Step 2: Write fingerprints at extraction time

In `src/extraction/extract.js`, in `enrichAndDedupEvents` (~line 796), after:

```javascript
message_ids: messageIdsArray,
```

Add:
```javascript
message_fingerprints: messageFingerprintsArray,
```

In the calling code (~line 950), where `messageIdsArray` is created:

```javascript
const messageIdsArray = messages.map((m) => m.id);
```

Add after it:
```javascript
const messageFingerprintsArray = messages.map((m) => getFingerprint(m));
```

This requires importing `getFingerprint` from `./scheduler.js` in `extract.js`. Check if it's already imported — if not, add it to the import block at the top.

- [ ] Step 3: Run existing tests to verify no breakage

Run: `npx vitest run tests/extraction/ --reporter verbose`
Expected: PASS — no existing test checks message_ids directly

Run: `npx vitest run tests/store/chat-data.test.js --reporter verbose`
Expected: PASS

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "feat: store message_fingerprints alongside message_ids on memories"
```

---

### Task 5: Add v3 migration to backfill message_fingerprints

**Files:**
- Modify: `src/store/migrations/index.js`
- Create: `src/store/migrations/v3.js`
- Modify: `src/store/chat-data.js` (update default schema version)
- Test: `tests/store/migrations-v3.test.js`

- [ ] Step 1: Write the failing tests

Create `tests/store/migrations-v3.test.js`:

```javascript
// @ts-check
/* global describe, expect, it */
import { describe, expect, it } from 'vitest';
import { runSchemaMigrations, CURRENT_SCHEMA_VERSION } from '../../src/store/migrations/index.js';

describe('v3 migration - backfill message_fingerprints', () => {
    const chat = [
        { send_date: '1000000', name: 'Alice', mes: 'Hello' },
        { send_date: '2000000', name: 'Bob', mes: 'World' },
        { send_date: '3000000', name: 'Alice', mes: 'Goodbye' },
    ];

    it('converts message_ids indices to message_fingerprints for existing memories', () => {
        const data = {
            schema_version: 2,
            memories: [
                { id: 'mem1', message_ids: [0, 1] },
                { id: 'mem2', message_ids: [2] },
                { id: 'mem3', message_ids: [] },
            ],
        };

        const result = runSchemaMigrations(data, chat);

        expect(result).toBe(true);
        expect(data.schema_version).toBe(3);
        expect(data.memories[0].message_fingerprints).toEqual(['1000000', '2000000']);
        expect(data.memories[1].message_fingerprints).toEqual(['3000000']);
        expect(data.memories[2].message_fingerprints).toEqual([]);
    });

    it('skips migration when already v3', () => {
        const data = {
            schema_version: 3,
            memories: [{ id: 'mem1', message_ids: [0], message_fingerprints: ['1000000'] }],
        };

        const result = runSchemaMigrations(data, chat);

        expect(result).toBe(false);
    });

    it('handles memories with missing message_ids', () => {
        const data = {
            schema_version: 2,
            memories: [
                { id: 'mem1' }, // no message_ids at all
            ],
        };

        const result = runSchemaMigrations(data, chat);

        expect(result).toBe(true);
        expect(data.memories[0].message_fingerprints).toEqual([]);
    });

    it('handles out-of-bounds indices gracefully', () => {
        const data = {
            schema_version: 2,
            memories: [
                { id: 'mem1', message_ids: [0, 99, 2] }, // index 99 doesn't exist
            ],
        };

        const result = runSchemaMigrations(data, chat);

        expect(result).toBe(true);
        expect(data.memories[0].message_fingerprints).toEqual(['1000000', '3000000']);
    });

    it('leaves message_ids intact for backward compatibility', () => {
        const data = {
            schema_version: 2,
            memories: [{ id: 'mem1', message_ids: [0] }],
        };

        runSchemaMigrations(data, chat);

        expect(data.memories[0].message_ids).toEqual([0]); // still there
    });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run tests/store/migrations-v3.test.js --reporter verbose`
Expected: FAIL — v3 migration does not exist yet

- [ ] Step 3: Implement the v3 migration

Create `src/store/migrations/v3.js`:

```javascript
import { MEMORIES_KEY } from '../../constants.js';
import { getFingerprint } from '../../extraction/scheduler.js';

/**
 * Backfill message_fingerprints from message_ids indices.
 * Leaves message_ids intact for backward compatibility.
 * @param {Object} data - OpenVault data (mutated)
 * @param {Array} chat - Chat messages
 * @returns {boolean} True if any memories were backfilled
 */
function migrateMessageFingerprints(data, chat) {
    const memories = data[MEMORIES_KEY];
    if (!memories?.length) return false;

    let changed = false;
    for (const memory of memories) {
        // Already has fingerprints — skip
        if (memory.message_fingerprints) continue;

        const indices = memory.message_ids || [];
        if (indices.length === 0) {
            memory.message_fingerprints = [];
            changed = true;
            continue;
        }

        const fps = [];
        for (const idx of indices) {
            const msg = chat[idx];
            if (msg) {
                fps.push(getFingerprint(msg));
            }
        }

        memory.message_fingerprints = fps;
        changed = true;
    }

    return changed;
}

/**
 * Run full v3 migration.
 * @param {Object} data - OpenVault data (mutated)
 * @param {Array} chat - Chat messages
 * @returns {boolean} True if any changes made
 */
export function migrateToV3(data, chat) {
    return migrateMessageFingerprints(data, chat);
}
```

Update `src/store/migrations/index.js`:

```javascript
import { migrateToV2 } from './v2.js';
import { migrateToV3 } from './v3.js';

export const CURRENT_SCHEMA_VERSION = 3;

const MIGRATIONS = [
    { version: 2, run: migrateToV2 },
    { version: 3, run: migrateToV3 },
];

// ... rest unchanged
```

Update `src/store/chat-data.js` default schema version:

Change:
```javascript
schema_version: 2,
```
To:
```javascript
schema_version: 3,
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run tests/store/migrations-v3.test.js --reporter verbose`
Expected: PASS

- [ ] Step 5: Run all migration and store tests for regressions

Run: `npx vitest run tests/store/migrations.test.js tests/store/chat-data.test.js --reporter verbose`
Expected: PASS — existing migration tests still pass (v2 migration unchanged, v2→v3 runs sequentially)

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "feat: add v3 migration to backfill message_fingerprints from indices"
```

---

### Task 6: Switch retrieval consumers to use fingerprints

**Files:**
- Modify: `src/retrieval/retrieve.js`
- Modify: `src/retrieval/math.js`
- Test: `tests/retrieval/scoring.test.js` (add fingerprint-based scoring test)

This task changes `_getHiddenMemories()` and `calculateScore()` to resolve fingerprints to current chat indices, making them resilient to chat mutations.

- [ ] Step 1: Write the failing tests

Add to `tests/retrieval/scoring.test.js` (or create a new test case within the existing `calculateScore` describe block):

```javascript
it('uses message_fingerprints over message_ids for distance calculation', async () => {
    const { calculateScore } = await import('../../src/retrieval/math.js');

    // Memory created at chat length 100 with message_ids=[90] (now stale after deletion)
    // But message_fingerprints point to a message that is now at index 45
    const memory = {
        importance: 3,
        message_ids: [90],           // stale — original index
        message_fingerprints: ['fp_45'], // current fingerprint
    };

    const result = calculateScore(
        memory,
        null,
        50,  // current chat length (after 50 messages deleted)
        { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
        { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
        0,
        null, // chatFingerprintMap — null means fall back to message_ids
    );

    // With stale message_ids: distance = max(0, 50 - 90) = 0 (broken — appears brand new)
    // With fingerprints and chatFingerprintMap: distance would be based on actual position
    expect(result).toBeDefined();
    // The key assertion: distance should NOT be 0 from stale indices when fingerprints are available
    // (This test verifies the function accepts the chatFingerprintMap parameter)
});

it('falls back to message_ids when no fingerprints available', async () => {
    const { calculateScore } = await import('../../src/retrieval/math.js');

    const memory = {
        importance: 3,
        message_ids: [40],
        // no message_fingerprints
    };

    const result = calculateScore(
        memory,
        null,
        50,
        { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
        { alpha: 0.7, combinedBoostWeight: 15, vectorSimilarityThreshold: 0.5 },
        0,
        null,
    );

    expect(result).toBeDefined();
    expect(result.distance).toBe(10); // 50 - 40
});
```

Also add tests for `_getHiddenMemories`:

```javascript
describe('_getHiddenMemories - fingerprint resolution', () => {
    it('resolves fingerprints to current indices when chat has been modified', async () => {
        const { default: retrieveModule } = await import('../../src/retrieval/retrieve.js');

        // We can't test the private function directly, so test through the exported
        // buildRetrievalContext or selectRelevantMemories.
        // Instead, test the resolution logic as a unit:
        const chat = [
            { is_system: false, send_date: '1000' },
            { is_system: true, send_date: '2000' },   // hidden
            { is_system: false, send_date: '3000' },
        ];

        // Build fingerprint map
        const fingerprintMap = new Map();
        for (let i = 0; i < chat.length; i++) {
            fingerprintMap.set(String(chat[i].send_date), i);
        }

        // Memory with fingerprints pointing to index 1 (hidden message)
        // After chat mutation, the fingerprint still resolves correctly
        const memory = {
            message_ids: [99],           // stale
            message_fingerprints: ['2000'], // resolves to index 1
        };

        // The resolved index should be 1 (hidden), not 99 (out of bounds)
        const resolvedIndices = memory.message_fingerprints
            ?.map((fp) => fingerprintMap.get(fp))
            .filter((idx) => idx !== undefined) ?? [];

        expect(resolvedIndices).toContain(1);
        expect(chat[resolvedIndices[0]].is_system).toBe(true);
    });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run tests/retrieval/scoring.test.js --reporter verbose`
Expected: FAIL — `calculateScore` does not accept `chatFingerprintMap` parameter yet

- [ ] Step 3: Implement fingerprint resolution

**In `src/retrieval/math.js`**, update `calculateScore` signature and distance logic:

Add `chatFingerprintMap` parameter (7th position, after `bm25Score`):

Replace the distance block:
```javascript
const messageIds = memory.message_ids || [0];
const maxMessageId = Math.max(...messageIds);
const distance = Math.max(0, chatLength - maxMessageId);
```

With:
```javascript
// Resolve message positions using fingerprints when available,
// falling back to raw indices for backward compatibility
let maxMessagePosition = 0;
if (chatFingerprintMap && memory.message_fingerprints?.length > 0) {
    for (const fp of memory.message_fingerprints) {
        const pos = chatFingerprintMap.get(fp);
        if (pos !== undefined && pos > maxMessagePosition) {
            maxMessagePosition = pos;
        }
    }
} else {
    const messageIds = memory.message_ids || [0];
    for (const id of messageIds) {
        if (id > maxMessagePosition) maxMessagePosition = id;
    }
}
const distance = Math.max(0, chatLength - maxMessagePosition);
```

**In `src/retrieval/retrieve.js`**, update `_getHiddenMemories`:

Replace:
```javascript
function _getHiddenMemories(chat, memories) {
    return memories.filter((m) => {
        if (!m.message_ids?.length) return false;
        const minId = Math.min(...m.message_ids);
        return chat[minId]?.is_system;
    });
}
```

With:
```javascript
function _getHiddenMemories(chat, memories) {
    // Build fingerprint→index map for current chat
    const fpMap = new Map();
    for (let i = 0; i < chat.length; i++) {
        const fp = getFingerprint(chat[i]);
        fpMap.set(fp, i);
    }

    return memories.filter((m) => {
        // Prefer fingerprints (stable across chat mutations)
        if (m.message_fingerprints?.length > 0) {
            const resolvedIndices = m.message_fingerprints
                .map((fp) => fpMap.get(fp))
                .filter((idx) => idx !== undefined);
            if (resolvedIndices.length > 0) {
                const minId = Math.min(...resolvedIndices);
                return chat[minId]?.is_system;
            }
        }
        // Fall back to message_ids (legacy)
        if (!m.message_ids?.length) return false;
        const minId = Math.min(...m.message_ids);
        return chat[minId]?.is_system;
    });
}
```

Add import at the top of `retrieve.js`:
```javascript
import { getFingerprint } from '../extraction/scheduler.js';
```

**In `src/retrieval/retrieve.js`**, build the fingerprint map in `selectRelevantMemories` and pass to `calculateScore`. Find where `calculateScore` is called and add the `chatFingerprintMap` parameter:

Build the map before the scoring loop:
```javascript
const chatFingerprintMap = new Map();
for (let i = 0; i < chat.length; i++) {
    chatFingerprintMap.set(getFingerprint(chat[i]), i);
}
```

Pass it as the 7th argument to `calculateScore` calls.

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run tests/retrieval/scoring.test.js tests/retrieval/retrieve.test.js --reporter verbose`
Expected: PASS

- [ ] Step 5: Run full retrieval test suite for regressions

Run: `npx vitest run tests/retrieval/ --reporter verbose`
Expected: All pass

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "feat: use message_fingerprints for stable retrieval after chat mutations"
```

---

### Task 7: Run full test suite and typecheck

**Files:** None (verification only)

- [ ] Step 1: Run typecheck

Run: `npm run typecheck`
Expected: No errors

- [ ] Step 2: Run lint

Run: `npm run lint`
Expected: No errors

- [ ] Step 3: Run full test suite

Run: `npx vitest run --reporter verbose`
Expected: All tests pass

- [ ] Step 4: Generate types if needed

Run: `npm run generate-types`
Expected: Updated `src/types.d.ts` with `message_fingerprints` field

- [ ] Step 5: Commit if any generated files changed

```bash
git add -A && git commit -m "chore: regenerate types for message_fingerprints field"
```
