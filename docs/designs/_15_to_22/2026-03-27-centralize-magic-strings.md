# Centralize Magic Strings and Orphaned Constants

## Goal

Improve refactoring hygiene — make scattered string literals and duplicated numeric thresholds searchable and safely renameable from a single source of truth.

## Scope (Approach B: Moderate)

- Cross-file string literals used in 3+ locations → frozen object constants
- Numeric thresholds duplicated as function parameter defaults → reference existing constants
- A few module-scoped numeric constants (`BM25_*`, `REFLECTION_THRESHOLD`) → promote to `constants.js`

**Out of scope:** Zod enum definitions in `schemas.js` (already a fine single source of truth), ST event names (external API), state flags (scoped to `state.js`), UI text/console logs.

## New Constants

All added to `src/constants.js`, following existing section-separator convention.

### ENTITY_TYPES (after `INJECTION_POSITIONS`)

```js
const ENTITY_TYPES = Object.freeze({
  PERSON: 'PERSON',
  PLACE: 'PLACE',
  ORGANIZATION: 'ORGANIZATION',
  OBJECT: 'OBJECT',
  CONCEPT: 'CONCEPT',
});
```

**Replaces:** ~20 string comparisons in `graph.js`, `extract.js`, `prompts/graph/rules.js`, `prompts/graph/schema.js`.

### EMBEDDING_SOURCES (after `embeddingModelPrefixes`)

```js
const EMBEDDING_SOURCES = Object.freeze({
  LOCAL: 'local',
  OLLAMA: 'ollama',
  ST_VECTOR: 'st_vector',
});
```

**Replaces:** ~15 string comparisons in `embeddings.js`, `extract.js`, `st-vector.js`, `chat-data.js`, `embedding-codec.js`.

### ST_API_ENDPOINTS (end of file)

```js
const ST_API_ENDPOINTS = Object.freeze({
  INSERT: '/api/vector/insert',
  DELETE: '/api/vector/delete',
  PURGE: '/api/vector/purge',
  QUERY: '/api/vector/query',
});
```

**Replaces:** 4 string literals in `st-vector.js`.

## Orphaned Numeric Thresholds

These values already exist in `constants.js` but are restated as function parameter defaults. Replace defaults with references to the existing constants.

| Default param | File | Existing constant in `constants.js` |
|---|---|---|
| `cosineThreshold = 0.92` | `src/extraction/extract.js` | `dedupSimilarityThreshold` (inside `CONSOLIDATION`) |
| `jaccardThreshold = 0.6` | `src/extraction/extract.js` | `dedupJaccardThreshold` (inside `CONSOLIDATION`) |
| `minOverlapRatio = 0.5` | `src/graph/graph.js` | No existing constant — add `ENTITY_TOKEN_OVERLAP_MIN_RATIO = 0.5` |
| `threshold = 0.85` | `src/reflection/reflect.js` | No existing constant — add `REFLECTION_SKIP_SIMILARITY = 0.85` |

### Promoted module-scoped constants

| Constant | Current location | Move to |
|---|---|---|
| `JACCARD_DUPLICATE_THRESHOLD = 0.6` | `src/graph/graph.js` | `constants.js` as `GRAPH_JACCARD_DUPLICATE_THRESHOLD` |
| `BM25_K1 = 1.2`, `BM25_B = 0.75` | `src/retrieval/math.js` | `constants.js` as `BM25_K1`, `BM25_B` |
| `REFLECTION_THRESHOLD = 40` | `src/reflection/reflect.js` | `constants.js` as `REFLECTION_MIN_MEMORIES` |
| `CORPUS_GROUNDED_BOOST_RATIO = 0.6` | `src/retrieval/query-context.js` | `constants.js` as `CORPUS_GROUNDED_BOOST_RATIO` |

## Files Changed

| File | Change type |
|---|---|
| `src/constants.js` | Add 3 frozen objects + ~5 numeric constants |
| `src/graph/graph.js` | Import + replace ~15 entity type strings, `JACCARD_DUPLICATE_THRESHOLD` |
| `src/embeddings.js` | Import + replace ~10 embedding source strings |
| `src/extraction/extract.js` | Import + replace entity type strings, consolidate threshold defaults |
| `src/services/st-vector.js` | Import + replace 4 endpoint paths |
| `src/store/chat-data.js` | Import + replace embedding source strings |
| `src/reflection/reflect.js` | Import + replace `REFLECTION_THRESHOLD`, threshold defaults |
| `src/retrieval/math.js` | Import + replace `BM25_K1`, `BM25_B` |
| `src/retrieval/query-context.js` | Import + replace `CORPUS_GROUNDED_BOOST_RATIO` |
| `src/prompts/graph/rules.js` | Import + replace entity type strings |
| `src/prompts/graph/schema.js` | Import + replace entity type strings |
| Test files (as needed) | Update hardcoded strings to use constants |

## Testing

- Existing tests cover the domain logic — no new tests needed for constant renaming.
- Run `npm run test` after changes to verify nothing breaks.
- Test files may need imports updated but test assertions against literal values are acceptable (test data is intentionally hardcoded).
