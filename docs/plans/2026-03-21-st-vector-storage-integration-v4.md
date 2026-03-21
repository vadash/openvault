# ST Vector Storage Integration v4 - Implementation Plan

**Goal:** Add SillyTavern's Vector Storage as an optional embedding strategy that delegates embedding generation, storage, and similarity search to ST's `/api/vector/*` endpoints.

**Architecture:** Extend existing `EmbeddingStrategy` pattern with `StVectorStrategy`. Uses text prefix approach for ID mapping (avoids hash collisions and memory leaks). Items are marked with `_st_synced` flag to prevent re-sync loops. Sync hooks added for all entity types including deletions during graph consolidation.

**Tech Stack:** JavaScript, Vitest, fetch API

---

## Changes from v3

This plan incorporates critical fixes from code review:

1. **CRITICAL: Vector Rank Ordering Preserved** (Fix for Claim #1)
   - Changed `memories.filter()` to Map-based approach that preserves ST's similarity order
   - Results are now ordered by vector score, not chronologically

2. **CRITICAL: Deletion Hooks for Graph Consolidation** (Fix for Claim #2)
   - Added deletion calls in `consolidateGraph()` for merged nodes
   - Added deletion calls in `redirectEdges()` for removed edges
   - Nodes and edges removed during consolidation are now cleaned from ST Vector Storage

3. **RISK: Batching for Bulk Inserts** (Fix for Claim #3)
   - `backfillAllEmbeddings` now uses `processInBatches` with batch size of 100
   - Prevents network timeouts and API limits with large chats

4. **MINOR: Node/Community Noise** (Claim #4)
   - Already handled gracefully by Map approach with `filter(Boolean)`

---

## File Structure

| File | Action | Description |
|------|--------|-------------|
| `src/utils/embedding-codec.js` | Modify | Add `_st_synced` check to `hasEmbedding()`, add `markStSynced()` and `isStSynced()` helpers |
| `src/embeddings.js` | Modify | Add `StVectorStrategy` with text prefix approach, extend base class, update `backfillAllEmbeddings` with batching |
| `src/retrieval/scoring.js` | Modify | Add branch for `usesExternalStorage()` with Map-based order preservation |
| `src/retrieval/world-context.js` | Modify | Add branch for ST search on communities |
| `src/extraction/extract.js` | Modify | Add sync hook after Phase 1 commit for events |
| `src/reflection/reflect.js` | Modify | Add sync hook after reflection generation |
| `src/graph/graph.js` | Modify | Add sync support in `mergeOrInsertEntity`, `consolidateEdges`, and **deletion hooks in `consolidateGraph` and `redirectEdges`** |
| `src/graph/communities.js` | Modify | Add sync support in `updateCommunitySummaries` |
| `src/utils/data.js` | Modify | Add sync helpers, call on delete operations |
| `tests/embeddings.test.js` | Modify | Add tests for `StVectorStrategy` |

---

### Task 1: Update hasEmbedding for ST Synced Items

**Files:**
- Modify: `src/utils/embedding-codec.js`

**Purpose:** Prevent infinite re-sync loops by recognizing items that have been synced to ST Vector Storage. Also ensure `deleteEmbedding()` clears the flag so switching back to local embeddings works correctly.

**Common Pitfalls:**
- The `_st_synced` flag must be checked BEFORE the `embedding_b64` check
- This flag is set when `insertItems()` succeeds, NOT when the strategy is enabled
- **CRITICAL**: `deleteEmbedding()` MUST clear `_st_synced` - otherwise switching from st-vectors to a local strategy will leave the flag, causing `hasEmbedding()` to return true even though there's no actual embedding, breaking local RAG

- [ ] Step 1: Update `deleteEmbedding` to clear `_st_synced`

Update the `deleteEmbedding` function:

```javascript
/**
 * Remove embedding from an object (both formats and ST sync flag).
 * @param {Object} obj - Object to clean (mutated)
 */
export function deleteEmbedding(obj) {
    if (!obj) return;
    delete obj.embedding;
    delete obj.embedding_b64;
    delete obj._st_synced;
}
```

- [ ] Step 2: Add `isStSynced`, `markStSynced`, and `clearStSynced` functions

Add after the `deleteEmbedding` function:

```javascript
/**
 * Check if an object has been synced to ST Vector Storage.
 * @param {Object} obj - Object to check
 * @returns {boolean}
 */
export function isStSynced(obj) {
    return !!(obj && obj._st_synced);
}

/**
 * Mark an object as synced to ST Vector Storage.
 * @param {Object} obj - Target object (mutated)
 */
export function markStSynced(obj) {
    if (!obj) return;
    obj._st_synced = true;
}

/**
 * Clear the ST sync flag from an object.
 * @param {Object} obj - Target object (mutated)
 */
export function clearStSynced(obj) {
    if (!obj) return;
    delete obj._st_synced;
}
```

- [ ] Step 3: Update `hasEmbedding` to check `_st_synced`

Replace the `hasEmbedding` function:

```javascript
/**
 * Check if an object has an embedding (either format or ST synced).
 * @param {Object} obj - Object to check
 * @returns {boolean}
 */
export function hasEmbedding(obj) {
    if (!obj) return false;
    // ST Vector Storage synced items don't have local embeddings
    if (obj._st_synced) return true;
    if (obj.embedding_b64) return true;
    if (obj.embedding && obj.embedding.length > 0) return true;
    return false;
}
```

- [ ] Step 4: Run existing tests to verify no regression

Run: `npm run test:run tests/embeddings.test.js`
Expected: All existing tests pass

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(embedding-codec): add _st_synced flag to prevent re-sync loops"
```

---

### Task 2: Add Storage Methods to EmbeddingStrategy Base Class

**Files:**
- Modify: `src/embeddings.js`

**Purpose:** Add storage-related methods to the base class that strategies can optionally implement.

- [ ] Step 1: Add storage methods to EmbeddingStrategy base class

Find the `EmbeddingStrategy` class and add these methods after the `reset()` method:

```javascript
    /**
     * Check if this strategy uses external storage (ST Vector Storage)
     * @returns {boolean} True if strategy delegates storage to external system
     */
    usesExternalStorage() {
        return false;
    }

    /**
     * Insert items into external vector storage
     * @param {Object[]} items - Items to insert [{ id, summary, type? }]
     * @param {Object} options - Options
     * @param {AbortSignal} options.signal - AbortSignal
     * @returns {Promise<boolean>} True if successful
     */
    async insertItems(_items, _options = {}) {
        return false;
    }

    /**
     * Search for similar items in external vector storage
     * @param {string} queryText - Query text
     * @param {number} topK - Number of results
     * @param {number} threshold - Similarity threshold
     * @param {Object} options - Options
     * @param {AbortSignal} options.signal - AbortSignal
     * @returns {Promise<{id: string, text: string, score?: number}[]|null>} Search results or null
     */
    async searchItems(_queryText, _topK, _threshold, _options = {}) {
        return null;
    }

    /**
     * Delete items from external vector storage
     * @param {string[]} ids - Item IDs to delete
     * @param {Object} options - Options
     * @param {AbortSignal} options.signal - AbortSignal
     * @returns {Promise<boolean>} True if successful
     */
    async deleteItems(_ids, _options = {}) {
        return false;
    }

    /**
     * Purge entire collection from external vector storage
     * @param {Object} options - Options
     * @param {AbortSignal} options.signal - AbortSignal
     * @returns {Promise<boolean>} True if successful
     */
    async purgeCollection(_options = {}) {
        return false;
    }
```

- [ ] Step 2: Run tests to verify no regression

Run: `npm run test:run tests/embeddings.test.js`
Expected: All existing tests pass

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "feat(embeddings): add storage methods to EmbeddingStrategy base class"
```

---

### Task 3: Add ID Prefix Utility Functions

**Files:**
- Modify: `src/embeddings.js`

**Purpose:** Add text prefix utilities for embedding OpenVault IDs in ST text fields. This replaces the numeric hash approach, eliminating hash collision risk and memory leak from the hash map.

- [ ] Step 1: Add ID prefix constants and functions after imports

Add after the imports section (around line 20):

```javascript
// =============================================================================
// ST Vector Storage ID Prefix Utilities
// =============================================================================

/**
 * Prefix marker for embedding OpenVault IDs in ST Vector text fields.
 * Format: [OV_ID:entity_id] Actual summary text...
 */
const OV_ID_PREFIX_START = '[OV_ID:';
const OV_ID_PREFIX_END = '] ';

/**
 * Create text with embedded OpenVault ID for ST Vector Storage.
 * @param {string} id - OpenVault entity ID (e.g., "event_123", "Alice")
 * @param {string} text - Summary text
 * @returns {string} Text with ID prefix
 */
function createTextWithId(id, text) {
    return `${OV_ID_PREFIX_START}${id}${OV_ID_PREFIX_END}${text}`;
}

/**
 * Extract OpenVault ID from ST Vector text field.
 * @param {string} text - Text that may contain ID prefix
 * @returns {{id: string|null, text: string}} Extracted ID and clean text
 */
function extractIdFromText(text) {
    if (!text || !text.startsWith(OV_ID_PREFIX_START)) {
        return { id: null, text: text || '' };
    }
    const endIdx = text.indexOf(OV_ID_PREFIX_END);
    if (endIdx === -1) {
        return { id: null, text };
    }
    const id = text.slice(OV_ID_PREFIX_START.length, endIdx);
    const cleanText = text.slice(endIdx + OV_ID_PREFIX_END.length);
    return { id, text: cleanText };
}

/**
 * Generate a 53-bit numeric hash from string for ST Vector hash field.
 * Uses Cyrb53 algorithm to avoid collisions - with 53-bit output, collision
 * probability is negligible even with millions of items (unlike djb2's 32-bit).
 * ST requires numeric hashes for its Vectra backend.
 * @param {string} str - String to hash
 * @param {number} [seed=0] - Optional seed for different hash sequences
 * @returns {number} 53-bit numeric hash (safe JavaScript integer)
 */
function hashStringToNumber(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return Math.abs(4294967296 * (2097151 & h2) + (h1 >>> 0));
}
```

- [ ] Step 2: Export the extractIdFromText function for testing

Add to the exports at the bottom of the file:

```javascript
export { extractIdFromText, hashStringToNumber };
```

- [ ] Step 3: Write tests for ID prefix utilities

Add to `tests/embeddings.test.js`:

```javascript
describe('ST Vector ID Prefix Utilities', () => {
    it('creates and extracts ID from text', async () => {
        const { extractIdFromText } = await import('../src/embeddings.js');

        // Simulate what createTextWithId produces
        const textWithId = '[OV_ID:event_123456789_0] This is a memory summary';
        const result = extractIdFromText(textWithId);

        expect(result.id).toBe('event_123456789_0');
        expect(result.text).toBe('This is a memory summary');
    });

    it('handles text without ID prefix', async () => {
        const { extractIdFromText } = await import('../src/embeddings.js');

        const result = extractIdFromText('Plain text without prefix');

        expect(result.id).toBeNull();
        expect(result.text).toBe('Plain text without prefix');
    });

    it('handles IDs with special characters', async () => {
        const { extractIdFromText } = await import('../src/embeddings.js');

        const textWithId = '[OV_ID:ref_abc-123_xyz] Reflection summary';
        const result = extractIdFromText(textWithId);

        expect(result.id).toBe('ref_abc-123_xyz');
        expect(result.text).toBe('Reflection summary');
    });

    it('hashStringToNumber produces stable hashes', async () => {
        const { hashStringToNumber } = await import('../src/embeddings.js');

        const id1 = 'event_123456789_0';
        const id2 = 'ref_abc123-def456';

        expect(hashStringToNumber(id1)).toBe(hashStringToNumber(id1)); // Stable
        expect(hashStringToNumber(id2)).toBe(hashStringToNumber(id2)); // Stable
        expect(hashStringToNumber(id1)).not.toBe(hashStringToNumber(id2)); // Different
        expect(hashStringToNumber(id1)).toBeGreaterThan(0); // Positive
    });
});
```

- [ ] Step 4: Run tests

Run: `npm run test:run tests/embeddings.test.js`
Expected: Tests pass

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(embeddings): add ID prefix utilities for ST Vector Storage"
```

---

### Task 4: Write Tests for StVectorStrategy

**Files:**
- Modify: `tests/embeddings.test.js`

**Purpose:** Write failing tests that define the expected behavior of StVectorStrategy.

**Common Pitfalls:**
- Mock `getDeps()` to return ST's `vectors` extension settings
- Collection ID should include chatId for isolation
- Search threshold should come from settings, NOT hardcoded

- [ ] Step 1: Write test suite for StVectorStrategy

Add to `tests/embeddings.test.js`:

```javascript
describe('StVectorStrategy', () => {
    let _originalGetDeps;

    beforeEach(async () => {
        const depsModule = await import('../src/deps.js');
        _originalGetDeps = depsModule.getDeps;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('isEnabled', () => {
        it('returns true when ST vectors source is configured', async () => {
            const depsModule = await import('../src/deps.js');
            vi.spyOn(depsModule, 'getDeps').mockReturnValue({
                getExtensionSettings: vi.fn(() => ({
                    vectors: { source: 'openrouter', openrouter_model: 'qwen/qwen3-embedding-4b' },
                })),
            });

            const { getStrategy } = await import('../src/embeddings.js');
            const strategy = getStrategy('st-vectors');

            expect(strategy.isEnabled()).toBe(true);
        });

        it('returns false when ST vectors source is not configured', async () => {
            const depsModule = await import('../src/deps.js');
            vi.spyOn(depsModule, 'getDeps').mockReturnValue({
                getExtensionSettings: vi.fn(() => ({ vectors: {} })),
            });

            const { getStrategy } = await import('../src/embeddings.js');
            const strategy = getStrategy('st-vectors');

            expect(strategy.isEnabled()).toBe(false);
        });
    });

    describe('getStatus', () => {
        it('shows source and model when configured', async () => {
            const depsModule = await import('../src/deps.js');
            vi.spyOn(depsModule, 'getDeps').mockReturnValue({
                getExtensionSettings: vi.fn(() => ({
                    vectors: { source: 'openrouter', openrouter_model: 'qwen/qwen3-embedding-4b' },
                })),
            });

            const { getStrategy } = await import('../src/embeddings.js');
            const strategy = getStrategy('st-vectors');

            expect(strategy.getStatus()).toBe('ST: openrouter / qwen/qwen3-embedding-4b');
        });

        it('shows only source when model not set', async () => {
            const depsModule = await import('../src/deps.js');
            vi.spyOn(depsModule, 'getDeps').mockReturnValue({
                getExtensionSettings: vi.fn(() => ({
                    vectors: { source: 'ollama' },
                })),
            });

            const { getStrategy } = await import('../src/embeddings.js');
            const strategy = getStrategy('st-vectors');

            expect(strategy.getStatus()).toBe('ST: ollama');
        });
    });

    describe('usesExternalStorage', () => {
        it('returns true', async () => {
            const depsModule = await import('../src/deps.js');
            vi.spyOn(depsModule, 'getDeps').mockReturnValue({
                getExtensionSettings: vi.fn(() => ({ vectors: { source: 'openrouter' } })),
            });

            const { getStrategy } = await import('../src/embeddings.js');
            const strategy = getStrategy('st-vectors');

            expect(strategy.usesExternalStorage()).toBe(true);
        });
    });

    describe('insertItems', () => {
        it('calls ST /api/vector/insert with ID prefix in text', async () => {
            const fetchSpy = vi.fn(async () => ({ ok: true }));

            const depsModule = await import('../src/deps.js');
            vi.spyOn(depsModule, 'getDeps').mockReturnValue({
                getExtensionSettings: vi.fn(() => ({
                    vectors: { source: 'openrouter', openrouter_model: 'test-model' },
                })),
                fetch: fetchSpy,
            });

            const dataModule = await import('../src/utils/data.js');
            vi.spyOn(dataModule, 'getCurrentChatId').mockReturnValue('chat-123');

            const { getStrategy } = await import('../src/embeddings.js');
            const strategy = getStrategy('st-vectors');

            const items = [
                { id: 'event_123', summary: 'First memory' },
                { id: 'ref_456', summary: 'Second memory' },
            ];

            const result = await strategy.insertItems(items);

            expect(result).toBe(true);
            expect(fetchSpy).toHaveBeenCalledTimes(1);

            const callArgs = fetchSpy.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);

            // Verify collectionId includes chatId
            expect(body.collectionId).toBe('openvault-chat-123-openrouter');
            expect(body.source).toBe('openrouter');

            // Verify text contains ID prefix
            expect(body.items[0].text).toBe('[OV_ID:event_123] First memory');
            expect(body.items[1].text).toBe('[OV_ID:ref_456] Second memory');
        });

        it('returns false on fetch failure', async () => {
            const fetchSpy = vi.fn(async () => ({ ok: false }));

            const depsModule = await import('../src/deps.js');
            vi.spyOn(depsModule, 'getDeps').mockReturnValue({
                getExtensionSettings: vi.fn(() => ({ vectors: { source: 'openrouter' } })),
                fetch: fetchSpy,
            });

            const dataModule = await import('../src/utils/data.js');
            vi.spyOn(dataModule, 'getCurrentChatId').mockReturnValue('chat-123');

            const { getStrategy } = await import('../src/embeddings.js');
            const strategy = getStrategy('st-vectors');

            const result = await strategy.insertItems([{ id: 'event_1', summary: 'test' }]);

            expect(result).toBe(false);
        });
    });

    describe('searchItems', () => {
        it('calls ST /api/vector/query and extracts IDs from text', async () => {
            const fetchSpy = vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    hashes: [12345, 67890],
                    metadata: [
                        { text: '[OV_ID:event_123] First memory' },
                        { text: '[OV_ID:ref_456] Second memory' },
                    ],
                }),
            }));

            const depsModule = await import('../src/deps.js');
            vi.spyOn(depsModule, 'getDeps').mockReturnValue({
                getExtensionSettings: vi.fn(() => ({
                    vectors: { source: 'openrouter' },
                })),
                fetch: fetchSpy,
            });

            const dataModule = await import('../src/utils/data.js');
            vi.spyOn(dataModule, 'getCurrentChatId').mockReturnValue('chat-123');

            const { getStrategy } = await import('../src/embeddings.js');
            const strategy = getStrategy('st-vectors');

            const results = await strategy.searchItems('query text', 10, 0.5);

            expect(fetchSpy).toHaveBeenCalledWith('/api/vector/query', expect.objectContaining({
                method: 'POST',
            }));

            const callArgs = fetchSpy.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.collectionId).toBe('openvault-chat-123-openrouter');
            expect(body.searchText).toBe('query text');
            expect(body.threshold).toBe(0.5);

            // Verify IDs are extracted from text prefix
            expect(results).toEqual([
                { id: 'event_123', text: 'First memory', score: undefined },
                { id: 'ref_456', text: 'Second memory', score: undefined },
            ]);
        });

        it('handles items without ID prefix gracefully', async () => {
            const fetchSpy = vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    hashes: [12345],
                    metadata: [{ text: 'Memory without ID prefix' }],
                }),
            }));

            const depsModule = await import('../src/deps.js');
            vi.spyOn(depsModule, 'getDeps').mockReturnValue({
                getExtensionSettings: vi.fn(() => ({ vectors: { source: 'openrouter' } })),
                fetch: fetchSpy,
            });

            const dataModule = await import('../src/utils/data.js');
            vi.spyOn(dataModule, 'getCurrentChatId').mockReturnValue('chat-123');

            const { getStrategy } = await import('../src/embeddings.js');
            const strategy = getStrategy('st-vectors');

            const results = await strategy.searchItems('query', 10, 0.5);

            // Should return the hash as ID when no prefix found
            expect(results).toEqual([
                { id: '12345', text: 'Memory without ID prefix', score: undefined },
            ]);
        });

        it('returns empty array on fetch failure', async () => {
            const fetchSpy = vi.fn(async () => ({ ok: false }));

            const depsModule = await import('../src/deps.js');
            vi.spyOn(depsModule, 'getDeps').mockReturnValue({
                getExtensionSettings: vi.fn(() => ({ vectors: { source: 'openrouter' } })),
                fetch: fetchSpy,
            });

            const dataModule = await import('../src/utils/data.js');
            vi.spyOn(dataModule, 'getCurrentChatId').mockReturnValue('chat-123');

            const { getStrategy } = await import('../src/embeddings.js');
            const strategy = getStrategy('st-vectors');

            const results = await strategy.searchItems('query', 10, 0.5);

            expect(results).toEqual([]);
        });
    });

    describe('deleteItems', () => {
        it('converts string IDs to numeric hashes for deletion', async () => {
            const fetchSpy = vi.fn(async () => ({ ok: true }));
            const { hashStringToNumber } = await import('../src/embeddings.js');

            const depsModule = await import('../src/deps.js');
            vi.spyOn(depsModule, 'getDeps').mockReturnValue({
                getExtensionSettings: vi.fn(() => ({ vectors: { source: 'openrouter' } })),
                fetch: fetchSpy,
            });

            const dataModule = await import('../src/utils/data.js');
            vi.spyOn(dataModule, 'getCurrentChatId').mockReturnValue('chat-123');

            const { getStrategy } = await import('../src/embeddings.js');
            const strategy = getStrategy('st-vectors');

            const result = await strategy.deleteItems(['event_123', 'ref_456']);

            expect(result).toBe(true);
            expect(fetchSpy).toHaveBeenCalledWith('/api/vector/delete', expect.objectContaining({
                method: 'POST',
            }));

            const callArgs = fetchSpy.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.hashes).toEqual([hashStringToNumber('event_123'), hashStringToNumber('ref_456')]);
        });
    });

    describe('purgeCollection', () => {
        it('calls ST /api/vector/purge', async () => {
            const fetchSpy = vi.fn(async () => ({ ok: true }));

            const depsModule = await import('../src/deps.js');
            vi.spyOn(depsModule, 'getDeps').mockReturnValue({
                getExtensionSettings: vi.fn(() => ({ vectors: { source: 'openrouter' } })),
                fetch: fetchSpy,
            });

            const dataModule = await import('../src/utils/data.js');
            vi.spyOn(dataModule, 'getCurrentChatId').mockReturnValue('chat-123');

            const { getStrategy } = await import('../src/embeddings.js');
            const strategy = getStrategy('st-vectors');

            const result = await strategy.purgeCollection();

            expect(result).toBe(true);
            expect(fetchSpy).toHaveBeenCalledWith('/api/vector/purge', expect.objectContaining({
                method: 'POST',
            }));
        });
    });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npm run test:run tests/embeddings.test.js`
Expected: Tests fail with "Unknown vector source st-vectors" or strategy not found

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "test(embeddings): add failing tests for StVectorStrategy"
```

