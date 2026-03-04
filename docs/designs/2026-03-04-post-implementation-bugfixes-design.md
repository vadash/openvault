# Design: Post-Implementation Bugfixes

Follow-up to `2026-03-04-prompts-quality-improvements-design.md`. Three regressions/bugs discovered via debug export analysis.

## 1. Problem Statement

After implementing the quality improvements design, debug export reveals:
1. **0 graph edges** — entity semantic merging silently breaks edge creation
2. **0 reflections scored** — reflections are filtered out before reaching the scoring pipeline
3. **Garbage query entities** — Russian interjections ("Ага", "Воны") extracted as entity names

## 2. Goals & Non-Goals

### Must Do
- Fix edge creation regression caused by `mergeOrInsertEntity` / `consolidateGraph`
- Fix reflection exclusion from retrieval scoring
- Expand Cyrillic stop list to filter interjections

### Won't Do
- Rearchitect entity merging — just fix the edge creation order
- Add `message_ids` to reflections — wrong fix; fix the filter instead
- Build a full NLP pipeline for entity extraction — stop list expansion is sufficient

## 3. Bug Analysis & Fixes

### Bug A: Graph Edges Silently Dropped

**Root Cause:** `mergeOrInsertEntity` (commit `6e0f857`) + `consolidateGraph` (commit `c43f84f`) delete old entity nodes during semantic merging. When `upsertRelationship` runs afterward, it checks `if (!graphData.nodes[srcKey] || !graphData.nodes[tgtKey]) return;` — silently skipping edges whose nodes were merged away.

**Fix:** Two changes:

1. `upsertRelationship` must resolve merged keys. When `mergeOrInsertEntity` merges entity A into entity B, store a redirect map. `upsertRelationship` consults this map before looking up nodes.

```javascript
// graph.js — maintain merge redirect map on graphData
graphData._mergeRedirects = graphData._mergeRedirects || {};

// In mergeOrInsertEntity, when merging:
graphData._mergeRedirects[removedKey] = keptKey;

// In upsertRelationship:
function resolveKey(graphData, key) {
    const normalized = normalizeKey(key);
    return graphData._mergeRedirects?.[normalized] || normalized;
}

export function upsertRelationship(graphData, source, target, description, cap) {
    const srcKey = resolveKey(graphData, source);
    const tgtKey = resolveKey(graphData, target);
    if (!graphData.nodes[srcKey] || !graphData.nodes[tgtKey]) {
        log(`[graph] Edge skipped: missing node ${srcKey} or ${tgtKey}`);
        return; // Now with logging
    }
    // ... existing edge creation
}
```

2. In `extract.js`, collect the returned keys from `mergeOrInsertEntity` and use those resolved keys when calling `upsertRelationship`:

```javascript
// Stage 4.5 in extract.js
const entityKeyMap = {};
for (const entity of validated.entities) {
    const resolvedKey = await mergeOrInsertEntity(
        data.graph, entity.name, entity.type, entity.description, entityCap, settings
    );
    entityKeyMap[entity.name.toLowerCase()] = resolvedKey;
}

for (const rel of validated.relationships) {
    // Use original names — upsertRelationship will resolve via redirect map
    upsertRelationship(data.graph, rel.source, rel.target, rel.description, edgeCap);
}
```

**Alternative (simpler):** Process ALL relationships BEFORE running `consolidateGraph`. If consolidation only runs periodically (not per-extraction), edges would already exist before nodes get merged. Then `consolidateGraph` must also migrate edges when merging nodes.

### Bug B: Reflections Excluded from Retrieval

**Root Cause:** `_getHiddenMemories()` in `src/retrieval/retrieve.js:43-48` filters out any memory without `message_ids`. Reflections are synthesized insights — they have no `message_ids` by design.

```javascript
function _getHiddenMemories(chat, memories) {
    return memories.filter((m) => {
        if (!m.message_ids?.length) return false;  // ← kills all reflections
        const minId = Math.min(...m.message_ids);
        return chat[minId]?.is_system;
    });
}
```

The function name is misleading — it identifies memories tied to *system messages* (hidden from the user). The return value is used to **exclude** these memories. But the filter's `!m.message_ids?.length` check also catches reflections as collateral damage.

