# Critical Bugfixes Implementation Plan

**Goal:** Fix 6 architectural bugs affecting multilingual support, extraction pipeline stability, reflection loops, ST Vector sync, memory leaks, and embedding migrations.

**Architecture:** OpenVault is a SillyTavern extension using ESM modules without bundlers. State lives in `context.chatMetadata.openvault`. Core patterns: CDN imports via `cdnImport()`, SillyTavern globals via `getDeps()`, settings via `src/settings.js`.

**Tech Stack:** Vanilla JavaScript (ESM), Vitest for testing, Biome for linting, Zod for schemas.

---

## File Structure Overview

**Files to Modify:**
- `src/pov.js` - Fix Cyrillic character name detection regex
- `src/utils/tokens.js` - Fix turn boundary logic for all-User message queues
- `src/extraction/extract.js` - Fix reflection accumulator reset on failure
- `src/retrieval/scoring.js` - Fix ST Vector retrieval to include graph nodes and communities
- `src/retrieval/world-context.js` - Fix community retrieval for ST Vector users
- `src/utils/st-helpers.js` - Fix memory leak by clearing timeout in `withTimeout`
- `src/embeddings/migration.js` - Fix edge embedding invalidation on model change

**Files to Create:**
- `tests/pov.test.js` - Tests for Cyrillic character detection
- `tests/utils/st-helpers.test.js` - Tests for timeout clearing

---

### Task 1: Fix Multilingual Regex for Cyrillic Character Names

**Files:**
- Modify: `src/pov.js`
- Test: `tests/pov.test.js`

**Bug:** `detectPresentCharactersFromMessages` uses `\b` word boundaries which only work with ASCII characters. Cyrillic names fail to match.

- [ ] Step 1: Write failing test for Cyrillic character detection

```javascript
// tests/pov.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectPresentCharactersFromMessages } from '../src/pov.js';

describe('detectPresentCharactersFromMessages', () => {
    it('should detect Cyrillic character names in messages', () => {
        const chat = [
            { name: 'User', is_user: true, mes: 'Привет Сузи, как дела?' }
        ];
        const knownCharacters = new Set(['Сузи', 'Анна']);
        const recentMessageCount = 5;

        const result = detectPresentCharactersFromMessages(chat, knownCharacters, recentMessageCount);

        expect(result.has('Сузи')).toBe(true);
    });

    it('should detect Cyrillic names at start of message', () => {
        const chat = [
            { name: 'User', is_user: true, mes: 'Сузи, ты здесь?' }
        ];
        const knownCharacters = new Set(['Сузи']);

        const result = detectPresentCharactersFromMessages(chat, knownCharacters, 5);

        expect(result.has('Сузи')).toBe(true);
    });

    it('should detect Cyrillic names at end of message', () => {
        const chat = [
            { name: 'User', is_user: true, mes: 'Я говорю с Анна' }
        ];
        const knownCharacters = new Set(['Анна']);

        const result = detectPresentCharactersFromMessages(chat, knownCharacters, 5);

        expect(result.has('Анна')).toBe(true);
    });

    it('should still work with ASCII names', () => {
        const chat = [
            { name: 'User', is_user: true, mes: 'Hello Alice, how are you?' }
        ];
        const knownCharacters = new Set(['Alice', 'Bob']);

        const result = detectPresentCharactersFromMessages(chat, knownCharacters, 5);

        expect(result.has('Alice')).toBe(true);
        expect(result.has('Bob')).toBe(false);
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test tests/pov.test.js -- --reporter=verbose`
Expected: FAIL - Cyrillic names not detected

- [ ] Step 3: Fix the regex in `src/pov.js`

Replace the `\b` word boundary with a Unicode-aware boundary using lookbehind/lookahead:

```javascript
// src/pov.js, around line 154-156
// BEFORE:
const regex = new RegExp(`\\b${escapedName}\\b`, 'i');

// AFTER:
// Use Unicode-aware word boundaries: match if preceded/followed by
// non-letter, non-digit, non-underscore, or string start/end
const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedName}(?![\\p{L}\\p{N}])`, 'iu');
```

The `u` flag enables Unicode property escapes (`\p{L}` for letters, `\p{N}` for numbers). The negative lookbehind `(?<![\p{L}\p{N}_])` ensures the name is not preceded by a word character, and the negative lookahead `(?![\p{L}\p{N}])` ensures it's not followed by a letter or number.

- [ ] Step 4: Run test to verify it passes

Run: `npm test tests/pov.test.js -- --reporter=verbose`
Expected: PASS - All tests pass

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: use Unicode-aware word boundaries for Cyrillic character detection"
```