---

### Task 5: Implement StVectorStrategy

**Files:**
- Modify: `src/embeddings.js`

**Purpose:** Add `StVectorStrategy` class and register it in the strategies map.

**Common Pitfalls:**
- Register strategy as `'st-vectors'` in the strategies map
- Collection ID must include chatId for isolation
- Return `null` from `getQueryEmbedding` and `getDocumentEmbedding`
- Use text prefix approach for ID mapping
- Handle fetch errors gracefully

- [ ] Step 1: Add StVectorStrategy class after OllamaStrategy

Add after the `OllamaStrategy` class (before the Strategy Registry comment):

```javascript
// =============================================================================
// ST Vector Storage Strategy
// =============================================================================

class StVectorStrategy extends EmbeddingStrategy {
    getId() {
        return 'st-vectors';
    }

    isEnabled() {
        const settings = getDeps().getExtensionSettings()?.vectors;
        return !!(settings?.source);
    }

    getStatus() {
        const settings = getDeps().getExtensionSettings()?.vectors;
        const source = settings?.source || 'not configured';
        const model = settings?.[`${source}_model`] || '';
        return `ST: ${source}${model ? ` / ${model}` : ''}`;
    }

    usesExternalStorage() {
        return true;
    }

    async getQueryEmbedding() {
        return null;
    }

    async getDocumentEmbedding() {
        return null;
    }

    #getSource() {
        const settings = getDeps().getExtensionSettings()?.vectors;
        return settings?.source || 'transformers';
    }

    async #getCollectionId() {
        const { getCurrentChatId } = await import('./utils/data.js');
        const chatId = getCurrentChatId() || 'default';
        const source = this.#getSource();
        return `openvault-${chatId}-${source}`;
    }

    async insertItems(items, { signal } = {}) {
        try {
            const source = this.#getSource();
            const settings = getDeps().getExtensionSettings()?.vectors;
            const model = settings?.[`${source}_model`];

            // Build items with ID prefix in text
            const itemsForSt = items.map((item) => ({
                hash: hashStringToNumber(item.id),
                text: createTextWithId(item.id, item.summary),
                index: 0,
            }));

            const body = {
                collectionId: await this.#getCollectionId(),
                source,
                items: itemsForSt,
            };

            if (model) {
                body.model = model;
            }

            const response = await getDeps().fetch('/api/vector/insert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });
            return response.ok;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            logError('ST Vector insert failed', error);
            return false;
        }
    }

    async searchItems(queryText, topK, threshold, { signal } = {}) {
        try {
            const source = this.#getSource();
            const settings = getDeps().getExtensionSettings()?.vectors;
            const model = settings?.[`${source}_model`];

            const body = {
                collectionId: await this.#getCollectionId(),
                source,
                searchText: queryText,
                topK,
                threshold,
            };

            if (model) {
                body.model = model;
            }

            const response = await getDeps().fetch('/api/vector/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });

            if (!response.ok) {
                return [];
            }

            const data = await response.json();

            // Extract IDs from text prefix, fall back to hash
            return data.hashes.map((hash, i) => {
                const rawText = data.metadata[i]?.text || '';
                const { id, text } = extractIdFromText(rawText);
                return {
                    id: id || String(hash),
                    text,
                    score: data.scores?.[i],
                };
            });
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            logError('ST Vector search failed', error);
            return [];
        }
    }

    async deleteItems(ids, { signal } = {}) {
        try {
            const numericHashes = ids.map((id) => hashStringToNumber(id));

            const source = this.#getSource();
            const settings = getDeps().getExtensionSettings()?.vectors;
            const model = settings?.[`${source}_model`];

            const body = {
                collectionId: await this.#getCollectionId(),
                source,
                hashes: numericHashes,
            };

            if (model) {
                body.model = model;
            }

            const response = await getDeps().fetch('/api/vector/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });
            return response.ok;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            logError('ST Vector delete failed', error);
            return false;
        }
    }

    async purgeCollection({ signal } = {}) {
        try {
            const response = await getDeps().fetch('/api/vector/purge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    collectionId: await this.#getCollectionId(),
                }),
                signal,
            });
            return response.ok;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            logError('ST Vector purge failed', error);
            return false;
        }
    }
}
```

