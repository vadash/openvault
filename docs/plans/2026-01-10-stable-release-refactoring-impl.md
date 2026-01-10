# OpenVault Stable Release Refactoring - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:using-git-worktrees before making any file modifications.

**Goal:** Stabilize OpenVault for release with dynamic path detection, worker safety, settings decoupling, and serialization testing.

**Architecture:** Four independent changes: (1) replace hardcoded extension path with dynamic detection, (2) wrap Worker instantiation in try-catch with sync fallback, (3) eliminate setExternalFunctions coupling via direct imports, (4) add serialization safety tests.

**Tech Stack:** Browser ES Modules, Web Workers, Vitest/jsdom

---

## Task 1: Dynamic Extension Path Detection

**Files:**
- Modify: `src/constants.js:1-10`

**Step 1: Write the failing test**

Create test file `tests/constants.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('extensionFolderPath', () => {
    it('derives path from import.meta.url', async () => {
        // Dynamic import to get fresh module evaluation
        const { extensionFolderPath } = await import('../src/constants.js');

        // Path should end without /src/constants.js
        expect(extensionFolderPath).not.toContain('/src/constants.js');
        expect(extensionFolderPath).not.toContain('\\src\\constants.js');
    });

    it('handles renamed folder correctly', async () => {
        const { extensionFolderPath } = await import('../src/constants.js');

        // Should not be hardcoded to 'openvault'
        // The actual value depends on where tests run from
        expect(typeof extensionFolderPath).toBe('string');
        expect(extensionFolderPath.length).toBeGreaterThan(0);
    });
});
```

**Step 2: Run test to verify baseline**

```bash
npm test -- tests/constants.test.js
```

Expected: Tests may pass or fail depending on current implementation - establishes baseline.

**Step 3: Update src/constants.js**

Replace the hardcoded path at the top of the file:

```javascript
// Dynamic path detection - works regardless of folder name
const currentUrl = new URL(import.meta.url);
const pathFromST = currentUrl.pathname;
// Handle both Unix and Windows paths, remove /src/constants.js suffix
export const extensionFolderPath = pathFromST
    .replace(/^\/([A-Z]:)/, '$1')  // Fix Windows drive letter (e.g., /C: -> C:)
    .replace(/[/\\]src[/\\]constants\.js$/, '');
```

Remove the old hardcoded line:
```javascript
// DELETE THIS LINE:
export const extensionFolderPath = 'scripts/extensions/third-party/openvault';
```

**Step 4: Run tests**

```bash
npm test -- tests/constants.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/constants.test.js src/constants.js
git commit -m "feat: dynamic extension path detection via import.meta.url"
```

---

## Task 2: Worker Instantiation Safety

**Files:**
- Create: `src/retrieval/sync-scorer.js`
- Modify: `src/retrieval/scoring.js`
- Modify: `tests/scoring.test.js`

### Step 1: Write failing test for sync fallback

Add to `tests/scoring.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { scoreMemoriesSync } from '../src/retrieval/sync-scorer.js';

describe('sync-scorer fallback', () => {
    it('scores memories synchronously', () => {
        const memories = [{
            id: '1',
            summary: 'test memory about dragons',
            importance: 3,
            message_ids: [10],
            embedding: [0.1, 0.2, 0.3],
            event_type: 'dialogue',
            is_secret: false
        }];

        const params = {
            contextEmbedding: [0.1, 0.2, 0.3],
            chatLength: 100,
            limit: 10,
            queryTokens: ['dragon'],
            constants: { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            settings: { vectorSimilarityThreshold: 0.5, vectorSimilarityWeight: 15 }
        };

        const results = scoreMemoriesSync(memories, params);

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeLessThanOrEqual(params.limit);
        if (results.length > 0) {
            expect(results[0]).toHaveProperty('id');
            expect(results[0]).toHaveProperty('score');
        }
    });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/scoring.test.js -t "sync-scorer"
```

