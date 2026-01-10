# OpenVault Stable Release Refactoring

**Date:** 2026-01-10
**Status:** Approved

## Overview

Four changes to stabilize OpenVault for release: dynamic path detection, worker safety, settings decoupling, and serialization testing.

---

## 1. Dynamic Extension Path Detection

**File:** `src/constants.js`

**Problem:** `extensionFolderPath` is hardcoded to `scripts/extensions/third-party/openvault`. If user renames folder, templates won't load.

**Solution:**
```javascript
const currentUrl = new URL(import.meta.url);
const pathFromST = currentUrl.pathname;
export const extensionFolderPath = pathFromST.replace(/\/src\/constants\.js$/, '');
```

**Verification:** Install extension in folder named `OpenVault-Renamed` and confirm it loads.

---

## 2. Worker Instantiation Safety

**File:** `src/retrieval/scoring.js`

**Problem:** `new Worker()` can throw in Firefox strict mode or CORS-restricted environments.

**Solution:**
```javascript
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

**Fallback:** Create `src/retrieval/sync-scorer.js` with main-thread scoring. When `getScoringWorker()` returns `null`, use sync fallback.

**Architecture:**
```
src/retrieval/
├── math.js          # Pure scoring math (exists)
├── scoring.js       # Orchestrator - tries worker, falls back to sync
├── worker.js        # Web Worker wrapper
└── sync-scorer.js   # NEW: Main-thread fallback
```

---

## 3. Decouple Settings UI

**Files:** `src/ui/settings.js`, `index.js`, new modules

**Problem:** `setExternalFunctions` creates brittle initialization order.

**Solution - Full Module Extraction:**

### Step A: Create `src/listeners.js`
```javascript
import { getDeps } from './deps.js';
import { extensionName } from './constants.js';

let listenersRegistered = false;

export function updateEventListeners() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    // Move listener registration logic from index.js
}
```

### Step B: Create `src/ui/actions.js`
```javascript
import { extractAllMessages } from '../extraction/batch.js';
import { deleteCurrentChatData, deleteCurrentChatEmbeddings } from '../data/actions.js';
import { backfillEmbeddings } from '../backfill.js';
import { showToast } from '../utils.js';

export async function handleExtractAll() { ... }
export async function handleDeleteChatData() { ... }
export async function handleDeleteEmbeddings() { ... }
export { backfillEmbeddings };
```

### Step C: Update `src/ui/settings.js`
```javascript
// Direct imports - remove setExternalFunctions
import { updateEventListeners } from '../listeners.js';
import { handleExtractAll, handleDeleteChatData, handleDeleteEmbeddings, backfillEmbeddings } from './actions.js';
```

### Step D: Simplify `index.js`
Remove `setExternalFunctions` call. Import from new modules.

---

## 4. Worker Serialization Test

**File:** `tests/scoring.test.js`

**Problem:** Non-serializable properties (functions, DOM elements) in memory objects cause silent worker crashes.

**Solution:**
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
            callback: () => {}
        };

        expect(() => structuredClone(badMemory)).toThrow();
    });
});
```

---

## Implementation Order

1. **Dynamic path detection** - isolated change, easy to verify
2. **Worker safety** - creates new file, modifies scoring.js
3. **Serialization test** - add test, verify passes
4. **Settings decoupling** - largest change, touches multiple files

## Verification Checklist

- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] Extension loads in folder named `OpenVault-Renamed`
- [ ] Worker fallback triggers when Worker blocked (test in Firefox private mode)
- [ ] All UI buttons work after settings decoupling