---

### Task 2: Fix Extraction Pipeline Stall on All-User Message Queues

**Files:**
- Modify: `src/utils/tokens.js`
- Modify: `src/extraction/scheduler.js`
- Test: `tests/scheduler.test.js` (existing)

**Bug:** `snapToTurnBoundary` returns empty array when queue has only User messages, causing extraction to stall.

- [ ] Step 1: Write failing test for all-User message batch

```javascript
// Add to tests/scheduler.test.js
import { describe, it, expect } from 'vitest';
import { getNextBatch } from '../src/extraction/scheduler.js';
import { makeChat, makeData } from './factories.js';

describe('getNextBatch with all-User messages', () => {
    it('should extract User-only messages during Emergency Cut', () => {
        const chat = makeChat([
            ['u1', true],   // User
            ['u2', true],   // User
            ['u3', true],   // User
        ]);
        const data = makeData();
        const tokenBudget = 100;
        const isEmergencyCut = true;

        const result = getNextBatch(chat, data, tokenBudget, isEmergencyCut);

        // Should return all messages during Emergency Cut, even without Bot messages
        expect(result).not.toBeNull();
        expect(result.length).toBe(3);
    });

    it('should handle queue with only User messages gracefully', () => {
        const chat = makeChat([
            ['u1', true],   // User
            ['u2', true],   // User
        ]);
        const data = makeData();
        // Set high token count to force extraction
        data.processedFingerprints = new Set();

        const result = getNextBatch(chat, data, 10, false);

        // Should not stall - either return messages or null, not empty array
        // that causes infinite loop
        expect(result === null || result.length > 0).toBe(true);
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test tests/scheduler.test.js -- --reporter=verbose`
Expected: FAIL - Empty array returned for all-User queue

- [ ] Step 3: Fix the logic in `src/utils/tokens.js`

Modify `snapToTurnBoundary` to have a fallback for when no Bot→User boundary is found:

```javascript
// src/utils/tokens.js, function snapToTurnBoundary (lines 76-93)
// BEFORE:
function snapToTurnBoundary(chat, messageIds) {
    if (messageIds.length === 0) return [];

    for (let i = messageIds.length - 1; i >= 0; i--) {
        const lastId = messageIds[i];
        const lastMsg = chat[lastId];
        const nextInChat = chat[lastId + 1];

        if (lastMsg && !lastMsg.is_user && (!nextInChat || nextInChat.is_user)) {
            return messageIds.slice(0, i + 1);
        }
    }

    return [];
}

// AFTER:
function snapToTurnBoundary(chat, messageIds, allowUserOnly = false) {
    if (messageIds.length === 0) return [];

    for (let i = messageIds.length - 1; i >= 0; i--) {
        const lastId = messageIds[i];
        const lastMsg = chat[lastId];
        const nextInChat = chat[lastId + 1];

        if (lastMsg && !lastMsg.is_user && (!nextInChat || nextInChat.is_user)) {
            return messageIds.slice(0, i + 1);
        }
    }

    // Fallback: if no Bot→User boundary found and we allow user-only batches,
    // return the accumulated messages anyway (prevents stall)
    if (allowUserOnly) {
        return messageIds;
    }

    return [];
}
```

- [ ] Step 4: Update caller in `src/extraction/scheduler.js`

Pass `isEmergencyCut` to `snapToTurnBoundary`:

```javascript
// src/extraction/scheduler.js, in getNextBatch function
// Line ~163: Change snapToTurnBoundary call
// BEFORE:
let snapped = snapToTurnBoundary(chat, accumulated);

// AFTER:
let snapped = snapToTurnBoundary(chat, accumulated, isEmergencyCut);

// Also update the second call at line ~172:
// BEFORE:
snapped = snapToTurnBoundary(chat, extended);

// AFTER:
snapped = snapToTurnBoundary(chat, extended, isEmergencyCut);
```

- [ ] Step 5: Run test to verify it passes

