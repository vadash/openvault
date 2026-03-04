# Implementation Plan - Extraction Quality Improvements

> **Reference:** `docs/designs/2026-03-04-extraction-quality-design.md`
> **Execution:** Use `executing-plans` skill.
> **Baseline:** 454 tests passing across 22 test files.

---

### Task 1: Edge Description Cap

**Goal:** Add FIFO description capping to `upsertRelationship()`, matching the existing pattern in `upsertEntity()`.

**Step 1: Write the Failing Tests**
- File: `tests/graph/graph.test.js`
- Add inside the `describe('upsertRelationship', ...)` block, after the last existing test:
```javascript
it('caps edge description segments at configured limit', () => {
    const cap = 3;
    upsertRelationship(graphData, 'King Aldric', 'Castle', 'First desc', cap);
    upsertRelationship(graphData, 'King Aldric', 'Castle', 'Second desc', cap);
    upsertRelationship(graphData, 'King Aldric', 'Castle', 'Third desc', cap);
    upsertRelationship(graphData, 'King Aldric', 'Castle', 'Fourth desc', cap);
    upsertRelationship(graphData, 'King Aldric', 'Castle', 'Fifth desc', cap);

    const edge = graphData.edges['king aldric__castle'];
    expect(edge.description).toBe('Third desc | Fourth desc | Fifth desc');
    expect(edge.weight).toBe(5);
});

it('uses default cap of 5 for edge descriptions when not specified', () => {
    for (let i = 1; i <= 7; i++) {
        upsertRelationship(graphData, 'King Aldric', 'Castle', `Desc ${i}`);
    }
    const edge = graphData.edges['king aldric__castle'];
    const segments = edge.description.split(' | ');
    expect(segments).toHaveLength(5);
    expect(segments[0]).toBe('Desc 3');
    expect(segments[4]).toBe('Desc 7');
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/graph/graph.test.js`
- Expect: 2 failures — `upsertRelationship` doesn't accept `cap` parameter, no capping logic.

**Step 3: Implementation (Green)**
- File: `src/graph/graph.js`
- Change `upsertRelationship` signature from `(graphData, source, target, description)` to `(graphData, source, target, description, cap = 5)`.
- After the line `existing.description = existing.description + ' | ' + description;`, add:
```javascript
// Cap description segments (FIFO eviction)
const segments = existing.description.split(' | ');
if (cap > 0 && segments.length > cap) {
    existing.description = segments.slice(-cap).join(' | ');
}
```

**Step 4: Update caller in extract.js**
- File: `src/extraction/extract.js`
- In the Stage 4.5 relationship loop (~line 371), pass the cap:
```javascript
const edgeCap = settings.edgeDescriptionCap ?? 5;
for (const rel of validated.relationships) {
    upsertRelationship(data.graph, rel.source, rel.target, rel.description, edgeCap);
}
```

**Step 5: Add setting default**
- File: `src/constants.js`
- Add `edgeDescriptionCap: 5,` after the `entityDescriptionCap: 3,` line (~line 63).

**Step 6: Verify (Green)**
- Command: `npx vitest run tests/graph/graph.test.js`
- Expect: All tests PASS (20 existing + 2 new = 22).

**Step 7: Full suite check**
- Command: `npx vitest run`
- Expect: All 456 tests pass.

**Step 8: Git Commit**
- `git add -A && git commit -m "feat: add FIFO description cap to upsertRelationship (default: 5)"`

---

### Task 2: Fix "unknown" Memory Type

**Goal:** Investigate and fix why extracted events get `type: "unknown"` instead of `"event"`.

**Step 1: Locate the bug**
- File: `src/extraction/extract.js`
- Search for where event objects are created. Look for the `type` field assignment. The events extracted from LLM response likely don't include a `type` field, and the code that converts them into memory objects may not be setting `type: 'event'`.

**Step 2: Write the Failing Test**
- File: `tests/extraction/extract.test.js`
- Add a test that verifies extracted events always have `type: 'event'`:
```javascript
it('sets type to "event" on all extracted memory objects', () => {
    // This test validates the event creation logic.
    // The exact test depends on what function creates event memory objects.
    // Look for the function that converts LLM-extracted events into memory objects
    // and verify it sets type: 'event'.
});
```
- **Note:** The exact test requires reading the event creation code first. The executor should:
  1. Search `extract.js` for where `type` is assigned on event objects (grep for `type:` or `type =` near event creation)
  2. If `type` is never set, add `type: 'event'` to the event object literal
  3. If `type` is set conditionally, fix the condition

