# Four-Bug Fix Implementation Plan

**Goal:** Fix entity merge false positives, community parse failure, character duplication, and resulting 0-community bug.
**Architecture:** Four targeted fixes across the graph merge logic, structured response parser, transliteration utility, and extraction pipeline. Bug 4 resolves automatically from bugs 2+3.
**Tech Stack:** Vitest, Zod, snowball-stemmers, cyrillic-to-translit-js (new dep)

---

### Task 1: Bug 2 — Array Recovery in parseStructuredResponse

The simplest fix. `parseStructuredResponse()` in `src/extraction/structured.js` warns when the LLM returns an array but doesn't recover — Zod rejects the array. Fix: unwrap single-element arrays before validation.

**Files:**
- Modify: `src/extraction/structured.js`
- Modify: `tests/extraction/structured.test.js`

- [ ] Step 1: Write failing tests for array recovery

Add these tests to the existing `CommunitySummarySchema` describe block in `tests/extraction/structured.test.js`:

```javascript
    it('recovers when LLM returns single-element array instead of object', () => {
        const json = JSON.stringify([{
            title: 'The Royal Court',
            summary: 'King Aldric rules from the Castle...',
            findings: ['The King fears betrayal', 'The Guard is loyal'],
        }]);
        const result = parseCommunitySummaryResponse(json);
        expect(result.title).toBe('The Royal Court');
        expect(result.findings).toHaveLength(2);
    });

    it('recovers when LLM returns multi-element array (uses first)', () => {
        const json = JSON.stringify([
            {
                title: 'First Community',
                summary: 'The main group of characters',
                findings: ['Finding one'],
            },
            {
                title: 'Second Community',
                summary: 'Should be ignored',
                findings: ['Ignored'],
            },
        ]);
        const result = parseCommunitySummaryResponse(json);
        expect(result.title).toBe('First Community');
    });

    it('throws on empty array from LLM', () => {
        const json = '[]';
        expect(() => parseCommunitySummaryResponse(json)).toThrow('LLM returned empty array');
    });
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run tests/extraction/structured.test.js --reporter=verbose`
Expected: 3 new tests FAIL — the single-element and multi-element tests fail with "Schema validation failed" because the array passes through to Zod. The empty array test may pass or fail depending on how Zod handles `[]`.

- [ ] Step 3: Implement array recovery in parseStructuredResponse

In `src/extraction/structured.js`, find the `parseStructuredResponse` function. Replace the existing array warning block:

```javascript
    // Array recovery - if LLM returned a bare array instead of expected object
    // Note: callers expecting objects must handle this appropriately
    if (Array.isArray(parsed)) {
        logWarn('LLM returned array instead of object in parseStructuredResponse');
    }
```

with:

```javascript
    // Array recovery — unwrap bare arrays to first element before Zod validation.
    // LLMs occasionally return [{...}] instead of {...}. The Zod schema provides
    // real structural validation, so permissive unwrapping here is safe.
    if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
            throw new Error('LLM returned empty array');
        }
        logWarn(`LLM returned ${parsed.length}-element array instead of object — unwrapping first element`);
        parsed = parsed[0];
    }
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run tests/extraction/structured.test.js --reporter=verbose`
Expected: ALL tests PASS including the 3 new ones.

- [ ] Step 5: Commit

```bash
git add src/extraction/structured.js tests/extraction/structured.test.js && git commit -m "fix: recover from LLM array responses in parseStructuredResponse

parseStructuredResponse warned on array input but passed it to Zod,
which rejected it. Communities C0 and C6 both failed this way -> 0
communities stored. Now unwraps first element before validation."
```

---

### Task 2: Bug 1 — Tighten LCS Threshold in hasSufficientTokenOverlap

The LCS (longest common substring) check uses ratio ≥ 0.6 which is too permissive for short Cyrillic keys. Raise to 0.7 with a minimum absolute length of 4 chars (exception: both keys ≤ 4 chars → min 2, ratio 0.6).

**Files:**
- Modify: `src/graph/graph.js`
- Modify: `tests/graph/token-overlap.test.js`

- [ ] Step 1: Write failing regression tests for false-positive LCS merges

Add these tests to the `hasSufficientTokenOverlap` describe block in `tests/graph/token-overlap.test.js`:

```javascript
    it('should NOT merge расчёска/миска (short suffix "-ска" = 3 chars < 4 min)', () => {
        const tokensA = new Set(['расчёска']);
        const tokensB = new Set(['миска']);
        expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'расчёска', 'миска')).toBe(false);
    });

    it('should NOT merge anything with воск (LCS 3 chars < 4 min)', () => {
        const tokensA = new Set(['чёрный', 'кружевной', 'бюстгальтер', 'с', 'носками', 'в', 'чашках']);
        const tokensB = new Set(['воск']);
        expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6,
            'чёрный кружевной бюстгальтер с носками в чашках', 'воск')).toBe(false);
    });

    it('should NOT merge кольцо/колокольчик (LCS "коль" 4/6=0.67 < 0.7)', () => {
        const tokensA = new Set(['кольцо']);
        const tokensB = new Set(['колокольчик']);
        expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'кольцо', 'колокольчик')).toBe(false);
    });

    it('should still merge Свечи/Свеча (LCS "свеч" 4/5=0.8 ≥ 0.7)', () => {
        const tokensA = new Set(['свечи']);
        const tokensB = new Set(['свеча']);
        expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'свечи', 'свеча')).toBe(true);
    });

    it('should still merge верёвки/верёвка (LCS "верёвк" 6/7=0.86 ≥ 0.7)', () => {
        const tokensA = new Set(['верёвки']);
        const tokensB = new Set(['верёвка']);
        expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6, 'верёвки', 'верёвка')).toBe(true);
    });
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run tests/graph/token-overlap.test.js --reporter=verbose`
Expected: The first 3 tests FAIL (false positives currently pass the LCS check). The last 2 PASS (good merges already work).

- [ ] Step 3: Tighten the LCS check in hasSufficientTokenOverlap

In `src/graph/graph.js`, in the `hasSufficientTokenOverlap` function, find the fuzzy substring block:

```javascript
    // Fuzzy substring: significant common prefix/suffix (e.g., "alice" vs "alicia")
    if (keyA && keyB && keyA.length > 2 && keyB.length > 2) {
        const commonLen = longestCommonSubstring(keyA, keyB);
        const minLen = Math.min(keyA.length, keyB.length);
        if (commonLen / minLen >= 0.6) {
            // 60% of shorter string
            return true;
        }
    }
```

Replace with:

```javascript
    // Fuzzy substring: significant common prefix/suffix (e.g., "alice" vs "alicia")
    // Short-key exception: both keys ≤ 4 chars get relaxed thresholds to preserve
    // morphological variants like Кай/Каю. Normal keys require ≥ 4 absolute chars
    // and 70% ratio to block false positives from short suffixes like "-ска".
    if (keyA && keyB && keyA.length > 2 && keyB.length > 2) {
        const commonLen = longestCommonSubstring(keyA, keyB);
        const minLen = Math.min(keyA.length, keyB.length);
        const shortKeys = keyA.length <= 4 && keyB.length <= 4;
        const minAbsLen = shortKeys ? 2 : 4;
        const minRatio = shortKeys ? 0.6 : 0.7;
        if (commonLen >= minAbsLen && commonLen / minLen >= minRatio) {
            return true;
        }
    }
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run tests/graph/token-overlap.test.js --reporter=verbose`
Expected: ALL tests PASS. The existing Кай/Каю test still passes (both ≤ 4 chars, uses relaxed thresholds).

- [ ] Step 5: Commit

```bash
git add src/graph/graph.js tests/graph/token-overlap.test.js && git commit -m "fix: tighten LCS threshold to prevent false entity merges

Raise LCS ratio 0.6->0.7 with minimum 4-char absolute length.
Short-key exception (both ≤4 chars) preserves morphological variants
like Кай/Каю. Blocks false positives: расчёска/миска, */воск,
кольцо/колокольчик."
```

---

### Task 3: Bug 1 — Raise Overlap Ratio from 0.5 to 0.6

The stem/token overlap ratio of 0.5 lets shared adjective stems (бордов) or generic nouns (магазин) trigger merges on 2-token entities. Raise to 0.6.

**Files:**
- Modify: `src/graph/graph.js`
- Modify: `tests/graph/token-overlap.test.js`

- [ ] Step 1: Write failing regression tests for false-positive stem/token merges

Add these tests to the `hasSufficientTokenOverlap` describe block in `tests/graph/token-overlap.test.js`:

```javascript
    it('should NOT merge бордовая свеча / бордовый дилдо (stem overlap 1/2=0.5 < 0.6)', () => {
        const tokensA = new Set(['бордовая', 'свеча']);
        const tokensB = new Set(['бордовый', 'силиконовый', 'дилдо']);
        expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6,
            'бордовая свеча', 'бордовый силиконовый дилдо')).toBe(false);
    });

    it('should NOT merge продуктовый магазин / цветочный магазин (token overlap 1/2=0.5 < 0.6)', () => {
        const tokensA = new Set(['продуктовый', 'магазин']);
        const tokensB = new Set(['цветочный', 'магазин']);
        expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6,
            'продуктовый магазин', 'цветочный магазин')).toBe(false);
    });

    it('should NOT merge силиконовое кольцо / силиконовый дилдо (stem overlap 1/2=0.5 < 0.6)', () => {
        const tokensA = new Set(['силиконовое', 'кольцо']);
        const tokensB = new Set(['силиконовый', 'дилдо']);
        expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6,
            'силиконовое кольцо', 'силиконовый дилдо')).toBe(false);
    });

    it('should still merge king aldric northern / king aldric southern at 0.6 ratio (2/3=0.67)', () => {
        const tokensA = new Set(['king', 'aldric', 'northern']);
        const tokensB = new Set(['king', 'aldric', 'southern']);
        expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6)).toBe(true);
    });
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run tests/graph/token-overlap.test.js --reporter=verbose`
Expected: The first 3 tests FAIL because these pairs currently pass the stem overlap check at the 0.5 threshold (1/2 = 0.5 ≥ 0.5). The 4th test PASSES (2/3 = 0.67 ≥ 0.6).

