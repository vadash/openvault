# Implementation Plan - Unified Stopword System

> **Reference:** `docs/designs/2025-03-05-stopword-refactor-design.md`
> **Execution:** Use `executing-plans` skill.

## Overview

Replace 4 separate hardcoded stopword lists with a single `src/utils/stopwords.js` module that imports EN+RU stopwords from the `stopword` package.

---

## Task 1: Create the Unified Stopwords Module

**Goal:** Create `src/utils/stopwords.js` as the single source of truth.

**Step 1: Create the Module File**
- File: `src/utils/stopwords.js`
- Action: Create new file with this EXACT content:

```javascript
/**
 * OpenVault Unified Stopword Module
 *
 * Single source of truth for all stopword filtering.
 * Imports base stopwords from 'stopword' package (EN + RU).
 * Adds custom words for graph merging and query context.
 */

import { eng, rus } from 'https://esm.sh/stopword';

// Core stopwords from package (EN + RU)
const BASE_STOPWORDS = new Set([...eng, ...rus]);

// Graph entity merging - generic terms that shouldn't block merging
const GRAPH_CUSTOM = new Set([
  // Articles & determiners
  'the', 'a', 'an', 'this', 'that', 'these', 'those',
  // Colors
  'red', 'blue', 'green', 'yellow', 'black', 'white',
  'burgundy', 'dark', 'light',
  // Sizes & generic descriptors
  'large', 'small', 'big',
  // Common adjectives
  'old', 'new', 'young', 'first', 'last', 'other'
]);

// Query context - sentence starters and discourse markers
const QUERY_STARTERS = new Set([
  // Latin (English) starters
  'The', 'This', 'That', 'Then', 'There', 'When', 'Where',
  'What', 'Which', 'While', 'Since', 'Because', 'Although',
  'However', 'Therefore', 'Moreover', 'Furthermore',
  'These', 'Those', 'Who', 'Why', 'How', 'Here', 'Now',
  'Just', 'But', 'And', 'Yet', 'Still', 'Also', 'Only',
  'Even', 'Well', 'Much', 'Very', 'Some',
  // Cyrillic (Russian) starters
  'После', 'Когда', 'Потом', 'Затем', 'Тогда', 'Здесь', 'Там',
  'Это', 'Эта', 'Этот', 'Эти', 'Что', 'Как', 'Где', 'Куда',
  'Почему', 'Зачем', 'Кто', 'Чей', 'Какой', 'Какая', 'Какое',
  'Пока', 'Если', 'Хотя', 'Также', 'Ещё', 'Уже', 'Вот', 'Вон',
  // Interjections & filler words
  'Ага', 'Угу', 'Ого', 'Ура', 'Хм', 'Ну',
  // Affirmations, negations, casual
  'Да', 'Нет', 'Ладно', 'Хорошо', 'Ок',
  // Expletives (common in RP)
  'Блин', 'Блять', 'Бля',
  // Discourse markers
  'Значит', 'Типа', 'Короче', 'Просто', 'Конечно',
  'Наверное', 'Возможно', 'Может',
  // Informal speech common in RP
  'Воны', 'Чё', 'Чо', 'Ваще', 'Щас'
]);

// Unified export - lowercase for case-insensitive matching
export const ALL_STOPWORDS = new Set([
  ...[...BASE_STOPWORDS].map(w => w.toLowerCase()),
  ...[...GRAPH_CUSTOM].map(w => w.toLowerCase()),
  ...[...QUERY_STARTERS].map(w => w.toLowerCase())
]);

// Re-export utility function from package
export { removeStopwords } from 'https://esm.sh/stopword';
```

**Step 2: Verify File Created**
- Command: `ls -la src/utils/stopwords.js`
- Expect: File exists

**Step 3: Git Commit**
- Command: `git add src/utils/stopwords.js && git commit -m "feat: create unified stopwords module with stopword package"`

---

## Task 2: Update `src/retrieval/math.js`

**Goal:** Replace hardcoded `STOP_WORDS` with import from new module.

**Step 1: Read Current Implementation (Verification)**
- Command: `head -n 200 src/retrieval/math.js | grep -A 5 "STOP_WORDS"`
- Expect: See hardcoded Set definition

**Step 2: Remove Hardcoded Stopwords**
- File: `src/retrieval/math.js`
- Action: Find line `const STOP_WORDS = new Set([` and DELETE the entire Set definition (lines 29-197 approximately)
- After deletion, add import at top of file:

```javascript
import { ALL_STOPWORDS } from '../utils/stopwords.js';
```

**Step 3: Verify Import Added**
- Command: `head -n 20 src/retrieval/math.js | grep stopwords`
- Expect: Import statement visible

**Step 4: Run Tests (Red → Green)**
- Command: `npm test tests/math.test.js`
- Expect: PASS (behavior should be identical)