Run: `npm test tests/scheduler.test.js -- --reporter=verbose`
Expected: PASS - All tests pass

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "fix: prevent extraction stall on all-User message queues"
```

---

### Task 3: Fix Token-Burning Reflection Retry Loop

**Files:**
- Modify: `src/extraction/extract.js`
- Test: `tests/extraction/extract.test.js` (existing)

**Bug:** `importance_sum` accumulator only resets on successful LLM call, causing infinite retries on failure.

- [ ] Step 1: Write failing test for reflection retry behavior

```javascript
// Add to tests/extraction/extract.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { synthesizeReflections } from '../../src/extraction/extract.js';
import * as reflectModule from '../../src/reflection/reflect.js';
import * as llmModule from '../../src/llm.js';

describe('synthesizeReflections accumulator reset', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('should reset importance_sum even when LLM fails', async () => {
        const data = {
            reflection_state: {
                'TestCharacter': { importance_sum: 45 }
            },
            memories: [],
            characters: {}
        };
        const settings = {
            reflectionThreshold: 40,
            maxConcurrency: 1
        };

        // Mock generateReflections to fail
        vi.spyOn(llmModule, 'generateReflections').mockRejectedValue(new Error('LLM timeout'));

        // Spy on console.error to suppress error output
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await synthesizeReflections(data, ['TestCharacter'], settings);

        // importance_sum should be reset even though LLM failed
        expect(data.reflection_state['TestCharacter'].importance_sum).toBe(0);
    });

    it('should not retry failed reflection on next call', async () => {
        const data = {
            reflection_state: {
                'TestCharacter': { importance_sum: 45 }
            },
            memories: [],
            characters: {}
        };
        const settings = {
            reflectionThreshold: 40,
            maxConcurrency: 1
        };

        // Mock generateReflections to fail
        const generateSpy = vi.spyOn(llmModule, 'generateReflections')
            .mockRejectedValue(new Error('LLM timeout'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        // First call - should attempt reflection and fail
        await synthesizeReflections(data, ['TestCharacter'], settings);
        expect(generateSpy).toHaveBeenCalledTimes(1);

        // Second call - importance_sum is now 0, should NOT attempt reflection
        await synthesizeReflections(data, ['TestCharacter'], settings);
        expect(generateSpy).toHaveBeenCalledTimes(1); // Still 1, not 2
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test tests/extraction/extract.test.js -- --reporter=verbose -t "should reset importance_sum"`
Expected: FAIL - importance_sum not reset on failure

- [ ] Step 3: Fix the accumulator reset in `src/extraction/extract.js`

Reset `importance_sum` BEFORE the LLM call to prevent retry loops:

```javascript
// src/extraction/extract.js, in synthesizeReflections function (around line 625-640)
// BEFORE:
reflectionPromises.push(
    ladderQueue
        .add(async () => {
            const { reflections, stChanges } = await generateReflections(
                characterName,
                data[MEMORIES_KEY] || [],
                data[CHARACTERS_KEY] || {}
            );
            if (reflections.length > 0) {
                addMemories(reflections);
            }
            // Reset accumulator after reflection
            data.reflection_state[characterName].importance_sum = 0;
            await applySyncChanges(stChanges);
        })
        .catch((error) => {
            if (error.name === 'AbortError') throw error;
            logError(`Reflection error for ${characterName}`, error);
        })
);

// AFTER:
reflectionPromises.push(
    ladderQueue
        .add(async () => {
            // Reset accumulator BEFORE LLM call to prevent infinite retry loop on failure
            const accumulatedImportance = data.reflection_state[characterName].importance_sum;
            data.reflection_state[characterName].importance_sum = 0;

            try {
                const { reflections, stChanges } = await generateReflections(
                    characterName,
                    data[MEMORIES_KEY] || [],
                    data[CHARACTERS_KEY] || {}
                );
                if (reflections.length > 0) {
                    addMemories(reflections);
                }
                await applySyncChanges(stChanges);
            } catch (error) {
                // On failure, restore the accumulated importance so it can be retried later
                // but only if it was reset (prevents double-counting)
                if (data.reflection_state[characterName].importance_sum === 0) {
                    data.reflection_state[characterName].importance_sum = accumulatedImportance;
                }
                throw error;
            }
        })
        .catch((error) => {
            if (error.name === 'AbortError') throw error;
            logError(`Reflection error for ${characterName}`, error);
        })
);
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test tests/extraction/extract.test.js -- --reporter=verbose -t "should reset importance_sum"`
Expected: PASS - Accumulator resets properly

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: reset reflection accumulator before LLM call to prevent infinite retry loop"
```

---

### Task 4: Fix ST Vector World Context Sync (Graph Nodes and Communities)

**Files:**
- Modify: `src/retrieval/scoring.js`
- Modify: `src/retrieval/world-context.js`
- Test: `tests/retrieval/scoring.test.js` (existing)

**Bug:** `selectRelevantMemoriesWithST` only maps memories, discarding graph nodes and communities from ST Vector results.

- [ ] Step 1: Write failing test for ST Vector retrieval of graph nodes and communities

```javascript
// Add to tests/retrieval/scoring.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectRelevantMemoriesWithST } from '../../src/retrieval/scoring.js';

describe('selectRelevantMemoriesWithST with graph nodes and communities', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('should include graph nodes from ST Vector results', async () => {
        const memories = [
            { id: 'memory1', summary: 'Test memory', importance: 5 }
        ];
        const graphNodes = {
            'Alice': { name: 'Alice', description: 'A brave warrior' },
            'Bob': { name: 'Bob', description: 'A wise mage' }
        };
        const communities = {
            'C1': { id: 'C1', summary: 'The fellowship group' }
        };

        const mockStrategy = {
            searchItems: vi.fn().mockResolvedValue([
                { id: 'memory1', hash: 123, text: '[OV_ID:memory1] Test' },
                { id: 'Alice', hash: 456, text: '[OV_ID:Alice] A brave warrior' },
                { id: 'C1', hash: 789, text: '[OV_ID:C1] The fellowship' }
            ])
        };

        const result = await selectRelevantMemoriesWithST(
            memories,
            graphNodes,
            communities,
            'test query',
            10,
            mockStrategy
        );

        // Should include memory, graph node, and community
        const memoryResult = result.find(r => r.item.id === 'memory1');
        const nodeResult = result.find(r => r.item.name === 'Alice');
        const communityResult = result.find(r => r.item.id === 'C1');

        expect(memoryResult).toBeDefined();
        expect(nodeResult).toBeDefined();
        expect(communityResult).toBeDefined();
    });

    it('should handle empty graph nodes and communities gracefully', async () => {
        const memories = [{ id: 'memory1', summary: 'Test' }];

        const mockStrategy = {
            searchItems: vi.fn().mockResolvedValue([
                { id: 'memory1', hash: 123, text: '[OV_ID:memory1] Test' }
            ])
        };

        const result = await selectRelevantMemoriesWithST(
            memories,
            {},
            {},
            'test query',
            10,
            mockStrategy
        );

        expect(result.length).toBe(1);
        expect(result[0].item.id).toBe('memory1');
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test tests/retrieval/scoring.test.js -- --reporter=verbose -t "should include graph nodes"`
Expected: FAIL - Graph nodes and communities not found in results

- [ ] Step 3: Fix the retrieval logic in `src/retrieval/scoring.js`

Modify `selectRelevantMemoriesWithST` to include graph nodes and communities in the lookup:

```javascript
// src/retrieval/scoring.js, function selectRelevantMemoriesWithST (around line 182-279)
// BEFORE (line ~194):
const memoriesById = new Map(memories.map((m) => [m.id, m]));

for (let i = 0; i < stResults.length; i++) {
    const memory = memoriesById.get(stResults[i].id);
    if (!memory) continue;
    // ...
}

// AFTER:
// Build lookup maps for all item types
const memoriesById = new Map(memories.map((m) => [m.id, m]));
const nodesById = new Map(Object.entries(graphNodes || {}));
const communitiesById = new Map(Object.entries(communities || {}));

for (let i = 0; i < stResults.length; i++) {
    const result = stResults[i];
    let item = memoriesById.get(result.id);
    let itemType = 'memory';

    if (!item) {
        item = nodesById.get(result.id);
        itemType = 'node';
    }

    if (!item) {
        item = communitiesById.get(result.id);
        itemType = 'community';
    }

    if (!item) continue;

    // Store item type for downstream processing
    scored.push({
        item,
        stRank: i,
        stScore: 1.0 - (i / stResults.length), // Normalize to 0-1
        itemType
    });
}
```

- [ ] Step 4: Fix community retrieval in `src/retrieval/world-context.js`

Ensure `retrieveWorldContext` can work with ST Vector storage for communities:

```javascript
// src/retrieval/world-context.js, function retrieveWorldContext (around line 42-93)
// Check if there's an ST Vector path for communities
// The current implementation only uses local embeddings

// Add check for ST Vector mode and use appropriate retrieval method:
// BEFORE (lines 60-67):
const scored = [];
for (const [id, community] of Object.entries(communities)) {
    if (!hasEmbedding(community)) continue;
    const score = cosineSimilarity(queryEmbedding, getEmbedding(community));
    scored.push({ id, community, score });
}

// AFTER - check for ST Vector availability:
const scored = [];

// If using ST Vector, communities should already be retrieved via selectRelevantMemoriesWithST
// Only use local embeddings for non-ST Vector mode
const settings = getSettings();
const isStVectorMode = settings?.embeddingMode === 'st_vector';

if (!isStVectorMode) {
    for (const [id, community] of Object.entries(communities)) {
        if (!hasEmbedding(community)) continue;
        const score = cosineSimilarity(queryEmbedding, getEmbedding(community));
        scored.push({ id, community, score });
    }
} else {
    // In ST Vector mode, communities are retrieved via the scoring layer
    // Return empty here to avoid duplicate processing
    return null;
}
```

- [ ] Step 5: Run test to verify it passes

Run: `npm test tests/retrieval/scoring.test.js -- --reporter=verbose -t "should include graph nodes"`
Expected: PASS - All item types retrieved

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "fix: include graph nodes and communities in ST Vector retrieval"
```

---

### Task 5: Fix Memory Leak in withTimeout

**Files:**
- Modify: `src/utils/st-helpers.js`
- Create: `tests/utils/st-helpers.test.js`

**Bug:** `setTimeout` is never cleared when primary promise resolves, causing memory bloat during backfills.

- [ ] Step 1: Write failing test for timeout cleanup

```javascript
// tests/utils/st-helpers.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout } from '../../src/utils/st-helpers.js';

describe('withTimeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should clear timeout when promise resolves before timeout', async () => {
        const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

        const promise = Promise.resolve('success');
        const resultPromise = withTimeout(promise, 5000, 'Test');

        // Fast-forward but not enough to trigger timeout
        await vi.advanceTimersByTimeAsync(100);

        const result = await resultPromise;

        expect(result).toBe('success');
        expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should clear timeout when promise rejects before timeout', async () => {
        const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

        const promise = Promise.reject(new Error('test error'));
        const resultPromise = withTimeout(promise, 5000, 'Test');

        // Fast-forward but not enough to trigger timeout
        await vi.advanceTimersByTimeAsync(100);

        await expect(resultPromise).rejects.toThrow('test error');
        expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should reject with timeout error when promise takes too long', async () => {
        const promise = new Promise(() => {}); // Never resolves
        const resultPromise = withTimeout(promise, 5000, 'Test Operation');

        vi.advanceTimersByTime(5000);

        await expect(resultPromise).rejects.toThrow('Test Operation timed out after 5000ms');
    });

    it('should resolve with promise value when it completes in time', async () => {
        const promise = Promise.resolve('completed');

        const result = await withTimeout(promise, 5000, 'Test');

        expect(result).toBe('completed');
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test tests/utils/st-helpers.test.js -- --reporter=verbose`
Expected: FAIL - clearTimeout not called

- [ ] Step 3: Fix the withTimeout function

Clear the timeout when the primary promise settles:

```javascript
// src/utils/st-helpers.js, function withTimeout (lines 12-18)
// BEFORE:
export function withTimeout(promise, ms, operation = 'Operation') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)),
    ]);
}

// AFTER:
export function withTimeout(promise, ms, operation = 'Operation') {
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${operation} timed out after ${ms}ms`));
        }, ms);
    });

    return Promise.race([
        promise.finally(() => {
            clearTimeout(timeoutId);
        }),
        timeoutPromise,
    ]);
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test tests/utils/st-helpers.test.js -- --reporter=verbose`
Expected: PASS - All tests pass

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "fix: clear timeout in withTimeout to prevent memory leak"
```

---

### Task 6: Fix Edge Embeddings Desync on Model Change

**Files:**
- Modify: `src/embeddings/migration.js`
- Test: `tests/embeddings/migration.test.js` (existing)

**Bug:** `invalidateStaleEmbeddings` clears embeddings for memories, nodes, and communities but forgets `graph.edges`.

- [ ] Step 1: Write failing test for edge embedding invalidation

```javascript
// Add to tests/embeddings/migration.test.js
import { describe, it, expect } from 'vitest';
import { invalidateStaleEmbeddings } from '../../src/embeddings/migration.js';

describe('invalidateStaleEmbeddings edge handling', () => {
    it('should clear embeddings from graph edges', () => {
        const data = {
            memories: [],
            graph: {
                nodes: {},
                edges: {
                    'edge1': {
                        source: 'A',
                        target: 'B',
                        description: 'Test edge',
                        embedding_b64: 'base64encodedembedding',
                        embedding: [0.1, 0.2, 0.3]
                    },
                    'edge2': {
                        source: 'B',
                        target: 'C',
                        description: 'Another edge',
                        embedding_b64: 'anotherembedding',
                        embedding: [0.4, 0.5, 0.6]
                    }
                }
            },
            communities: {}
        };

        const result = invalidateStaleEmbeddings(data);

        // Should report 2 embeddings cleared (the edges)
        expect(result.clearedCount).toBe(2);

        // Edge embeddings should be removed
        expect(data.graph.edges['edge1'].embedding_b64).toBeUndefined();
        expect(data.graph.edges['edge1'].embedding).toBeUndefined();
        expect(data.graph.edges['edge2'].embedding_b64).toBeUndefined();
        expect(data.graph.edges['edge2'].embedding).toBeUndefined();
    });

    it('should clear edge embeddings along with other embeddings', () => {
        const data = {
            memories: [
                { id: 'm1', summary: 'Test', embedding_b64: 'mem1' }
            ],
            graph: {
                nodes: {
                    'Alice': { name: 'Alice', embedding_b64: 'node1' }
                },
                edges: {
                    'edge1': { source: 'A', target: 'B', embedding_b64: 'edge1' }
                }
            },
            communities: {
                'C1': { id: 'C1', embedding_b64: 'comm1' }
            }
        };

        const result = invalidateStaleEmbeddings(data);

        // Should clear: 1 memory + 1 node + 1 community + 1 edge = 4
        expect(result.clearedCount).toBe(4);

        expect(data.memories[0].embedding_b64).toBeUndefined();
        expect(data.graph.nodes['Alice'].embedding_b64).toBeUndefined();
        expect(data.graph.edges['edge1'].embedding_b64).toBeUndefined();
        expect(data.communities['C1'].embedding_b64).toBeUndefined();
    });

    it('should handle empty or missing edges gracefully', () => {
        const data1 = {
            memories: [],
            graph: { nodes: {} }  // No edges property
        };

        const data2 = {
            memories: [],
            graph: { nodes: {}, edges: {} }  // Empty edges
        };

        expect(() => invalidateStaleEmbeddings(data1)).not.toThrow();
        expect(() => invalidateStaleEmbeddings(data2)).not.toThrow();
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npm test tests/embeddings/migration.test.js -- --reporter=verbose -t "should clear embeddings from graph edges"`
Expected: FAIL - Edge embeddings not cleared

- [ ] Step 3: Fix the invalidation logic in `src/embeddings/migration.js`

Add edge loop to `invalidateStaleEmbeddings` and related helper functions:

```javascript
// src/embeddings/migration.js

// 1. Update _countEmbeddings (around line 108-120)
// BEFORE:
function _countEmbeddings(data) {
    let count = 0;
    for (const m of data.memories || []) {
        if (m.embedding_b64) count++;
    }
    for (const node of Object.values(data.graph?.nodes || {})) {
        if (node.embedding_b64) count++;
    }
    for (const community of Object.values(data.communities || {})) {
        if (community.embedding_b64) count++;
    }
    return count;
}

// AFTER:
function _countEmbeddings(data) {
    let count = 0;
    for (const m of data.memories || []) {
        if (m.embedding_b64) count++;
    }
    for (const node of Object.values(data.graph?.nodes || {})) {
        if (node.embedding_b64) count++;
    }
    for (const edge of Object.values(data.graph?.edges || {})) {
        if (edge.embedding_b64) count++;
    }
    for (const community of Object.values(data.communities || {})) {
        if (community.embedding_b64) count++;
    }
    return count;
}

// 2. Update _hasSyncedItems (around line 83-95)
// BEFORE:
function _hasSyncedItems(data) {
    for (const m of data.memories || []) {
        if (m._st_synced) return true;
    }
    for (const node of Object.values(data.graph?.nodes || {})) {
        if (node._st_synced) return true;
    }
    for (const community of Object.values(data.communities || {})) {
        if (community._st_synced) return true;
    }
    return false;
}

// AFTER:
function _hasSyncedItems(data) {
    for (const m of data.memories || []) {
        if (m._st_synced) return true;
    }
    for (const node of Object.values(data.graph?.nodes || {})) {
        if (node._st_synced) return true;
    }
    for (const edge of Object.values(data.graph?.edges || {})) {
        if (edge._st_synced) return true;
    }
    for (const community of Object.values(data.communities || {})) {
        if (community._st_synced) return true;
    }
    return false;
}

// 3. Update _clearAllStSyncFlags (around line 98-106)
// BEFORE:
function _clearAllStSyncFlags(data) {
    for (const m of data.memories || []) {
        delete m._st_synced;
    }
    for (const node of Object.values(data.graph?.nodes || {})) {
        delete node._st_synced;
    }
    for (const community of Object.values(data.communities || {})) {
        delete community._st_synced;
    }
}

// AFTER:
function _clearAllStSyncFlags(data) {
    for (const m of data.memories || []) {
        delete m._st_synced;
    }
    for (const node of Object.values(data.graph?.nodes || {})) {
        delete node._st_synced;
    }
    for (const edge of Object.values(data.graph?.edges || {})) {
        delete edge._st_synced;
    }
    for (const community of Object.values(data.communities || {})) {
        delete community._st_synced;
    }
}

// 4. Update invalidateStaleEmbeddings (around line 176-194)
// BEFORE:
for (const node of Object.values(data.graph?.nodes || {})) {
    if (hasEmbedding(node)) {
        deleteEmbedding(node);
        count++;
    }
}

for (const community of Object.values(data.communities || {})) {
    if (hasEmbedding(community)) {
        deleteEmbedding(community);
        count++;
    }
}

// AFTER:
for (const node of Object.values(data.graph?.nodes || {})) {
    if (hasEmbedding(node)) {
        deleteEmbedding(node);
        count++;
    }
}

for (const edge of Object.values(data.graph?.edges || {})) {
    if (hasEmbedding(edge)) {
        deleteEmbedding(edge);
        count++;
    }
}

for (const community of Object.values(data.communities || {})) {
    if (hasEmbedding(community)) {
        deleteEmbedding(community);
        count++;
    }
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npm test tests/embeddings/migration.test.js -- --reporter=verbose -t "should clear embeddings from graph edges"`
Expected: PASS - Edge embeddings cleared

- [ ] Step 5: Run full test suite to check for regressions

Run: `npm test -- --reporter=verbose`
Expected: All tests pass

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "fix: invalidate edge embeddings on model change"
```

---

## Final Verification

After all tasks are complete:

- [ ] Run typecheck: `npm run typecheck`
- [ ] Run linter: `npm run lint`
- [ ] Run full test suite: `npm test`
- [ ] Commit final changes

```bash
git add -A && git commit -m "fix: resolve 6 critical architectural bugs

- Multilingual regex now uses Unicode-aware boundaries for Cyrillic
- Extraction pipeline no longer stalls on all-User message queues
- Reflection accumulator reset prevents token-burning retry loops
- ST Vector retrieval now includes graph nodes and communities
- withTimeout clears timers to prevent memory leaks
- Edge embeddings properly invalidated on model changes"
```

**Common Pitfalls:**
- The Unicode regex `(?<!...)` and `(?!...)` require the `u` flag and may not work in older JavaScript engines. SillyTavern uses modern Chromium, so this is safe.
- The `finally()` method on promises was added in ES2018. Ensure the project's target supports it (check `jsconfig.json` or `tsconfig.json`).
- When modifying scheduler logic, ensure Emergency Cut behavior remains correct - it should bypass all safety checks.
- The reflection fix has two approaches: reset before (defensive) or reset in catch. The plan uses "reset before with restore on failure" to prevent data loss while avoiding infinite loops.