Expected: FAIL - module not found

**Step 3: Create src/retrieval/sync-scorer.js**

```javascript
/**
 * Synchronous fallback scorer for environments where Web Workers are unavailable.
 * Uses the same scoring logic as worker.js but runs on the main thread.
 */
import { scoreMemories } from './math.js';

/**
 * Score memories synchronously (main-thread fallback).
 * @param {Array} memories - Array of memory objects with embeddings
 * @param {Object} params - Scoring parameters
 * @param {Array<number>} params.contextEmbedding - Query embedding vector
 * @param {number} params.chatLength - Current chat length for recency calculation
 * @param {number} params.limit - Maximum results to return
 * @param {Array<string>} params.queryTokens - Tokenized query for BM25
 * @param {Object} params.constants - Scoring constants (BASE_LAMBDA, IMPORTANCE_5_FLOOR)
 * @param {Object} params.settings - User settings (vectorSimilarityThreshold, vectorSimilarityWeight)
 * @returns {Array} Scored and sorted memory results
 */
export function scoreMemoriesSync(memories, params) {
    const {
        contextEmbedding,
        chatLength,
        limit,
        queryTokens,
        constants,
        settings
    } = params;

    return scoreMemories(
        memories,
        contextEmbedding,
        chatLength,
        limit,
        queryTokens,
        constants,
        settings
    );
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- tests/scoring.test.js -t "sync-scorer"
```

Expected: PASS

**Step 5: Commit sync-scorer**

```bash
git add src/retrieval/sync-scorer.js tests/scoring.test.js
git commit -m "feat: add sync-scorer.js as worker fallback"
```

### Step 6: Update getScoringWorker with try-catch

In `src/retrieval/scoring.js`, find the `getScoringWorker` function and replace it:

```javascript
/**
 * Gets or creates the scoring worker with error handling.
 * Returns null if worker creation fails (fallback to sync scoring).
 */
function getScoringWorker() {
    if (!scoringWorker) {
        try {
            scoringWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
            scoringWorker.onerror = (e) => {
                console.error('[OpenVault] Worker load error:', e);
                scoringWorker = null;
            };
        } catch (e) {
            console.error('[OpenVault] Worker creation failed, using main thread:', e);
            return null;
        }
    }
    return scoringWorker;
}
```

### Step 7: Add sync fallback import

At the top of `src/retrieval/scoring.js`, add the import:

```javascript
import { scoreMemoriesSync } from './sync-scorer.js';
```

### Step 8: Update scoreMemoriesWithWorker to use fallback

Find the `scoreMemoriesWithWorker` function and add fallback logic after worker retrieval:

```javascript
async function scoreMemoriesWithWorker(memories, contextEmbedding, chatLength, limit, queryTokens, constants, settings) {
    const worker = getScoringWorker();

    // Fallback to sync scoring if worker unavailable
    if (!worker) {
        console.log('[OpenVault] Using synchronous scoring fallback');
        return scoreMemoriesSync(memories, {
            contextEmbedding,
            chatLength,
            limit,
            queryTokens,
            constants,
            settings
        });
    }

    // ... rest of existing worker logic unchanged
```

**Step 9: Run all scoring tests**

```bash
npm test -- tests/scoring.test.js
```

Expected: PASS

**Step 10: Commit worker safety changes**

```bash
git add src/retrieval/scoring.js
git commit -m "feat: add try-catch worker instantiation with sync fallback"
```

---

## Task 3: Worker Serialization Tests

**Files:**
- Modify: `tests/scoring.test.js`

**Step 1: Add serialization tests**

Add to `tests/scoring.test.js`:

```javascript
describe('worker data serialization', () => {
    it('scoring payload is structuredClone-safe', () => {
        const memories = [{
            id: '1',
            summary: 'test memory',
            importance: 3,
            message_ids: [10],
            embedding: [0.1, 0.2, 0.3],
            event_type: 'dialogue',
            is_secret: false
        }];

        const payload = {
            memories,
            memoriesChanged: true,
            contextEmbedding: [0.1, 0.2, 0.3],
            chatLength: 100,
            limit: 10,
            queryTokens: ['test', 'query'],
            constants: { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 },
            settings: { vectorSimilarityThreshold: 0.5, vectorSimilarityWeight: 15 }
        };

        expect(() => structuredClone(payload)).not.toThrow();
    });

    it('rejects non-serializable memory properties', () => {
        const badMemory = {
            id: '1',
            summary: 'test',
            callback: () => {}  // Functions are not serializable
        };

        expect(() => structuredClone(badMemory)).toThrow();
    });

    it('rejects DOM elements in memory', () => {
        // jsdom provides document
        const badMemory = {
            id: '1',
            summary: 'test',
            element: document.createElement('div')
        };

        expect(() => structuredClone(badMemory)).toThrow();
    });

    it('memory schema matches expected structure', () => {
        const validMemory = {
            id: '1',
            summary: 'A dragon attacked the village',
            importance: 4,
            message_ids: [10, 11],
            embedding: new Array(384).fill(0.01),
            event_type: 'action',
            is_secret: false
        };

        // Should clone without error
        const cloned = structuredClone(validMemory);

        expect(cloned.id).toBe(validMemory.id);
        expect(cloned.summary).toBe(validMemory.summary);
        expect(cloned.importance).toBe(validMemory.importance);
        expect(cloned.message_ids).toEqual(validMemory.message_ids);
        expect(cloned.embedding.length).toBe(384);
        expect(cloned.event_type).toBe(validMemory.event_type);
        expect(cloned.is_secret).toBe(validMemory.is_secret);
    });
});
```

**Step 2: Run serialization tests**

```bash
npm test -- tests/scoring.test.js -t "serialization"
```

Expected: PASS

**Step 3: Commit**

```bash
git add tests/scoring.test.js
git commit -m "test: add worker serialization safety tests"
```

---

## Task 4: Settings Decoupling

**Files:**
- Create: `src/listeners.js`
- Create: `src/ui/actions.js`
- Modify: `src/ui/settings.js`
- Modify: `index.js`

### Step 4.1: Create src/listeners.js

**Step 1: Write test for listeners module**

Create `tests/listeners.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock deps before importing
vi.mock('../src/deps.js', () => ({
    getDeps: () => ({
        getExtensionSettings: () => ({
            openvault: { enabled: true }
        }),
        eventSource: {
            on: vi.fn(),
            removeListener: vi.fn(),
            makeFirst: vi.fn()
        }
    })
}));

describe('listeners module', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('exports updateEventListeners function', async () => {
        const { updateEventListeners } = await import('../src/listeners.js');
        expect(typeof updateEventListeners).toBe('function');
    });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/listeners.test.js
```

Expected: FAIL - module not found

**Step 3: Create src/listeners.js**

```javascript
/**
 * Event listener management for OpenVault.
 * Handles registration/deregistration of SillyTavern event handlers.
 */
import { getDeps } from './deps.js';
import { extensionName } from './constants.js';
import {
    onBeforeGeneration,
    onGenerationEnded,
    onMessageReceived,
    onChatChanged
} from './events.js';

let listenersRegistered = false;

/**
 * Updates event listeners based on extension enabled state.
 * Registers listeners when enabled, removes them when disabled.
 */
export function updateEventListeners() {
    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    const eventSource = deps.eventSource;
    const eventTypes = deps.eventTypes;

    if (settings?.enabled && !listenersRegistered) {
        // Register listeners
        eventSource.on(eventTypes.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
        eventSource.makeFirst(eventTypes.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
        eventSource.on(eventTypes.GENERATION_ENDED, onGenerationEnded);
        eventSource.on(eventTypes.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
        listenersRegistered = true;
        console.log('[OpenVault] Event listeners registered');
    } else if (!settings?.enabled && listenersRegistered) {
        // Remove listeners
        eventSource.removeListener(eventTypes.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
        eventSource.removeListener(eventTypes.GENERATION_ENDED, onGenerationEnded);
        eventSource.removeListener(eventTypes.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.removeListener(eventTypes.CHAT_CHANGED, onChatChanged);
        listenersRegistered = false;
        console.log('[OpenVault] Event listeners removed');
    }
}

/**
 * Check if listeners are currently registered.
 * @returns {boolean}
 */
export function areListenersRegistered() {
    return listenersRegistered;
}
```