- [ ] Step 2: Register strategy in the strategies map

Find the `strategies` object and add `'st-vectors'`:

```javascript
const strategies = {
    'multilingual-e5-small': new TransformersStrategy(),
    'bge-small-en-v1.5': new TransformersStrategy(),
    'embeddinggemma-300m': new TransformersStrategy(),
    ollama: new OllamaStrategy(),
    'st-vectors': new StVectorStrategy(),
};
```

- [ ] Step 3: Run tests to verify they pass

Run: `npm run test:run tests/embeddings.test.js`
Expected: All tests pass

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "feat(embeddings): implement StVectorStrategy for ST Vector Storage"
```

---

### Task 6: Integrate with Retrieval System

**Files:**
- Modify: `src/retrieval/scoring.js`

**Purpose:** Add branch in `selectRelevantMemories()` to use ST's search when the strategy uses external storage, using the user's threshold setting. **CRITICAL: Preserve vector rank ordering by using Map-based approach.**

**Common Pitfalls:**
- **CRITICAL**: Use `Map` to preserve ST's similarity order, NOT `filter()` which preserves chronological order
- Use `settings.vectorSimilarityThreshold` NOT hardcoded `0.0`
- Check `usesExternalStorage()` before calling `searchItems()`
- Mark synced items with `markStSynced()` after successful selection
- Filter out non-memory results (graph nodes, communities) with `filter(Boolean)`

- [ ] Step 1: Add import for getStrategy and sync helpers

At the top of `src/retrieval/scoring.js`, update imports:

```javascript
import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { getStrategy, getQueryEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { markStSynced } from '../utils/embedding-codec.js';
import { logDebug } from '../utils/logging.js';
```

- [ ] Step 2: Add ST branch at start of selectRelevantMemories

Find the `selectRelevantMemories()` function and add the ST branch after the early return for empty memories:

```javascript
export async function selectRelevantMemories(memories, ctx) {
    if (!memories || memories.length === 0) return [];

    // Check if using ST Vector Storage
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);

    if (strategy.usesExternalStorage()) {
        // Use ST's vector search with user's threshold
        const queryText = ctx.userMessages || ctx.recentContext?.slice(-500);
        const threshold = settings.vectorSimilarityThreshold;
        const results = await strategy.searchItems(queryText, 100, threshold);

        if (!results || results.length === 0) {
            cacheRetrievalDebug({
                stVectorMode: true,
                stResultsCount: 0,
                selectedCount: 0,
                threshold,
            });
            return [];
        }

        // CRITICAL: Use Map to preserve ST's similarity order
        // (NOT filter() which would preserve chronological order)
        const memoriesById = new Map(memories.map((m) => [m.id, m]));
        const selectedMemories = results
            .map((r) => memoriesById.get(r.id))
            .filter(Boolean) // Drops undefined (non-memory entities like graph nodes)
            .slice(0, Math.ceil(ctx.finalTokens / 50));

        // Mark as synced to prevent re-sync
        for (const memory of selectedMemories) {
            markStSynced(memory);
        }

        // Mock scoredResults for debug cache compatibility
        const scoredResults = selectedMemories.map((m, i) => ({
            memory: m,
            score: 1.0 - i * 0.01,
            breakdown: {
                base: 1.0,
                baseAfterFloor: 1.0,
                recencyPenalty: 0,
                vectorSimilarity: 1.0 - i * 0.01,
                vectorBonus: 0,
                bm25Score: 0,
                bm25Bonus: 0,
                hitDamping: 0,
                frequencyFactor: 0,
                total: 1.0 - i * 0.01,
                stVectorScore: true,
            },
        }));

        const selectedIds = new Set(selectedMemories.map((m) => m.id));
        cacheScoringDetails(scoredResults, selectedIds);

        // Calculate bucket distribution for debug
        const afterBuckets = assignMemoriesToBuckets(selectedMemories, ctx.chatLength);
        const countTokens = (bucket) => bucket.reduce((sum, m) => sum + (m.summary?.length || 0), 0);

        cacheRetrievalDebug({
            stVectorMode: true,
            stResultsCount: results.length,
            selectedCount: selectedMemories.length,
            threshold,
            tokenBudget: {
                budget: ctx.finalTokens,
                scoredCount: results.length,
                selectedCount: selectedMemories.length,
                trimmedByBudget: results.length - selectedMemories.length,
            },
            bucketDistribution: {
                after: {
                    old: countTokens(afterBuckets.old),
                    mid: countTokens(afterBuckets.mid),
                    recent: countTokens(afterBuckets.recent),
                },
                selectedCount: selectedMemories.length,
            },
        });

        // Increment retrieval_hits
        for (const memory of selectedMemories) {
            memory.retrieval_hits = (memory.retrieval_hits || 0) + 1;
        }

        logDebug(
            `ST Vector Retrieval: ${results.length} results -> ${selectedMemories.length} memories selected (threshold: ${threshold})`
        );
        return selectedMemories;
    }

    // Skip archived reflections in retrieval
    const activeMemories = memories.filter((m) => !m.archived);
    // ... existing local embedding + scoring logic ...
}
```

- [ ] Step 3: Run all tests to verify no regression

Run: `npm run test:run`
Expected: All tests pass

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "feat(retrieval): integrate StVectorStrategy with memory selection"
```

