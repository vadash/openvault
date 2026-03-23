# Four-Bug Fix: Entity Merges, Community Parse, Character Duplication, 0 Communities

**Date:** 2026-03-16
**Status:** Design

## Problem Statement

Build 9 logs reveal four interconnected bugs:

1. **Entity merge false positives** — Unrelated entities merge because the grey-zone token overlap checks are too permissive for Cyrillic text (e.g., "бордовая свеча" → "бордовый силиконовый дилдо" at 0.875 cosine).
2. **Community summary parse failure** — `parseStructuredResponse` warns when the LLM returns an array `[{...}]` instead of object `{...}` but doesn't recover, so Zod rejects it. Both C0 and C6 fail → 0 communities summarized.
3. **Character duplication** — The LLM extracts both English and Cyrillic character nodes (Suzy/Сузи, Vova/Вова, Mina/Мина) as separate entities. They can't merge (different scripts defeat stemmer/LCS). Cyrillic hubs bypass `mainCharacterKeys` attenuation.
4. **0 communities despite 87 nodes** — Compound of bugs 2+3. Louvain detects 14 communities, 12 are singletons (filtered), 2 qualify but both hit bug 2's parse failure.

## Bug 1: Entity Merge False Positives

### Root Cause

The grey zone (cosine 0.85–0.95) delegates to `hasSufficientTokenOverlap()` in `src/graph/graph.js`. Three sub-mechanisms produce false positives:

| Mechanism | Threshold | Failure mode |
|---|---|---|
| LCS ratio | ≥ 0.6 | Short suffixes like "-ска" (3 chars) hit 0.6 on 5-char keys. 4-char keys like "воск" match almost anything (3/4 = 0.75). |
| Stem overlap ratio | ≥ 0.5 | Shared adjective stems (бордов, силиконов) give 1/2 = 0.5 on 2-token entities, triggering merge despite different nouns. |
| Token overlap ratio | ≥ 0.5 | Generic shared nouns like "магазин" give 1/2 = 0.5, merging unrelated stores. |

**Confirmed by stemmer test:**
```
бордовая → бордов | бордовый → бордов | match=true (adjective stem, NOT identity)
силиконовое → силиконов | силиконовый → силиконов | match=true
```

### Fix

Two constant changes in `hasSufficientTokenOverlap()`:

**A. LCS check — raise ratio 0.6 → 0.7, add minimum absolute length of 4 chars:**

```javascript
// Before:
if (commonLen / minLen >= 0.6) return true;

// After:
const minAbsLen = (keyA.length <= 4 && keyB.length <= 4) ? 2 : 4;
if (commonLen >= minAbsLen && commonLen / minLen >= 0.7) return true;
```

Short-key exception (both ≤ 4 chars, min 2, ratio 0.6) preserves Кай/Каю morphological variants without letting "воск" match everything.

**B. Stem/token overlap — raise `minOverlapRatio` from 0.5 → 0.6:**

The caller `shouldMergeEntities()` currently passes 0.5. Change to 0.6.

```javascript
// In shouldMergeEntities():
return hasSufficientTokenOverlap(tokensA, tokensB, 0.6, keyA, keyB);
//                                                  ^^^
```

### Verification Matrix

All 6 known false positives blocked, all known good merges preserved:

| Pair | Cosine | Mechanism | Old | New |
|---|---|---|---|---|
| **False positives (should block)** | | | | |
| бордовая свеча → бордовый дилдо | 0.875 | Stem 1/2 | 0.50 ≥ 0.5 ✗ | 0.50 < 0.6 ✓ |
| расчёска → миска | 0.865 | LCS 3 chars | 3/5=0.6 ≥ 0.6 ✗ | 3 < 4 min ✓ |
| \*anything → воск | 0.87–0.88 | LCS 3 chars | 3/4=0.75 ✗ | 3 < 4 min ✓ |
| кольцо → колокольчик | 0.907 | LCS 4 chars | 4/6=0.67 ✗ | 0.67 < 0.7 ✓ |
| продуктовый магазин → цветочный магазин | 0.894 | Token 1/2 | 0.50 ≥ 0.5 ✗ | 0.50 < 0.6 ✓ |
| силиконовое кольцо → силиконовый дилдо | 0.897 | Stem 1/2 | 0.50 ≥ 0.5 ✗ | 0.50 < 0.6 ✓ |
| **Good merges (should pass)** | | | | |
| Свечи → Свеча | 0.866 | LCS 4 chars | 4/5=0.8 ✓ | 4 ≥ 4, 0.8 ≥ 0.7 ✓ |
| ошейник → ошейником | ~0.88 | LCS 7 chars | 7/9=0.78 ✓ | 7 ≥ 4, 0.78 ≥ 0.7 ✓ |
| Б. комплект → Б. комплект белья | 0.887 | Substring | contains ✓ | contains ✓ |
| верёвки → верёвка | 0.894 | LCS 6 chars | 6/7=0.86 ✓ | 6 ≥ 4, 0.86 ≥ 0.7 ✓ |
| king aldric N → king aldric S | — | Token 2/3 | 0.67 ✓ | 0.67 ≥ 0.6 ✓ |
| Кай → Каю | — | LCS 2 chars | 2/3=0.67 ✓ | both ≤ 4, 2 ≥ 2, 0.67 ≥ 0.6 ✓ |