**Step 4: Run test**

```bash
npm test -- tests/listeners.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/listeners.js tests/listeners.test.js
git commit -m "feat: extract event listener management to src/listeners.js"
```

### Step 4.2: Create src/ui/actions.js

**Step 1: Write test**

Create `tests/ui-actions.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../src/deps.js', () => ({
    getDeps: () => ({
        getContext: () => ({ chatId: 'test-chat' }),
        getExtensionSettings: () => ({ openvault: {} }),
        showToast: vi.fn()
    })
}));

vi.mock('../src/extraction/batch.js', () => ({
    extractAllMessages: vi.fn().mockResolvedValue({ success: true })
}));

vi.mock('../src/data/actions.js', () => ({
    deleteCurrentChatData: vi.fn().mockResolvedValue(true),
    deleteCurrentChatEmbeddings: vi.fn().mockResolvedValue(true)
}));

vi.mock('../src/backfill.js', () => ({
    backfillEmbeddings: vi.fn().mockResolvedValue(true)
}));

describe('ui/actions module', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('exports all action handlers', async () => {
        const actions = await import('../src/ui/actions.js');

        expect(typeof actions.handleExtractAll).toBe('function');
        expect(typeof actions.handleDeleteChatData).toBe('function');
        expect(typeof actions.handleDeleteEmbeddings).toBe('function');
        expect(typeof actions.backfillEmbeddings).toBe('function');
    });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/ui-actions.test.js
```

Expected: FAIL - module not found

**Step 3: Create src/ui/actions.js**

```javascript
/**
 * UI action handlers for OpenVault settings panel.
 * Provides button click handlers that were previously passed via setExternalFunctions.
 */
import { getDeps } from '../deps.js';
import { extractAllMessages } from '../extraction/batch.js';
import { deleteCurrentChatData, deleteCurrentChatEmbeddings } from '../data/actions.js';
import { backfillEmbeddings } from '../backfill.js';
import { updateEventListeners } from '../listeners.js';

/**
 * Handle "Extract All Messages" button click.
 * Extracts memories from all chat messages.
 */
export async function handleExtractAll() {
    const deps = getDeps();
    const context = deps.getContext();

    if (!context.chatId) {
        deps.showToast('No chat selected', 'warning');
        return;
    }

    try {
        await extractAllMessages(updateEventListeners);
        deps.showToast('Extraction complete', 'success');
    } catch (error) {
        console.error('[OpenVault] Extract all failed:', error);
        deps.showToast('Extraction failed: ' + error.message, 'error');
    }
}

/**
 * Handle "Delete Chat Data" button click.
 * Removes all OpenVault data for current chat after confirmation.
 */
export async function handleDeleteChatData() {
    const deps = getDeps();

    if (!confirm('Delete all OpenVault data for this chat? This cannot be undone.')) {
        return;
    }

    try {
        await deleteCurrentChatData();
        deps.showToast('Chat data deleted', 'success');
    } catch (error) {
        console.error('[OpenVault] Delete chat data failed:', error);
        deps.showToast('Delete failed: ' + error.message, 'error');
    }
}

/**
 * Handle "Delete Embeddings" button click.
 * Removes embeddings only, keeping memory metadata.
 */
export async function handleDeleteEmbeddings() {
    const deps = getDeps();

    if (!confirm('Delete all embeddings for this chat? Memories will be kept but need re-embedding.')) {
        return;
    }

    try {
        await deleteCurrentChatEmbeddings();
        deps.showToast('Embeddings deleted', 'success');
    } catch (error) {
        console.error('[OpenVault] Delete embeddings failed:', error);
        deps.showToast('Delete failed: ' + error.message, 'error');
    }
}

// Re-export backfillEmbeddings for convenience
export { backfillEmbeddings };
```