---

### Task 7: Add World Context Support

**Files:**
- Modify: `src/retrieval/world-context.js`

**Purpose:** Support ST Vector Storage for community retrieval with user's threshold.

- [ ] Step 1: Add imports

Update imports at the top:

```javascript
import { getStrategy, isEmbeddingsEnabled } from '../embeddings.js';
import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { hashStringToNumber, extractIdFromText } from '../embeddings.js';
```

- [ ] Step 2: Update retrieveWorldContext function

Add ST Vector Storage branch:

```javascript
export async function retrieveWorldContext(communities, globalState, userMessagesString, queryEmbedding, tokenBudget = 2000) {
    // Intent-based routing: check for macro intent first
    if (detectMacroIntent(userMessagesString) && globalState?.summary) {
        return {
            text: `<world_context>\n${globalState.summary}\n</world_context>`,
            communityIds: [],
            isMacroIntent: true,
        };
    }

    // Check if using ST Vector Storage
    const settings = getDeps()?.getExtensionSettings()?.[extensionName];
    const source = settings?.embeddingSource;
    const strategy = getStrategy(source);

    if (strategy.usesExternalStorage()) {
        // Use ST's search for communities with user's threshold
        const queryText = userMessagesString || '';
        if (!queryText) {
            return { text: '', communityIds: [], isMacroIntent: false };
        }

        const threshold = settings.vectorSimilarityThreshold;
        const results = await strategy.searchItems(queryText, 10, threshold);

        if (!results || results.length === 0) {
            return { text: '', communityIds: [], isMacroIntent: false };
        }

        // Community IDs are stored as "C0", "C1", etc.
        const communityResults = results.filter((r) => r.id.startsWith('C'));

        if (communityResults.length === 0) {
            return { text: '', communityIds: [], isMacroIntent: false };
        }

        // Map IDs back to community objects
        const selected = [];
        let usedTokens = 0;

        for (const result of communityResults) {
            const community = communities?.[result.id];
            if (!community) continue;

            const entry = formatCommunityEntry(community);
            const tokens = countTokens(entry);
            if (usedTokens + tokens > tokenBudget) break;
            selected.push({ id: result.id, entry });
            usedTokens += tokens;
        }

        if (selected.length === 0) {
            return { text: '', communityIds: [], isMacroIntent: false };
        }

        const text = '<world_context>\n' + selected.map((s) => s.entry).join('\n\n') + '\n</world_context>';

        return {
            text,
            communityIds: selected.map((s) => s.id),
            isMacroIntent: false,
        };
    }

    // Fall back to existing local vector search logic
    if (!communities || !queryEmbedding) {
        return { text: '', communityIds: [], isMacroIntent: false };
    }

    // ... existing local logic ...
}
```

