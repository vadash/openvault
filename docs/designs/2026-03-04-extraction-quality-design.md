# Design: Extraction Quality Improvements

## 1. Problem Statement

OpenVault's extraction pipeline produces duplicate entities and an excessive reflection-to-event ratio, degrading memory quality over long conversations.

**Evidence from production data (693-message session):**
- 46 graph nodes with obvious semantic duplicates (`Vova's house` / `Vova's Apartment` / `Vova's Bedroom`; 4 variants of "silicone dildo")
- Edge descriptions growing unbounded (21 pipe-delimited segments on `suzy__vova`)
- 136 reflections vs 62 events (2.2:1 ratio) — reflections may be diluting concrete event retrieval
- 62 memories with type `"unknown"` instead of `"event"`

## 2. Goals & Non-Goals

### Must do
- **Semantic entity deduplication** — merge entities that refer to the same thing using embedding similarity
- **Tune reflection frequency** — reduce reflection-to-event ratio without losing narrative insight quality
- **Cap edge descriptions** — prevent unbounded growth matching the existing entity description cap pattern

### Won't do
- Prompt restructuring or example reduction (user confirmed current examples are worth keeping)
- Token cost optimization (not the primary pain point)
- Retrieval algorithm changes (retrieval relevance is acceptable)
- Debug export improvements (deferred)

## 3. Proposed Architecture

### 3A. Semantic Entity Deduplication

**Current state:** `normalizeKey()` does lowercase + possessive strip + whitespace collapse. This catches `"Vova's House"` = `"vova house"` but NOT `"Vova's house"` ≠ `"Vova's Apartment"`.

**Proposed approach:** Post-extraction embedding-based merge pass.

#### Flow

```
LLM extracts entities
    ↓
upsertEntity() tries normalizeKey() match (existing fast path)
    ↓
If no key match found:
    ↓
Generate embedding for new entity name+type
    ↓
Compare against embeddings of existing nodes (same type only)
    ↓
If cosine similarity ≥ threshold → merge into existing node
If below threshold → create new node
```

#### Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **What to embed** | `"{type}: {name}"` (e.g., `"PLACE: Vova's Apartment"`) | Type-prefixed embedding prevents cross-type merges (a person named "Castle" won't merge with a place named "Castle") |
| **Same-type constraint** | Only compare within same `type` | Reduces comparison space and prevents nonsensical merges |
| **Similarity threshold** | 0.80 (configurable as `entityMergeSimilarityThreshold`) | Lower than event dedup (0.85) because entity names are shorter and less semantically rich. Needs tuning. |
| **Merge behavior** | Keep the node with more `mentions`. Append description from the merged node. Redirect all edges. | Preserves the more established entity |
| **When to run** | After each extraction batch, before community detection | Catches duplicates early |
| **Embedding reuse** | Store entity embeddings on nodes (`node.embedding`) | Avoids re-embedding on every extraction cycle |
| **Batch vs incremental** | Incremental — only embed new entities, compare against cached embeddings of existing nodes | O(new × existing_same_type) per extraction, not O(n²) |

#### Entity merge function (pseudocode)

```javascript
async function mergeOrInsertEntity(graphData, name, type, description, cap, settings) {
    const key = normalizeKey(name);

    // Fast path: exact key match (existing behavior)
    if (graphData.nodes[key]) {
        upsertEntity(graphData, name, type, description, cap);
        return key;
    }

    // Slow path: semantic match
    const newEmbedding = await getDocumentEmbedding(`${type}: ${name}`);
    if (!newEmbedding) {
        // Embeddings unavailable, fall back to insert
        upsertEntity(graphData, name, type, description, cap);
        return key;
    }

    const threshold = settings.entityMergeSimilarityThreshold ?? 0.80;
    let bestMatch = null;
    let bestScore = 0;

    for (const [existingKey, node] of Object.entries(graphData.nodes)) {
        if (node.type !== type) continue;
        if (!node.embedding) continue;

        const sim = cosineSimilarity(newEmbedding, node.embedding);
        if (sim >= threshold && sim > bestScore) {
            bestMatch = existingKey;
            bestScore = sim;
        }
    }

    if (bestMatch) {
        // Merge into existing node
        upsertEntity(graphData, graphData.nodes[bestMatch].name, type, description, cap);
        return bestMatch;
    }

    // No match: create new node with embedding
    upsertEntity(graphData, name, type, description, cap);
    graphData.nodes[key].embedding = newEmbedding;
    return key;
}
```

#### Edge redirection on merge

When entity B merges into entity A, all edges referencing B's key must be redirected to A's key. Edges that would create duplicates (A→C already exists, B→C being redirected) should have their descriptions and weights merged.

#### Retroactive merge (one-time migration)

For existing graphs with accumulated duplicates, provide a `consolidateGraph()` function that:
1. Embeds all existing nodes that lack embeddings
2. Runs pairwise same-type comparison
3. Merges nodes above threshold
4. Redirects edges
5. Can be triggered manually from settings UI

### 3B. Reflection Tuning

**Current state:**
- Threshold: 30 importance points per character
- Avg event importance: ~3.9 → triggers every ~8 events
- Each trigger: 3 questions × 1-5 insights = 3-15 reflections
- Result: 2.2:1 reflection-to-event ratio

**Problems:**
1. Reflections outnumber events, potentially burying concrete memories in retrieval
2. With weak models, insight quality degrades — vague reflections waste retrieval slots

**Proposed changes:**

