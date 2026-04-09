# Design: Float32Array Runtime Embeddings

## 1. Problem Statement

Two unnecessary `Array.from()` conversions waste memory and CPU on every embedding operation:

**Conversion #1 — `TransformersStrategy.#embed()`:**
Transformers.js `pipeline()` returns `output.data` as a native `Float32Array`. The strategy immediately converts it to `number[]` via `Array.from(output.data)` for no reason.

**Conversion #2 — `embedding-codec.js:decode()`:**
The codec decodes Base64 → `Uint8Array` → `Float32Array` → `Array.from(new Float32Array(...))`. The final `Array.from()` exists because the original storage design chose `number[]` as the runtime type to avoid `JSON.stringify` surprises with `Float32Array`. But with the codec fully in place, embeddings are never directly serialized — they go through `setEmbedding()` which handles the encoding. The `JSON.stringify` concern is no longer relevant.

**Memory impact (per 384-dim embedding):**

| Type | Bytes per element | Per-vector memory | Per-vector with V8 overhead |
|------|:-:|:-:|:-:|
| `number[]` | 8 (double) | 3,072 B | ~5,072 B |
| `Float32Array` | 4 (float32) | 1,536 B | ~1,600 B |

That's **68% less memory** per embedding. For the LRU cache (500 entries): 2.5 MB → 0.8 MB. For scoring 5,000 memories: 25 MB transient → 8 MB transient.

**CPU impact:**
- Two `Array.from()` conversions eliminated per embedding decode
- `cosineSimilarity()` on `Float32Array` benefits from V8's typed array optimizations (contiguous memory, no boxing)
- Loop unrolling (4 elements per iteration) reduces branch overhead: 96 iterations instead of 384 for 384-dim vectors

## 2. Goals & Non-Goals

### Must do:
- Return `Float32Array` from `getEmbedding()` (both Base64 and legacy paths)
- Return `Float32Array` from all strategy methods and public embedding API
- Store `Float32Array` in the embedding cache
- Remove both `Array.from()` conversions (codec decode + Transformers strategy)
- Wrap Ollama's `number[]` response in `Float32Array` for type consistency
- Unroll `cosineSimilarity()` loop (4 elements per iteration)
- `cosineSimilarity()` accepts both `Float32Array` and `number[]` (backwards-compatible)
- Update `embedding-codec.test.js` assertions for `Float32Array` return type
- Update JSDoc types across all changed functions

### Won't do:
- Batch scoring function (process N memories in one `cosineSimilarity` call) — premature; current `scoreMemories` with `yieldToMain` every 250 is good enough
- WASM/WebGPU-accelerated dot product — would require a new dependency or WebGPU compute shader
- Change `setEmbedding()` — it already accepts `Float32Array` input (`instanceof` check exists)
- Change `hasEmbedding()` or `deleteEmbedding()` — unrelated to runtime type
- Change test mocks that return `number[]` — `cosineSimilarity` handles mixed types

## 3. Proposed Architecture

### 3.1 Data Flow (Before vs After)

**Before:**
```
Transformers.js pipeline → Float32Array
  → Array.from() → number[]           ← WASTE
  → cache stores number[]
  → setEmbedding() → Float32Array → Base64

getEmbedding() → atob → Float32Array
  → Array.from() → number[]           ← WASTE
  → cosineSimilarity(number[], number[])
```

**After:**
```
Transformers.js pipeline → Float32Array
  → cache stores Float32Array          ← DIRECT
  → setEmbedding() → encodes to Base64 (no conversion needed)

getEmbedding() → atob → Float32Array   ← DIRECT
  → cosineSimilarity(Float32Array, Float32Array)
```

### 3.2 Type Contract

All embedding vectors at runtime are `Float32Array`. The type flows through three layers:

| Layer | Function | Returns |
|-------|----------|---------|
| **Codec** | `getEmbedding(obj)` | `Float32Array \| null` |
| **Strategy** | `strategy.getQueryEmbedding(text)` | `Float32Array \| null` |
| **Public API** | `getQueryEmbedding(text)` / `getDocumentEmbedding(text)` | `Float32Array \| null` |
| **Cache** | `embeddingCache.get(key)` | `Float32Array \| null` |
| **Math** | `cosineSimilarity(vecA, vecB)` | `number` (accepts `Float32Array \| number[]`) |

**Why `cosineSimilarity` stays polymorphic:** Test mocks return `number[]` from `getEmbedding`. Making the function typed-only would force updating ~15 test files for zero runtime benefit. The unrolled loop works identically on both types via `[]` indexing.

### 3.3 Unrolled Cosine Similarity

Process 4 elements per iteration, handle remainder separately:

```js
export function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
        return 0;
    }

    const len = vecA.length;
    let dot = 0, normA = 0, normB = 0;

    // Process 4 elements per iteration (384-dim → 96 iterations)
    const limit = len - (len % 4);
    for (let i = 0; i < limit; i += 4) {
        const a0 = vecA[i],     a1 = vecA[i + 1], a2 = vecA[i + 2], a3 = vecA[i + 3];
        const b0 = vecB[i],     b1 = vecB[i + 1], b2 = vecB[i + 2], b3 = vecB[i + 3];
        dot   += a0 * b0 + a1 * b1 + a2 * b2 + a3 * b3;
        normA += a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
        normB += b0 * b0 + b1 * b1 + b2 * b2 + b3 * b3;
    }

    // Handle remainder (0-3 elements)
    for (let i = limit; i < len; i++) {
        dot   += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dot / magnitude;
}
```

**Why 4x unroll, not 8x?**
384 and 768 are both divisible by 4 (no remainder). 8x would also work (384 % 8 = 0, 768 % 8 = 0), but 4x is the sweet spot for code readability vs performance. V8's JIT handles 4-wide patterns well without excessive register pressure.

## 4. Callsite Migration Map

### 4.1 `src/utils/embedding-codec.js` — Core Type Change

**`decode()`** — Remove `Array.from()`:

```js
// BEFORE:
function decode(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return Array.from(new Float32Array(bytes.buffer));
}

// AFTER:
function decode(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Float32Array(bytes.buffer);
}
```

**`getEmbedding()`** — Wrap legacy path:

```js
// BEFORE:
export function getEmbedding(obj) {
    if (!obj) return null;
    if (obj.embedding_b64) return decode(obj.embedding_b64);
    if (obj.embedding && obj.embedding.length > 0) return obj.embedding;
    return null;
}

// AFTER:
export function getEmbedding(obj) {
    if (!obj) return null;
    if (obj.embedding_b64) return decode(obj.embedding_b64);
    if (obj.embedding && obj.embedding.length > 0) return new Float32Array(obj.embedding);
    return null;
}
```

**`encode()`** — No change needed (already accepts `Float32Array`).
**`setEmbedding()`** — No change needed (already accepts `Float32Array`).
**`hasEmbedding()`** — No change needed (checks key existence, not type).
**`deleteEmbedding()`** — No change needed (deletes keys, not type-dependent).

### 4.2 `src/embeddings.js` — Strategy + Cache Changes

**`TransformersStrategy.#embed()`** — Remove `Array.from()`:

```js
// BEFORE:
return Array.from(output.data);

// AFTER:
return output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
```

Why the guard? `output.data` is `Float32Array` in practice, but the Transformers.js API doesn't guarantee it in its TypeScript types. Defensive.

**`OllamaStrategy.getEmbedding()`** — Wrap response:

```js
// BEFORE:
return data.embedding || null;

// AFTER:
return data.embedding ? new Float32Array(data.embedding) : null;
```

**Cache hits** — No change needed. The cache stores whatever the strategy returns (now `Float32Array`). LRU operations (delete + re-set, eviction) work identically on any value type.

**`getQueryEmbedding()` / `getDocumentEmbedding()` return type** — Changes from `number[] | null` to `Float32Array | null`. No code change needed; the strategy return type flows through.

**`generateEmbeddingsForMemories()` / `enrichEventsWithEmbeddings()`** — No code change. They call `setEmbedding(obj, embeddings[i])` which already accepts `Float32Array`.

### 4.3 `src/retrieval/math.js` — Unrolled `cosineSimilarity()`

Replace the existing loop with the 4x unrolled version from §3.3. Update JSDoc parameter types to `Float32Array | number[]`.

**`calculateScore()`** — No code change. Calls `cosineSimilarity(contextEmbedding, getEmbedding(memory))` which now receives `Float32Array` from both sides.

**`scoreMemories()`** — No code change. Passes embeddings through to `calculateScore`.

### 4.4 All Cosine Similarity Callsites (No Changes)

Every callsite follows one of two patterns:

**Pattern A: `cosineSimilarity(getEmbedding(a), getEmbedding(b))`**
Both arguments are now `Float32Array`. No change needed.

| File | Line | Call |
|------|------|------|
| `extract.js` | 260 | `cosineSimilarity(getEmbedding(event), getEmbedding(memory))` |
| `graph.js` | 305 | `cosineSimilarity(newEmbedding, getEmbedding(node))` |
| `graph.js` | 450 | `cosineSimilarity(getEmbedding(nodeA), getEmbedding(nodeB))` |
| `reflect.js` | 103 | `cosineSimilarity(getEmbedding(ref), getEmbedding(existing))` |
| `reflect.js` | 164 | `cosineSimilarity(getEmbedding(recent), getEmbedding(reflection))` |
| `world-context.js` | 27 | `cosineSimilarity(queryEmbedding, getEmbedding(community))` |