- [ ] Step 3: Run tests

Run: `npm run test:run`
Expected: All tests pass

- [ ] Step 4: Commit

```bash
git add -A && git commit -m "feat(world-context): add ST Vector Storage support for communities"
```

---

### Task 8: Add Sync Helpers in data.js

**Files:**
- Modify: `src/utils/data.js`

**Purpose:** Add helper functions for syncing items to ST Vector Storage.

- [ ] Step 1: Add imports

Add to imports at the top:

```javascript
import { getStrategy } from '../embeddings.js';
import { extensionName } from '../constants.js';
import { markStSynced, clearStSynced } from './embedding-codec.js';
```

- [ ] Step 2: Add sync helper functions

Add after the imports section:

```javascript
/**
 * Check if ST Vector Storage is active and sync items
 * @param {Object[]} items - Items to sync [{ id, summary }]
 * @param {Object} options - Options
 * @param {Object} options.targetObjects - Objects to mark as synced (parallel to items)
 * @returns {Promise<boolean>} True if synced or skipped
 */
export async function syncItemsToStStorage(items, { targetObjects } = {}) {
    try {
        const deps = getDeps();
        const settings = deps.getExtensionSettings()?.[extensionName];
        if (settings?.embeddingSource !== 'st-vectors') return false;

        const strategy = getStrategy('st-vectors');
        if (!strategy.usesExternalStorage()) return false;

        if (!items || items.length === 0) return true;

        const result = await strategy.insertItems(items);
        if (result && targetObjects) {
            // Mark the target objects as synced
            for (const obj of targetObjects) {
                markStSynced(obj);
            }
        }
        if (!result) {
            logWarn(`ST Vector sync failed for ${items.length} items`);
        }
        return result;
    } catch (error) {
        logError('Failed to sync items to ST Vector Storage', error);
        return false;
    }
}

/**
 * Delete items from ST Vector Storage
 * @param {string[]} ids - Item IDs to delete
 * @returns {Promise<boolean>} True if deleted or skipped
 */
export async function deleteItemsFromStStorage(ids) {
    try {
        const deps = getDeps();
        const settings = deps.getExtensionSettings()?.[extensionName];
        if (settings?.embeddingSource !== 'st-vectors') return false;

        const strategy = getStrategy('st-vectors');
        if (!strategy.usesExternalStorage()) return false;

        if (!ids || ids.length === 0) return true;

        return await strategy.deleteItems(ids);
    } catch (error) {
        logError('Failed to delete items from ST Vector Storage', error);
        return false;
    }
}

/**
 * Purge ST Vector Storage collection for current chat
 * @returns {Promise<boolean>} True if purged or skipped
 */
export async function purgeStVectorCollection() {
    try {
        const deps = getDeps();
        const settings = deps.getExtensionSettings()?.[extensionName];
        if (settings?.embeddingSource !== 'st-vectors') return false;

        const strategy = getStrategy('st-vectors');
        if (!strategy.usesExternalStorage()) return false;

        return await strategy.purgeCollection();
    } catch (error) {
        logError('Failed to purge ST Vector collection', error);
        return false;
    }
}
```

