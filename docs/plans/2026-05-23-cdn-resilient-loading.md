# CDN-Resilient Extension Loading — Implementation Plan

**Goal:** Move all top-level `await cdnImport()` calls into lazy per-function initialization so CDN failures degrade gracefully instead of blocking the entire extension.
**Design Doc:** `docs/designs/2026-05-23-cdn-resilient-loading.md`
**Testing Conventions:** Unit tests use `await import()` dynamic imports. CDN packages are overridden via `global.registerCdnOverrides()` in `tests/setup.js` which maps CDN specs to `node_modules/`. Never mock internal modules. Use factory builders from `tests/factories.js` for structural tests, inline objects for math tests.

---

### Task 1: Lazy CDN init — stemmer.js, stopwords.js, transliterate.js

**Objective:** Convert the three simplest utility modules from top-level `await cdnImport()` to lazy per-function initialization. These have no cross-dependencies and follow the same pattern.

**Files to modify/create:**
- Modify: `src/utils/stemmer.js` (Remove top-level await, make `stemWord`/`stemName` async with lazy init)
- Modify: `src/utils/stopwords.js` (Remove top-level await, convert `ALL_STOPWORDS` to `getAllStopwords()` async, make `removeStopwords` async)
- Modify: `src/utils/transliterate.js` (Remove top-level await, make `transliterateCyrToLat`/`resolveCharacterName` async with lazy init)
- Modify: `tests/utils/stemmer.test.js` (Add `await` to all `stemWord`/`stemName` calls)
- Modify: `tests/utils/transliterate.test.js` (Add `await` to async calls)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/utils/stemmer.js`, `src/utils/stopwords.js`, `src/utils/transliterate.js`, and their test files.
2. **Write Failing Tests:** In each test file, add a test block for the CDN-unavailable fallback path. For `stemmer.test.js`: test that `stemWord('running')` resolves to `'running'` when CDN is unavailable (the fallback returns the word unchanged). For `stopwords` (no existing test file): test that `getAllStopwords()` returns an empty Set and `removeStopwords(words)` returns words unchanged when CDN fails. For `transliterate.test.js`: test that `transliterateCyrToLat('Привет')` resolves to `'привет'` (lowercase only, no translit) when CDN fails. To simulate CDN failure, temporarily clear the test override: delete `globalThis.__openvault_cdn_test_overrides` for the spec, call the function, then restore it. Run tests to ensure new tests fail (functions are still sync).
3. **Implement Minimal Code:**
   - **stemmer.js:** Replace the top-level `await cdnImport('snowball-stemmers')` and stemmer instantiation with a `let _stemmers = null` + `async function getStemmers()` lazy getter. Make `stemWord(word)` async — await `getStemmers()`, if stemmers are unavailable return `word` unchanged. Make `stemName(name)` async — await `stemWord()` for each word.
   - **stopwords.js:** Replace top-level await with `let _data = null` + `async function getStopwordData()` lazy getter. Export `async function getAllStopwords()` returning the Set. Export `async function removeStopwords(words)` wrapping the package function. Fallback: empty Set / identity.
   - **transliterate.js:** Replace top-level await with `let _translit = null` + `async function getTranslit()` lazy getter. Make `transliterateCyrToLat(str)` async — if translit unavailable return `str.toLowerCase()`. Make `resolveCharacterName(name, canonicalNames, maxDistance)` async since it calls `transliterateCyrToLat`. Fallback: exact case-insensitive match only, skip cross-script fuzzy.
4. **Update Existing Tests:** Add `await` to all calls to `stemWord`, `stemName`, `transliterateCyrToLat`, `resolveCharacterName` in existing test files.
5. **Verify:** Run `npx vitest run tests/utils/stemmer.test.js tests/utils/transliterate.test.js` and ensure all pass.
6. **Commit:** `feat: lazy CDN init for stemmer, stopwords, transliterate`

---

### Task 2: Lazy CDN init — tokens.js

**Objective:** Convert `tokens.js` from top-level await to lazy init. This module has the most callers (~8 files) so changes must be precise.

**Files to modify/create:**
- Modify: `src/utils/tokens.js` (Remove top-level await, make `countTokens`/`getMessageTokenCount`/`getTokenSum` async)
- Modify: `tests/utils/tokens.test.js` (Add `await` to all async calls, add fallback test)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/utils/tokens.js` and `tests/utils/tokens.test.js`.
2. **Write Failing Tests:** Add a test for CDN fallback: when CDN is unavailable, `countTokens('hello world')` resolves to `Math.ceil('hello world'.length / 4)` = 3. Add a test that `getMessageTokenCount` falls back gracefully. Run tests to see them fail.
3. **Implement Minimal Code:**
   - Replace top-level `await cdnImport('gpt-tokenizer/encoding/o200k_base')` with `let _countTokens = null` + `async function getTokenizer()` lazy getter.
   - Add `function roughTokenCount(text) { return Math.ceil(text.length / 4); }` as fallback.
   - Make `countTokens(text)` async: `const fn = await getTokenizer(); return fn ? fn(text) : roughTokenCount(text);`
   - Make `getMessageTokenCount(chat, index)` async: change `_countTokens(text)` call to `await countTokens(text)`. The cache logic stays, but the uncached path awaits.
   - Make `getTokenSum(chat, indices)` async: `await getMessageTokenCount()`.
   - `countTurns()` and `snapToTurnBoundary()` are pure — **do not change them**, they have no CDN dependency.