- [ ] Step 3: Raise the overlap ratio in shouldMergeEntities

In `src/graph/graph.js`, find the `shouldMergeEntities` function:

```javascript
export function shouldMergeEntities(cosine, threshold, tokensA, keyA, keyB) {
    if (cosine >= threshold) return true;
    const greyZoneFloor = threshold - 0.1;
    if (cosine >= greyZoneFloor) {
        const tokensB = new Set(keyB.split(/\s+/));
        return hasSufficientTokenOverlap(tokensA, tokensB, 0.5, keyA, keyB);
    }
    return false;
}
```

Change `0.5` to `0.6`:

```javascript
export function shouldMergeEntities(cosine, threshold, tokensA, keyA, keyB) {
    if (cosine >= threshold) return true;
    const greyZoneFloor = threshold - 0.1;
    if (cosine >= greyZoneFloor) {
        const tokensB = new Set(keyB.split(/\s+/));
        return hasSufficientTokenOverlap(tokensA, tokensB, 0.6, keyA, keyB);
    }
    return false;
}
```

- [ ] Step 4: Update the existing "50%+ token overlap" test title and ratio

The first test in the file uses `0.5` directly. Update its title and expectation to reflect the new system-wide ratio. In `tests/graph/token-overlap.test.js`, find:

```javascript
    it('should accept 50%+ token overlap', () => {
        const tokensA = new Set(['king', 'aldric', 'northern']);
        const tokensB = new Set(['king', 'aldric', 'southern']);

        expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.5)).toBe(true);
    });
```

Replace with:

```javascript
    it('should accept 60%+ token overlap', () => {
        const tokensA = new Set(['king', 'aldric', 'northern']);
        const tokensB = new Set(['king', 'aldric', 'southern']);

        // 2/3 = 0.67 ≥ 0.6 → passes
        expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.6)).toBe(true);
    });
```

- [ ] Step 5: Run tests to verify they pass

Run: `npx vitest run tests/graph/token-overlap.test.js --reporter=verbose`
Expected: ALL tests PASS.

- [ ] Step 6: Commit

```bash
git add src/graph/graph.js tests/graph/token-overlap.test.js && git commit -m "fix: raise overlap ratio 0.5->0.6 to prevent adjective-driven merges

Shared adjective stems like бордов (burgundy) or силиконов (silicone)
gave 1/2=0.5 on 2-token entities, triggering false merges. At 0.6,
these are blocked while legitimate merges (2/3=0.67+) still pass."
```

---

### Task 4: Bug 1 — Update CLAUDE.md Docs

**Files:**
- Modify: `src/graph/CLAUDE.md`

- [ ] Step 1: Update the SEMANTIC MERGE LOGIC section

In `src/graph/CLAUDE.md`, find:

```markdown
3. **Token Overlap Guard** (grey zone only): Strips base EN+RU stopwords (via `stopword` lib). Requires >= 50% overlap OR direct substring match.
```

Replace with:

```markdown
3. **Token Overlap Guard** (grey zone only): Strips base EN+RU stopwords (via `stopword` lib). Requires >= 60% stem/token overlap OR direct substring match OR fuzzy LCS match (≥ 70% ratio AND ≥ 4 absolute chars; short keys ≤ 4 chars: ≥ 60% ratio AND ≥ 2 chars).
```

- [ ] Step 2: Commit

```bash
git add src/graph/CLAUDE.md && git commit -m "docs: update merge threshold values in graph CLAUDE.md"
```

---

### Task 5: Bug 3 — Install cyrillic-to-translit-js and Register CDN Override

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `tests/setup.js`

- [ ] Step 1: Install the package

Run: `cd /c/projects/openvault && npm install --save cyrillic-to-translit-js`
Expected: Package added to `dependencies` in `package.json`.

- [ ] Step 2: Register CDN override for tests

In `tests/setup.js`, find the `CDN_SPECS` object:

```javascript
const CDN_SPECS = {
    zod: () => import('zod'),
    jsonrepair: () => import('jsonrepair'),
    'snowball-stemmers': () => import('snowball-stemmers'),
    stopword: () => import('stopword'),
    graphology: () => import('graphology'),
    'graphology-communities-louvain': () => import('graphology-communities-louvain'),
    'graphology-operators': () => import('graphology-operators'),
    'gpt-tokenizer/encoding/o200k_base': () => import('gpt-tokenizer/encoding/o200k_base'),
    'p-queue': () => import('p-queue'),
};
```

Add the new entry:

```javascript
const CDN_SPECS = {
    zod: () => import('zod'),
    jsonrepair: () => import('jsonrepair'),
    'snowball-stemmers': () => import('snowball-stemmers'),
    stopword: () => import('stopword'),
    graphology: () => import('graphology'),
    'graphology-communities-louvain': () => import('graphology-communities-louvain'),
    'graphology-operators': () => import('graphology-operators'),
    'gpt-tokenizer/encoding/o200k_base': () => import('gpt-tokenizer/encoding/o200k_base'),
    'p-queue': () => import('p-queue'),
    'cyrillic-to-translit-js': () => import('cyrillic-to-translit-js'),
};
```

- [ ] Step 3: Commit

```bash
git add package.json package-lock.json tests/setup.js && git commit -m "chore: add cyrillic-to-translit-js dependency for cross-script character matching"
```

---

### Task 6: Bug 3 — Create transliterate.js Utility

New utility module with two functions: `transliterateCyrToLat()` for Cyrillic→Latin conversion and `levenshteinDistance()` for string distance.

**Files:**
- Create: `src/utils/transliterate.js`
- Create: `tests/utils/transliterate.test.js`

- [ ] Step 1: Write tests for transliteration and Levenshtein

Create `tests/utils/transliterate.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import { levenshteinDistance, transliterateCyrToLat } from '../../src/utils/transliterate.js';

describe('transliterateCyrToLat', () => {
    it('transliterates Сузи to suzi', () => {
        expect(transliterateCyrToLat('Сузи')).toBe('suzi');
    });

    it('transliterates Вова to vova', () => {
        expect(transliterateCyrToLat('Вова')).toBe('vova');
    });

    it('transliterates Мина to mina', () => {
        expect(transliterateCyrToLat('Мина')).toBe('mina');
    });

    it('passes through Latin text unchanged (lowercased)', () => {
        expect(transliterateCyrToLat('Suzy')).toBe('suzy');
    });

    it('handles empty string', () => {
        expect(transliterateCyrToLat('')).toBe('');
    });
});

describe('levenshteinDistance', () => {
    it('returns 0 for identical strings', () => {
        expect(levenshteinDistance('suzy', 'suzy')).toBe(0);
    });

    it('returns string length for empty comparison', () => {
        expect(levenshteinDistance('abc', '')).toBe(3);
        expect(levenshteinDistance('', 'abc')).toBe(3);
    });

    it('returns 1 for single char difference (suzi vs suzy)', () => {
        expect(levenshteinDistance('suzi', 'suzy')).toBe(1);
    });

    it('returns 2 for two char differences', () => {
        // "vova" vs "vava" = 1 (o->a), "mina" vs "mona" = 1 (i->o)
        expect(levenshteinDistance('ab', 'cd')).toBe(2);
    });

    it('handles insertion/deletion', () => {
        expect(levenshteinDistance('cat', 'cats')).toBe(1);
        expect(levenshteinDistance('cats', 'cat')).toBe(1);
    });
});
```

- [ ] Step 2: Run tests to verify they fail (module not found)

Run: `npx vitest run tests/utils/transliterate.test.js --reporter=verbose`
Expected: FAIL with module not found error.

- [ ] Step 3: Create the transliterate.js module

Create `src/utils/transliterate.js`:

```javascript
import { cdnImport } from './cdn.js';

const CyrillicToTranslit = (await cdnImport('cyrillic-to-translit-js')).default;
const translit = new CyrillicToTranslit({ preset: 'ru' });

/**
 * Transliterate a Cyrillic string to Latin characters.
 * Non-Cyrillic characters pass through unchanged.
 * Result is always lowercased for key comparison.
 *
 * @param {string} str - Input string (may contain Cyrillic)
 * @returns {string} Lowercased Latin transliteration
 */
export function transliterateCyrToLat(str) {
    if (!str) return '';
    return translit.transform(str).toLowerCase();
}

/**
 * Compute Levenshtein edit distance between two strings.
 * Standard O(n*m) dynamic programming implementation.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
export function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Use single-row optimization: only need previous row + current row
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    let curr = new Array(b.length + 1);

    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            if (a[i - 1] === b[j - 1]) {
                curr[j] = prev[j - 1];
            } else {
                curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
            }
        }
        [prev, curr] = [curr, prev];
    }
    return prev[b.length];
}
```

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run tests/utils/transliterate.test.js --reporter=verbose`
Expected: ALL tests PASS.

- [ ] Step 5: Commit

```bash
git add src/utils/transliterate.js tests/utils/transliterate.test.js && git commit -m "feat: add transliterate.js utility for cross-script character matching

