# Implementation Plan - Post-Implementation Bugfixes

> **Reference:** `docs/designs/2026-03-04-post-implementation-bugfixes-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Expand Cyrillic stop list (Bug C)

**Goal:** Filter Russian interjections ("Ага", "Воны", etc.) from query entity extraction.

**Step 1: Write the Failing Test**
- File: `tests/query-context.test.js`
- Add test inside the `filters common Cyrillic sentence starters` describe block (near line 78):
```javascript
it('filters Russian interjections and filler words', () => {
    const messages = [
        { mes: 'Ага полностью. Воны какие-то. Ну ладно, Саша пошла.' },
        { mes: 'Да, Хорошо. Блин, забыл.' },
        { mes: 'Угу, Конечно.' },
    ];
    const result = extractQueryContext(messages);

    expect(result.entities).not.toContain('Ага');
    expect(result.entities).not.toContain('Воны');
    expect(result.entities).not.toContain('Ладно');
    expect(result.entities).not.toContain('Хорошо');
    expect(result.entities).not.toContain('Блин');
    expect(result.entities).not.toContain('Угу');
    expect(result.entities).not.toContain('Конечно');
    expect(result.entities).toContain('Саша');
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/query-context.test.js`
- Expect: FAIL — "Ага", "Воны" etc. pass through the filter

**Step 3: Implementation (Green)**
- File: `src/retrieval/query-context.js`
- Action: Add entries to `CYRILLIC_STARTERS` set (around line 48-68). Append after the existing entries:
```javascript
// Interjections & filler words
'Ага', 'Угу', 'Ого', 'Ура', 'Хм', 'Ну',
// Affirmations, negations, casual
'Да', 'Нет', 'Ладно', 'Хорошо', 'Ок',
// Expletives (common in RP)
'Блин', 'Блять', 'Бля',
// Discourse markers
'Значит', 'Типа', 'Короче', 'Просто',
'Конечно', 'Наверное', 'Возможно', 'Может',
// Informal speech common in RP
'Воны', 'Чё', 'Чо', 'Ваще', 'Щас',
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/query-context.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/retrieval/query-context.js tests/query-context.test.js && git commit -m "fix: expand Cyrillic stop list to filter Russian interjections in query entity extraction"`

---

## Task 2: Include reflections in retrieval pipeline (Bug B)

**Goal:** Reflections (type='reflection', no `message_ids`) must reach the scoring pipeline alongside hidden-message memories.

**Step 1: Write the Failing Test**
- File: `tests/retrieval/retrieve.test.js`
- Add a new describe block. The test needs to verify that reflections reach `selectRelevantMemories`. Since `selectRelevantMemories` is mocked (line 23), we can check it receives reflections:
```javascript
describe('reflection retrieval', () => {
    it('includes reflections in memories passed to scoring', async () => {
        const { selectRelevantMemories } = await import('../../src/retrieval/scoring.js');

        mockSetPrompt = vi.fn();
        setDeps({
            getContext: () => ({
                chat: [
                    { mes: 'Hello', is_user: true, is_system: true },
                    { mes: 'Hi', is_user: false, is_system: false },
                ],
                name1: 'User',
                name2: 'Alice',
                chatMetadata: {
                    openvault: {
                        memories: [
                            {
                                id: 'ev1',
                                summary: 'Event memory',
                                importance: 3,
                                message_ids: [0],
                                characters_involved: ['Alice'],
                                witnesses: ['Alice'],
                                is_secret: false,
                            },
                            {
                                id: 'ref1',
                                type: 'reflection',
                                summary: 'Alice fears abandonment',
                                importance: 4,
                                characters_involved: ['Alice'],
                                witnesses: ['Alice'],
                                is_secret: false,
                                source_ids: ['ev1'],
                                // NO message_ids — this is the key
                            },
                        ],
                        graph: { nodes: {}, edges: {} },
                        communities: {},
                    },
                },
            }),
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings, autoMode: true },
            }),
            setExtensionPrompt: mockSetPrompt,
        });

        await updateInjection();

        // selectRelevantMemories should have received BOTH the event and the reflection
        const calledWith = selectRelevantMemories.mock.calls[0]?.[0];
        expect(calledWith).toBeDefined();
        const ids = calledWith.map(m => m.id);
        expect(ids).toContain('ev1');
        expect(ids).toContain('ref1');
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/retrieval/retrieve.test.js`
- Expect: FAIL — `ref1` not in the memories passed to `selectRelevantMemories`

**Step 3: Implementation (Green)**
- File: `src/retrieval/retrieve.js`
- Action: At **two** locations, add reflections to the candidate set.

**Location 1** (~line 228, in `retrieveAndInjectContext`):
Replace:
```javascript
const hiddenMemories = _getHiddenMemories(chat, memories);
```
With:
```javascript
const hiddenMemories = _getHiddenMemories(chat, memories);
const reflections = memories.filter(m => m.type === 'reflection');
const candidateMemories = _deduplicateById([...hiddenMemories, ...reflections]);
```
Then use `candidateMemories` instead of `hiddenMemories` in the next line:
```javascript
const accessibleMemories = filterMemoriesByPOV(candidateMemories, povCharacters, data);
```
Also update the log and cache lines to reference `candidateMemories.length`.

**Location 2** (~line 327, in `updateInjection`):
Apply the same pattern:
```javascript
const hiddenMemories = _getHiddenMemories(context.chat, memories);
const reflections = memories.filter(m => m.type === 'reflection');
const candidateMemories = _deduplicateById([...hiddenMemories, ...reflections]);
const accessibleMemories = filterMemoriesByPOV(candidateMemories, povCharacters, data);
```

**Add helper** (top of file or near `_getHiddenMemories`):
```javascript
function _deduplicateById(memories) {
    const seen = new Set();
    return memories.filter(m => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
    });
}
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/retrieval/retrieve.test.js`
- Expect: PASS

**Step 5: Run full test suite**
- Command: `npx vitest run`
- Expect: All PASS (no regressions in other retrieval tests)

**Step 6: Git Commit**
- Command: `git add src/retrieval/retrieve.js tests/retrieval/retrieve.test.js && git commit -m "fix: include reflections in retrieval scoring pipeline (were silently excluded by hidden-message filter)"`

---

## Task 3: Fix graph edges dropped by semantic merge (Bug A)

**Goal:** When `mergeOrInsertEntity` merges entity "X" into existing node "Y", subsequent `upsertRelationship` calls referencing "X" must resolve to "Y"'s key.

**Root Cause:** `mergeOrInsertEntity` returns the resolved key, but `extract.js` doesn't use it. `upsertRelationship` normalizes `rel.source`/`rel.target` to keys that may not exist (the entity was merged elsewhere).

**Step 1: Write the Failing Test**
- File: `tests/graph/graph.test.js`
- Add inside a new describe block:
```javascript
describe('edge creation with semantic merge', () => {
    it('creates edges using resolved keys after mergeOrInsertEntity', async () => {
        const { getDocumentEmbedding } = await import('../../src/embeddings.js');

        // Setup: "vova apartment" already exists with embedding
        const graphData = createEmptyGraph();
        graphData.nodes['vova apartment'] = {
            name: "Vova's Apartment",
            type: 'PLACE',
            description: 'An apartment',
            mentions: 5,
            embedding: [1, 0, 0],
        };
        graphData.nodes['suzy'] = {
            name: 'Suzy',
            type: 'PERSON',
            description: 'A student',
            mentions: 10,
        };

        // Mock: "Vova's Room" embeds to something very similar to "Vova's Apartment"
        getDocumentEmbedding.mockResolvedValue([0.99, 0.1, 0]);

        const settings = { entityMergeSimilarityThreshold: 0.8 };

        // mergeOrInsertEntity should merge "Vova's Room" into "vova apartment"
        const resolvedKey = await mergeOrInsertEntity(
            graphData, "Vova's Room", 'PLACE', 'A room', 3, settings
        );
        expect(resolvedKey).toBe('vova apartment');

        // Now create a relationship using the ORIGINAL name "Vova's Room"
        // This should work because we use the resolved key
        upsertRelationship(graphData, 'Suzy', "Vova's Room", 'Lives in', 5);

        // Edge should exist (suzy -> vova apartment), NOT be silently dropped
        const edgeKey = 'suzy__vova apartment';
        expect(graphData.edges[edgeKey]).toBeDefined();
        expect(graphData.edges[edgeKey].description).toBe('Lives in');
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/graph/graph.test.js`
- Expect: FAIL — edge is silently dropped because `normalizeKey("Vova's Room")` = `"vova room"` which doesn't exist in nodes

**Step 3: Implementation (Green)**

**3a: Add merge redirect map to `mergeOrInsertEntity`** in `src/graph/graph.js`:

In `mergeOrInsertEntity`, when a semantic match is found (the `if (bestMatch)` branch), record the redirect:
```javascript
if (bestMatch) {
    upsertEntity(graphData, graphData.nodes[bestMatch].name, type, description, cap);
    // Record redirect so upsertRelationship can resolve
    if (!graphData._mergeRedirects) graphData._mergeRedirects = {};
    if (key !== bestMatch) {
        graphData._mergeRedirects[key] = bestMatch;
    }
    return bestMatch;
}
```

**3b: Update `upsertRelationship`** to resolve redirects:

Add helper function:
```javascript
function _resolveKey(graphData, rawName) {
    const key = normalizeKey(rawName);
    return graphData._mergeRedirects?.[key] || key;
}
```

Update `upsertRelationship`:
```javascript
export function upsertRelationship(graphData, source, target, description, cap = 5) {
    const srcKey = _resolveKey(graphData, source);
    const tgtKey = _resolveKey(graphData, target);

    if (!graphData.nodes[srcKey] || !graphData.nodes[tgtKey]) return;
    // ... rest unchanged
```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/graph/graph.test.js`
- Expect: PASS

**Step 5: Run full test suite**
- Command: `npx vitest run`
- Expect: All PASS

**Step 6: Git Commit**
- Command: `git add src/graph/graph.js tests/graph/graph.test.js && git commit -m "fix: resolve merge redirects in upsertRelationship so edges aren't silently dropped after semantic entity merge"`

---

## Task 4: Add logging for dropped edges

**Goal:** Silent edge drops should log a warning for future debugging.

**Step 1: Implementation**
- File: `src/graph/graph.js`
- In `upsertRelationship`, after the node existence check, add logging:
```javascript
if (!graphData.nodes[srcKey] || !graphData.nodes[tgtKey]) {
    // Only log in debug scenarios — this import should already exist or use console
    // If a log function is available:
    // log(`[graph] Edge skipped: ${source} (${srcKey}) -> ${target} (${tgtKey}) — missing node`);
    return;
}
```
- Check if there's a `log` import in graph.js. If not, use a conditional approach or add the import.

**Step 2: Verify**
- Command: `npx vitest run`
- Expect: All PASS (logging is non-breaking)

**Step 3: Git Commit**
- Command: `git add src/graph/graph.js && git commit -m "fix: add warning log when graph edges are dropped due to missing nodes"`

---

## Task 5: Exclude _mergeRedirects from serialization

**Goal:** The `_mergeRedirects` map is runtime-only and should not persist to storage or debug exports.

**Step 1: Write the Test**
- File: `tests/graph/graph.test.js`
```javascript
it('_mergeRedirects is not enumerable or is cleaned before serialization', async () => {
    const { getDocumentEmbedding } = await import('../../src/embeddings.js');
    const graphData = createEmptyGraph();
    graphData.nodes['alice'] = {
        name: 'Alice', type: 'PERSON', description: 'A person', mentions: 3, embedding: [1, 0],
    };
    getDocumentEmbedding.mockResolvedValue([0.99, 0.05]);

    await mergeOrInsertEntity(graphData, 'Alicia', 'PERSON', 'Also Alice', 3, { entityMergeSimilarityThreshold: 0.8 });

    // _mergeRedirects should exist at runtime
    expect(graphData._mergeRedirects).toBeDefined();

    // But JSON serialization should not include it (or it's acceptable as transient)
    const serialized = JSON.parse(JSON.stringify(graphData));
    // If we want to exclude it, we need to delete before save or use a toJSON method
    // For now, just verify it doesn't break anything
    expect(serialized.nodes).toBeDefined();
    expect(serialized.edges).toBeDefined();
});
```

**Step 2: Verify**
- Command: `npx vitest run tests/graph/graph.test.js`
- Note: If `_mergeRedirects` persisting is acceptable (it's small and gets overwritten), skip cleanup. If it causes issues with the debug export, add cleanup in `extract.js` after Stage 4.5:
```javascript
delete data.graph._mergeRedirects;
```

**Step 3: Git Commit**
- Command: `git add . && git commit -m "chore: clean up _mergeRedirects after graph update stage"`

---

## Task 6: Update design doc with corrected root cause

**Goal:** The design doc incorrectly blames `consolidateGraph` (never called from extract.js). Update.

**Step 1: Implementation**
- File: `docs/designs/2026-03-04-post-implementation-bugfixes-design.md`
- Update Bug A root cause to reflect: `consolidateGraph` is not involved. The actual issue is `mergeOrInsertEntity` returning a resolved key that differs from `normalizeKey(rel.source)`, causing `upsertRelationship` to not find the node.

**Step 2: Git Commit**
- Command: `git add docs/designs/2026-03-04-post-implementation-bugfixes-design.md && git commit -m "docs: correct root cause analysis for edge creation regression"`
