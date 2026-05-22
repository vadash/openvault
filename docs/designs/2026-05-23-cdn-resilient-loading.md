# CDN-Resilient Extension Loading

**Date:** 2026-05-23
**Status:** Approved

## Problem

7 modules use top-level `await cdnImport()` at module scope. Since they are statically imported by `index.js` (transitively), any CDN failure — offline environment, all CDNs down, slow connection — blocks the entire extension. The browser fails to evaluate the entry point: no UI renders, no slash commands register, nothing works.

Affected modules and their CDN packages:

| Module | CDN Package |
|---|---|
| `src/utils/stemmer.js` | `snowball-stemmers` |
| `src/utils/stopwords.js` | `stopword` |
| `src/utils/transliterate.js` | `cyrillic-to-translit-js` |
| `src/utils/tokens.js` | `gpt-tokenizer` |
| `src/utils/text.js` | `jsonrepair` |
| `src/store/schemas.js` | `zod` |
| `src/extraction/structured.js` | `zod` |

## Approach

Move each `await cdnImport()` from module scope into the functions that use the library. On first call, the library is fetched and cached; subsequent calls use the cache. If the CDN fetch fails, a degraded fallback runs instead of crashing.

No new infrastructure. No bootstrap stage. Each module owns its own lazy init.

## Per-Module Changes

### 1. `src/utils/stemmer.js` — `snowball-stemmers`

**Before:**
```javascript
const { default: snowball } = await cdnImport('snowball-stemmers');
const ruStemmer = snowball.newStemmer('russian');
const enStemmer = snowball.newStemmer('english');

export function stemWord(word) { /* uses ruStemmer/enStemmer */ }
```

**After:**
```javascript
let _stemmers = null;
async function getStemmers() {
    if (!_stemmers) {
        try {
            const { default: snowball } = await cdnImport('snowball-stemmers');
            _stemmers = { ru: snowball.newStemmer('russian'), en: snowball.newStemmer('english') };
        } catch { _stemmers = {}; }
    }
    return _stemmers;
}

export async function stemWord(word) {
    const stemmers = await getStemmers();
    if (!stemmers.ru || !stemmers.en) return word; // fallback: unchanged
    // ... existing logic using stemmers.ru / stemmers.en
}
```

- `stemWord(word)` → `async stemWord(word)`. Fallback: return word unchanged.
- `stemName(name)` → `async stemName(name)`. Calls `await stemWord()`. Fallback: tokenize and return lowercased words unstemmed.

### 2. `src/utils/stopwords.js` — `stopword`

**Before:**
```javascript
const { eng, rus, removeStopwords: _removeStopwords } = await cdnImport('stopword');
export const ALL_STOPWORDS = new Set([...eng, ...rus].map(w => w.toLowerCase()));
export const removeStopwords = _removeStopwords;
```

**After:**
```javascript
let _data = null;
async function getStopwordData() {
    if (!_data) {
        try {
            const { eng, rus, removeStopwords } = await cdnImport('stopword');
            _data = { stopwords: new Set([...eng, ...rus].map(w => w.toLowerCase())), removeStopwords };
        } catch { _data = { stopwords: new Set(), removeStopwords: (words) => words }; }
    }
    return _data;
}

export async function getAllStopwords() { return (await getStopwordData()).stopwords; }
export async function removeStopwords(words) { return (await getStopwordData()).removeStopwords(words); }
```

- `ALL_STOPWORDS` → `getAllStopwords()` async. Fallback: empty `Set`.
- `removeStopwords` → async wrapper. Fallback: identity (returns words unchanged).

### 3. `src/utils/transliterate.js` — `cyrillic-to-translit-js`

**Before:**
```javascript
const CyrillicToTranslit = (await cdnImport('cyrillic-to-translit-js')).default;
const translit = new CyrillicToTranslit({ preset: 'ru' });
export function transliterateCyrToLat(str) { return translit.transform(str).toLowerCase(); }
```

**After:**
```javascript
let _translit = null;
async function getTranslit() {
    if (!_translit) {
        try {
            const CyrillicToTranslit = (await cdnImport('cyrillic-to-translit-js')).default;
            _translit = new CyrillicToTranslit({ preset: 'ru' });
        } catch { _translit = null; }
    }
    return _translit;
}

export async function transliterateCyrToLat(str) {
    if (!str) return '';
    const t = await getTranslit();
    return t ? t.transform(str).toLowerCase() : str.toLowerCase(); // fallback: lowercase only
}
```