**Accepted trade-off:** "Силиконовый фаллос" (0.892) won't merge with "Бордовый силиконовый дилдо" — only 1 stem overlap. Duplicate nodes are harmless; false merges corrupt the graph permanently.

### Files Changed

- `src/graph/graph.js` — `hasSufficientTokenOverlap()`: LCS check, `shouldMergeEntities()`: overlap ratio
- `tests/graph/token-overlap.test.js` — New false-positive regression tests, update existing expectations
- `src/graph/CLAUDE.md` — Update threshold values in docs

---

## Bug 2: Community Summary Parse Failure

### Root Cause

`parseStructuredResponse()` in `src/extraction/structured.js` (line ~131) handles array responses poorly:

```javascript
if (Array.isArray(parsed)) {
    logWarn('LLM returned array instead of object in parseStructuredResponse');
}
// Falls through to schema.safeParse(parsed) which rejects arrays
```

The `parseEventExtractionResponse()` function already handles this correctly by wrapping bare arrays. The generic `parseStructuredResponse()` does not.

### Fix

Add single-element array unwrapping in `parseStructuredResponse()`, after the JSON parse and before Zod validation:

```javascript
if (Array.isArray(parsed)) {
    if (parsed.length === 1) {
        logWarn('LLM returned single-element array instead of object — unwrapping');
        parsed = parsed[0];
    } else if (parsed.length === 0) {
        throw new Error('LLM returned empty array');
    } else {
        logWarn(`LLM returned ${parsed.length}-element array instead of object — using first element`);
        parsed = parsed[0];
    }
}
```

This is intentionally permissive: any non-empty array gets unwrapped to its first element. The Zod schema provides the real validation.

### Files Changed

- `src/extraction/structured.js` — `parseStructuredResponse()`: array recovery
- `tests/extraction/structured.test.js` — Test array → object unwrapping for community schema

---

## Bug 3: Character Duplication

Two-phase fix: short-term (community detection) + long-term (extraction prevention).

### Root Cause

The LLM extracts character references in the language of the conversation. In Russian-language RPs, it creates Cyrillic entity nodes ("Сузи", "Вова") alongside the English nodes ("Suzy", "Vova") that `mergeOrInsertEntity` initialized from context. These don't merge because:

- Different scripts → stemmer can't match
- Different scripts → LCS produces 0 common characters
- Embedding similarity for short names across scripts may fall below the 0.85 grey-zone floor

Consequences:
- `mainCharacterKeys` = `["suzy", "vova"]` (English only)
- Cyrillic hubs "сузи" (59 events), "вова" (59 events) are **not** attenuated during Louvain
- Community detection sees unattenuated hairball

### Phase A: Short-Term — Expand mainCharacterKeys