4. **Update Existing Tests:** Add `await` to all calls to `countTokens`, `getMessageTokenCount`, `getTokenSum` in `tokens.test.js`. The `countTurns` and `snapToTurnBoundary` tests remain unchanged (sync).
5. **Verify:** Run `npx vitest run tests/utils/tokens.test.js` and ensure all pass.
6. **Commit:** `feat: lazy CDN init for tokens with rough fallback`

---

### Task 3: Lazy CDN init — text.js (safeParseJSON)

**Objective:** Convert `text.js` to lazy init for `jsonrepair`. Only `safeParseJSON` and `sliceToTokenBudget` become async — all other exports stay sync.

**Depends on:** Task 2 (text.js imports `countTokens` from tokens.js, which is now async)

**Files to modify/create:**
- Modify: `src/utils/text.js` (Remove top-level await for jsonrepair, make `safeParseJSON` and `sliceToTokenBudget` async)
- Modify: `tests/utils/text.test.js` (Add `await` to `safeParseJSON` and `sliceToTokenBudget` calls)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/utils/text.js` (focus on `safeParseJSON` and `sliceToTokenBudget`) and `tests/utils/text.test.js`.
2. **Write Failing Tests:** Add test for degraded JSON parsing: when jsonrepair is unavailable, `safeParseJSON('{"key": "value"}')` still succeeds (Tier 1 native parse). When given malformed JSON that only jsonrepair can fix (e.g. unquoted keys), it fails gracefully at Tier 5 instead of crashing. Run to see fail.
3. **Implement Minimal Code:**
   - Replace top-level `const { jsonrepair } = await cdnImport('jsonrepair')` with `let _jsonrepair = null` + `async function getJsonRepair()` lazy getter.
   - Make `safeParseJSON` async. In Tiers 2-4: `const repair = await getJsonRepair();` if null, skip the `jsonrepair()` call and try only `extractJsonBlocks` + native `JSON.parse` + `normalizeText`. If native parse succeeds on extracted blocks, return success. Otherwise continue to next tier.
   - Make `sliceToTokenBudget` async: change `countTokens(memory.summary)` to `await countTokens(memory.summary)`.
   - **Do not change** `normalizeText`, `extractJsonBlocks`, `jaccardSimilarity`, `mergeDescriptions`, `stripThinkingTags`, `stripMarkdownFences`, `sortMemoriesBySequence`, `assignMemoriesToBuckets` — these are pure sync functions with no CDN dependency.
4. **Update Existing Tests:** Add `await` to all `safeParseJSON(...)` and `sliceToTokenBudget(...)` calls in `tests/utils/text.test.js`.
5. **Verify:** Run `npx vitest run tests/utils/text.test.js` and ensure all pass.
6. **Commit:** `feat: lazy CDN init for jsonrepair with degraded tier fallback`

---

### Task 4: Schema factory — schemas.js + generate-types.js

**Objective:** Convert `schemas.js` from ~40 module-scope schema constants to a single `getSchemas()` async factory. Update the type generator to call the factory instead of destructuring imports.

**This is the hardest structural change.** Only `structured.js` imports from `schemas.js` (checked via grep), so the blast radius is contained.

**Files to modify/create:**
- Modify: `src/store/schemas.js` (Replace all `export const XSchema = z.object({...})` with a factory function `getSchemas()` that builds and returns all schemas)
- Modify: `scripts/generate-types.js` (Change from destructured import to `await getSchemas()`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/store/schemas.js` fully (it's ~380 lines) and `scripts/generate-types.js`.
2. **Write Failing Tests:** Create `tests/store/schemas.test.js`. Test: (a) `getSchemas()` returns an object with all expected schema names (MemorySchema, GraphNodeSchema, etc.), (b) schemas are cached (second call returns same reference), (c) generated schemas validate correct data (e.g. `schemas.MemorySchema.parse({id:'x', summary:'s', ...})`). Run to see fail (module still exports constants, not a factory).
3. **Implement Minimal Code:**
   - In `schemas.js`: Remove `const { z } = await cdnImport('zod');` top-level await. Add `let _schemas = null;` cache and `export async function getSchemas()`. Inside `getSchemas()`, `const { z } = await cdnImport('zod');`, then build all schema objects (MemorySchema, GraphNodeSchema, etc.), assign them to `_schemas = { MemorySchema, ... }`, return `_schemas`.
   - **Remove all `export const` schema declarations** from module scope. The only export is `getSchemas`.
   - In `generate-types.js`: Change from `const { MemorySchema, ... } = await import('../src/store/schemas.js')` to `const schemas = await (await import('../src/store/schemas.js')).getSchemas()`. Use `schemas.MemorySchema` etc. in `typeMappings`. The CDN override in setup already maps zod to node_modules, so `getSchemas()` will work in Node.
4. **Verify:** Run `npx vitest run tests/store/schemas.test.js` and `npm run generate-types` to ensure types still generate correctly.
5. **Commit:** `feat: convert schemas.js to async factory pattern`

---

### Task 5: Lazy CDN init — structured.js

**Objective:** Convert `structured.js` to use lazy zod init and the schema factory from `schemas.js`. All parse functions and JSON schema generators become async.

**Depends on:** Task 3 (text.js — `safeParseJSON` is now async), Task 4 (schemas.js — now uses `getSchemas()`)

**Files to modify/create:**
- Modify: `src/extraction/structured.js` (Lazy zod init, use `getSchemas()`, make all parse/getJsonSchema functions async)
- Modify: `tests/extraction/structured.test.js` (Add `await` to all parse/getJsonSchema calls)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/extraction/structured.js` fully (~500 lines) and `tests/extraction/structured.test.js`.
2. **Write Failing Tests:** In the existing test file, add `await` to all calls to `parseStructuredResponse`, `parseEventExtractionResponse`, `parseGraphExtractionResponse`, `parseUnifiedReflectionResponse`, `parseConsolidationResponse`, `parseGlobalSynthesisResponse`, `getEventExtractionJsonSchema`, `getGraphExtractionJsonSchema`, `getUnifiedReflectionJsonSchema`, `getEdgeConsolidationJsonSchema`, `getGlobalSynthesisJsonSchema`, `getCommunitySummaryJsonSchema`. Run tests — they will fail because functions are still sync.
3. **Implement Minimal Code:**
   - Replace `const { z } = await cdnImport('zod')` with lazy `let _z = null; async function getZ()`.
   - Change `import { BaseEntitySchema, BaseRelationshipSchema, ... } from '../store/schemas.js'` to `import { getSchemas } from '../store/schemas.js'`.
   - Create `let _extended = null; async function getExtendedSchemas()` that awaits `getZ()` and `getSchemas()` to build EntitySchema, RelationshipSchema, GraphExtractionSchema, UnifiedReflectionSchema, CommunitySummarySchema, EdgeConsolidationSchema, GlobalSynthesisSchema.
   - Make all `parse*Response()` functions async. They call `safeParseJSON` (now async) and use schemas from `getExtendedSchemas()`.
   - Make all `get*JsonSchema()` functions async. They call `getExtendedSchemas()` to get schemas, then build JSON schema.
   - `stripLeakedIds`, `recoverBareString` stay sync (pure helpers).
   - Re-export `EventSchema`, `EventExtractionSchema` via async getter from `getSchemas()`.
4. **Update Existing Tests:** Ensure all test calls use `await`.
5. **Verify:** Run `npx vitest run tests/extraction/structured.test.js` and ensure all pass.
6. **Commit:** `feat: lazy CDN init for structured.js parse and schema functions`

---

### Task 6: Async propagation — llm.js

**Objective:** Update `llm.js` to handle async `getJsonSchema` functions from `structured.js`. The `LLM_CONFIGS` objects store `getJsonSchema` function references that are called in `callLLM`.

**Depends on:** Task 5 (structured.js — getJsonSchema functions are now async)

**Files to modify/create:**
- Modify: `src/llm.js` (Await `getJsonSchema()` calls in `callLLM`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/llm.js`, focusing on `LLM_CONFIGS` (lines ~60-95) and `callLLM` (lines ~100-200). The `getJsonSchema` values in `LLM_CONFIGS` are function references imported from `structured.js`.
2. **Write Failing Tests:** No new test file needed. The existing integration tests that call LLM functions will catch issues.
3. **Implement Minimal Code:**
   - The `LLM_CONFIGS` objects store `getJsonSchema: getEventExtractionJsonSchema` etc. These are now async functions. **Do not change the LLM_CONFIGS declarations** — storing async function references is fine.
   - In `callLLM` at line ~170: `const jsonSchema = options.structured && getJsonSchema ? getJsonSchema() : undefined;` — add `await`: `const jsonSchema = options.structured && getJsonSchema ? await getJsonSchema() : undefined;`
   - `callLLM` is already async, so no signature change needed.
4. **Verify:** Run `npm run check` (typecheck + lint) to ensure no regressions.
5. **Commit:** `feat: await async getJsonSchema in llm.js callLLM`

---

### Task 7: Async propagation — graph.js

**Objective:** Update `graph.js` to `await` all now-async function calls. This is the largest single consumer — it uses stemmer, stopwords, transliterate, tokens, and structured.js.

**Depends on:** Task 1 (stemmer, stopwords, transliterate), Task 2 (tokens), Task 5 (structured.js)

**Files to modify/create:**
- Modify: `src/graph/graph.js` (Add `await` to all calls to `stemWord`, `ALL_STOPWORDS`→`getAllStopwords`, `countTokens`, `transliterateCyrToLat`, `parseConsolidationResponse`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/graph/graph.js`. Search for all calls to: `stemWord(`, `ALL_STOPWORDS`, `countTokens(`, `transliterateCyrToLat(`, `parseConsolidationResponse(`.
2. **Update import of stopwords:** Change `import { ALL_STOPWORDS } from '../utils/stopwords.js'` to `import { getAllStopwords } from '../utils/stopwords.js'`.
3. **Add await to each call site:**
   - Every `stemWord(...)` → `await stemWord(...)`
   - Every `ALL_STOPWORDS` usage → `await getAllStopwords()`. Since this is called potentially in loops, cache the result at the top of the function: `const stopwords = await getAllStopwords();` then use `stopwords.has(...)` instead of `ALL_STOPWORDS.has(...)`.
   - Every `countTokens(...)` → `await countTokens(...)`
   - Every `transliterateCyrToLat(...)` → `await transliterateCyrToLat(...)`
   - Every `parseConsolidationResponse(...)` → `await parseConsolidationResponse(...)`
4. **Make enclosing functions async** if they aren't already. Most graph functions are already async (they do IO), but verify each one.
5. **Verify:** Run `npm run check` (typecheck + lint).
6. **Commit:** `feat: await async CDN-dependent functions in graph.js`

---

### Task 8: Async propagation — extraction pipeline (extract.js, scheduler.js)

**Objective:** Update the extraction pipeline modules to await the now-async utility functions.

**Depends on:** Task 2 (tokens), Task 3 (text.js), Task 5 (structured.js)

**Files to modify/create:**
- Modify: `src/extraction/extract.js` (Await `countTokens`, `resolveCharacterName`, `transliterateCyrToLat`, `sliceToTokenBudget`, `parseEventExtractionResponse`, `parseGraphExtractionResponse`)
- Modify: `src/extraction/scheduler.js` (Await `getMessageTokenCount`, `getTokenSum`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/extraction/extract.js` and `src/extraction/scheduler.js`. Search for all calls to the functions listed above.
2. **In extract.js:** Add `await` before every call to: `countTokens(...)`, `resolveCharacterName(...)`, `transliterateCyrToLat(...)`, `sliceToTokenBudget(...)`, `parseEventExtractionResponse(...)`, `parseGraphExtractionResponse(...)`. All enclosing functions are already async.
3. **In scheduler.js:** Add `await` before every call to `getMessageTokenCount(...)` and `getTokenSum(...)`. Enclosing functions should already be async.
4. **Verify:** Run `npm run check`.
5. **Commit:** `feat: await async CDN-dependent functions in extraction pipeline`

---

### Task 9: Async propagation — retrieval layer

**Objective:** Update all retrieval modules to await async functions from stemmer, stopwords, and tokens.

**Depends on:** Task 1 (stemmer, stopwords), Task 2 (tokens)

**Files to modify/create:**
- Modify: `src/retrieval/math.js` (Await `stemWord`, replace `ALL_STOPWORDS` with `getAllStopwords()`)
- Modify: `src/retrieval/query-context.js` (Await `stemName`, `stemWord`)
- Modify: `src/retrieval/scoring.js` (Await `countTokens`)
- Modify: `src/retrieval/formatting.js` (Await `countTokens`)
- Modify: `src/retrieval/world-context.js` (Await `countTokens`)
- Modify: `src/retrieval/retrieve.js` (No direct CDN deps, but verify transitive calls)

**Instructions for Execution Agent:**
1. **Context Setup:** Read all files in `src/retrieval/`. Search for calls to: `stemWord`, `stemName`, `ALL_STOPWORDS`, `countTokens`.
2. **In math.js:** Change `import { ALL_STOPWORDS }` to `import { getAllStopwords }`. Cache `const stopwords = await getAllStopwords()` at function start. Add `await` to `stemWord(...)` calls.
3. **In query-context.js:** Add `await` to `stemName(...)` and `stemWord(...)` calls.
4. **In scoring.js:** Add `await` to `countTokens(...)` calls.
5. **In formatting.js:** Add `await` to `countTokens(...)` calls.
6. **In world-context.js:** Add `await` to `countTokens(...)` calls.
7. **In retrieve.js:** Check for transitive async calls — if any caller of these updated functions needs `await`, add it.
8. **Verify:** Run `npm run check`.
9. **Commit:** `feat: await async CDN-dependent functions in retrieval layer`

---

### Task 10: Async propagation — remaining callers

**Objective:** Update the remaining files that call async CDN-dependent functions.

**Depends on:** Task 2 (tokens), Task 3 (text.js), Task 5 (structured.js)

**Files to modify/create:**
- Modify: `src/reflection/reflect.js` (Await `parseUnifiedReflectionResponse`)
- Modify: `src/graph/world-state.js` (Await `parseGlobalSynthesisResponse`)
- Modify: `src/store/chat-data.js` (Await `countTokens`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/reflection/reflect.js`, `src/graph/world-state.js`, `src/store/chat-data.js`.
2. **In reflect.js:** Add `await` to `parseUnifiedReflectionResponse(...)` calls. Function is already async.
3. **In world-state.js:** Add `await` to `parseGlobalSynthesisResponse(...)` calls. Function is already async.
4. **In chat-data.js:** Search for `countTokens` calls. Add `await` to each. Make enclosing functions async if they aren't already.
5. **Verify:** Run `npm run check`.
6. **Commit:** `feat: await async CDN-dependent functions in reflect, world-state, chat-data`

---

### Task 11: Update CLAUDE.md files and finalize

**Objective:** Update all CLAUDE.md files to document the lazy CDN pattern, so future contributors know the conventions. Run the full test suite to verify nothing is broken.

**Depends on:** All previous tasks

**Files to modify/create:**
- Modify: `CLAUDE.md` (Add rule about lazy CDN imports)
- Modify: `src/utils/CLAUDE.md` (Document new async signatures for utility functions)
- Modify: `src/store/CLAUDE.md` (Document schemas.js factory pattern)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `CLAUDE.md`, `src/utils/CLAUDE.md`, `src/store/CLAUDE.md`.
2. **Update `CLAUDE.md`** — In "GLOBAL ARCHITECTURE RULES" section, add a rule under "Code & State Safety":
   - **Never use top-level `await cdnImport()`.** Load CDN packages lazily inside the function that uses them. Cache the result in a module-level variable. Provide a degraded fallback when CDN is unavailable. All CDN-dependent functions are `async`.
3. **Update `src/utils/CLAUDE.md`** — Add a section:
   - **LAZY CDN IMPORTS.** `stemWord`, `getAllStopwords`, `transliterateCyrToLat`, `resolveCharacterName`, `countTokens`, `getMessageTokenCount`, `getTokenSum`, `safeParseJSON`, `sliceToTokenBudget` are all `async`. Always `await` them. Fallbacks: stemmer returns input unchanged, stopwords returns empty Set, token counting uses `Math.ceil(text.length / 4)`, jsonrepair skips repair tiers, transliteration lowercases only.
4. **Update `src/store/CLAUDE.md`** — Add a note:
   - **Schema factory.** `schemas.js` exports `getSchemas()` async function, not individual constants. Use `const { MemorySchema, ... } = await getSchemas()` to access schemas. The type generator (`scripts/generate-types.js`) calls `getSchemas()` in Node.js.
5. **Run full test suite:** `npx vitest run` — all tests must pass.
6. **Run pre-commit checks:** `npm run check` — lint, types, CSS all pass.
7. **Commit:** `docs: update CLAUDE.md with lazy CDN import conventions`