- [ ] Step 3: Update deleteMemory function

Find `deleteMemory` and update:

```javascript
export async function deleteMemory(id) {
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat loaded');
        return false;
    }

    const idx = data[MEMORIES_KEY]?.findIndex((m) => m.id === id);
    if (idx === -1) {
        logDebug(`Memory ${id} not found`);
        return false;
    }

    const memory = data[MEMORIES_KEY][idx];
    data[MEMORIES_KEY].splice(idx, 1);

    // Clear sync flag and delete from ST Vector Storage
    clearStSynced(memory);
    await deleteItemsFromStStorage([id]);

    await getDeps().saveChatConditional();
    logDebug(`Deleted memory ${id}`);
    return true;
}
```

- [ ] Step 4: Update deleteCurrentChatData function

Find `deleteCurrentChatData` and update:

```javascript
export async function deleteCurrentChatData() {
    const context = getDeps().getContext();

    if (!context.chatMetadata) {
        logDebug('No chat metadata found');
        return false;
    }

    // Purge ST Vector collection before deleting data
    await purgeStVectorCollection();

    delete context.chatMetadata[METADATA_KEY];
    await getDeps().saveChatConditional();
    logDebug('Deleted all chat data');
    return true;
}
```

- [ ] Step 5: Run tests

Run: `npm run test:run`
Expected: All tests pass

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "feat(data): add sync helpers for ST Vector Storage"
```

---

### Task 9: Add Sync Hooks for Events in extract.js

**Files:**
- Modify: `src/extraction/extract.js`

**Purpose:** Add sync hooks for events after Phase 1 commit.

- [ ] Step 1: Add sync hook for events after Phase 1 commit

Find where events are committed (after `data[MEMORIES_KEY].push(...events)`) and add:

```javascript
// After: data[MEMORIES_KEY].push(...events);
// Add:
if (events.length > 0) {
    // Sync to ST Vector Storage
    const { syncItemsToStStorage } = await import('../utils/data.js');
    await syncItemsToStStorage(
        events.map((e) => ({ id: e.id, summary: e.summary })),
        { targetObjects: events }
    );
}
```

- [ ] Step 2: Commit

```bash
git add -A && git commit -m "feat(extract): add sync hook for events to ST Vector Storage"
```

---

### Task 10: Add Sync Support in Graph Operations

**Files:**
- Modify: `src/graph/graph.js`

**Purpose:** Add sync support in `mergeOrInsertEntity` for new nodes and in `consolidateEdges` for consolidated edges. **Also add deletion hooks for graph consolidation.**

- [ ] Step 1: Add required imports

Add at the top of `src/graph/graph.js`:

```javascript
import { getStrategy, isEmbeddingsEnabled } from '../embeddings.js';
```

- [ ] Step 2: Add sync call in mergeOrInsertEntity for new nodes

Find the end of `mergeOrInsertEntity` where a new node is created and add sync:

```javascript
// At the end of mergeOrInsertEntity, after creating a new node:
// Find this pattern:
// upsertEntity(graphData, name, type, description, cap);
// setEmbedding(graphData.nodes[key], newEmbedding);