**New dependency:** [`cyrillic-to-translit-js`](https://www.npmjs.com/package/cyrillic-to-translit-js) — lightweight Cyrillic↔Latin transliteration via `cdnImport()`.

**New utility:** `src/utils/transliterate.js`

```javascript
import { cdnImport } from './cdn.js';
const CyrillicToTranslit = (await cdnImport('cyrillic-to-translit-js')).default;
const translit = new CyrillicToTranslit({ preset: 'ru' });

export function transliterateCyrToLat(str) {
    return translit.transform(str).toLowerCase();
}

export function levenshteinDistance(a, b) {
    // Standard O(n*m) DP implementation, ~15 lines
}
```

**New function in `src/graph/graph.js`:** `findCrossScriptCharacterKeys(baseKeys, graphNodes)`

```javascript
export function findCrossScriptCharacterKeys(baseKeys, graphNodes) {
    const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
    const crossScriptKeys = [];

    for (const [nodeKey, node] of Object.entries(graphNodes)) {
        if (node.type !== 'PERSON') continue;
        if (baseKeys.includes(nodeKey)) continue;
        if (!CYRILLIC_RE.test(nodeKey)) continue;

        const transliterated = transliterateCyrToLat(nodeKey);
        for (const baseKey of baseKeys) {
            if (levenshteinDistance(transliterated, baseKey) <= 2) {
                crossScriptKeys.push(nodeKey);
                break;
            }
        }
    }

    return crossScriptKeys;
}
```

**Integration** in `src/extraction/extract.js` — both community detection sites:

```javascript
const baseKeys = [normalizeKey(characterName), normalizeKey(userName)];
const mainCharacterKeys = expandMainCharacterKeys(baseKeys, data.graph.nodes || {});
// NEW: also find Cyrillic variants
const crossScriptKeys = findCrossScriptCharacterKeys(baseKeys, data.graph.nodes || {});
mainCharacterKeys.push(...crossScriptKeys.filter(k => !mainCharacterKeys.includes(k)));
```

### Phase B: Long-Term — Cross-Script Merge During Extraction

Prevent duplication at the source. In `mergeOrInsertEntity()`, add a cross-script check between the slow-path embedding check and the "no match" fallback:

```javascript
// After embedding comparison finds no match, before creating new node:
if (type === 'PERSON' && mainCharacterNames?.length > 0) {
    const transliterated = transliterateCyrToLat(key);
    for (const mainName of mainCharacterNames) {
        const mainKey = normalizeKey(mainName);
        if (graphData.nodes[mainKey] && levenshteinDistance(transliterated, mainKey) <= 2) {
            // Force-merge into existing main character node
            upsertEntity(graphData, graphData.nodes[mainKey].name, type, description, cap);
            if (!graphData.nodes[mainKey].aliases) graphData.nodes[mainKey].aliases = [];
            graphData.nodes[mainKey].aliases.push(name);
            if (!graphData._mergeRedirects) graphData._mergeRedirects = {};
            graphData._mergeRedirects[key] = mainKey;
            return mainKey;
        }
    }
}
```

**Signature change:** `mergeOrInsertEntity` gains an optional `mainCharacterNames` parameter:

```javascript
export async function mergeOrInsertEntity(graphData, name, type, description, cap, settings, mainCharacterNames = [])
```

The caller in `extract.js` passes `[characterName, userName]` from context.

### Files Changed

- `src/utils/transliterate.js` — **New file.** `transliterateCyrToLat()`, `levenshteinDistance()`
- `src/utils/CLAUDE.md` — Document new module
- `src/graph/graph.js` — `findCrossScriptCharacterKeys()`, `mergeOrInsertEntity()` cross-script check
- `src/extraction/extract.js` — Wire cross-script keys into both community detection sites + pass character names to `mergeOrInsertEntity`
- `tests/graph/graph.test.js` — Test cross-script character merge
- `tests/utils/transliterate.test.js` — **New file.** Unit tests for transliteration + Levenshtein

---

## Bug 4: 0 Communities Despite 87 Nodes

### Root Cause

Compound failure:

1. **Bug 3** → Cyrillic character hubs not attenuated → Louvain produces 12 singletons + 2 large communities
2. Singletons filtered (< 2 nodes)
3. **Bug 2** → Both qualifying communities fail parse → 0 stored

### Fix

No dedicated code change. Resolves when bugs 2 and 3 are fixed:

- **Bug 3 fix** → Cyrillic hubs attenuated → better Louvain partitioning → fewer singletons
- **Bug 2 fix** → Qualifying communities actually get summarized → communities stored

---

## Implementation Order

```
Bug 2 (parse fix)       — Standalone, ~10 lines, immediate payoff
  ↓
Bug 1 (merge thresholds) — Standalone, ~15 lines of logic change + tests
  ↓
Bug 3A (mainCharKeys)    — Depends on new transliterate.js
  ↓
Bug 3B (extraction merge) — Depends on transliterate.js + extract.js wiring
  ↓
Bug 4                    — Verify via integration test / manual build run
```

Bugs 1 and 2 are independent and can be done in parallel. Bug 3A and 3B are sequential.

## Testing Strategy

| Bug | Test type | What to verify |
|---|---|---|
| 1 | Unit (`token-overlap.test.js`) | All 6 false positives blocked, all 6 good merges preserved |
| 2 | Unit (`structured.test.js`) | `parseCommunitySummaryResponse('[{...}]')` returns valid object |
| 3A | Unit (`graph.test.js`) | `findCrossScriptCharacterKeys(["suzy"], {сузи: {type:"PERSON"}})` returns `["сузи"]` |
| 3B | Unit (`graph.test.js`) | `mergeOrInsertEntity` with Cyrillic PERSON name + `mainCharacterNames=["Suzy"]` merges into existing node |
| 3 | Unit (`transliterate.test.js`) | Сузи→Suzi, Вова→Vova, Мина→Mina; Levenshtein correctness |
| 4 | Manual | Re-run build, verify communities > 0 in output |