Provides transliterateCyrToLat() using cyrillic-to-translit-js and
levenshteinDistance() for fuzzy name matching. Used to detect that
Сузи=Suzy, Вова=Vova across scripts."
```

---

### Task 7: Bug 3A — findCrossScriptCharacterKeys in graph.js

New exported function that scans PERSON nodes in the graph for Cyrillic names that transliterate close to known main character keys.

**Files:**
- Modify: `src/graph/graph.js`
- Modify: `tests/graph/graph.test.js`

- [ ] Step 1: Write tests for findCrossScriptCharacterKeys

Add a new describe block in `tests/graph/graph.test.js`. First, add the import at the top where other graph.js imports are:

Find the existing import block:
```javascript
import {
    consolidateEdges,
    consolidateGraph,
    createEmptyGraph,
    expandMainCharacterKeys,
    initGraphState,
    markEdgeForConsolidation,
    mergeOrInsertEntity,
    normalizeKey,
    redirectEdges,
    shouldMergeEntities,
    upsertEntity,
    upsertRelationship,
} from '../../src/graph/graph.js';
```

Add `findCrossScriptCharacterKeys` to the import list:
```javascript
import {
    consolidateEdges,
    consolidateGraph,
    createEmptyGraph,
    expandMainCharacterKeys,
    findCrossScriptCharacterKeys,
    initGraphState,
    markEdgeForConsolidation,
    mergeOrInsertEntity,
    normalizeKey,
    redirectEdges,
    shouldMergeEntities,
    upsertEntity,
    upsertRelationship,
} from '../../src/graph/graph.js';
```

Then add the test block at the end of the file (before the final closing, or after the last describe block):

```javascript
describe('findCrossScriptCharacterKeys', () => {
    it('finds Cyrillic character node matching English base key', () => {
        const graphNodes = {
            suzy: { name: 'Suzy', type: 'PERSON', description: 'Main char', mentions: 28 },
            'сузи': { name: 'Сузи', type: 'PERSON', description: 'Главная героиня', mentions: 59 },
            'бордовый силиконовый дилдо': { name: 'Бордовый силиконовый дилдо', type: 'OBJECT', description: 'An object', mentions: 14 },
        };
        const result = findCrossScriptCharacterKeys(['suzy'], graphNodes);
        expect(result).toContain('сузи');
        expect(result).not.toContain('suzy');
        expect(result).toHaveLength(1);
    });

    it('finds multiple Cyrillic character nodes', () => {
        const graphNodes = {
            suzy: { name: 'Suzy', type: 'PERSON', description: 'Main char', mentions: 28 },
            vova: { name: 'Vova', type: 'PERSON', description: 'User', mentions: 28 },
            'сузи': { name: 'Сузи', type: 'PERSON', description: 'Героиня', mentions: 59 },
            'вова': { name: 'Вова', type: 'PERSON', description: 'Пользователь', mentions: 59 },
        };
        const result = findCrossScriptCharacterKeys(['suzy', 'vova'], graphNodes);
        expect(result).toContain('сузи');
        expect(result).toContain('вова');
        expect(result).toHaveLength(2);
    });

    it('does not match non-PERSON nodes', () => {
        const graphNodes = {
            suzy: { name: 'Suzy', type: 'PERSON', description: 'Main char', mentions: 28 },
            // Hypothetical Cyrillic OBJECT that transliterates near "suzy"
            'сузи': { name: 'Сузи', type: 'OBJECT', description: 'Not a person', mentions: 5 },
        };
        const result = findCrossScriptCharacterKeys(['suzy'], graphNodes);
        expect(result).toHaveLength(0);
    });

    it('does not match Latin PERSON nodes', () => {
        const graphNodes = {
            suzy: { name: 'Suzy', type: 'PERSON', description: 'Main', mentions: 28 },
            susan: { name: 'Susan', type: 'PERSON', description: 'NPC', mentions: 3 },
        };
        const result = findCrossScriptCharacterKeys(['suzy'], graphNodes);
        expect(result).toHaveLength(0);
    });

    it('returns empty array when no matches', () => {
        const graphNodes = {
            'замок': { name: 'Замок', type: 'PLACE', description: 'A castle', mentions: 5 },
        };
        const result = findCrossScriptCharacterKeys(['suzy'], graphNodes);
        expect(result).toHaveLength(0);
    });

    it('tolerates Levenshtein distance ≤ 2 (Мина→mina vs mina)', () => {
        const graphNodes = {
            mina: { name: 'Mina', type: 'PERSON', description: 'Third char', mentions: 10 },
            'мина': { name: 'Мина', type: 'PERSON', description: 'Третий персонаж', mentions: 20 },
        };
        const result = findCrossScriptCharacterKeys(['mina'], graphNodes);
        expect(result).toContain('мина');
    });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run tests/graph/graph.test.js --reporter=verbose -t "findCrossScriptCharacterKeys"`
Expected: FAIL — `findCrossScriptCharacterKeys` is not exported from graph.js.

- [ ] Step 3: Implement findCrossScriptCharacterKeys

In `src/graph/graph.js`, add the import at the top alongside other imports:

Find:
```javascript
import { countTokens } from '../utils/tokens.js';
```

Add after it:
```javascript
import { levenshteinDistance, transliterateCyrToLat } from '../utils/transliterate.js';
```

Then add the function after `expandMainCharacterKeys` (around line 80, after the existing `expandMainCharacterKeys` function):

```javascript
/**
 * Find graph node keys that are Cyrillic transliterations of known main character names.
 * Used to expand mainCharacterKeys for community detection hairball prevention.
 *
 * Scans all PERSON-type nodes with Cyrillic names, transliterates them to Latin,
 * and checks Levenshtein distance against each base key. Distance ≤ 2 is a match
 * (handles minor transliteration variants like Сузи→Suzi vs Suzy).
 *
 * @param {string[]} baseKeys - Normalized English main character keys
 * @param {Object} graphNodes - Graph nodes keyed by normalized name
 * @returns {string[]} Cyrillic node keys matching main characters
 */
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

- [ ] Step 4: Run tests to verify they pass

Run: `npx vitest run tests/graph/graph.test.js --reporter=verbose -t "findCrossScriptCharacterKeys"`
Expected: ALL 6 tests PASS.

- [ ] Step 5: Commit

```bash
git add src/graph/graph.js tests/graph/graph.test.js && git commit -m "feat: findCrossScriptCharacterKeys for Cyrillic character detection

Scans PERSON nodes for Cyrillic names that transliterate close to
known English main character keys (Levenshtein ≤ 2). Used to expand
mainCharacterKeys so Cyrillic hubs get attenuated during Louvain."
```

---

### Task 8: Bug 3A — Wire Cross-Script Keys into Community Detection

Integrate `findCrossScriptCharacterKeys` at both community detection sites in `extract.js`.

**Files:**
- Modify: `src/extraction/extract.js`

- [ ] Step 1: Add the import

In `src/extraction/extract.js`, find:

```javascript
import {
    consolidateEdges,
    expandMainCharacterKeys,
    initGraphState,
    mergeOrInsertEntity,
    normalizeKey,
    upsertRelationship,
} from '../graph/graph.js';
```

Add `findCrossScriptCharacterKeys`:

```javascript
import {
    consolidateEdges,
    expandMainCharacterKeys,
    findCrossScriptCharacterKeys,
    initGraphState,
    mergeOrInsertEntity,
    normalizeKey,
    upsertRelationship,
} from '../graph/graph.js';
```

- [ ] Step 2: Wire into the first community detection site (extractMemories)

In `src/extraction/extract.js`, find the first community detection block (around line 631):

```javascript
                    const baseKeys = [normalizeKey(characterName), normalizeKey(userName)];
                    const mainCharacterKeys = expandMainCharacterKeys(baseKeys, data.graph.nodes || {});
                    const communityResult = detectCommunities(data.graph, mainCharacterKeys);
```

Replace with:

```javascript
                    const baseKeys = [normalizeKey(characterName), normalizeKey(userName)];
                    const mainCharacterKeys = expandMainCharacterKeys(baseKeys, data.graph.nodes || {});
                    const crossScriptKeys = findCrossScriptCharacterKeys(baseKeys, data.graph.nodes || {});
                    mainCharacterKeys.push(...crossScriptKeys.filter(k => !mainCharacterKeys.includes(k)));
                    const communityResult = detectCommunities(data.graph, mainCharacterKeys);
```

- [ ] Step 3: Wire into the second community detection site (runPhase2Enrichment)

In `src/extraction/extract.js`, find the second community detection block (around line 755):

```javascript
            const baseKeys = [normalizeKey(characterName), normalizeKey(userName)];
            const mainCharacterKeys = expandMainCharacterKeys(baseKeys, data.graph.nodes || {});
            const communityResult = detectCommunities(data.graph, mainCharacterKeys);
```

Replace with:

```javascript
            const baseKeys = [normalizeKey(characterName), normalizeKey(userName)];
            const mainCharacterKeys = expandMainCharacterKeys(baseKeys, data.graph.nodes || {});
            const crossScriptKeys = findCrossScriptCharacterKeys(baseKeys, data.graph.nodes || {});
            mainCharacterKeys.push(...crossScriptKeys.filter(k => !mainCharacterKeys.includes(k)));
            const communityResult = detectCommunities(data.graph, mainCharacterKeys);
```

- [ ] Step 4: Run full test suite to check for regressions

Run: `npx vitest run --reporter=verbose`
Expected: ALL tests PASS. No regressions.

- [ ] Step 5: Commit

```bash
git add src/extraction/extract.js && git commit -m "feat: expand mainCharacterKeys with cross-script Cyrillic matches

Both community detection sites now find Cyrillic PERSON nodes
(e.g. Сузи, Вова) and add them to mainCharacterKeys so their edges
get attenuated during Louvain, breaking the hairball."
```

---

### Task 9: Bug 3B — Cross-Script Merge in mergeOrInsertEntity

Add a cross-script check in `mergeOrInsertEntity()` so that Cyrillic PERSON entities matching known main character names are force-merged into the existing English node at extraction time, preventing duplicates at the source.

**Files:**
- Modify: `src/graph/graph.js`
- Modify: `src/extraction/extract.js`
- Modify: `tests/graph/graph.test.js`

- [ ] Step 1: Write test for cross-script PERSON merge

Add to `tests/graph/graph.test.js`, in the existing `mergeOrInsertEntity` describe block (find it by searching for `describe('mergeOrInsertEntity'`):

```javascript
    it('force-merges Cyrillic PERSON name matching main character via transliteration', async () => {
        // Setup: existing English character node
        graphData.nodes.suzy = {
            name: 'Suzy',
            type: 'PERSON',
            description: 'Main character',
            mentions: 28,
        };

        // Act: insert Cyrillic variant with mainCharacterNames
        const key = await mergeOrInsertEntity(
            graphData,
            'Сузи',
            'PERSON',
            'Главная героиня',
            3,
            { entityMergeSimilarityThreshold: 0.95 },
            ['Suzy', 'Vova']
        );

        // Assert: merged into existing English node
        expect(key).toBe('suzy');
        expect(graphData.nodes.suzy.description).toContain('Главная героиня');
        expect(graphData.nodes.suzy.aliases).toContain('Сузи');
        expect(graphData.nodes['сузи']).toBeUndefined();
        // Redirect exists so edges referencing "сузи" resolve to "suzy"
        expect(graphData._mergeRedirects?.['сузи']).toBe('suzy');
    });

    it('does not cross-script merge non-PERSON entities', async () => {
        graphData.nodes.suzy = {
            name: 'Suzy',
            type: 'PERSON',
            description: 'Main character',
            mentions: 28,
        };

        // Insert a Cyrillic OBJECT — should NOT merge into Suzy even if name matches
        const key = await mergeOrInsertEntity(
            graphData,
            'Сузи',
            'OBJECT',
            'Some object named Сузи',
            3,
            { entityMergeSimilarityThreshold: 0.95 },
            ['Suzy']
        );

        // Should create a new node, not merge
        expect(key).toBe('сузи');
        expect(graphData.nodes['сузи']).toBeDefined();
    });

    it('works without mainCharacterNames (backward compatible)', async () => {
        // Existing behavior: no cross-script check when param not provided
        const key = await mergeOrInsertEntity(
            graphData,
            'Сузи',
            'PERSON',
            'Some person',
            3,
            { entityMergeSimilarityThreshold: 0.95 }
        );

        // Creates new node since no embedding match and no cross-script names
        expect(key).toBe('сузи');
        expect(graphData.nodes['сузи']).toBeDefined();
    });
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run tests/graph/graph.test.js --reporter=verbose -t "force-merges Cyrillic"`
Expected: FAIL — the function doesn't have cross-script logic yet, so "Сузи" creates a new node instead of merging.

- [ ] Step 3: Add cross-script merge to mergeOrInsertEntity

In `src/graph/graph.js`, change the function signature from:

```javascript
export async function mergeOrInsertEntity(graphData, name, type, description, cap, settings) {
```

to:

```javascript
export async function mergeOrInsertEntity(graphData, name, type, description, cap, settings, mainCharacterNames = []) {
```

Then, just before the "No match: create new node" block at the end of the function, find:

```javascript
    // No match: create new node with embedding
    upsertEntity(graphData, name, type, description, cap);
    setEmbedding(graphData.nodes[key], newEmbedding);
    return key;
```

Add the cross-script check BEFORE that block:

```javascript
    // Cross-script merge: if this is a PERSON entity and its transliterated name
    // matches a known main character, force-merge to prevent character duplication.
    if (type === 'PERSON' && mainCharacterNames.length > 0) {
        const transliterated = transliterateCyrToLat(key);
        for (const mainName of mainCharacterNames) {
            const mainKey = normalizeKey(mainName);
            if (graphData.nodes[mainKey] && levenshteinDistance(transliterated, mainKey) <= 2) {
                logDebug(
                    `[graph] Cross-script merge: "${name}" (${key}) → "${graphData.nodes[mainKey].name}" (${mainKey}), transliterated: "${transliterated}"`
                );
                upsertEntity(graphData, graphData.nodes[mainKey].name, type, description, cap);
                if (!graphData.nodes[mainKey].aliases) graphData.nodes[mainKey].aliases = [];
                graphData.nodes[mainKey].aliases.push(name);
                if (!graphData._mergeRedirects) graphData._mergeRedirects = {};
                if (key !== mainKey) {
                    graphData._mergeRedirects[key] = mainKey;
                }
                return mainKey;
            }
        }
    }

    // No match: create new node with embedding
    upsertEntity(graphData, name, type, description, cap);
    setEmbedding(graphData.nodes[key], newEmbedding);
    return key;
```

- [ ] Step 4: Run the mergeOrInsertEntity tests

Run: `npx vitest run tests/graph/graph.test.js --reporter=verbose -t "mergeOrInsertEntity"`
Expected: ALL tests PASS including the 3 new ones.

- [ ] Step 5: Wire mainCharacterNames into extract.js caller

In `src/extraction/extract.js`, find the mergeOrInsertEntity call (around line 523):

```javascript
            for (const entity of validated.entities) {
                if (entity.name === 'Unknown') continue;
                await mergeOrInsertEntity(
                    data.graph,
                    entity.name,
                    entity.type,
                    entity.description,
                    entityCap,
                    settings
                );
            }
```

Replace with:

```javascript
            for (const entity of validated.entities) {
                if (entity.name === 'Unknown') continue;
                await mergeOrInsertEntity(
                    data.graph,
                    entity.name,
                    entity.type,
                    entity.description,
                    entityCap,
                    settings,
                    [characterName, userName]
                );
            }
```

- [ ] Step 6: Run full test suite

Run: `npx vitest run --reporter=verbose`
Expected: ALL tests PASS. No regressions.

- [ ] Step 7: Commit

```bash
git add src/graph/graph.js src/extraction/extract.js tests/graph/graph.test.js && git commit -m "feat: cross-script PERSON merge in mergeOrInsertEntity

When a new PERSON entity's transliterated name matches a known main
character (Levenshtein ≤ 2), force-merge into the existing English
node. Prevents Сузи/Suzy, Вова/Vova duplication at extraction time.
English name stays primary, Cyrillic added as alias."
```

---

### Task 10: Bug 3 — Update CLAUDE.md Docs

**Files:**
- Modify: `src/utils/CLAUDE.md`
- Modify: `src/graph/CLAUDE.md`

- [ ] Step 1: Document transliterate.js in utils CLAUDE.md

In `src/utils/CLAUDE.md`, add a new section after the `stemmer.js & stopwords.js` section:

```markdown
### `transliterate.js`
- `transliterateCyrToLat(str)`: Cyrillic→Latin via `cyrillic-to-translit-js` (CDN import, Russian preset). Always lowercased.
- `levenshteinDistance(a, b)`: Standard O(n*m) edit distance. Used for fuzzy cross-script name matching (threshold: ≤ 2).
- **Use case**: Detecting that "Сузи" = "Suzy" and "Вова" = "Vova" across Cyrillic/Latin scripts for character deduplication.
```

- [ ] Step 2: Update graph CLAUDE.md merge logic section

In `src/graph/CLAUDE.md`, find the existing section about aliases:

```markdown
4. **Aliases**: If merged, the absorbed name is pushed to the surviving node's `aliases` array for future retrieval matching.
```

Add after it:

```markdown
4b. **Cross-Script Merge** (PERSON only): Before creating a new node, `mergeOrInsertEntity` checks if the transliterated name matches any known main character (Levenshtein ≤ 2). Force-merges Cyrillic variants (Сузи→Suzy, Вова→Vova) into the English node. English name stays primary, Cyrillic added as alias.
```

Also find:

```markdown
- **Hairball Prevention**: Edges involving main characters (User/Char + their aliases) are attenuated by `MAIN_CHARACTER_ATTENUATION` (95% weight reduction) instead of dropped.
```

Append after the existing sentence:

```markdown
`findCrossScriptCharacterKeys()` also expands the key set with Cyrillic PERSON nodes that transliterate close to main character names (Levenshtein ≤ 2).
```

- [ ] Step 3: Commit

```bash
git add src/utils/CLAUDE.md src/graph/CLAUDE.md && git commit -m "docs: document cross-script transliteration and character merge"
```

---

### Task 11: Full Regression Test + Version Bump

**Files:**
- Modify: `package.json`

- [ ] Step 1: Run the full test suite

Run: `npx vitest run --reporter=verbose`
Expected: ALL tests PASS. Zero failures.

- [ ] Step 2: Bump version

In `package.json`, bump the version (patch increment from current 10.50):

Run: `npm version 10.51 --no-git-tag-version`

- [ ] Step 3: Final commit

```bash
git add -A && git commit -m "Bump to 10.51"
```