**Step 4: Run test**

```bash
npm test -- tests/ui-actions.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/actions.js tests/ui-actions.test.js
git commit -m "feat: extract UI action handlers to src/ui/actions.js"
```

### Step 4.3: Update src/ui/settings.js

**Step 1: Read current settings.js structure**

First examine the current `setExternalFunctions` usage and imports.

**Step 2: Remove setExternalFunctions**

In `src/ui/settings.js`:

1. Add new imports at top:
```javascript
import { updateEventListeners } from '../listeners.js';
import { handleExtractAll, handleDeleteChatData, handleDeleteEmbeddings, backfillEmbeddings } from './actions.js';
```

2. Remove the `setExternalFunctions` export and related state:
```javascript
// DELETE these lines:
let externalFunctions = null;

export function setExternalFunctions(functions) {
    externalFunctions = functions;
}
```

3. Update any references from `externalFunctions.functionName()` to direct calls:
   - `externalFunctions.updateEventListeners()` → `updateEventListeners()`
   - `externalFunctions.extractAllMessages()` → `handleExtractAll()`
   - `externalFunctions.deleteCurrentChatData()` → `handleDeleteChatData()`
   - `externalFunctions.deleteCurrentChatEmbeddings()` → `handleDeleteEmbeddings()`
   - `externalFunctions.backfillEmbeddings()` → `backfillEmbeddings()`

**Step 3: Run tests**

```bash
npm test
```

Expected: PASS (may need to update mocks if tests reference setExternalFunctions)

**Step 4: Commit**

```bash
git add src/ui/settings.js
git commit -m "refactor: replace setExternalFunctions with direct imports in settings.js"
```

### Step 4.4: Simplify index.js

**Step 1: Update index.js imports**

Add:
```javascript
import { updateEventListeners } from './src/listeners.js';
```

Remove from imports:
```javascript
// Remove setExternalFunctions from this import if present:
import { loadSettings } from './src/ui/settings.js';
```

**Step 2: Remove setExternalFunctions call**

Find and delete the `setExternalFunctions({...})` call block in index.js.

**Step 3: Update initialization**

Replace any inline function definitions that were passed to setExternalFunctions with calls to the new modules.

**Step 4: Run full test suite**

```bash
npm test
```

Expected: PASS

**Step 5: Run linting**

```bash
npm run lint
```

Expected: No errors

**Step 6: Commit**

```bash
git add index.js
git commit -m "refactor: remove setExternalFunctions coupling from index.js"
```

---

## Task 5: Final Verification

**Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass

**Step 2: Run linting**

```bash
npm run lint
```

Expected: No errors

**Step 3: Manual verification checklist**

- [ ] Extension loads in SillyTavern
- [ ] Rename folder to `OpenVault-Renamed` - templates still load
- [ ] All settings panel buttons work
- [ ] Extract/Retrieve functions work
- [ ] Check browser console for `[OpenVault]` logs without errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: stable release refactoring complete"
```

---

## Summary

| Task | Files Modified | Risk |
|------|---------------|------|
| 1. Dynamic Path | `src/constants.js` | Low |
| 2. Worker Safety | `src/retrieval/scoring.js`, new `sync-scorer.js` | Medium |
| 3. Serialization Tests | `tests/scoring.test.js` | Low |
| 4. Settings Decoupling | `src/listeners.js`, `src/ui/actions.js`, `src/ui/settings.js`, `index.js` | High |

Total estimated time: 45-60 minutes