// Add after node creation:
// Sync new node to ST Vector Storage
const { syncItemsToStStorage } = await import('../utils/data.js');
await syncItemsToStStorage(
    [{ id: key, summary: `${type}: ${name} - ${description}` }],
    { targetObjects: [graphData.nodes[key]] }
);
```

- [ ] Step 3: Handle consolidateEdges for ST Vector Storage

In `consolidateEdges`, find the re-embed section and update:

```javascript
// In consolidateEdges, find the re-embed section:
// if (isEmbeddingsEnabled()) {
//     const newEmbedding = await getDocumentEmbedding(...);
//     setEmbedding(edge, newEmbedding);
// }

// Replace with:
if (isEmbeddingsEnabled()) {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const strategy = getStrategy(settings.embeddingSource);
    if (strategy.usesExternalStorage()) {
        // Sync updated edge to ST Vector Storage
        const { syncItemsToStStorage } = await import('../utils/data.js');
        const edgeId = `edge_${edge.source}_${edge.target}`;
        await syncItemsToStStorage(
            [{ id: edgeId, summary: `relationship: ${edge.source} - ${edge.target}: ${edge.description}` }],
            { targetObjects: [edge] }
        );
    } else {
        const newEmbedding = await getDocumentEmbedding(
            `relationship: ${edge.source} - ${edge.target}: ${edge.description}`
        );
        setEmbedding(edge, newEmbedding);
    }
}
```

- [ ] Step 4: Add deletion hook in redirectEdges for removed edges

In `redirectEdges`, after removing old edges, add deletion:

```javascript
// In redirectEdges, find the edges removal section:
// for (const key of edgesToRemove) {
//     delete graphData.edges[key];
// }

// Add after deletion:
// CRITICAL: Transform edge keys to ST Vector Storage ID format
// Edge dictionary key: "source__target" (e.g., "alice__bob")
// ST Vector ID: "edge_source_target" (e.g., "edge_alice_bob")
const { deleteItemsFromStStorage } = await import('../utils/data.js');
const edgeIdsToDelete = edgesToRemove.map((key) => {
    const [source, target] = key.split('__');
    return `edge_${source}_${target}`;
});
await deleteItemsFromStStorage(edgeIdsToDelete);
```

- [ ] Step 5: Run tests

Run: `npm run test:run`
Expected: All tests pass

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "feat(graph): add sync support for nodes and edges to ST Vector Storage"
```

---

### Task 11: Add Deletion Hooks for Graph Consolidation

**Files:**
- Modify: `src/graph/graph.js`

**Purpose:** Add deletion hooks when nodes are merged during `consolidateGraph()`. When two nodes merge, the removed node must be deleted from ST Vector Storage.

**Common Pitfalls:**
- Deletion must happen BEFORE the node is removed from `graphData.nodes`
- The removed node's key is needed for deletion

- [ ] Step 1: Add deletion hook in consolidateGraph for merged nodes

Find the merge execution section in `consolidateGraph()`:

```javascript
// Step 4: Execute merges
const entityCap = settings.entityDescriptionCap;
for (const [removeKey, keepKey] of mergeMap) {
    const removedNode = graphData.nodes[removeKey];
    if (!removedNode) continue;

    // Merge description
    upsertEntity(
        graphData,
        graphData.nodes[keepKey].name,
        graphData.nodes[keepKey].type,
        removedNode.description,
        entityCap
    );

    // Persist alias for retrieval-time alternate name matching
    if (!graphData.nodes[keepKey].aliases) graphData.nodes[keepKey].aliases = [];
    graphData.nodes[keepKey].aliases.push(removedNode.name);

    // Redirect edges
    redirectEdges(graphData, removeKey, keepKey);

    // Remove old node
    delete graphData.nodes[removeKey];
    mergedCount++;
}
```

Update to include ST Vector Storage deletion:

```javascript
// Step 4: Execute merges
const entityCap = settings.entityDescriptionCap;
for (const [removeKey, keepKey] of mergeMap) {
    const removedNode = graphData.nodes[removeKey];
    if (!removedNode) continue;

    // Merge description
    upsertEntity(
        graphData,
        graphData.nodes[keepKey].name,
        graphData.nodes[keepKey].type,
        removedNode.description,
        entityCap
    );

    // Persist alias for retrieval-time alternate name matching
    if (!graphData.nodes[keepKey].aliases) graphData.nodes[keepKey].aliases = [];
    graphData.nodes[keepKey].aliases.push(removedNode.name);

    // Redirect edges (includes ST deletion for removed edges)
    redirectEdges(graphData, removeKey, keepKey);

    // Delete merged node from ST Vector Storage
    const { deleteItemsFromStStorage } = await import('../utils/data.js');
    await deleteItemsFromStStorage([removeKey]);

    // Remove old node
    delete graphData.nodes[removeKey];
    mergedCount++;
}
```

- [ ] Step 2: Run tests

Run: `npm run test:run`
Expected: All tests pass

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "feat(graph): add deletion hooks for graph consolidation"
```

---

### Task 12: Add Sync Support in Communities

**Files:**
- Modify: `src/graph/communities.js`

**Purpose:** Add sync support in `updateCommunitySummaries` for newly summarized communities.

- [ ] Step 1: Add sync call after community summarization

In `updateCommunitySummaries`, find where communities are stored and add sync:

```javascript
// After: updatedCommunities[key] = community;
// Add sync for ST Vector Storage
const { syncItemsToStStorage } = await import('../utils/data.js');
await syncItemsToStStorage(
    [{ id: key, summary: community.summary }],
    { targetObjects: [community] }
);
```

- [ ] Step 2: Run tests

Run: `npm run test:run`
Expected: All tests pass

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "feat(communities): add sync support to ST Vector Storage"
```

---

### Task 13: Add Sync Hook in Reflection Generation

**Files:**
- Modify: `src/reflection/reflect.js`

**Purpose:** Add sync hook after reflection generation.

- [ ] Step 1: Add sync hook after reflections are generated

Find where reflections are added to memories and add:

```javascript
// After reflections are generated and added to data[MEMORIES_KEY]
if (reflections.length > 0) {
    const { syncItemsToStStorage } = await import('../utils/data.js');
    await syncItemsToStStorage(
        reflections.map((r) => ({ id: r.id, summary: r.summary })),
        { targetObjects: reflections }
    );
}
```

- [ ] Step 2: Run tests

