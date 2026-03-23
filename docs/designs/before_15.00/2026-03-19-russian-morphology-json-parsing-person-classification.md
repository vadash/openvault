# Russian Morphology, JSON Parsing, and PERSON Classification Fixes

**Date:** 2026-03-19
**Status:** Approved

## Summary

Three targeted patches to address diagnosed failure modes from diagnostic reports:
1. Russian morphology false positives/negatives in entity merging
2. LLM JSON syntax hallucinations with multi-line string concatenation
3. Persona/alter-ego classification inconsistency in graph extraction

---

## 1. Russian Morphology Fix

### Problem

The `hasSufficientTokenOverlap()` function fails on Russian diminutives and inflected forms:

- **False Negative:** `Плетка` (whip) vs `Плеточка` (little whip) — same root, different suffixes, but not merged
- **False Negative:** `Ошейник` vs `Ошейники` (collars) — singular vs plural
- **False Positive:** `Таблеточки` (pills) vs `Плеточка` (whip) — different roots, but merged due to shared suffix `леточк` (6 chars, LCS ratio 0.75 ≥ 0.70 threshold)

### Root Cause

1. Stem-based comparison runs **last** in the function, after LCS has already triggered a false positive
2. LCS threshold of `0.70` is too permissive for suffix-heavy languages like Russian

### Solution

Reorder checks and raise LCS threshold:

**File:** `src/graph/graph.js`
**Function:** `hasSufficientTokenOverlap()`

**New check order:**
1. **Stem equality** (NEW, top priority) — if stems match exactly, return `true` immediately
2. Substring containment
3. **LCS check** — raise threshold from `0.70` to `0.85` for longer words
4. Token overlap with stopwords
5. Stem overlap check (existing fallback)

**Code changes:**

```javascript
export function hasSufficientTokenOverlap(tokensA, tokensB, minOverlapRatio = 0.5, keyA = '', keyB = '') {
    // 1. NEW: Stem equality — immediate merge for morphological variants
    if (keyA && keyB) {
        const stemA = stemWord(keyA);
        const stemB = stemWord(keyB);
        if (stemA && stemB && stemA === stemB) return true;
    }

    // Helper: longest common substring
    function longestCommonSubstring(a, b) {
        // ... existing implementation ...
    }

    // 2. Direct substring containment
    if (keyA && keyB && (keyA.includes(keyB) || keyB.includes(keyA))) {
        return true;
    }

    // 3. LCS check — RAISED threshold to prevent suffix collisions
    if (keyA && keyB && keyA.length > 2 && keyB.length > 2) {
        const commonLen = longestCommonSubstring(keyA, keyB);
        const minLen = Math.min(keyA.length, keyB.length);
        const shortKeys = keyA.length <= 4 && keyB.length <= 4;
        const minAbsLen = shortKeys ? 2 : 4;
        const minRatio = shortKeys ? 0.6 : 0.85; // Changed from 0.7 to 0.85

        if (commonLen >= minAbsLen && commonLen / minLen >= minRatio) {
            return true;
        }
    }

    // 4. Token overlap with stopwords (existing)
    // ... existing code ...

    // 5. Stem overlap check (existing)
    // ... existing code ...
}
```

### Impact

- Exact stem matches (Russian inflections) merge immediately via step 1
- Suffix-only collisions (false positives) are blocked by stricter LCS threshold
- Short names (≤4 chars) keep relaxed 0.6 threshold to preserve variants like Кай/Каю
- Other languages unaffected — stem equality is language-agnostic

---

## 2. JSON Parsing Fix

### Problem

LLM generates JavaScript-style string concatenation across newlines without proper quote pairing:

```
"text" +
"more text"
```

Or worse:
```
"text"

+

"more text"
```

The existing regex assumes quotes on both sides of `+` without accounting for multiple newlines.

### Root Cause

Pattern `/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*(?<!\\)(["'])/g` matches `+` with at most one newline. Multi-line breaks with `+` stranded in the middle pass through uncaught, causing `jsonrepair` to fail.

### Solution

Add two regex patterns for multi-line `+` symbols before existing handlers.

**File:** `src/utils/text.js`
**Function:** `safeParseJSON()`

**Position:** After step 1 (mid-string concatenation), before step 2 (dangling plus before punctuation).

**Code changes:**

