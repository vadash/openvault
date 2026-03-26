# Centralize Magic Strings and Orphaned Constants — Implementation Plan

**Goal:** Replace scattered string literals and duplicated numeric thresholds with named constants from `src/constants.js` for safer refactoring.
**Architecture:** Pure mechanical refactoring — no behavior changes. New frozen object constants added to `constants.js`, imported and substituted in source files.
**Tech Stack:** JavaScript (ESM), Vitest

---

### Task 1: Add new constants to `src/constants.js`

**Files:**
- Modify: `src/constants.js`

- [ ] Step 1: Add `ENTITY_TYPES` frozen object after the `INJECTION_POSITIONS` / `POSITION_LABELS` section

```js
// ============== Entity Types ==============
const ENTITY_TYPES = Object.freeze({
  PERSON: 'PERSON',
  PLACE: 'PLACE',
  ORGANIZATION: 'ORGANIZATION',
  OBJECT: 'OBJECT',
  CONCEPT: 'CONCEPT',
});
```

- [ ] Step 2: Add `EMBEDDING_SOURCES` frozen object after the `embeddingModelPrefixes` section

```js
// ============== Embedding Sources ==============
const EMBEDDING_SOURCES = Object.freeze({
  LOCAL: 'local',
  OLLAMA: 'ollama',
  ST_VECTOR: 'st_vector',
});
```

- [ ] Step 3: Add new numeric constants to the threshold section (near `ENTITY_MERGE_THRESHOLD`)

```js
const GRAPH_JACCARD_DUPLICATE_THRESHOLD = 0.6;
const ENTITY_TOKEN_OVERLAP_MIN_RATIO = 0.5;
const REFLECTION_SKIP_SIMILARITY = 0.85;
const REFLECTION_MIN_MEMORIES = 40;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const CORPUS_GROUNDED_BOOST_RATIO = 0.6;
const NON_GROUNDED_BOOST_RATIO = 0.4;
```

- [ ] Step 4: Add `ST_API_ENDPOINTS` frozen object near the end of the file

```js
// ============== ST API Endpoints ==============
const ST_API_ENDPOINTS = Object.freeze({
  INSERT: '/api/vector/insert',
  DELETE: '/api/vector/delete',
  PURGE: '/api/vector/purge',
  QUERY: '/api/vector/query',
});
```

- [ ] Step 5: Export all new constants in the module's export block

Add to existing export: `ENTITY_TYPES`, `EMBEDDING_SOURCES`, `ST_API_ENDPOINTS`, `GRAPH_JACCARD_DUPLICATE_THRESHOLD`, `ENTITY_TOKEN_OVERLAP_MIN_RATIO`, `REFLECTION_SKIP_SIMILARITY`, `REFLECTION_MIN_MEMORIES`, `BM25_K1`, `BM25_B`, `CORPUS_GROUNDED_BOOST_RATIO`, `NON_GROUNDED_BOOST_RATIO`.

- [ ] Step 6: Run full test suite to verify no breakage

Run: `npm run test`
Expected: All tests pass (no source files import these yet, so no behavior change)

- [ ] Step 7: Commit

```bash
git add src/constants.js && git commit -m "refactor: add centralized constants for entity types, embedding sources, endpoints, and thresholds"
```

---

### Task 2: Update `src/graph/graph.js`

**Files:**
- Modify: `src/graph/graph.js`
- Test: `tests/graph/graph.test.js`, `tests/graph/token-overlap.test.js`

- [ ] Step 1: Run graph tests (green baseline)

Run: `npx vitest run tests/graph/`
Expected: All pass

- [ ] Step 2: Update import to include new constants

Change:
```js
import { CONSOLIDATION, ENTITY_MERGE_THRESHOLD, extensionName } from '../constants.js';
```
To:
```js
import { CONSOLIDATION, ENTITY_MERGE_THRESHOLD, ENTITY_TOKEN_OVERLAP_MIN_RATIO, ENTITY_TYPES, extensionName, GRAPH_JACCARD_DUPLICATE_THRESHOLD } from '../constants.js';
```

- [ ] Step 3: Replace entity type string literals

| Line | Before | After |
|------|--------|-------|
| 110 | `node.type !== 'PERSON'` | `node.type !== ENTITY_TYPES.PERSON` |
| 134 | JSDoc `"PERSON" \| "PLACE" \| ...` | Leave as JSDoc type annotation (not runtime) |
| 368 | `type === 'PERSON'` | `type === ENTITY_TYPES.PERSON` |

Note: Lines 364, 383 are JSDoc type annotations — leave those as-is since they're documentation, not runtime values.

- [ ] Step 4: Replace `JACCARD_DUPLICATE_THRESHOLD`