Run: `npm run test:run`
Expected: All tests pass

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "feat(reflect): add sync hook for reflections to ST Vector Storage"
```

---

### Task 14: Update backfillAllEmbeddings with Batching

**Files:**
- Modify: `src/embeddings.js`

**Purpose:** Handle external storage strategies in the backfill function with **batching** to prevent network timeouts and API limits. Uses the `_st_synced` flag to skip already-synced items.

**Common Pitfalls:**
- **CRITICAL**: Use `processInBatches` with batch size of 100 to prevent network issues
- Filter to items without `_st_synced` flag before syncing
- Mark all items as synced after successful batch

- [ ] Step 1: Update backfillAllEmbeddings function

Find the `backfillAllEmbeddings()` function and add branch for external storage:

```javascript
export async function backfillAllEmbeddings({ signal, silent = false } = {}) {
    signal ??= getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const { MEMORIES_KEY } = await import('./constants.js');
    const { getOpenVaultData, saveOpenVaultData } = await import('./utils/data.js');
    const { setStatus } = await import('./ui/status.js');
    const { showToast } = await import('./utils/dom.js');
    const { markStSynced } = await import('./utils/embedding-codec.js');

    if (!isEmbeddingsEnabled()) {
        if (!silent) showToast('warning', 'Configure embedding source first');
        return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: false };
    }

    const data = getOpenVaultData();
    if (!data) {
        if (!silent) showToast('warning', 'No chat data available');
        return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: false };
    }

    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);

    // Handle external storage strategies (ST Vector Storage)
    if (strategy.usesExternalStorage()) {
        // Filter to items that need syncing (not already marked with _st_synced)
        const memories = (data[MEMORIES_KEY] || []).filter((m) => m.summary && !hasEmbedding(m));
        const nodes = Object.values(data.graph?.nodes || {}).filter((n) => !hasEmbedding(n));
        const communities = Object.values(data.communities || {}).filter((c) => c.summary && !hasEmbedding(c));
        const totalNeeded = memories.length + nodes.length + communities.length;

        if (totalNeeded === 0) {
            return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: true };
        }

        if (!silent) showToast('info', `Syncing ${totalNeeded} items to ST Vector Storage...`);
        setStatus('extracting');

        try {
            const memoryItems = memories.map((m) => ({
                id: m.id,
                summary: m.summary,
                targetObject: m,
            }));

            const nodeItems = nodes.map((n) => ({
                id: n.name,
                summary: `${n.type}: ${n.name} - ${n.description}`,
                targetObject: n,
            }));

            const communityItems = Object.entries(data.communities || {})
                .filter(([_, c]) => c.summary && !hasEmbedding(c))
                .map(([key, c]) => ({
                    id: key,
                    summary: c.summary,
                    targetObject: c,
                }));

            const allItems = [...memoryItems, ...nodeItems, ...communityItems];

            // CRITICAL: Batch inserts to prevent network timeouts
            // Use batch size of 100 (conservative for API limits)
            const BATCH_SIZE = 100;
            let successCount = 0;

            for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
                const batch = allItems.slice(i, i + BATCH_SIZE);
                const success = await strategy.insertItems(
                    batch.map((item) => ({ id: item.id, summary: item.summary }))
                );

                if (success) {
                    // Mark batch items as synced
                    for (const item of batch) {
                        markStSynced(item.targetObject);
                    }
                    successCount += batch.length;
                }

                // Yield to main thread between batches
                if (i + BATCH_SIZE < allItems.length) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }

            if (successCount > 0) {
                await saveOpenVaultData();
                logInfo(
                    `ST Vector sync complete: ${successCount} items synced in ${Math.ceil(allItems.length / BATCH_SIZE)} batches`
                );
            }

            return {
                memories: memoryItems.length,
                nodes: nodeItems.length,
                communities: communityItems.length,
                total: successCount,
                skipped: false,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            logError('ST Vector sync error', error);
            if (!silent) showToast('error', `ST Vector sync failed: ${error.message}`);
            return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: false };
        } finally {
            setStatus('ready');
        }
    }

    // Existing local embedding logic...
    // (keep all existing code for Transformers/Ollama strategies)
}
```

- [ ] Step 2: Run tests

Run: `npm run test:run tests/embeddings.test.js`
Expected: All tests pass

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "feat(embeddings): add ST Vector Storage support to backfillAllEmbeddings with batching"
```

---

### Task 15: Update getOptimalChunkSize for st-vectors

**Files:**
- Modify: `src/embeddings.js`

**Purpose:** Return a reasonable chunk size for st-vectors strategy.

- [ ] Step 1: Update getOptimalChunkSize function

Find the `getOptimalChunkSize()` function and add case for st-vectors:

```javascript
function getOptimalChunkSize() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;

    // For Transformers models, get from model config
    if (TRANSFORMERS_MODELS[source]) {
        return TRANSFORMERS_MODELS[source].optimalChunkSize || 1000;
    }

    // For Ollama, use a safe default
    if (source === 'ollama') {
        return 800;
    }

    // For ST Vector Storage, use safe default (delegates to ST's model)
    if (source === 'st-vectors') {
        return 1000;
    }

    // Fallback default
    return 1000;
}
```

- [ ] Step 2: Run tests

Run: `npm run test:run tests/embeddings.test.js`
Expected: All tests pass

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "feat(embeddings): add chunk size for st-vectors strategy"
```

---

### Task 16: Run Full Test Suite and Manual Verification

- [ ] Step 1: Run full test suite

Run: `npm run test:run`
Expected: All tests pass

- [ ] Step 2: Manual testing checklist

1. Configure ST Vector Storage with a provider (e.g., OpenRouter)
2. Select `st-vectors` as embedding source in OpenVault settings
3. Add memories in OpenVault
4. Verify vectors in `data/vectors/{source}/openvault-{chatId}-{source}/`
5. Search via OpenVault UI with threshold 0.5
6. Verify results are ordered by similarity (NOT chronologically)
7. Delete memory, verify removal from ST
8. Trigger graph consolidation, verify merged nodes are deleted from ST
9. Restart ST, verify persistence
10. Switch chats, verify isolation (no cross-chat results)
11. Run backfill twice - second run should skip already-synced items
12. Test with large chat (3000+ memories) - verify batching prevents timeout

- [ ] Step 3: Final commit

```bash
git add -A && git commit -m "feat: complete ST Vector Storage integration v4"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Update hasEmbedding for ST synced items | `src/utils/embedding-codec.js` |
| 2 | Add storage methods to EmbeddingStrategy | `src/embeddings.js` |
| 3 | Add ID prefix utility functions | `src/embeddings.js` |
| 4 | Write tests for StVectorStrategy | `tests/embeddings.test.js` |
| 5 | Implement StVectorStrategy | `src/embeddings.js` |
| 6 | Integrate with retrieval system (Map-based ordering) | `src/retrieval/scoring.js` |
| 7 | Add world context support | `src/retrieval/world-context.js` |
| 8 | Add sync helpers in data.js | `src/utils/data.js` |
| 9 | Add sync hooks for events in extract.js | `src/extraction/extract.js` |
| 10 | Add sync support in graph operations | `src/graph/graph.js` |
| 11 | Add deletion hooks for graph consolidation | `src/graph/graph.js` |
| 12 | Add sync support in communities | `src/graph/communities.js` |
| 13 | Add sync hook in reflection generation | `src/reflection/reflect.js` |
| 14 | Update backfillAllEmbeddings with batching | `src/embeddings.js` |
| 15 | Update getOptimalChunkSize | `src/embeddings.js` |
| 16 | Full test and verification | All files |