**Pattern B: `cosineSimilarity(apiEmbedding, getEmbedding(obj))`**
First argument from `getQueryEmbedding()`/`getDocumentEmbedding()` (now `Float32Array`). Second from codec. No change needed.

| File | Line | Call |
|------|------|------|
| `math.js` | 200 | `cosineSimilarity(contextEmbedding, getEmbedding(memory))` |
| `reflect.js` | 259 | `cosineSimilarity(queryEmb, getEmbedding(m))` |

### 4.5 JSDoc Type Updates

All `@returns {number[]|null}` and `@param {number[]}` for embedding vectors change to `@returns {Float32Array|null}` / `@param {Float32Array|number[]}`.

| File | Function | Change |
|------|----------|--------|
| `embedding-codec.js` | `decode()` | `@returns {Float32Array}` |
| `embedding-codec.js` | `getEmbedding()` | `@returns {Float32Array\|null}` |
| `embeddings.js` | `EmbeddingStrategy.getEmbedding()` | `@returns {Promise<Float32Array\|null>}` |
| `embeddings.js` | `EmbeddingStrategy.getQueryEmbedding()` | `@returns {Promise<Float32Array\|null>}` |
| `embeddings.js` | `EmbeddingStrategy.getDocumentEmbedding()` | `@returns {Promise<Float32Array\|null>}` |
| `embeddings.js` | `getQueryEmbedding()` | `@returns {Promise<Float32Array\|null>}` |
| `embeddings.js` | `getDocumentEmbedding()` | `@returns {Promise<Float32Array\|null>}` |
| `math.js` | `cosineSimilarity()` | `@param {Float32Array\|number[]}` both params |
| `math.js` | `calculateScore()` | `@param {Float32Array\|null} contextEmbedding` |
| `math.js` | `scoreMemories()` | `@param {Float32Array\|null} contextEmbedding` |
| `world-context.js` | `retrieveWorldContext()` | `@param {Float32Array} queryEmbedding` |

### 4.6 ARCHITECTURE.md Update

The Embeddings section currently says:
> Stored as Base64 Float32Array. Legacy JSON arrays read transparently (lazy migration).

Update to:
> Stored as Base64 Float32Array, decoded to `Float32Array` at runtime (not `number[]`). Legacy JSON arrays wrapped in `Float32Array` on read (lazy migration). True LRU cache (max 500). All cosine similarity uses 4x loop-unrolled dot product on typed arrays.

## 5. Interface / API Design

### Changed return types (no signature changes)

```js
// embedding-codec.js
export function getEmbedding(obj) {} // Returns: Float32Array | null (was: number[] | null)

// embeddings.js — strategies
class EmbeddingStrategy {
    async getEmbedding(text, options) {}       // Returns: Float32Array | null
    async getQueryEmbedding(text, options) {}  // Returns: Float32Array | null
    async getDocumentEmbedding(text, options) {} // Returns: Float32Array | null
}

// embeddings.js — public API
export async function getQueryEmbedding(text, options) {}    // Returns: Float32Array | null
export async function getDocumentEmbedding(text, options) {} // Returns: Float32Array | null
```

### Changed parameter types (backwards-compatible)

```js
// math.js
export function cosineSimilarity(vecA, vecB) {}
// vecA, vecB: Float32Array | number[]  (was: number[])
// Returns: number (unchanged)
```

### Unchanged signatures

```js
// embedding-codec.js — these accept Float32Array already
export function setEmbedding(obj, vec) {}     // vec: number[] | Float32Array (unchanged)
export function hasEmbedding(obj) {}          // boolean (unchanged)
export function deleteEmbedding(obj) {}       // void (unchanged)

// embeddings.js — batch operations
export async function generateEmbeddingsForMemories(memories, options) {}  // unchanged
export async function enrichEventsWithEmbeddings(events, options) {}        // unchanged

// math.js — scoring
export function calculateScore(memory, contextEmbedding, ...) {}  // unchanged structure
export async function scoreMemories(memories, contextEmbedding, ...) {} // unchanged structure
```

## 6. Risks & Edge Cases