Delete the local constant on line 198:
```js
const JACCARD_DUPLICATE_THRESHOLD = 0.6;
```
No other change needed — the name matches the imported constant, so all usages on line 200 automatically resolve to the imported value.

- [ ] Step 5: Replace `minOverlapRatio = 0.5` default

Change line 281:
```js
export function hasSufficientTokenOverlap(tokensA, tokensB, minOverlapRatio = 0.5, keyA = '', keyB = '') {
```
To:
```js
export function hasSufficientTokenOverlap(tokensA, tokensB, minOverlapRatio = ENTITY_TOKEN_OVERLAP_MIN_RATIO, keyA = '', keyB = '') {
```

- [ ] Step 6: Run graph tests

Run: `npx vitest run tests/graph/`
Expected: All pass

- [ ] Step 7: Commit

```bash
git add src/graph/graph.js && git commit -m "refactor(graph): use centralized constants for entity types and thresholds"
```

---

### Task 3: Update `src/embeddings.js`

**Files:**
- Modify: `src/embeddings.js`
- Test: `tests/embeddings.test.js`, `tests/embeddings/migration.test.js`

- [ ] Step 1: Run embedding tests (green baseline)

Run: `npx vitest run tests/embeddings/`
Expected: All pass

- [ ] Step 2: Update import

Change:
```js
import { extensionName } from './constants.js';
```
To:
```js
import { EMBEDDING_SOURCES, extensionName } from './constants.js';
```

- [ ] Step 3: Replace embedding source string literals

| Line | Before | After |
|------|--------|-------|
| 472 | `return 'st_vector';` | `return EMBEDDING_SOURCES.ST_VECTOR;` |
| 535 | `st_vector: new StVectorStrategy()` | `st_vector` is an object key — this is a settings value match, not a comparison. Leave as-is (the key must match the Zod schema value). |
| 586 | `source === 'ollama'` | `source === EMBEDDING_SOURCES.OLLAMA` |

Note: Line 535 uses `'st_vector'` as an object property key in the strategy registry. The key must match the setting value from `defaultSettings.embeddingSource`. This is a registry pattern, not a comparison — leave it as a string key. Alternatively, use computed property: `[EMBEDDING_SOURCES.ST_VECTOR]: new StVectorStrategy()`. Prefer computed property for consistency.

- [ ] Step 4: Run embedding tests

Run: `npx vitest run tests/embeddings/`
Expected: All pass

- [ ] Step 5: Commit

```bash
git add src/embeddings.js && git commit -m "refactor(embeddings): use centralized EMBEDDING_SOURCES constants"
```

---

### Task 4: Update `src/extraction/extract.js`

**Files:**
- Modify: `src/extraction/extract.js`
- Test: `tests/extraction/dedup.test.js`

- [ ] Step 1: Run extraction tests (green baseline)

Run: `npx vitest run tests/extraction/`
Expected: All pass

- [ ] Step 2: Update import

Add to existing import block:
```js
import {
    CHARACTERS_KEY,
    COMMUNITY_STALENESS_THRESHOLD,
    EDGE_DESCRIPTION_CAP,
    EMBEDDING_SOURCES,
    ENTITY_DESCRIPTION_CAP,
    ENTITY_TYPES,
    extensionName,
    MEMORIES_KEY,
} from '../constants.js';
```

- [ ] Step 3: Replace entity type string literal

Line 260: `node.type === 'PERSON'` → `node.type === ENTITY_TYPES.PERSON`

- [ ] Step 4: Replace embedding source string literal

Line 965: `settings.embeddingSource === 'st_vector'` → `settings.embeddingSource === EMBEDDING_SOURCES.ST_VECTOR`

- [ ] Step 5: Replace `filterSimilarEvents` default parameters

Line 517:
```js
export async function filterSimilarEvents(newEvents, existingMemories, cosineThreshold = 0.92, jaccardThreshold = 0.6) {
```
To:
```js
export async function filterSimilarEvents(newEvents, existingMemories, cosineThreshold = CONSOLIDATION.dedupSimilarityThreshold, jaccardThreshold = CONSOLIDATION.dedupJaccardThreshold) {
```

Also add `CONSOLIDATION` to the import if not already present.

- [ ] Step 6: Run extraction tests

Run: `npx vitest run tests/extraction/`
Expected: All pass

- [ ] Step 7: Commit

```bash
git add src/extraction/extract.js && git commit -m "refactor(extraction): use centralized constants for entity types, embedding sources, and dedup thresholds"
```

---

### Task 5: Update `src/services/st-vector.js`

**Files:**
- Modify: `src/services/st-vector.js`
- Test: `tests/services/st-vector.test.js`

