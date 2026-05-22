# Flatten Reflections to Level 1

**Date:** 2026-05-22
**Status:** Draft
**Scope:** `src/reflection/`, `src/retrieval/math.js`, `src/prompts/reflection/`, `src/constants.js`, `src/store/`

## Problem

Multi-tier recursive reflections (Level 2+) suffer from **abstraction degradation** — LLMs synthesizing summaries of summaries produce generic tropes rather than grounded insights ("The character is on a journey of self-discovery"). This wastes context tokens, complicates debugging of retrieval behavior, and adds level-aware decay math that only matters for levels that produce low-quality output anyway.

## Decision

**Cap reflections at Level 1.** Only allow the LLM to reflect on raw events, never on other reflections.

This is a hybrid approach: flatten now, and design the removal so a future "psychological state card" (in-place regeneration model) can slot into the same pipeline interface without further structural changes.

## Changes

### 1. `src/reflection/reflect.js` — Remove multi-tier synthesis

**Candidate set:** Remove the `oldReflections` collection (line 232). The candidate set fed to `buildUnifiedReflectionPrompt` becomes recent events only — no reflections of any level.

```diff
- const oldReflections = accessibleMemories.filter((m) => m.type === 'reflection' && (m.level || 1) >= 1);
- const candidateSet = Array.from(new Map([...recentMemories, ...oldReflections].map((m) => [m.id, m])).values());
+ const candidateSet = recentMemories;
```

**Level derivation:** Replace the entire level/parent detection block (lines 279–307) with fixed values:

```diff
- const hasReflectionEvidence = evidence_ids.some((id) => id.startsWith('ref_'));
- const reflectionEvidenceIds = evidence_ids.filter((id) => id.startsWith('ref_'));
- const eventEvidenceIds = evidence_ids.filter((id) => !id.startsWith('ref_'));
  return {
      id: `ref_${generateId()}`,
      type: 'reflection',
      summary: insight,
      tokens: tokenize(insight || ''),
      importance: 4,
      sequence: now,
      characters_involved: [characterName],
      character: characterName,
-     source_ids: eventEvidenceIds,
-     parent_ids: reflectionEvidenceIds,
-     level: hasReflectionEvidence
-         ? Math.min(defaultSettings.maxReflectionLevel, 1 + Math.max(...))
-         : 1,
+     source_ids: evidence_ids,
+     parent_ids: [],
+     level: 1,
      ...
```

**Imports:** Remove `defaultSettings` import (no longer needed for `maxReflectionLevel`).

### 2. `src/retrieval/math.js` — Simplify reflection decay

Remove the level-aware decay branch (lines 329–341). Replace with a single decay formula:

```diff
  if (memory.type === 'reflection' && distance > constants.reflectionDecayThreshold) {
      const threshold = constants.reflectionDecayThreshold;
-     const level = memory.level || 1;
-     const multiplier = constants.reflectionLevelMultiplier || 2.0;
-     const levelDivisor = multiplier ** (level - 1);
-     const decayFactor = Math.max(0.25, 1 - (distance - threshold) / (2 * threshold * levelDivisor));
+     const decayFactor = Math.max(0.25, 1 - (distance - threshold) / (2 * threshold));
      total *= decayFactor;
  }
```

### 3. `src/constants.js` — Remove dead settings

Remove from `defaultSettings`:
- `maxReflectionLevel: 3`
- `reflectionLevelMultiplier: 2.0`

Remove from `UI_DEFAULT_HINTS`:
- `maxReflectionLevel`
- `reflectionLevelMultiplier`

### 4. `src/prompts/reflection/builder.js` — Remove level-aware prompt sections

Remove:
- `hasOldReflections` detection (line 37) — always false now
- `levelIndicator` in memory list formatting (line 42) — reflections no longer in candidate set
- Level-aware synthesis rules appended to `UNIFIED_REFLECTION_RULES` (lines 47–54)
- `levelAwareInstruction` variable and its injection into the prompt (lines 64–66, 84)

The prompt becomes: events-only candidate list + base rules. No mention of synthesizing existing reflections.

### 5. `src/store/migrations/` — V7 migration (schema v6 → v7)

New file `src/store/migrations/v7.js`:

```javascript
export function migrateToV7(data, _chat) {
    let changed = false;

    if (data.memories) {
        const before = data.memories.length;
        data.memories = data.memories.filter(
            (m) => !(m.type === 'reflection' && (m.level || 1) > 1)
        );
        if (data.memories.length < before) {
            changed = true;
        }
    }

    // Clean stale settings
    if (data.settings) {
        if ('maxReflectionLevel' in data.settings) {
            delete data.settings.maxReflectionLevel;
            changed = true;
        }
        if ('reflectionLevelMultiplier' in data.settings) {
            delete data.settings.reflectionLevelMultiplier;
            changed = true;
        }
    }

    return changed;
}
```

Register in `src/store/migrations/index.js`, bump `CURRENT_SCHEMA_VERSION` to 7.

### 6. Schema fields — Keep `level` and `parent_ids`

The `MemorySchema` in `src/store/schemas.js` retains `level` and `parent_ids` fields. This is intentional:
- Backward compatibility with existing Level 1 reflections that already have these fields
- Forward compatibility: a future state-card design may repurpose these fields or remove them in a later migration

### 7. Documentation updates

| File | Change |
|---|---|
| `src/reflection/CLAUDE.md` | Remove Level 2+ references, update pipeline description |
| `include/DATA_SCHEMA.md` | Update reflection schema: level is always 1, parent_ids always empty |

### 8. Tests

**Remove:**
- `tests/reflection/reflect.test.js`: `describe('Reflection level derivation from parent_ids')` — both test cases (level-3 derivation and maxLevel cap)
- `tests/retrieval/math.test.js`: `describe('Reflection decay with level divisor')` — both test cases

**Update:**
- `tests/reflection/reflect.test.js`: `describe('Reflection level and parent_ids fields')` — assert `level === 1` and `parent_ids === []` unconditionally
- Add migration test: given mix of Level 1 and Level 2+ reflections, verify Level 2+ deleted, Level 1 preserved, stale settings cleaned

## Future State Card Compatibility

The pipeline interface remains:

```
accumulateImportance() → shouldReflect() → generateReflections(characterName, allMemories, characterStates) → { reflections: [] }
```

A future state-card design replaces only the **storage step** (append to memory array → upsert single card per character). Everything upstream — accumulator, trigger, gate, LLM call, dedup — works unchanged.

## Rollback

If issues arise post-migration:
1. Revert code changes
2. Users who loaded the chat with v7 already had Level 2+ reflections deleted — this data is **not recoverable** unless they have a chat backup
3. The migration is intentionally destructive per design decision