```javascript
// --- LLM SYNTAX HALLUCINATION SANITIZER ---

// 1. Mid-string concatenation across newlines: "text" +\n "more" -> "textmore"
cleanedInput = cleanedInput.replace(/(?<!\\)(["'])\s*[+＋]\s*(?:\r?\n)?\s*(?<!\\)(["'])/g, '');

// 1.5 NEW: Catch rogue '+' symbols stranded across multiple newlines
cleanedInput = cleanedInput.replace(/(["'])\s*(?:\r?\n)+\s*[+＋]\s*(?:\r?\n)+\s*(["'])/g, '$1$2');
cleanedInput = cleanedInput.replace(/(["'])\s*(?:\r?\n)+\s*[+＋]\s*(["'])/g, '$1$2');

// 2. Dangling plus before punctuation/newlines: "text" + , -> "text" ,
// ... rest unchanged ...
```

### Impact

- Idempotent patterns — safe to apply repeatedly
- Catches multi-line concatenation without breaking existing single-line handling
- `jsonrepair` handles any remaining edge cases

---

## 3. PERSON Classification Rule

### Problem

Fictional personas and alter-egos are inconsistently classified as `PERSON` vs `CONCEPT`, causing graph fragmentation and split relationship edges.

### Root Cause

Current rule says "Named characters, NPCs, people mentioned by name." LLMs interpret "persona" as an abstract concept rather than a character identity.

### Solution

Extend PERSON definition with broader principle language.

**File:** `src/prompts/graph/rules.js`
**Constant:** `GRAPH_RULES`

**Code change:**

```javascript
export const GRAPH_RULES = `Extract named entities mentioned or clearly implied in the messages. Focus on NEW entities or CHANGES to existing ones:
- PERSON: Named characters, NPCs, people mentioned by name, and fictional identities presented as characters (includes personas, alter-egos, avatars)
- PLACE: Named locations, buildings, rooms, cities, regions
- ORGANIZATION: Named groups, factions, guilds, companies
- OBJECT: Highly significant unique items, weapons, or plot devices. Do NOT extract mundane furniture, clothing, or food unless they are critical to the scene's dynamic
- CONCEPT: Named abilities, spells, diseases, prophecies

Also extract relationships between pairs of entities when the connection is stated or clearly implied. Do NOT re-describe existing static relationships unless a specific progression or change occurred in this batch.

IMPORTANT: Extract entities and relationships even when no events are extracted. Entity data builds world knowledge over time and is always valuable. Limit output to the most significant updates per batch.

<thinking_process>
Follow these steps IN ORDER. Write your work inside <tool_call> tags BEFORE outputting the JSON:

Step 1: Entity scan — List every named entity mentioned or implied. Include type (PERSON, PLACE, ORGANIZATION, OBJECT, CONCEPT).
Step 2: Type validation — Verify each entity type against the allowed set. Skip mundane objects unless plot-critical.
Step 3: Relationship map — For each entity pair with a stated or implied connection, note the direction and nature.
Step 4: Output — Count entities and relationships, then produce the final JSON.
</thinking_process>`;
```

### Impact

- LLM will consistently classify personas as PERSON
- Graph remains unified for power dynamics and relationship tracking
- No code logic changes — prompt-only modification

---

## Testing Strategy

| Fix | Test Method |
|-----|-------------|
| **Morphology** | Run diagnostic batch with Russian diminutives (`Плетка`/`Плеточка`, `Ошейник`/`Ошейники`) and verify merge. Test false positive case (`Таблеточки`/`Плеточка`) stays separate. |
| **JSON Parsing** | Unit test with malformed JSON containing multi-line `+` concatenation. Verify `safeParseJSON` returns valid object. |
| **PERSON Rule** | Run graph extraction on roleplay context with personas. Verify all personas classified as PERSON, not CONCEPT. |

---

## Implementation Checklist

- [ ] `src/graph/graph.js`: Modify `hasSufficientTokenOverlap()` — add stem equality check at top, raise LCS threshold to 0.85
- [ ] `src/utils/text.js`: Add two regex patterns in `safeParseJSON()` for multi-line `+` handling
- [ ] `src/prompts/graph/rules.js`: Update `GRAPH_RULES` PERSON definition
- [ ] Write unit tests for morphology and JSON parsing changes
- [ ] Integration test with diagnostic RP scenarios