| Risk | Mitigation |
|------|-----------|
| **Float32Array not deep-equal to number[]** | `expect(f32).toEqual([...])` fails in Vitest. Test assertions updated to use `Float32Array` or `Array.from()`. Only affects `embedding-codec.test.js` (real codec) — mocked tests are unaffected. |
| **Cache returns shared reference** | `Float32Array` is mutable — callers could theoretically corrupt cached values. But `number[]` had the same issue, and no code mutates embeddings post-creation. Non-issue. |
| **Transformers.js `output.data` type not guaranteed** | Defensive guard: `output.data instanceof Float32Array ? output.data : new Float32Array(output.data)`. Handles hypothetical future API changes. |
| **Ollama returns numbers that lose precision in Float32** | Float32 has ~7 significant digits. Ollama models output vectors normalized to unit length — individual components are typically 4-6 significant digits. No precision concern. |
| **Legacy `number[]` → `Float32Array` conversion cost** | `new Float32Array([...])` for 384 elements: ~2μs. One-time per `getEmbedding()` call on legacy data. Amortized as data migrates to Base64 format via `setEmbedding()`. |
| **Unrolled loop correctness for non-standard dimensions** | Remainder loop handles `len % 4 !== 0`. All current models use 384 or 768 (both divisible by 4), but the code is safe for any dimension. |
| **Mixed-type `cosineSimilarity(number[], Float32Array)`** | Works correctly — `[]` indexing and `.length` are identical on both types. V8 doesn't penalize mixed-type access in modern JIT. |

## 7. Testing Strategy

### `tests/utils/embedding-codec.test.js` — Assertion Updates

Tests that assert `getEmbedding()` output need to expect `Float32Array`:

```js
// BEFORE:
const decoded = getEmbedding(obj);
expect(decoded).toEqual([0.1, 0.2, 0.3]);

// AFTER:
const decoded = getEmbedding(obj);
expect(decoded).toBeInstanceOf(Float32Array);
expect(Array.from(decoded)).toEqual([
    expect.closeTo(0.1, 5),
    expect.closeTo(0.2, 5),
    expect.closeTo(0.3, 5),
]);
```

New test case:
```js
it('returns Float32Array from Base64 decode', () => {
    const obj = {};
    setEmbedding(obj, [0.5, -0.5, 1.0]);
    const result = getEmbedding(obj);
    expect(result).toBeInstanceOf(Float32Array);
});

it('wraps legacy number[] in Float32Array', () => {
    const obj = { embedding: [0.1, 0.2, 0.3] };
    const result = getEmbedding(obj);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(3);
});
```

### `tests/math.test.js` — cosineSimilarity Unrolling

New test cases for the unrolled loop:

```js
it('handles Float32Array inputs', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
});

it('handles mixed Float32Array + number[] inputs', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = [1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
});

it('handles vectors with length not divisible by 4', () => {
    const a = new Float32Array([1, 2, 3, 4, 5]);
    const b = new Float32Array([1, 2, 3, 4, 5]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
});

it('produces identical results for unrolled vs naive on 384-dim', () => {
    const a = new Float32Array(384);
    const b = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
        a[i] = Math.random() * 2 - 1;
        b[i] = Math.random() * 2 - 1;
    }
    // Naive reference
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < 384; i++) {
        dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
    }
    const expected = dot / (Math.sqrt(na) * Math.sqrt(nb));
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 10);
});
```

### Existing test suites — no changes needed

| Test file | Why unchanged |
|-----------|---------------|
| `math.test.js` (existing cases) | Uses legacy `embedding: [1, 0, 0]` → `getEmbedding()` wraps in Float32Array → `cosineSimilarity` handles it |
| `graph.test.js` | Mocks `getEmbedding` to return `number[]` → `cosineSimilarity` handles mixed types |
| `communities.test.js` | Same mock pattern as graph.test.js |
| `reflect.test.js` | Uses `embedding: [0.1, 0.9]` properties → same flow as math.test.js |
| `world-context.test.js` | Uses `embedding: [0.9, 0.1, 0.0]` → same flow |
| `extract.test.js` | Uses legacy embeddings or mock fetch → works transparently |
| `retrieve.test.js` | Uses legacy embeddings + mock Ollama fetch |
| `preflight-gate.test.js` | Uses `embedding: [1, 0, 0]` → same flow |
| `export-debug.test.js` | Already uses `new Float32Array(384)` in test data |

### `tests/embeddings.test.js` — Minor assertion update

```js
// Line 62 — check decoded type:
const decoded = getEmbedding(memories[0]);
expect(decoded).toBeInstanceOf(Float32Array);
```

## 8. File Change Summary

| File | Type of change |
|------|---------------|
| `src/utils/embedding-codec.js` | Remove `Array.from()` from `decode()`, wrap legacy path in `Float32Array` |
| `src/embeddings.js` | Remove `Array.from()` from Transformers strategy, wrap Ollama response |
| `src/retrieval/math.js` | Unroll `cosineSimilarity()` loop 4x, update JSDoc types |
| `src/retrieval/world-context.js` | Update JSDoc param type |
| `include/ARCHITECTURE.md` | Update Embeddings section |
| `tests/utils/embedding-codec.test.js` | Update assertions for Float32Array return type + new cases |
| `tests/math.test.js` | Add Float32Array + mixed-type + unroll correctness tests |
| `tests/embeddings.test.js` | Update decoded type assertion |

**Total: 4 source files changed (3 with code changes + 1 JSDoc-only), 1 doc file, 3 test files updated.**