**Fix:** Reflections should pass through this filter unchanged (they can't be "hidden" since they aren't tied to messages):

```javascript
function _getHiddenMemories(chat, memories) {
    return memories.filter((m) => {
        if (!m.message_ids?.length) return false;  // No message_ids = not hidden
        const minId = Math.min(...m.message_ids);
        return chat[minId]?.is_system;
    });
}
```

Wait — the return value of `_getHiddenMemories` is the SET of hidden memories to exclude. Looking at the call site:

```javascript
const hiddenMemories = _getHiddenMemories(chat, memories);
const visibleMemories = memories.filter(m => !hiddenMemories.includes(m));
```

If reflections return `false` from the filter, they're NOT in `hiddenMemories`, so they SHOULD be in `visibleMemories`.

**Confirmed.** The call site at line 228-231 chains: `_getHiddenMemories` → `filterMemoriesByPOV(hiddenMemories, ...)`. Only memories IN `hiddenMemories` proceed to scoring. Reflections return `false` from the filter, so they're excluded from the set, and never reach `filterMemoriesByPOV` or scoring.

The comment on line 227 explains intent: "visible messages are already in context." The system assumes memories from visible messages don't need injection. But reflections aren't from ANY message — they're synthesized insights. They should bypass the hidden-message filter entirely.

**Fix:** Include reflections alongside hidden memories:

```javascript
// retrieve.js line 228
const hiddenMemories = _getHiddenMemories(chat, memories);
const reflections = memories.filter(m => m.type === 'reflection');
const candidateMemories = [...hiddenMemories, ...reflections];

// Then pass candidateMemories to filterMemoriesByPOV
const accessibleMemories = filterMemoriesByPOV(candidateMemories, povCharacters, data);
```

Apply the same fix at line 327 (second call site in `updateInjection`).

### Bug C: Russian Interjection False Positives

**Root Cause:** `CYRILLIC_STARTERS` stop list in `src/retrieval/query-context.js:48-68` lacks common interjections.

**Fix:** Expand the stop list:

```javascript
const CYRILLIC_STARTERS = new Set([
    // Existing entries...
    'После', 'Когда', 'Потом', 'Затем', 'Тогда',
    'Здесь', 'Там',
    'Это', 'Эта', 'Этот', 'Эти',
    'Что', 'Как', 'Где', 'Куда', 'Почему', 'Зачем', 'Кто', 'Чей',
    'Какой', 'Какая', 'Какое',
    'Пока', 'Если', 'Хотя', 'Также', 'Ещё', 'Уже', 'Вот', 'Вон',
    // New: interjections & filler words
    'Ага', 'Угу', 'Ого', 'Ура', 'Хм', 'Ну',
    'Да', 'Нет', 'Ладно', 'Хорошо', 'Ок',
    'Блин', 'Блять', 'Бля',
    'Значит', 'Типа', 'Короче', 'Просто',
    'Конечно', 'Наверное', 'Возможно', 'Может',
    // Informal speech patterns common in RP
    'Воны', 'Чё', 'Чо', 'Ваще', 'Щас',
]);
```

Also add a **minimum word length** filter (3+ characters after normalization) as a safety net, since most Russian entity names are 4+ characters.

**Add test cases** for the new entries in `tests/query-context.test.js`.

## 4. Implementation Order

1. **Bug C** (stop list) — trivial, 15-line change + tests
2. **Bug B** (reflection retrieval) — needs call-site verification first, then targeted fix
3. **Bug A** (graph edges) — most complex, needs merge redirect map + edge migration in consolidation

## 5. Risks

### Bug A: Merge Redirect Map Growth
**Risk:** Map grows unbounded as entities keep merging.
**Mitigation:** Redirect map only needs entries for the current extraction batch. Clear it after each extraction cycle. Or: transitive resolution (A→B, B→C resolves A→C) with periodic compaction.

### Bug C: Over-filtering
**Risk:** A character literally named "Ага" would be filtered.
**Mitigation:** Cross-reference extracted entities against the known entity graph. If "Ага" exists as a node, don't filter it. This is a future enhancement; for now, the stop list is correct for 99% of cases.