- `transliterateCyrToLat(str)` → async. Fallback: return lowercased str (no transliteration).
- `resolveCharacterName(name, canonicalNames, maxDistance)` → async (calls `transliterateCyrToLat`). Fallback: exact case-insensitive match only (skip cross-script fuzzy matching).

### 4. `src/utils/tokens.js` — `gpt-tokenizer`

**Before:**
```javascript
const { countTokens: _countTokens } = await cdnImport('gpt-tokenizer/encoding/o200k_base');
export function countTokens(text) { return _countTokens(text); }
```

**After:**
```javascript
let _countTokens = null;
async function getTokenizer() {
    if (!_countTokens) {
        try {
            const mod = await cdnImport('gpt-tokenizer/encoding/o200k_base');
            _countTokens = mod.countTokens;
        } catch { _countTokens = null; }
    }
    return _countTokens;
}

function roughTokenCount(text) { return Math.ceil(text.length / 4); }

export async function countTokens(text) {
    if (!text || text.length === 0) return 0;
    const fn = await getTokenizer();
    return fn ? fn(text) : roughTokenCount(text);
}
```

- `countTokens(text)` → async. Fallback: `Math.ceil(text.length / 4)`.
- `getMessageTokenCount(chat, index)` → async (calls `await countTokens()`). Uses same fallback.
- `getTokenSum(chat, indices)` → async (calls `await getMessageTokenCount()`).
- `countTurns()` and `snapToTurnBoundary()` are pure — no CDN deps, stay sync.

### 5. `src/utils/text.js` — `jsonrepair`

**Before:**
```javascript
const { jsonrepair } = await cdnImport('jsonrepair');
// Used in safeParseJSON at Tiers 2, 3, 4
```

**After:**
```javascript
let _jsonrepair = null;
async function getJsonRepair() {
    if (!_jsonrepair) {
        try { _jsonrepair = (await cdnImport('jsonrepair')).jsonrepair; }
        catch { _jsonrepair = null; }
    }
    return _jsonrepair;
}

export async function safeParseJSON(input, options = {}) {
    // ... Tier 0 and Tier 1 unchanged (no CDN) ...
    // Tiers 2-4: await getJsonRepair(), degrade to extract-only if null
}
```

- `safeParseJSON(input)` → async. Fallback: skip jsonrepair in Tiers 2-4, try only `extractJsonBlocks` + native `JSON.parse` + normalize.
- All other exports (`normalizeText`, `extractJsonBlocks`, `jaccardSimilarity`, `mergeDescriptions`, `stripThinkingTags`, `stripMarkdownFences`, etc.) stay sync — no CDN dependency.
- `sliceToTokenBudget(memories, budget)` → async (calls `await countTokens()`).

### 6. `src/store/schemas.js` — `zod` (HARDEST)

**Before:** ~40 schema constants defined at module scope using `z` from top-level await.

**After:** Schema factory behind async initialization.

```javascript
let _schemas = null;

export async function getSchemas() {
    if (_schemas) return _schemas;
    const { z } = await cdnImport('zod');

    const MemorySchema = z.object({ ... });
    const GraphNodeSchema = z.object({ ... });
    // ... all ~40 schemas built here ...

    _schemas = {
        MemorySchema, GraphNodeSchema, GraphEdgeSchema, GraphDataSchema,
        BaseEntitySchema, BaseRelationshipSchema, ScoreBreakdownSchema,
        ScoredMemorySchema, EventSchema, EventExtractionSchema,
        CharacterDataSchema, ReflectionStateSchema, GlobalWorldStateSchema,
        OpenVaultDataSchema, ScoringConfigSchema, QueryConfigSchema,
        // ... all exported schemas ...
    };
    return _schemas;
}
```

- No top-level await. Module evaluates instantly.
- Every consumer changes from `import { MemorySchema } from '../store/schemas.js'` to `const { MemorySchema } = await getSchemas()`.
- Fallback: if `cdnImport('zod')` throws, `getSchemas()` throws. Callers catch and skip validation. No silent passthrough — Zod is required for schema-dependent operations.

**Type generation compatibility:** `npm run generate-types` runs in Node.js with CDN mapped to `node_modules/`. The generator script calls `await getSchemas()` instead of reading exported constants. This works because Node.js supports top-level await and the vitest config already maps CDN to local packages.

### 7. `src/extraction/structured.js` — `zod`

Depends on both `z` directly and schemas from `schemas.js`. Both become lazy.