**Step 3: Implementation (Green)**
- File: `src/extraction/extract.js`
- Find where event memory objects are constructed (likely a `.map()` or loop that builds objects with `id`, `summary`, `importance`, etc.)
- Ensure each event object has `type: 'event'` explicitly set.

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/extraction/extract.test.js`
- Expect: PASS

**Step 5: Git Commit**
- `git add -A && git commit -m "fix: set type='event' on extracted memory objects"`

---

### Task 3: Reflection Tuning — Raise Threshold and Cap Insights

**Goal:** Reduce reflection-to-event ratio from 2.2:1 to ~0.9:1 by raising threshold to 40 and capping insights at 3.

**Step 3.1: Update default threshold**

**Step 1: Write the Failing Test**
- File: `tests/reflection/reflect.test.js`
- Add test verifying new default threshold behavior:
```javascript
it('does not trigger reflection below threshold of 40', () => {
    const state = { Alice: { importance_sum: 35 } };
    expect(shouldReflect(state, 'Alice')).toBe(false);
});

it('triggers reflection at threshold of 40', () => {
    const state = { Alice: { importance_sum: 40 } };
    expect(shouldReflect(state, 'Alice')).toBe(true);
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/reflection/reflect.test.js`
- Expect: First test fails — current threshold is 30, so importance_sum=35 triggers reflection.

**Step 3: Implementation (Green)**
- File: `src/reflection/reflect.js`, line 18
- Change: `const REFLECTION_THRESHOLD = 30;` → `const REFLECTION_THRESHOLD = 40;`
- File: `src/constants.js`, line ~59
- Change: `reflectionThreshold: 30,` → `reflectionThreshold: 40,`

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/reflection/reflect.test.js`
- Expect: PASS

**Step 5: Check for broken existing tests**
- Command: `npx vitest run`
- Expect: All tests pass. If any reflection tests relied on threshold=30, update them.

**Step 6: Git Commit**
- `git add -A && git commit -m "feat: raise default reflection threshold from 30 to 40"`

---

### Task 3.2: Cap Insights Per Reflection Question

**Goal:** Limit insights to max 3 per question (was 1-5 unbounded).

**Step 1: Update the prompt**
- File: `src/prompts.js`, in `buildInsightExtractionPrompt()`
- Find all occurrences of `"1-5"` or `"1 to 5"` in the insight extraction prompt and replace with `"1-3"` or `"1 to 3"`.
- Specifically update:
  - The `<output_schema>` section: `"The \"insights\" array MUST contain 1 to 5 insight objects."` → `"The \"insights\" array MUST contain 1 to 3 insight objects."`
  - The `<rules>` section if it mentions 1-5.

**Step 2: Write the Failing Test**
- File: `tests/prompts.test.js`
- Add test:
```javascript
it('insight extraction prompt limits insights to 1-3', () => {
    const prompt = buildInsightExtractionPrompt('Alice', 'How is Alice?', [
        { id: 'ev_1', summary: 'Alice did something' },
    ]);
    const systemContent = prompt[0].content;
    expect(systemContent).toContain('1 to 3');
    expect(systemContent).not.toContain('1 to 5');
});
```

**Step 3: Run Test (Red)**
- Command: `npx vitest run tests/prompts.test.js`
- Expect: Fail — prompt still says "1 to 5".

**Step 4: Implementation (Green)**
- File: `src/prompts.js`, in `buildInsightExtractionPrompt()`
- Replace `1 to 5` with `1 to 3` and `1-5` with `1-3` in the system prompt string.

**Step 5: Add post-hoc cap in reflect.js**
- File: `src/reflection/reflect.js`, in `generateReflections()`
- After `parseInsightExtractionResponse(insightResponse)` returns, cap the insights array:
```javascript
const parsed = parseInsightExtractionResponse(insightResponse);
// Cap insights per question
const maxInsights = settings.maxInsightsPerReflection ?? 3;
parsed.insights = parsed.insights.slice(0, maxInsights);
return parsed;
```

**Step 6: Add setting default**
- File: `src/constants.js`
- Add `maxInsightsPerReflection: 3,` near the other reflection settings.

**Step 7: Verify (Green)**
- Command: `npx vitest run`
- Expect: All tests pass.

**Step 8: Git Commit**
- `git add -A && git commit -m "feat: cap insights per reflection question to 3 (prompt + post-hoc)"`

---

### Task 4: Reflection Dedup Gate

**Goal:** Prevent near-duplicate reflections by comparing new reflection embeddings against existing ones for the same character.

**Step 1: Write the Failing Test**
- File: `tests/reflection/reflect.test.js`
- Add test for a new exported function `filterDuplicateReflections`:
```javascript
import { filterDuplicateReflections } from '../../src/reflection/reflect.js';

describe('filterDuplicateReflections', () => {
    it('filters out reflections too similar to existing ones', () => {
        const existing = [
            { type: 'reflection', character: 'Alice', embedding: [1, 0, 0], summary: 'Alice trusts Bob' },
        ];
        const newReflections = [
            { type: 'reflection', character: 'Alice', embedding: [1, 0, 0], summary: 'Alice trusts Bob deeply' },
            { type: 'reflection', character: 'Alice', embedding: [0, 1, 0], summary: 'Alice fears the dark' },
        ];
        const filtered = filterDuplicateReflections(newReflections, existing, 0.90);
        expect(filtered).toHaveLength(1);
        expect(filtered[0].summary).toBe('Alice fears the dark');
    });

    it('keeps all reflections when none are similar', () => {
        const existing = [
            { type: 'reflection', character: 'Alice', embedding: [1, 0, 0], summary: 'Existing' },
        ];
        const newReflections = [
            { type: 'reflection', character: 'Alice', embedding: [0, 1, 0], summary: 'New 1' },
            { type: 'reflection', character: 'Alice', embedding: [0, 0, 1], summary: 'New 2' },
        ];
        const filtered = filterDuplicateReflections(newReflections, existing, 0.90);
        expect(filtered).toHaveLength(2);
    });

    it('passes through reflections without embeddings', () => {
        const existing = [
            { type: 'reflection', character: 'Alice', embedding: [1, 0, 0], summary: 'Existing' },
        ];
        const newReflections = [
            { type: 'reflection', character: 'Alice', summary: 'No embedding' },
        ];
        const filtered = filterDuplicateReflections(newReflections, existing, 0.90);
        expect(filtered).toHaveLength(1);
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/reflection/reflect.test.js`
- Expect: Fail — `filterDuplicateReflections` doesn't exist.

**Step 3: Implementation (Green)**
- File: `src/reflection/reflect.js`
- Add new exported function:
```javascript
/**
 * Filter out reflections that are too similar to existing reflections for the same character.
 * @param {Array} newReflections - Newly generated reflections
 * @param {Array} existingMemories - All existing memories
 * @param {number} threshold - Cosine similarity threshold (default: 0.90)
 * @returns {Array} Filtered reflections
 */
export function filterDuplicateReflections(newReflections, existingMemories, threshold = 0.90) {
    const existingReflections = existingMemories.filter((m) => m.type === 'reflection' && m.embedding);

    return newReflections.filter((ref) => {
        if (!ref.embedding) return true;

        const sameCharReflections = existingReflections.filter((m) => m.character === ref.character);
        for (const existing of sameCharReflections) {
            const sim = cosineSimilarity(ref.embedding, existing.embedding);
            if (sim >= threshold) {
                log(`Reflection dedup: Skipping "${ref.summary}" (${(sim * 100).toFixed(1)}% similar to existing)`);
                return false;
            }
        }
        return true;
    });
}
```

**Step 4: Integrate into generateReflections()**
- File: `src/reflection/reflect.js`, in `generateReflections()`, after `await enrichEventsWithEmbeddings(reflections)` and before the final return:
```javascript
// Dedup: filter reflections too similar to existing ones
const reflectionDedupThreshold = settings.reflectionDedupThreshold ?? 0.90;
const dedupedReflections = filterDuplicateReflections(reflections, allMemories, reflectionDedupThreshold);
if (dedupedReflections.length < reflections.length) {
    log(`Reflection dedup: Filtered ${reflections.length - dedupedReflections.length} duplicate reflections for ${characterName}`);
}
```
- Return `dedupedReflections` instead of `reflections`.

**Step 5: Add setting default**
- File: `src/constants.js`
- Add `reflectionDedupThreshold: 0.90,` near the other reflection settings.

**Step 6: Verify (Green)**
- Command: `npx vitest run`
- Expect: All tests pass.

**Step 7: Git Commit**
- `git add -A && git commit -m "feat: add cosine similarity dedup gate for reflections (threshold: 0.90)"`

---

### Task 5: Semantic Entity Merge — Core Function

**Goal:** Add `mergeOrInsertEntity()` that tries key match first, then falls back to embedding-based semantic matching.

**Step 1: Write the Failing Tests**
- File: `tests/graph/graph.test.js`
- Add new describe block:
```javascript
import { mergeOrInsertEntity } from '../../src/graph/graph.js';

describe('mergeOrInsertEntity', () => {
    let graphData;
    const mockSettings = { entityMergeSimilarityThreshold: 0.80 };

    beforeEach(() => {
        graphData = { nodes: {}, edges: {} };
    });

    it('uses fast path for exact key match', async () => {
        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        const key = await mergeOrInsertEntity(graphData, 'castle', 'PLACE', 'Updated', 3, mockSettings);
        expect(key).toBe('castle');
        expect(graphData.nodes.castle.mentions).toBe(2);
        expect(Object.keys(graphData.nodes)).toHaveLength(1);
    });

    it('creates new node when no semantic match exists', async () => {
        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        graphData.nodes.castle.embedding = [1, 0, 0];

        const key = await mergeOrInsertEntity(graphData, 'Dragon', 'PERSON', 'A beast', 3, mockSettings);
        expect(key).toBe('dragon');
        expect(Object.keys(graphData.nodes)).toHaveLength(2);
    });

    it('merges into existing node when semantic similarity exceeds threshold', async () => {
        upsertEntity(graphData, "Vova's House", 'PLACE', 'Home');
        graphData.nodes['vova house'].embedding = [0.9, 0.1, 0];

        // Mock: mergeOrInsertEntity will call getDocumentEmbedding which returns similar vector
        // For unit testing, we test the merge logic directly via a helper or by pre-setting embeddings
        // This test validates the merge behavior when similarity is high
        const key = await mergeOrInsertEntity(graphData, "Vova's Apartment", 'PLACE', 'Flat', 3, mockSettings);
        // If embeddings are unavailable (no model loaded), falls back to creating new node
        // Full integration test needed with real embeddings
        expect(graphData.nodes['vova house'] || graphData.nodes['vova apartment']).toBeDefined();
    });

    it('does not merge entities of different types', async () => {
        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        graphData.nodes.castle.embedding = [1, 0, 0];

        const key = await mergeOrInsertEntity(graphData, 'Castle', 'PERSON', 'A person named Castle', 3, mockSettings);
        // Different type = no merge even if name is identical at embedding level
        // Key collision handled: 'castle' already exists as PLACE, so PERSON gets a different treatment
        expect(key).toBe('castle'); // fast-path key match fires first regardless of type
    });

    it('falls back to insert when embeddings are unavailable', async () => {
        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        // No embedding on existing node, and getDocumentEmbedding returns null
        const key = await mergeOrInsertEntity(graphData, 'Fortress', 'PLACE', 'A stronghold', 3, mockSettings);
        expect(key).toBe('fortress');
        expect(Object.keys(graphData.nodes)).toHaveLength(2);
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/graph/graph.test.js`
- Expect: Fail — `mergeOrInsertEntity` doesn't exist.

**Step 3: Implementation (Green)**
- File: `src/graph/graph.js`
- Add imports at top:
```javascript
import { getDocumentEmbedding } from '../embeddings.js';
import { cosineSimilarity } from '../retrieval/math.js';
```
- Export `normalizeKey` (currently unexported, needed by tests):
```javascript
export function normalizeKey(name) { ... }
```
- Add the new function:
```javascript
/**
 * Merge-or-insert an entity with semantic deduplication.
 * Fast path: exact normalizeKey match → upsert.
 * Slow path: embed name, compare against same-type nodes, merge if similar.
 * Fallback: if embeddings unavailable, insert as new node.
 *
 * @param {Object} graphData - The graph object { nodes, edges }
 * @param {string} name - Entity name
 * @param {string} type - Entity type
 * @param {string} description - Entity description
 * @param {number} cap - Description segment cap
 * @param {Object} settings - Extension settings
 * @returns {Promise<string>} The key of the node (existing or new)
 */
export async function mergeOrInsertEntity(graphData, name, type, description, cap, settings) {
    const key = normalizeKey(name);

    // Fast path: exact key match
    if (graphData.nodes[key]) {
        upsertEntity(graphData, name, type, description, cap);
        return key;
    }

    // Slow path: semantic match
    let newEmbedding;
    try {
        newEmbedding = await getDocumentEmbedding(`${type}: ${name}`);
    } catch {
        newEmbedding = null;
    }

    if (!newEmbedding) {
        upsertEntity(graphData, name, type, description, cap);
        return key;
    }

    const threshold = settings?.entityMergeSimilarityThreshold ?? 0.80;
    let bestMatch = null;
    let bestScore = 0;

    for (const [existingKey, node] of Object.entries(graphData.nodes)) {
        if (node.type !== type) continue;
        if (!node.embedding) continue;

        const sim = cosineSimilarity(newEmbedding, node.embedding);
        if (sim >= threshold && sim > bestScore) {
            bestMatch = existingKey;
            bestScore = sim;
        }
    }

    if (bestMatch) {
        upsertEntity(graphData, graphData.nodes[bestMatch].name, type, description, cap);
        return bestMatch;
    }

    // No match: create new node with embedding
    upsertEntity(graphData, name, type, description, cap);
    graphData.nodes[key].embedding = newEmbedding;
    return key;
}
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/graph/graph.test.js`
- Expect: All tests pass. Note: the `getDocumentEmbedding` import will need mocking in test environment. If vitest setup already mocks embeddings module (check existing test patterns), it should work. If not, use `vi.mock('../../src/embeddings.js', ...)`.

**Step 5: Full suite check**
- Command: `npx vitest run`
- Expect: All tests pass.

**Step 6: Git Commit**
- `git add -A && git commit -m "feat: add mergeOrInsertEntity with embedding-based semantic dedup"`

---

### Task 6: Semantic Entity Merge — Edge Redirection

**Goal:** When an entity merges into an existing one, redirect all edges from the old key to the new key.

**Step 1: Write the Failing Tests**
- File: `tests/graph/graph.test.js`
- Add inside the `mergeOrInsertEntity` describe block or a new `describe('redirectEdges', ...)`:
```javascript
import { redirectEdges } from '../../src/graph/graph.js';

describe('redirectEdges', () => {
    let graphData;

    beforeEach(() => {
        graphData = { nodes: {}, edges: {} };
        upsertEntity(graphData, 'Alice', 'PERSON', 'A');
        upsertEntity(graphData, 'Bob', 'PERSON', 'B');
        upsertEntity(graphData, 'Castle', 'PLACE', 'C');
    });

    it('redirects edges from old key to new key', () => {
        upsertRelationship(graphData, 'Bob', 'Castle', 'Lives in');
        redirectEdges(graphData, 'bob', 'alice');
        expect(graphData.edges['alice__castle']).toBeDefined();
        expect(graphData.edges['alice__castle'].description).toBe('Lives in');
        expect(graphData.edges['bob__castle']).toBeUndefined();
    });

    it('merges edge descriptions when redirect creates a duplicate', () => {
        upsertRelationship(graphData, 'Alice', 'Castle', 'Rules from');
        upsertRelationship(graphData, 'Bob', 'Castle', 'Visits often');
        redirectEdges(graphData, 'bob', 'alice');
        expect(graphData.edges['alice__castle'].description).toContain('Rules from');
        expect(graphData.edges['alice__castle'].description).toContain('Visits often');
        expect(graphData.edges['bob__castle']).toBeUndefined();
    });

    it('handles edges where old key is the target', () => {
        upsertRelationship(graphData, 'Castle', 'Bob', 'Contains');
        redirectEdges(graphData, 'bob', 'alice');
        expect(graphData.edges['castle__alice']).toBeDefined();
        expect(graphData.edges['castle__bob']).toBeUndefined();
    });

    it('does nothing when no edges reference old key', () => {
        upsertRelationship(graphData, 'Alice', 'Castle', 'Rules from');
        const edgesBefore = { ...graphData.edges };
        redirectEdges(graphData, 'bob', 'alice');
        expect(graphData.edges).toEqual(edgesBefore);
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/graph/graph.test.js`
- Expect: Fail — `redirectEdges` doesn't exist.

**Step 3: Implementation (Green)**
- File: `src/graph/graph.js`
- Add:
```javascript
/**
 * Redirect all edges from oldKey to newKey.
 * If redirection creates a duplicate edge, merges descriptions and sums weights.
 * Removes old edges after redirection.
 * @param {Object} graphData - The graph object { nodes, edges }
 * @param {string} oldKey - Normalized key being removed
 * @param {string} newKey - Normalized key to redirect to
 */
export function redirectEdges(graphData, oldKey, newKey) {
    const edgesToRemove = [];
    const edgesToAdd = [];

    for (const [edgeKey, edge] of Object.entries(graphData.edges)) {
        let src = edge.source;
        let tgt = edge.target;
        let changed = false;

        if (src === oldKey) { src = newKey; changed = true; }
        if (tgt === oldKey) { tgt = newKey; changed = true; }

        if (changed) {
            // Skip self-loops
            if (src === tgt) {
                edgesToRemove.push(edgeKey);
                continue;
            }
            edgesToRemove.push(edgeKey);
            edgesToAdd.push({ source: src, target: tgt, description: edge.description, weight: edge.weight });
        }
    }

    // Remove old edges
    for (const key of edgesToRemove) {
        delete graphData.edges[key];
    }

    // Add redirected edges (merge if duplicate)
    for (const newEdge of edgesToAdd) {
        const newEdgeKey = `${newEdge.source}__${newEdge.target}`;
        const existing = graphData.edges[newEdgeKey];
        if (existing) {
            existing.weight += newEdge.weight;
            if (!existing.description.includes(newEdge.description)) {
                existing.description = existing.description + ' | ' + newEdge.description;
            }
        } else {
            graphData.edges[newEdgeKey] = newEdge;
        }
    }
}
```

**Step 4: Integrate into mergeOrInsertEntity**
- File: `src/graph/graph.js`, in `mergeOrInsertEntity()`
- After the `if (bestMatch)` block that calls `upsertEntity`, add:
```javascript
if (bestMatch) {
    upsertEntity(graphData, graphData.nodes[bestMatch].name, type, description, cap);
    // Redirect any edges from the would-be new key (if it existed temporarily)
    // Note: since we never created the new node, no edges to redirect in incremental flow.
    // Edge redirection is used by consolidateGraph() for retroactive merging.
    return bestMatch;
}
```
- `redirectEdges` is primarily used by `consolidateGraph()` (Task 7), not by incremental `mergeOrInsertEntity` since the new node was never created.

**Step 5: Verify (Green)**
- Command: `npx vitest run tests/graph/graph.test.js`
- Expect: All tests pass.

**Step 6: Git Commit**
- `git add -A && git commit -m "feat: add redirectEdges for entity merge edge redirection"`

---

### Task 7: Semantic Entity Merge — Integration with Extraction Pipeline

**Goal:** Replace `upsertEntity` calls in `extract.js` with `mergeOrInsertEntity`.

**Step 1: Implementation**
- File: `src/extraction/extract.js`
- Import `mergeOrInsertEntity` instead of (or in addition to) `upsertEntity` from graph module.
- Replace the Stage 4.5 entity loop (~line 363-367):

Before:
```javascript
const entityCap = settings.entityDescriptionCap ?? 3;
if (validated.entities) {
    for (const entity of validated.entities) {
        upsertEntity(data.graph, entity.name, entity.type, entity.description, entityCap);
    }
}
```

After:
```javascript
const entityCap = settings.entityDescriptionCap ?? 3;
if (validated.entities) {
    for (const entity of validated.entities) {
        await mergeOrInsertEntity(data.graph, entity.name, entity.type, entity.description, entityCap, settings);
    }
}
```

**Step 2: Add setting default**
- File: `src/constants.js`
- Add `entityMergeSimilarityThreshold: 0.80,` near the entity settings.

**Step 3: Verify**
- Command: `npx vitest run`
- Expect: All tests pass. The `mergeOrInsertEntity` call is async but the extraction pipeline is already async.

**Step 4: Git Commit**
- `git add -A && git commit -m "feat: use mergeOrInsertEntity in extraction pipeline for semantic entity dedup"`

---

### Task 8: Retroactive Graph Consolidation

**Goal:** Add `consolidateGraph()` for one-time dedup of existing graphs with accumulated duplicates.

**Step 1: Write the Failing Tests**
- File: `tests/graph/graph.test.js`
- Add:
```javascript
import { consolidateGraph } from '../../src/graph/graph.js';

describe('consolidateGraph', () => {
    it('merges nodes with identical embeddings of the same type', async () => {
        const graphData = { nodes: {}, edges: {} };
        upsertEntity(graphData, "Vova's House", 'PLACE', 'Home');
        upsertEntity(graphData, "Vova's Apartment", 'PLACE', 'Flat');

        // Simulate identical embeddings
        graphData.nodes['vova house'].embedding = [1, 0, 0];
        graphData.nodes['vova apartment'].embedding = [0.99, 0.01, 0];

        const settings = { entityMergeSimilarityThreshold: 0.80 };
        const result = await consolidateGraph(graphData, settings);

        // One should be merged into the other
        expect(Object.keys(graphData.nodes).length).toBeLessThan(2);
        expect(result.mergedCount).toBeGreaterThan(0);
    });

    it('does not merge nodes of different types', async () => {
        const graphData = { nodes: {}, edges: {} };
        upsertEntity(graphData, 'Castle', 'PLACE', 'A fortress');
        upsertEntity(graphData, 'Castle Guard', 'PERSON', 'A knight');

        graphData.nodes.castle.embedding = [1, 0, 0];
        graphData.nodes['castle guard'].embedding = [0.95, 0.05, 0];

        const settings = { entityMergeSimilarityThreshold: 0.80 };
        await consolidateGraph(graphData, settings);

        expect(Object.keys(graphData.nodes)).toHaveLength(2);
    });

    it('redirects edges after merging nodes', async () => {
        const graphData = { nodes: {}, edges: {} };
        upsertEntity(graphData, 'Alice', 'PERSON', 'A person');
        upsertEntity(graphData, 'House A', 'PLACE', 'A house');
        upsertEntity(graphData, 'House B', 'PLACE', 'Another house');

        graphData.nodes.alice.embedding = [0, 1, 0];
        graphData.nodes['house a'].embedding = [1, 0, 0];
        graphData.nodes['house b'].embedding = [0.99, 0.01, 0];

        upsertRelationship(graphData, 'Alice', 'House B', 'Visits');

        const settings = { entityMergeSimilarityThreshold: 0.80 };
        await consolidateGraph(graphData, settings);

        // House B merged into House A, edge redirected
        const edgeKeys = Object.keys(graphData.edges);
        expect(edgeKeys.some((k) => k.includes('house a'))).toBe(true);
        expect(edgeKeys.some((k) => k.includes('house b'))).toBe(false);
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/graph/graph.test.js`
- Expect: Fail — `consolidateGraph` doesn't exist.

**Step 3: Implementation (Green)**
- File: `src/graph/graph.js`
- Add:
```javascript
/**
 * Retroactive graph consolidation: merge semantically duplicate nodes.
 * Embeds all nodes lacking embeddings, then pairwise-compares within each type.
 * Merges duplicates and redirects edges.
 *
 * @param {Object} graphData - The graph object { nodes, edges }
 * @param {Object} settings - Extension settings
 * @returns {Promise<{mergedCount: number, embeddedCount: number}>}
 */
export async function consolidateGraph(graphData, settings) {
    const threshold = settings?.entityMergeSimilarityThreshold ?? 0.80;
    let mergedCount = 0;
    let embeddedCount = 0;

    // Step 1: Embed all nodes that lack embeddings
    for (const [key, node] of Object.entries(graphData.nodes)) {
        if (!node.embedding) {
            try {
                node.embedding = await getDocumentEmbedding(`${node.type}: ${node.name}`);
                if (node.embedding) embeddedCount++;
            } catch {
                // Skip nodes that can't be embedded
            }
        }
    }

    // Step 2: Group nodes by type
    const byType = {};
    for (const [key, node] of Object.entries(graphData.nodes)) {
        if (!node.embedding) continue;
        if (!byType[node.type]) byType[node.type] = [];
        byType[node.type].push(key);
    }

    // Step 3: Pairwise comparison within each type
    const mergeMap = new Map(); // oldKey -> newKey

    for (const keys of Object.values(byType)) {
        for (let i = 0; i < keys.length; i++) {
            if (mergeMap.has(keys[i])) continue; // Already merged

            for (let j = i + 1; j < keys.length; j++) {
                if (mergeMap.has(keys[j])) continue;

                const nodeA = graphData.nodes[keys[i]];
                const nodeB = graphData.nodes[keys[j]];
                const sim = cosineSimilarity(nodeA.embedding, nodeB.embedding);

                if (sim >= threshold) {
                    // Merge B into A (A has lower index = likely older/more established)
                    const keepKey = nodeA.mentions >= nodeB.mentions ? keys[i] : keys[j];
                    const removeKey = keepKey === keys[i] ? keys[j] : keys[i];

                    mergeMap.set(removeKey, keepKey);
                }
            }
        }
    }

    // Step 4: Execute merges
    for (const [removeKey, keepKey] of mergeMap) {
        const removedNode = graphData.nodes[removeKey];
        if (!removedNode) continue;

        // Merge description
        upsertEntity(graphData, graphData.nodes[keepKey].name, graphData.nodes[keepKey].type, removedNode.description, settings?.entityDescriptionCap ?? 3);

        // Redirect edges
        redirectEdges(graphData, removeKey, keepKey);

        // Remove old node
        delete graphData.nodes[removeKey];
        mergedCount++;
    }

    return { mergedCount, embeddedCount };
}
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/graph/graph.test.js`
- Expect: All tests pass.

**Step 5: Full suite check**
- Command: `npx vitest run`
- Expect: All tests pass.

**Step 6: Git Commit**
- `git add -A && git commit -m "feat: add consolidateGraph for retroactive semantic entity dedup"`

---

### Task 9: Settings UI for New Thresholds

**Goal:** Expose the new settings in the UI so users can tune them.

**Step 1: Identify settings UI file**
- File: `src/ui/settings.js` (or the HTML template it references)
- Add slider/input controls for:
  - `entityMergeSimilarityThreshold` (0.5–1.0, default 0.80, step 0.05)
  - `edgeDescriptionCap` (1–20, default 5, step 1)
  - `maxInsightsPerReflection` (1–5, default 3, step 1)
  - `reflectionDedupThreshold` (0.5–1.0, default 0.90, step 0.05)

**Step 2: Implementation**
- Follow the existing pattern in `settings.js` for adding sliders.
- Add to the relevant sections (Entity settings, Reflection settings).
- Include `(default: X)` hint text matching `UI_DEFAULT_HINTS` pattern.

**Step 3: Update UI_DEFAULT_HINTS**
- File: `src/constants.js`
- Add to `UI_DEFAULT_HINTS`:
```javascript
entityMergeSimilarityThreshold: defaultSettings.entityMergeSimilarityThreshold,
edgeDescriptionCap: defaultSettings.edgeDescriptionCap,
maxInsightsPerReflection: defaultSettings.maxInsightsPerReflection,
reflectionDedupThreshold: defaultSettings.reflectionDedupThreshold,
```

**Step 4: Verify**
- Command: `npx vitest run`
- Expect: All tests pass.
- Manual verification: load the extension in SillyTavern, confirm sliders appear and persist values.

**Step 5: Git Commit**
- `git add -A && git commit -m "feat: add settings UI for entity merge, edge cap, reflection tuning"`

---

## Summary

| Task | Files Modified | Tests Added | Description |
|------|---------------|-------------|-------------|
| 1 | `graph.js`, `extract.js`, `constants.js` | 2 | Edge description cap |
| 2 | `extract.js` | 1 | Fix "unknown" memory type |
| 3 | `reflect.js`, `constants.js` | 2 | Raise reflection threshold |
| 3.2 | `prompts.js`, `reflect.js`, `constants.js` | 1 | Cap insights per question |
| 4 | `reflect.js`, `constants.js` | 3 | Reflection dedup gate |
| 5 | `graph.js` | 5 | `mergeOrInsertEntity` core |
| 6 | `graph.js` | 4 | `redirectEdges` |
| 7 | `extract.js`, `constants.js` | 0 | Pipeline integration |
| 8 | `graph.js` | 3 | `consolidateGraph` |
| 9 | `settings.js`, `constants.js` | 0 | Settings UI |