#### Option A: Raise threshold (simple)
- Change default `reflectionThreshold` from 30 → 50
- Effect: triggers every ~13 events instead of ~8
- Reduces ratio to ~1.2:1 (15/13) worst case, ~0.23:1 (3/13) best case

#### Option B: Cap reflections per trigger (targeted)
- Add `maxInsightsPerReflection` setting (default: 2, currently unbounded 1-5 from LLM)
- Keep threshold at 30 but limit output
- Effect: 3 questions × max 2 insights = max 6 reflections per trigger → ratio ~0.75:1

#### Option C: Both (recommended)
- Raise threshold to 40 AND cap insights at 3 per question
- Effect: triggers every ~10 events, max 9 reflections → ratio ~0.9:1
- Also update the insight extraction prompt to explicitly request "1-3 insights" instead of "1-5"

**Recommendation: Option C** — reduces volume while maintaining quality by keeping the most important insights.

#### Reflection quality gate

Additionally, consider discarding reflections that are too similar to existing ones (reuse the cosine similarity infrastructure):
- Before storing a reflection, compare its embedding against existing reflections for the same character
- If similarity ≥ 0.90, skip it (it's a rehash)
- This prevents the "Alice's trust in Bob is conflicted" insight from being generated in 5 slightly different phrasings

### 3C. Edge Description Cap

**Current state:** `upsertRelationship()` appends descriptions with `' | '` separator indefinitely. `suzy__vova` has 21 segments.

**Fix:** Add `edgeDescriptionCap` setting (default: 5, matching the higher interaction frequency of edges vs entities). Apply the same FIFO eviction pattern already used in `upsertEntity()`.

```javascript
// In upsertRelationship, after appending:
if (cap > 0) {
    const segments = existing.description.split(' | ');
    if (segments.length > cap) {
        existing.description = segments.slice(-cap).join(' | ');
    }
}
```

### 3D. Fix "unknown" Memory Type (Quick Fix)

Investigate why 62 memories have `type: "unknown"` instead of `"event"`. Likely a missing default assignment in the extraction pipeline. This should be a simple bug fix in `extract.js` where events are created.

## 4. Data Models / Schema

### Entity node (updated)
```json
{
  "name": "Vova's Apartment",
  "type": "PLACE",
  "description": "Private space where scenes occur | Location of BDSM activities",
  "mentions": 5,
  "embedding": [0.12, -0.34, ...]  // NEW: 384-dim vector (or null)
}
```

### Settings additions
```json
{
  "entityMergeSimilarityThreshold": 0.80,
  "edgeDescriptionCap": 5,
  "reflectionThreshold": 40,
  "maxInsightsPerReflection": 3,
  "reflectionDedupThreshold": 0.90
}
```

## 5. Interface / API Design

### New exports from `graph.js`
```javascript
// Replace direct upsertEntity calls in extract.js
export async function mergeOrInsertEntity(graphData, name, type, description, cap, settings)

// One-time migration for existing graphs
export async function consolidateGraph(graphData, settings)
```

### Updated `upsertRelationship` signature
```javascript
// Add cap parameter (backwards compatible, defaults to 5)
export function upsertRelationship(graphData, source, target, description, cap = 5)
```

### Updated reflection prompt (prompts.js)
```javascript
// buildInsightExtractionPrompt: change "1-5 insights" to "1-3 insights"
// in both the schema description and the rules section
```

## 6. Risks & Edge Cases

| Risk | Mitigation |
|------|------------|
| **False entity merges** (two genuinely different entities merged) | Same-type constraint + 0.80 threshold + manual threshold tuning in settings. Can always be raised if merges are too aggressive. |
| **Embedding model unavailable** (WASM fails, Ollama down) | Graceful fallback to key-only matching (current behavior). The `if (!newEmbedding)` guard handles this. |
| **Performance: embedding every new entity** | Entity extraction typically yields 1-5 entities per batch. Embedding is fast for short strings. Negligible compared to LLM extraction call. |
| **Edge cap too aggressive** | 5 segments is generous for most edges. The `suzy__vova` main-couple edge is an extreme outlier. Cap is configurable. |
| **Reflection quality drops with fewer insights** | Monitor: if insights become too generic, lower `maxInsightsPerReflection` is the wrong lever — raise threshold instead to give more source material per reflection cycle. |
| **Retroactive merge on large graphs** | `consolidateGraph()` is O(n² / types). For 46 nodes this is trivial. For 500+ nodes, consider batching by type. |
| **Entity name language mismatch** | `multilingual-e5-small` handles 100+ languages. `"PLACE: Vova's Apartment"` and `"PLACE: Квартира Вовы"` should have reasonable similarity. Test with actual multilingual data. |

## 7. Implementation Order

1. **Edge description cap** — smallest change, immediate graph health benefit
2. **Fix "unknown" memory type** — quick bug fix
3. **Reflection tuning** — raise threshold + cap insights + update prompt
4. **Reflection dedup** — cosine similarity gate on new reflections
5. **Entity semantic merge (incremental)** — new entities in extraction pipeline
6. **Entity retroactive merge** — one-time consolidation function + UI button
7. **Settings UI** — expose new thresholds

## 8. What the Debug Export Should Eventually Include

Not in scope for this design, but noted for future:
- Actual LLM request/response for extraction (or at minimum: token counts, model ID)
- Extraction timing per batch
- Failed/retried extractions with error messages
- Entity merge log (which entities were merged and why)
- Reflection trigger log (which character, what importance sum triggered it)
