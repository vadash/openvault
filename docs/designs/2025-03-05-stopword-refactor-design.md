# Design: Unified Stopword System

## 1. Problem Statement

Current codebase has **4 separate hardcoded stopword lists** across different files:
- `src/retrieval/math.js` - ~200 EN+RU stopwords for BM25
- `src/graph/graph.js` - ~35 words for entity merging (colors, sizes)
- `src/retrieval/query-context.js` - ~70 sentence starters and discourse markers
- Test files duplicating these lists

This creates maintenance burden, inconsistency, and limits language support.

## 2. Goals & Non-Goals

### Must Do
- Replace all hardcoded stopwords with the `stopword` package (EN + RU)
- Unify all stopword filtering into a single source of truth
- Maintain existing behavior for entity merging and query context
- Support mixed English/Russian text processing

### Won't Do
- Runtime configurable language selection
- Dynamic stopword loading from external sources
- Language detection improvements (current script detection is sufficient)

## 3. Proposed Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    src/utils/stopwords.js               │
│  ┌─────────────────────────────────────────────────────┐│
│  │  import { eng, rus } from 'stopword'                ││
│  │                                                      ││
│  │  const BASE_STOPWORDS = new Set([...eng, ...rus])   ││
│  │                                                      ││
│  │  const GRAPH_CUSTOM = [                              ││
│  │    'red', 'blue', ...colors/sizes/adjectives        ││
│  │  ]                                                   ││
│  │                                                      ││
│  │  const QUERY_STARTERS = [                            ││
│  │    'The', 'После', ...sentence starters             ││
│  │  ]                                                   ││
│  │                                                      ││
│  │  export const ALL_STOPWORDS = new Set([             ││
│  │    ...BASE_STOPWORDS, ...GRAPH_CUSTOM,              ││
│  │    ...QUERY_STARTERS                                 ││
│  │  ])                                                  ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                            │
                            ├──────────────────┐
                            ▼                  ▼
                  ┌─────────────────┐  ┌─────────────────┐
                  │ math.js         │  │ graph.js        │
                  │ tokenize()      │  │ hasOverlap()    │
                  └─────────────────┘  └─────────────────┘
                            │
                            ▼
                  ┌─────────────────┐
                  │ query-context.js│
                  │ extract()       │
                  └─────────────────┘
```

## 4. Data Models

### `src/utils/stopwords.js`

```javascript
import { eng, rus } from 'https://esm.sh/stopword'

// Core stopwords from package (EN + RU)
const BASE_STOPWORDS = new Set([...eng, ...rus])

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
])

// Query context - sentence starters and discourse markers
const QUERY_STARTERS = new Set([
  // Latin (English) starters
  'The', 'This', 'That', 'Then', 'There', 'When', 'Where',
  'What', 'Which', 'While', 'Since', 'Because', 'Although',
  'However', 'Therefore', 'Moreover', 'Furthermore',
  // Cyrillic (Russian) starters
  'После', 'Когда', 'Потом', 'Затем', 'Тогда',
  // Interjections
  'Ага', 'Угу', 'Ого',
  // Discourse markers
  'Значит', 'Типа', 'Короче',
  // Case-insensitive variants included
])

// Unified export - lowercase for case-insensitive matching
export const ALL_STOPWORDS = new Set([
  ...[...BASE_STOPWORDS].map(w => w.toLowerCase()),
  ...[...GRAPH_CUSTOM].map(w => w.toLowerCase()),
  ...[...QUERY_STARTERS].map(w => w.toLowerCase())
])

// Convenience export for compatibility with existing code
export { removeStopwords } from 'https://esm.sh/stopword'
```

### Usage Pattern

```javascript
// Before (math.js)
const STOP_WORDS = new Set([...]) // 200+ hardcoded words

// After
import { ALL_STOPWORDS } from '../utils/stopwords.js'
```

## 5. Interface / API Design

### `src/utils/stopwords.js` Exports

| Export | Type | Purpose |
|--------|------|---------|
| `ALL_STOPWORDS` | `Set<string>` | Unified stopword set (lowercased) |
| `BASE_STOPWORDS` | `Set<string>` | Just EN+RU from package |
| `GRAPH_CUSTOM` | `Set<string>` | Graph-specific terms |
| `QUERY_STARTERS` | `Set<string>` | Query context filters |
| `removeStopwords` | `Function` | Re-export from package |

### Files to Modify

| File | Change |
|------|--------|
| `src/retrieval/math.js` | Remove `STOP_WORDS`, import `ALL_STOPWORDS` |
| `src/graph/graph.js` | Remove `stopWords`, import `ALL_STOPWORDS` |
| `src/retrieval/query-context.js` | Remove `LATIN_STARTERS`/`CYRILLIC_STARTERS`, import `ALL_STOPWORDS` |
| `src/utils/stopwords.js` | **NEW FILE** |
| `tests/math.test.js` | Update to test new module |
| `tests/query-context.test.js` | Update to test new module |

## 6. Risks & Edge Cases

### Case Sensitivity
- **Risk:** The `stopword` package words are lowercase; current code may have mixed case
- **Mitigation:** Export `ALL_STOPWORDS` as lowercased, ensure tokenization lowercases before comparison

### Duplicates After Merge
- **Risk:** Some words may exist in multiple lists (e.g., "the" appears in BASE and GRAPH_CUSTOM)
- **Mitigation:** `Set` automatically deduplicates

### Behavior Changes
- **Risk:** The `stopword` package's lists may differ slightly from current hardcoded lists
- **Mitigation:** Run existing test suite to verify; add custom words to `GRAPH_CUSTOM` if needed

### ESM Import
- **Risk:** Using `https://esm.sh/stopword` requires network during dev, may have different semantics
- **Mitigation:** Alternatively use `npm install stopword` and standard import

### Missing Words
- **Risk:** Current lists may have domain-specific words not in standard stopword lists
- **Mitigation:** Audit removed words; add any missing to custom sets

## 7. Implementation Order

1. Create `src/utils/stopwords.js` with current hardcoded words + package
2. Update `src/retrieval/math.js` to import from new module
3. Update `src/graph/graph.js`
4. Update `src/retrieval/query-context.js`
5. Run tests to verify behavior
6. Clean up test files if needed
7. Commit

## 8. Verification Checklist

- [ ] All 4 files import from `src/utils/stopwords.js`
- [ ] No hardcoded stopword arrays remain in source files
- [ ] Tests pass with new implementation
- [ ] Mixed EN/RU text still processes correctly
- [ ] Entity merging still filters colors/sizes properly
- [ ] Query context extraction still filters starters
