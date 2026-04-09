# Design: TypeScript-Style Type Safety Phase 3 - Utilities & Services

## Summary
Add `@ts-check` and JSDoc type coverage to 8 remaining utility and service files. Strengthens type safety at I/O boundaries and pure function layers. Uses shared typedefs for cross-file structures.

## Goals
- Complete type coverage for utility layer (pure functions benefit most)
- Type the I/O service boundaries (LLM, ST Vector)
- Provide IntelliSense for high-traffic utility functions
- Zero runtime impact — pure comments, no transpilation
- Maintain "ESM + No Bundler" architecture

## Files to Add `@ts-check`

### Services Layer (2 files)
1. `src/llm.js` (~160 lines) - Unified LLM communication
2. `src/services/st-vector.js` (~280 lines) - ST Vector REST API

### Utilities Layer (6 files)
3. `src/utils/queue.js` (~140 lines) - AIMD Ladder Queue
4. `src/utils/cdn.js` (~110 lines) - CDN import with mirror fallback
5. `src/utils/embedding-codec.js` (~120 lines) - Base64 Float32Array codec
6. `src/utils/tokens.js` (~100 lines) - Token counting, turn boundary snapping
7. `src/utils/stemmer.js` (~45 lines) - Language-aware stemming
8. `src/utils/transliterate.js` (~90 lines) - Cyrillic↔Latin, Levenshtein

**Note:** `src/utils/text.js` already has `// @ts-check` from Phase 1.

---

## New Type Definitions (Add to `src/types.js`)

```javascript
/**
 * ST Vector Storage item for insert/sync operations
 * @typedef {Object} StVectorItem
 * @property {number} hash - Cyrb53 hash ID
 * @property {string} text - Text content (with optional OV_ID prefix)
 * @property {number} [index] - Optional index field
 */

/**
 * ST Vector Storage query result
 * @typedef {Object} StVectorQueryResult
 * @property {string} id - Extracted OpenVault ID or hash as string
 * @property {number} hash - Numeric hash
 * @property {string} text - Stored text content
 */

/**
 * LLM configuration preset for callLLM
 * @typedef {Object} LLMConfig
 * @property {string} profileSettingKey - Settings key for profile selection
 * @property {number} maxTokens - Maximum output tokens
 * @property {string} errorContext - Error message context
 * @property {number} timeoutMs - Request timeout in milliseconds
 * @property {function(): Object} [getJsonSchema] - Optional function returning Zod JSON schema
 */

/**
 * LLM call options
 * @typedef {Object} LLMCallOptions
 * @property {boolean} [structured] - Enable structured output with jsonSchema
 * @property {AbortSignal} [signal] - AbortSignal for cancellation
 * @property {string} [profileId] - Override profile ID
 * @property {string} [backupProfileId] - Backup profile for failover
 */

/**
 * Ladder Queue interface returned by createLadderQueue
 * @typedef {Object} LadderQueue
 * @property {<T>(taskFn: () => Promise<T>) => Promise<T>} add - Add task to queue
 * @property {function(): Promise<void>} onIdle - Promise resolving when queue is idle
 * @property {number} concurrency - Current concurrency level
 */

/**
 * CDN mirror function type
 * @typedef {function(string): string} CdnMirrorFn
 */
```

---

## File-by-File Implementation

### Services Layer

#### 1. `src/llm.js`

**Add at top:**
```javascript
// @ts-check

/** @typedef {import('./types.js').LLMConfig} LLMConfig */
/** @typedef {import('./types.js').LLMCallOptions} LLMCallOptions */
/** @typedef {import('./types.js').LLMMessages} LLMMessages */
```

**Key functions to type:**
- `raceAbort(promise, signal)` → `Promise<any>`
- `callLLM(messages, config, options = {})` → `Promise<string>`

**Note:** `LLM_CONFIGS` already has JSDoc comments — verify they align with `LLMConfig`.

---

#### 2. `src/services/st-vector.js`

**Add at top:**
```javascript
// @ts-check

/** @typedef {import('../types.js').StVectorItem} StVectorItem */
/** @typedef {import('../types.js').StVectorQueryResult} StVectorQueryResult */
```

**Key functions to type:**
- `syncItemsToST(items, chatId)` → `Promise<boolean>`
- `querySTVector(searchText, topK, threshold, chatId)` → `Promise<StVectorQueryResult[]>`
- `deleteItemsFromST(hashes, chatId)` → `Promise<boolean>`
- `purgeSTCollection(chatId)` → `Promise<boolean>`
- `isStVectorSource()` → `boolean`
- `getSTVectorSource()` → `string`
- `getSTVectorRequestBody(source)` → `Object`
- `_clearValidatedChatsCache()` → `void` (test-only)

**Internal helpers** (no new typedefs needed):
- `chatExists(chatId)` → `Promise<boolean>`
- `getSTCollectionId(chatId)` → `string`
- `extractOvId(text)` → `string | null`
- `getSourceApiUrl(sourceType)` → `string | undefined`

---

### Utilities Layer

#### 3. `src/utils/queue.js`