- [ ] Step 1: Run st-vector tests (green baseline)

Run: `npx vitest run tests/services/st-vector.test.js`
Expected: All pass

- [ ] Step 2: Update import

Change:
```js
import { getDeps } from '../deps.js';
```
To:
```js
import { EMBEDDING_SOURCES, ST_API_ENDPOINTS } from '../constants.js';
import { getDeps } from '../deps.js';
```

- [ ] Step 3: Replace API endpoint string literals

| Line | Before | After |
|------|--------|-------|
| 223 | `'/api/vector/insert'` | `ST_API_ENDPOINTS.INSERT` |
| 258 | `'/api/vector/delete'` | `ST_API_ENDPOINTS.DELETE` |
| 282 | `'/api/vector/purge'` | `ST_API_ENDPOINTS.PURGE` |
| 331 | `'/api/vector/query'` | `ST_API_ENDPOINTS.QUERY` |

- [ ] Step 4: Replace embedding source string literal

Line 201: `settings?.embeddingSource === 'st_vector'` → `settings?.embeddingSource === EMBEDDING_SOURCES.ST_VECTOR`

- [ ] Step 5: Run st-vector tests

Run: `npx vitest run tests/services/st-vector.test.js`
Expected: All pass

Note: Test assertions check `'/api/vector/purge'` as literal strings — these are test data verifying the correct endpoint is called. They intentionally stay as literals per test conventions.

- [ ] Step 6: Commit

```bash
git add src/services/st-vector.js && git commit -m "refactor(st-vector): use centralized constants for API endpoints and embedding source"
```

---

### Task 6: Update `src/store/chat-data.js`

**Files:**
- Modify: `src/store/chat-data.js`
- Test: `tests/store/chat-data.test.js`

- [ ] Step 1: Run store tests (green baseline)

Run: `npx vitest run tests/store/`
Expected: All pass

- [ ] Step 2: Update import

Add `EMBEDDING_SOURCES` to the existing import:
```js
import { CHARACTERS_KEY, EMBEDDING_SOURCES, MEMORIES_KEY, METADATA_KEY, PROCESSED_MESSAGES_KEY } from '../constants.js';
```

- [ ] Step 3: Replace embedding source string literal

Line 186: `settings?.embeddingSource === 'st_vector'` → `settings?.embeddingSource === EMBEDDING_SOURCES.ST_VECTOR`

- [ ] Step 4: Run store tests

Run: `npx vitest run tests/store/`
Expected: All pass

- [ ] Step 5: Commit

```bash
git add src/store/chat-data.js && git commit -m "refactor(store): use centralized EMBEDDING_SOURCES constant"
```

---

### Task 7: Update `src/reflection/reflect.js`

**Files:**
- Modify: `src/reflection/reflect.js`
- Test: `tests/reflection/`

- [ ] Step 1: Run reflection tests (green baseline)

Run: `npx vitest run tests/reflection/`
Expected: All pass

- [ ] Step 2: Update import

Add new constants to existing import:
```js
import {
    extensionName,
    REFLECTION_CANDIDATE_LIMIT,
    REFLECTION_DEDUP_REJECT_THRESHOLD,
    REFLECTION_DEDUP_REPLACE_THRESHOLD,
    REFLECTION_MIN_MEMORIES,
    REFLECTION_SKIP_SIMILARITY,
} from '../constants.js';
```

- [ ] Step 3: Remove local `REFLECTION_THRESHOLD` constant

Delete line 64:
```js
const REFLECTION_THRESHOLD = 40;
```

- [ ] Step 4: Update `shouldReflect` default parameter

Line 67:
```js
export function shouldReflect(reflectionState, characterName, threshold = REFLECTION_THRESHOLD) {
```
To:
```js
export function shouldReflect(reflectionState, characterName, threshold = REFLECTION_MIN_MEMORIES) {
```

- [ ] Step 5: Update `shouldSkipReflectionGeneration` default parameter

Line 137:
```js
export function shouldSkipReflectionGeneration(recentMemories, existingReflections, threshold = 0.85) {
```
To:
```js
export function shouldSkipReflectionGeneration(recentMemories, existingReflections, threshold = REFLECTION_SKIP_SIMILARITY) {
```

- [ ] Step 6: Update call site that passes `0.85` explicitly

Line 230: Replace the hardcoded `0.85` argument with the constant reference.

- [ ] Step 7: Run reflection tests

Run: `npx vitest run tests/reflection/`
Expected: All pass

- [ ] Step 8: Commit

```bash
git add src/reflection/reflect.js && git commit -m "refactor(reflection): use centralized constants for thresholds"
```

---

### Task 8: Update `src/retrieval/math.js`