**Step 5: Git Commit**
- Command: `git add src/retrieval/math.js && git commit -m "refactor: math.js uses unified stopwords module"`

---

## Task 3: Update `src/graph/graph.js`

**Goal:** Replace hardcoded `stopWords` in `hasSufficientTokenOverlap()` function.

**Step 1: Find the Stopwords Set**
- Command: `grep -n "const stopWords = new Set" src/graph/graph.js`
- Expect: Found at line ~204

**Step 2: Remove Hardcoded Stopwords**
- File: `src/graph/graph.js`
- Action:
  1. Add at top of file: `import { ALL_STOPWORDS } from '../utils/stopwords.js';`
  2. Find `const stopWords = new Set([...])` inside `hasSufficientTokenOverlap()`
  3. DELETE that entire Set definition
  4. In the same function, replace `stopWords` with `ALL_STOPWORDS` in the filter line

**Step 3: Verify Changes**
- Command: `grep -n "ALL_STOPWORDS" src/graph/graph.js`
- Expect: Import and usage visible

**Step 4: Run Tests**
- Command: `npm test tests/graph.test.js` (if exists) or `npm test`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/graph/graph.js && git commit -m "refactor: graph.js uses unified stopwords module"`

---

## Task 4: Update `src/retrieval/query-context.js`

**Goal:** Replace `LATIN_STARTERS` and `CYRILLIC_STARTERS` with unified import.

**Step 1: Find Hardcoded Sets**
- Command: `grep -n "STARTERS = new Set" src/retrieval/query-context.js`
- Expect: Two Sets found at lines ~14 and ~47

**Step 2: Remove Hardcoded Sets**
- File: `src/retrieval/query-context.js`
- Action:
  1. Add at top: `import { ALL_STOPWORDS } from '../utils/stopwords.js';`
  2. DELETE `const LATIN_STARTERS = new Set([...])` (lines 14-42)
  3. DELETE `const CYRILLIC_STARTERS = new Set([...])` (lines 44-96)
  4. In `extractFromText()` function, replace both conditionals:
     - Change `if (!LATIN_STARTERS.has(match))` to `if (!ALL_STOPWORDS.has(match))`
     - Change `if (!CYRILLIC_STARTERS.has(cleaned))` to `if (!ALL_STOPWORDS.has(cleaned))`

**Step 3: Verify Changes**
- Command: `grep -n "ALL_STOPWORDS" src/retrieval/query-context.js`
- Expect: Import and two usages visible

**Step 4: Run Tests**
- Command: `npm test tests/query-context.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add src/retrieval/query-context.js && git commit -m "refactor: query-context.js uses unified stopwords module"`

---

## Task 5: Verify Full Test Suite

**Goal:** Ensure all tests pass after refactor.

**Step 1: Run All Tests**
- Command: `npm test`
- Expect: All tests PASS

**Step 2: Check for Leftover Hardcoded Stopwords**
- Command: `grep -r "new Set\[" src/ --include="*.js" | grep -v node_modules | grep -v stopwords.js`
- Expect: Only `src/utils/stopwords.js` should contain Set literals with word lists

**Step 3: Verify No Hardcoded Arrays Remain**
- Command: `grep -r "STOP_WORDS\|stopWords\|LATIN_STARTERS\|CYRILLIC_STARTERS" src/ --include="*.js" | grep -v "import" | grep -v "ALL_STOPWORDS" | grep -v stopwords.js`
- Expect: Empty output (no old variable names)

**Step 4: Git Commit (Verification)**
- Command: `git add . && git commit -m "test: verify stopword refactor complete - all tests passing"`

---

## Task 6: Clean Up Test Files (If Needed)

**Goal:** Remove any duplicated stopword lists in test files.

**Step 1: Check Test Files**
- Command: `grep -r "STOP_WORDS\|stopWords" tests/ --include="*.js"`
- Expect: Identify any test files with hardcoded stopwords

**Step 2: Update Test Imports (If Found)**
- If test files have stopwords:
  - Add `import { ALL_STOPWORDS } from '../src/utils/stopwords.js';`
  - Replace local `STOP_WORDS` references with `ALL_STOPWORDS`

**Step 3: Final Test Run**
- Command: `npm test`
- Expect: All tests PASS

**Step 4: Git Commit**
- Command: `git add tests/ && git commit -m "test: use unified stopwords in test files"`

---

## Verification Checklist

- [ ] `src/utils/stopwords.js` exists and exports `ALL_STOPWORDS`
- [ ] `src/retrieval/math.js` imports from new module
- [ ] `src/graph/graph.js` imports from new module
- [ ] `src/retrieval/query-context.js` imports from new module
- [ ] No hardcoded stopword arrays remain in `src/`
- [ ] All tests pass: `npm test`
- [ ] Mixed EN/RU text still processes correctly

---

## Rollback Procedure

If anything breaks:
```bash
git revert HEAD~5..HEAD  # Revert all commits
```