**Add at top:**
```javascript
// @ts-check

/** @typedef {import('../types.js').LadderQueue} LadderQueue */
```

**Key functions to type:**
- `createLadderQueue(maxConcurrency = 1)` → `Promise<LadderQueue>`
- `isRateLimitError(error)` → `boolean`

---

#### 4. `src/utils/cdn.js`

**Add at top:**
```javascript
// @ts-check

/** @typedef {import('../types.js').CdnMirrorFn} CdnMirrorFn */
```

**Key functions to type:**
- `cdnImport(packageSpec)` → `Promise<any>`
- `_setTestOverride(packageSpec, mod)` → `void` (test-only)

**Internal:**
- `getTestOverrides()` → `Map<string, object>`

---

#### 5. `src/utils/embedding-codec.js`

**Add at top:**
```javascript
// @ts-check
```

**Key functions to type:**
- `encode(vec)` → `string`
- `decode(b64)` → `Float32Array`
- `getEmbedding(obj)` → `Float32Array | null`
- `setEmbedding(obj, vec)` → `void`
- `hasEmbedding(obj)` → `boolean`
- `deleteEmbedding(obj)` → `void`
- `markStSynced(obj)` → `void`
- `isStSynced(obj)` → `boolean`
- `clearStSynced(obj)` → `void`
- `cyrb53(str, seed = 0)` → `number`

**Note:** Because embeddings attach to multiple object types (Memory, Entity, CommunitySummary), type `obj` parameters as `Record<string, any>` or `Object` to avoid rigid casting issues.

---

#### 6. `src/utils/tokens.js`

**Add at top:**
```javascript
// @ts-check
```

**Key functions to type:**
- `countTokens(text)` → `number`
- `clearTokenCache()` → `void`
- `getMessageTokenCount(chat, index)` → `number`
- `getTokenSum(chat, indices)` → `number`
- `snapToTurnBoundary(chat, messageIds)` → `number[]`

---

#### 7. `src/utils/stemmer.js`

**Add at top:**
```javascript
// @ts-check
```

**Key functions to type:**
- `stemWord(word)` → `string`
- `stemName(name)` → `Set<string>`

---

#### 8. `src/utils/transliterate.js`

**Add at top:**
```javascript
// @ts-check
```

**Key functions to type:**
- `transliterateCyrToLat(str)` → `string`
- `levenshteinDistance(a, b)` → `number`
- `resolveCharacterName(name, canonicalNames, maxDistance = 2)` → `string | null`

---

## Implementation Steps

1. **Add new typedefs to `src/types.js`**
   - Add all 6 new type definitions above
   - Verify no syntax errors with `npm run lint`

2. **Add `@ts-check` to services layer**
   - `src/llm.js` — import typedefs, add JSDoc to exports
   - `src/services/st-vector.js` — import typedefs, add JSDoc to exports
   - Run `npm run lint` to verify

3. **Add `@ts-check` to utilities layer**
   - `src/utils/queue.js`, `cdn.js`, `embedding-codec.js`
   - `src/utils/tokens.js`, `stemmer.js`, `transliterate.js`
   - Run `npm run lint` after each

4. **Verify**
   - Check VS Code Problems panel — should show 0 errors
   - Run `npm run test` to ensure no runtime regressions
   - Verify IntelliSense works for new types

---

## Success Criteria

- [ ] `// @ts-check` present in all 8 target files
- [ ] VS Code shows IntelliSense for `StVectorItem`, `LLMConfig`, `LadderQueue`, etc.
- [ ] Property access typos show red underline
- [ ] All existing tests pass (`npm run test`)
- [ ] No new runtime dependencies added

---

## Implementation Notes

### CDN Library Types
Some libraries imported via CDN (`p-queue`, `snowball-stemmers`, `cyrillic-to-translit-js`) lack type definitions in vanilla JS environments. If the TS server complains:

```javascript
// @ts-expect-error - No types available for CDN import
const module = await cdnImport('some-package');
```

This is acceptable — the libraries work at runtime, we just can't fully type their APIs.

### Generic Type Syntax in JSDoc
The `LadderQueue.add` generic uses TS syntax inside JSDoc:

```javascript
/** @property {<T>(taskFn: () => Promise<T>) => Promise<T>} add */
```

This tells the TS server that `add()` returns exactly what the task function returns.

### AbortSignal Typing
Using `AbortSignal` (not `Object`) for the `signal` property connects to built-in DOM types, enabling IntelliSense for `.aborted` and `.addEventListener()`.

---

## Files NOT to Type

Stop here. Do NOT add `@ts-check` to:
- `src/ui/*.js` — jQuery/DOM manipulation is notoriously annoying to type via JSDoc
- `src/settings.js` — Settings object is dynamic per SillyTavern's structure
- Test files — Tests use Vitest mocks that confuse the TS server

---

## Completion

After Phase 3, the codebase will have comprehensive type coverage across:
- **Phase 1**: Core domain (retrieval math, extraction)
- **Phase 2**: Graph, store, prompt builders
- **Phase 3**: Utilities, services, I/O boundaries

The UI layer remains untyped — this is intentional. Domain logic is fully protected where it matters most.