**Files:**
- Modify: `src/retrieval/math.js`
- Test: `tests/math.test.js`

- [ ] Step 1: Run math tests (green baseline)

Run: `npx vitest run tests/math.test.js`
Expected: All pass

- [ ] Step 2: Update import

Change:
```js
import { VECTOR_PASS_LIMIT } from '../constants.js';
```
To:
```js
import { BM25_B, BM25_K1, VECTOR_PASS_LIMIT } from '../constants.js';
```

- [ ] Step 3: Remove local BM25 constants

Delete lines 29-30:
```js
// BM25 parameters
const BM25_K1 = 1.2;
const BM25_B = 0.75;
```

No usage changes needed — the variable names match the imported constants, so the BM25 formula on line 140 and any other usages automatically resolve correctly.

- [ ] Step 4: Run math tests

Run: `npx vitest run tests/math.test.js`
Expected: All pass

- [ ] Step 5: Commit

```bash
git add src/retrieval/math.js && git commit -m "refactor(retrieval): move BM25 parameters to centralized constants"
```

---

### Task 9: Update `src/retrieval/query-context.js`

**Files:**
- Modify: `src/retrieval/query-context.js`

- [ ] Step 1: Run retrieval tests (green baseline)

Run: `npx vitest run tests/retrieval/`
Expected: All pass

- [ ] Step 2: Add import

Add to imports:
```js
import { CORPUS_GROUNDED_BOOST_RATIO, NON_GROUNDED_BOOST_RATIO } from '../constants.js';
```

- [ ] Step 3: Remove local constants

Delete lines 14-15:
```js
const CORPUS_GROUNDED_BOOST_RATIO = 0.6;
const NON_GROUNDED_BOOST_RATIO = 0.4;
```

No usage changes needed — the variable names match the imported constants.

- [ ] Step 4: Run retrieval tests

Run: `npx vitest run tests/retrieval/`
Expected: All pass

- [ ] Step 5: Commit

```bash
git add src/retrieval/query-context.js && git commit -m "refactor(retrieval): move corpus boost ratio constants to centralized constants"
```

---

### Task 10: Update `src/prompts/graph/rules.js` and `src/prompts/graph/schema.js`

**Files:**
- Modify: `src/prompts/graph/rules.js`
- Modify: `src/prompts/graph/schema.js`

- [ ] Step 1: Update `rules.js` — add import and replace entity type references

Add import at top:
```js
import { ENTITY_TYPES } from '../../constants.js';
```

Replace entity type strings in the rules template string (lines 5-9):
- `PERSON:` → `${ENTITY_TYPES.PERSON}:`
- `PLACE:` → `${ENTITY_TYPES.PLACE}:`
- `ORGANIZATION:` → `${ENTITY_TYPES.ORGANIZATION}:`
- `OBJECT:` → `${ENTITY_TYPES.OBJECT}:`
- `CONCEPT:` → `${ENTITY_TYPES.CONCEPT}:`

Also line 27 in the thinking process:
- `type (PERSON, PLACE, ORGANIZATION, OBJECT, CONCEPT)` → `type (${Object.values(ENTITY_TYPES).join(', ')})`

- [ ] Step 2: Update `schema.js` — add import and replace entity type reference

Add import:
```js
import { ENTITY_TYPES } from '../../constants.js';
```

Replace line 13:
```js
4. "type" MUST be one of: PERSON, PLACE, ORGANIZATION, OBJECT, CONCEPT.
```
To:
```js
4. "type" MUST be one of: ${Object.values(ENTITY_TYPES).join(', ')}.
```

- [ ] Step 3: Run full test suite

Run: `npm run test`
Expected: All pass

- [ ] Step 4: Commit

```bash
git add src/prompts/graph/rules.js src/prompts/graph/schema.js && git commit -m "refactor(prompts): use centralized ENTITY_TYPES constants in graph prompts"
```

---

### Task 11: Full suite verification and final commit

- [ ] Step 1: Run full test suite

Run: `npm run test`
Expected: All pass

- [ ] Step 2: Run Biome lint/format check

Run: `npx biome check src/`
Expected: No new errors

- [ ] Step 3: Verify no remaining stray literals with grep spot-check

Run: `grep -rn "'PERSON'" src/ --include="*.js"` — should only hit JSDoc annotations and `constants.js`
Run: `grep -rn "'st_vector'" src/ --include="*.js"` — should only hit `constants.js` and `schemas.js`
Run: `grep -rn "'/api/vector/" src/ --include="*.js"` — should return nothing (all replaced)

- [ ] Step 4: Commit any Biome auto-fixes if needed

```bash
git add -A && git commit -m "chore: apply biome formatting after constant centralization"
```