**After:**
```javascript
import { getSchemas } from '../store/schemas.js';

let _z = null;
async function getZ() {
    if (!_z) _z = (await cdnImport('zod')).z;
    return _z;
}

// Schema extension functions become async factories:
let _extended = null;
async function getExtendedSchemas() {
    if (_extended) return _extended;
    const { z } = await getZ();
    const { BaseEntitySchema, BaseRelationshipSchema } = await getSchemas();
    _extended = {
        EntitySchema: z.object({
            name: BaseEntitySchema.shape.name.catch('Unknown'),
            // ...
        }),
        // ...
    };
    return _extended;
}

// Parse functions become async:
export async function parseStructuredResponse(content, schema, recoverFn = null) { ... }
export async function parseEventExtractionResponse(content) { ... }
export async function parseGraphExtractionResponse(content) { ... }
export async function parseUnifiedReflectionResponse(content) { ... }
export async function parseConsolidationResponse(content) { ... }
export async function parseGlobalSynthesisResponse(content) { ... }

// JSON Schema generators become async:
export async function getEventExtractionJsonSchema() { ... }
export async function getGraphExtractionJsonSchema() { ... }
export async function getUnifiedReflectionJsonSchema() { ... }
export async function getEdgeConsolidationJsonSchema() { ... }
export async function getGlobalSynthesisJsonSchema() { ... }
export async function getCommunitySummaryJsonSchema() { ... }
```

## Async Propagation

Making these functions async cascades upward through callers. Key ripple paths:

| Source function | Propagates to |
|---|---|
| `stemWord` | `stemName` → `graph.js`, `retrieval/math.js`, `retrieval/query-context.js` |
| `countTokens` | `getMessageTokenCount`, `getTokenSum` → `extraction/scheduler.js`, `retrieval/scoring.js`, `retrieval/formatting.js`, `retrieval/world-context.js`, `store/chat-data.js` |
| `getAllStopwords` | `graph.js`, `retrieval/math.js` |
| `safeParseJSON` | `structured.js` parse functions → `graph.js`, `extraction/*.js`, `reflection/*.js` |
| `getSchemas` | `structured.js` → everywhere schemas are imported |
| `parse*Response` | `graph.js`, `extraction/extract.js`, `reflection/reflect.js`, `graph/world-state.js` |
| `resolveCharacterName` | `extraction/extract.js` |

Every caller in these chains adds `await`. Mechanical but touches ~15-20 files. No logic changes in callers — only signature updates.

## Fallback Behavior Summary

| Feature | CDN Available | CDN Unavailable |
|---|---|---|
| Stemming | Russian + English Snowball stemmers | Words passed through unchanged |
| Stopwords | EN + RU stopword filtering | Empty set (no filtering) |
| Token counting | GPT o200k_base tokenizer | `Math.ceil(text.length / 4)` estimate |
| JSON repair | 5-tier waterfall with jsonrepair | 3-tier: native parse + extract + normalize |
| Cyrillic transliteration | Full Cyrillic→Latin transliteration | Lowercasing only |
| Zod validation | Full schema validation | JSON parse only, schemas unavailable |
| Cross-script name matching | Transliteration + Levenshtein fuzzy | Exact case-insensitive only |

Users see a one-time console warning when a CDN import falls back.

## Testing Strategy

1. **Existing tests unchanged.** Test overrides in `cdn.js` (`_setTestOverride`) bypass network entirely. Schema tests that import constants will need updating to use `await getSchemas()`.

2. **New integration test.** Mock all CDN fetches to fail. Verify:
   - `index.js` loads without error
   - Slash commands register
   - Extension UI renders
   - Degraded functions return fallback values

3. **Per-fallback unit tests.** For each module, test the fallback path:
   - `stemWord` with CDN failure → returns input unchanged
   - `countTokens` with CDN failure → returns rough estimate
   - `safeParseJSON` with CDN failure → succeeds on clean JSON, fails on malformed (no repair)
   - `getSchemas` with CDN failure → throws (schema-dependent features unavailable)

## Files Changed (Estimate)

| Category | Files |
|---|---|
| Lazy init (7 modules) | `stemmer.js`, `stopwords.js`, `transliterate.js`, `tokens.js`, `text.js`, `schemas.js`, `structured.js` |
| Async propagation | `graph.js`, `retrieval/math.js`, `retrieval/query-context.js`, `retrieval/scoring.js`, `retrieval/formatting.js`, `retrieval/world-context.js`, `retrieval/retrieve.js`, `extraction/extract.js`, `extraction/scheduler.js`, `reflection/reflect.js`, `graph/world-state.js`, `store/chat-data.js`, `llm.js` |
| Type generator | Script that reads schemas for `npm run generate-types` |
| Tests | Updates to match new async signatures |

**Total: ~20-25 files**
