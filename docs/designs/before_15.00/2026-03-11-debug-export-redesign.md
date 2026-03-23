# Design: Debug Export Redesign

## 1. Problem Statement

The "Copy Debug Info" button exports a JSON payload that:
- Dumps ALL scored memories (200+) with full JS float precision (15+ decimals)
- Includes the full raw graph (all nodes + edges) — easily 10KB+ in long chats
- Dumps all ~40 settings regardless of whether they differ from defaults
- Truncates memory summaries to 80 chars, losing context needed for debugging
- Every scoring entry includes zero/default fields (`recencyPenalty: 0`, `hitDamping: 1.0`, etc.)
- Omits useful debug info: raw `retrieval_hits`/`mentions` counts, decay percentage, BM25 tier breakdown, embedding model, extraction progress, reflection state, token budget utilization

Result: oversized, noisy payloads that waste tokens when pasted into LLM context for help, while missing actionable debug signals.

## 2. Goals & Non-Goals

### Must do
- Round all floats to 2 decimal places
- Scope scoring details to: selected memories + top 15 rejected (not all 200+)
- Omit score breakdown fields at default/zero values (with explanatory note in output)
- Show graph summary + only nodes/edges relevant to current query entities
- Only include settings that differ from `defaultSettings`
- Add to each scoring entry: `retrieval_hits`, `mentions`, `characters_involved`, `decayPct`
- Add to query context: BM25 token tier counts (entity / grounded / non-grounded)
- Add to runtime: `embedding_model_id`, extraction progress, reflection state
- Add to lastRetrieval: token budget utilization (budget / used / trimmedCount)
- Include perf metrics from `perf/store.js`
- Increase summary char limits (selected: 200, rejected: 150)
- Keep full injected context (memory + world XML)

### Won't do
- Change output format from JSON (stays JSON, stays clipboard)
- Change the perf tab's separate copy button
- Add new UI controls or settings for the export
- Change cache timing or lifecycle

## 3. Proposed Architecture

All changes concentrated in 2 files: `src/ui/export-debug.js` (payload builder) and `src/retrieval/debug-cache.js` (cache shape). No new files.

### 3.1 Float Rounding

```javascript
const r2 = (n) => Math.round(n * 100) / 100;
```

Applied via a `compactScores()` helper that rounds all numeric fields in a scoring entry.

### 3.2 Scoring Detail Scoping

Currently `buildExportPayload()` dumps the entire `getCachedScoringDetails()` array (all scored memories).

**New behavior**: Split into two arrays:
- `selected`: entries where `selected === true` (full breakdown)
- `rejected`: top 15 entries by `scores.total` where `selected === false`

Stats are still computed from the FULL array (all scored) — only the detail rows get filtered.

### 3.3 Score Field Zero-Suppression

For each scoring detail entry, omit fields at their default/neutral value:

| Field | Omit when | Default meaning |
|---|---|---|
| `baseAfterFloor` | `== base` | Imp-5 floor didn't activate |
| `recencyPenalty` | `== 0` | No floor bonus |
| `vectorSimilarity` | `== 0` | No embedding match |
| `vectorBonus` | `== 0` | Below threshold or no embeddings |
| `bm25Score` | `== 0` | No BM25 match |
| `bm25Bonus` | `== 0` | No BM25 contribution |
| `hitDamping` | `== 1` | No retrieval history |
| `frequencyFactor` | `== 1` | Single mention |

Always present: `id`, `type`, `summary`, `total`, `base`, `distance`, `importance`, `selected`, `decayPct`, `retrieval_hits`, `mentions`, `characters_involved`.

A `_note` string at the top of the `scoring` section explains the convention.

### 3.4 New Scoring Fields

**`decayPct`**: Shows what fraction of max base score survived distance decay.

```javascript
// decayPct = base / importance (range 0-1, where 1 = no decay)
const decayPct = importance > 0 ? r2(base / importance) : 0;
```

Example: importance 4, base 1.68 → `decayPct: 0.42` = "retained 42% of max after decay"

**`retrieval_hits`** and **`mentions`**: Raw counts from the memory object (inputs to hitDamping/frequencyFactor).

### 3.5 Summary Truncation Change

Move truncation from cache-time to export-time:
- `cacheScoringDetails()`: store full summary (no truncation)
- `buildExportPayload()`: truncate based on selection status
  - Selected memories: 200 chars
  - Rejected memories: 150 chars

### 3.6 Graph Filtering

Use `lastRetrieval.queryContext.entities` to identify relevant entity keys.

```javascript
function filterGraphByEntities(graph, entities) {
    // Normalize entity names to graph keys (lowercase, etc.)
    // Include nodes whose key or name matches any entity (case-insensitive)
    // Include edges where source OR target is a matched node
    // Return: { nodes: {...}, edges: {...}, matchedEntities: [...] }
}
```

Summary section unchanged. New `relevant` sub-section replaces `raw`.

### 3.7 Settings Diff

```javascript
function diffSettings(current, defaults) {
    const diff = {};
    for (const [key, defaultVal] of Object.entries(defaults)) {
        const currentVal = current[key];
        if (currentVal !== defaultVal) {
            diff[key === 'enabled' ? 'autoMode' : key] = currentVal;
        }
    }
    return diff;
}
```

If all settings match defaults → `settings: {}`.

### 3.8 BM25 Token Tier Summary

Cache tier counts in `cacheRetrievalDebug()` from `selectRelevantMemoriesSimple()`:

```javascript
cacheRetrievalDebug({
    queryContext: {
        entities: queryContext.entities,
        embeddingQuery: embeddingQuery,
        bm25Tokens: {
            total: bm25Tokens.length,
            entityStems: entityStemCount,    // Layer 1
            grounded: groundedCount,          // Layer 2
            nonGrounded: nonGroundedCount,    // Layer 3
        },
    },
});
```

This requires `buildBM25Tokens` to return tier metadata alongside the token array.

### 3.9 New Runtime & State Fields

```javascript
runtime: {
    embeddingsEnabled: true,
    embeddingModelId: data.embedding_model_id || null,
    extractionProgress: {
        processed: (data.processed_message_ids || []).length,
        chatLength: context.chat?.length || 0,
    },
    reflectionState: data.reflection_state || {},
}
```

### 3.10 Token Budget Utilization

Add to `lastRetrieval` via `cacheRetrievalDebug()` in `retrieve.js`:

```javascript
cacheRetrievalDebug({
    tokenBudget: {
        budget: ctx.finalTokens,
        scoredCount: relevantMemories.length,
        selectedCount: finalResults.length,
        trimmedByBudget: relevantMemories.length - finalResults.length,
    },
});
```

### 3.11 Perf Metrics Inclusion

Import `getAll()` from `src/perf/store.js`. Round ms values to 2dp. Drop `ts` field (timestamp noise).

```javascript
perf: Object.fromEntries(
    Object.entries(perfStore.getAll()).map(([id, entry]) => [
        PERF_METRICS[id]?.label || id,
        { ms: r2(entry.ms), ...(entry.size ? { size: entry.size } : {}) }
    ])
)
```

### 3.12 Scoring Stats Compaction

Flatten the stats object — merge reflection/event breakdowns into nested objects:

```javascript
// Before (current)
{ reflectionsScored, reflectionsSelected, avgReflectionScore, eventsScored, eventsSelected, avgEventScore }

// After
{ reflections: { scored, selected, avgScore }, events: { scored, selected, avgScore } }
```

Remove `rejected` from stats (rejected entries now have their own top-level array in `scoring`).

## 4. Data Models / Schema

### New payload shape

```json
{
  "openvault_debug_export": true,
  "exportedAt": "2026-03-11T12:00:00Z",

  "lastRetrieval": {
    "timestamp": 1710158400000,
    "filters": { "totalMemories": 100, "hiddenMemories": 45, "afterPOVFilter": 95 },
    "queryContext": {
      "entities": ["Alice", "Garden"],
      "embeddingQuery": "Alice walked toward the garden...",
      "bm25Tokens": { "total": 42, "entityStems": 15, "grounded": 18, "nonGrounded": 9 }
    },
    "retrievalContext": {
      "userMessages": "...",
      "chatLength": 200,
      "primaryCharacter": "Alice",
      "activeCharacters": ["Alice"]
    },
    "tokenBudget": { "budget": 10000, "scoredCount": 95, "selectedCount": 8, "trimmedByBudget": 87 },
    "injectedContext": "<scene_memory>full XML here...</scene_memory>",
    "injectedWorldContext": "Community summary text..."
  },

  "scoring": {
    "_note": "Default-value fields omitted from entries. Defaults: recencyPenalty=0, hitDamping=1, frequencyFactor=1, vector/bm25 fields=0",
    "stats": {
      "totalScored": 100,
      "selected": 8,
      "reflections": { "scored": 10, "selected": 2, "avgScore": 2.34 },
      "events": { "scored": 90, "selected": 6, "avgScore": 1.56 },
      "topScore": 4.23,
      "cutoffScore": 1.12
    },
    "selected": [
      {
        "id": "abc123",
        "type": "event",
        "summary": "Alice walked into the garden and found a mysterious glowing stone beneath the old oak tree. She picked it up carefully...",
        "total": 6.81,
        "base": 2.35,
        "decayPct": 0.59,
        "vectorSimilarity": 0.71,
        "vectorBonus": 3.23,
        "bm25Score": 0.46,
        "bm25Bonus": 1.23,
        "distance": 42,
        "importance": 4,
        "retrieval_hits": 3,
        "mentions": 2,
        "frequencyFactor": 1.03,
        "characters_involved": ["Alice"]
      }
    ],
    "rejected": [
      {
        "id": "def456",
        "type": "event",
        "summary": "Bob mentioned he saw strange lights near the forest edge last week during his patrol...",
        "total": 1.05,
        "base": 0.98,
        "decayPct": 0.49,
        "distance": 150,
        "importance": 2,
        "retrieval_hits": 0,
        "mentions": 1,
        "characters_involved": ["Bob"]
      }
    ]
  },

  "state": {
    "memories": {
      "total": 100,
      "byType": { "event": 90, "reflection": 10 },
      "byImportance": { "3": 40, "4": 30, "5": 20, "2": 8, "1": 2 },
      "avgImportance": 3.2
    },
    "characterStates": {
      "Alice": { "emotion": "happy", "intensity": 5, "knownEvents": 10 }
    },
    "graph": {
      "summary": {
        "nodeCount": 50,
        "edgeCount": 80,
        "typeBreakdown": { "PERSON": 10, "PLACE": 15, "CONCEPT": 25 },
        "topEntitiesByMentions": [
          { "name": "Alice", "type": "PERSON", "mentions": 42 }
        ]
      },
      "relevant": {
        "matchedEntities": ["Alice", "Garden"],
        "nodes": {
          "alice": { "name": "Alice", "type": "PERSON", "description": "Main character", "mentions": 42, "aliases": ["Al"] },
          "garden": { "name": "Garden", "type": "PLACE", "description": "A mystical garden", "mentions": 15 }
        },
        "edges": {
          "alice__garden": { "source": "alice", "target": "garden", "description": "visits frequently", "weight": 3 }
        }
      }
    },
    "communities": {
      "count": 3,
      "details": {
        "C0": { "title": "Alice's World", "summary": "...", "findings": ["f1", "f2"], "nodeCount": 5 }
      }
    }
  },

  "perf": {
    "Pre-gen injection": { "ms": 12.34, "size": "8 memories" },
    "Auto-hide messages": { "ms": 5.67, "size": "200 msgs" },
    "LLM: Events": { "ms": 2345.67, "size": "2 messages" }
  },

  "settings": {
    "alpha": 0.8,
    "visibleChatBudget": 20000
  },

  "runtime": {
    "embeddingsEnabled": true,
    "embeddingModelId": "multilingual-e5-small",
    "extractionProgress": { "processed": 180, "chatLength": 200 },
    "reflectionState": { "Alice": { "importance_sum": 35 } }
  }
}
```

### Changes to `cacheScoringDetails()` (debug-cache.js)

```javascript
// Before
return {
    memoryId: memory.id,
    type: memory.type || 'event',
    summary: truncatedSummary,    // 80 chars
    scores: { base, baseAfterFloor, recencyPenalty, vectorSimilarity, vectorBonus,
              bm25Score, bm25Bonus, hitDamping, frequencyFactor, total },
    selected: selectedSet.has(memory.id),
    distance: breakdown.distance,
};

// After
return {
    memoryId: memory.id,
    type: memory.type || 'event',
    summary: memory.summary || '',     // Full summary — truncated at export time
    scores: { base, baseAfterFloor, recencyPenalty, vectorSimilarity, vectorBonus,
              bm25Score, bm25Bonus, hitDamping, frequencyFactor, total },
    selected: selectedSet.has(memory.id),
    distance: breakdown.distance,
    importance: breakdown.importance,   // NEW
    retrieval_hits: memory.retrieval_hits || 0,  // NEW
    mentions: memory.mentions || 1,     // NEW
    characters_involved: memory.characters_involved || [],  // NEW
};
```

### Changes to `buildBM25Tokens()` (query-context.js)

Return tier metadata alongside token array:

```javascript
// New return type (backward compatible via .tokens or direct array use)
// Option: return { tokens: string[], tiers: { entityStems, grounded, nonGrounded } }
// But this breaks callers who use the array directly.
// Better: cache tier counts separately via cacheRetrievalDebug in scoring.js
```

Decision: Don't change `buildBM25Tokens` return type. Instead, compute tier counts in `selectRelevantMemoriesSimple()` by counting entity stems vs message stems before calling `buildBM25Tokens`, then cache them.

Alternative: Add a second export function `buildBM25TokensWithMeta()` or have `buildBM25Tokens` accept an optional metadata accumulator object. Simplest: extract tier counts from the token construction logic directly in `selectRelevantMemoriesSimple` using the same inputs.

Final approach: Add an optional `meta` object parameter to `buildBM25Tokens`. If provided, the function fills it with tier counts. Callers that don't pass it see no change.

```javascript
export function buildBM25Tokens(userMessage, extractedEntities, corpusVocab = null, meta = null) {
    // ... existing logic ...
    // At each layer, count tokens added
    if (meta) {
        meta.entityStems = entityStemCount;
        meta.grounded = groundedCount;
        meta.nonGrounded = nonGroundedCount;
    }
    return tokens;
}
```

## 5. Interface / API Design

### Modified functions

```javascript
// src/ui/export-debug.js
buildExportPayload()
// Returns restructured payload (see §4). No signature change.

// New internal helpers (not exported):
r2(n)                                    // Round to 2dp
compactScores(detail)                    // Zero-suppress + round a scoring entry
filterGraphByEntities(graph, entities)   // Query-relevant graph subset
diffSettings(current, defaults)          // Settings diff from defaults
truncateSummary(text, limit)             // Truncate with '...'

// src/retrieval/debug-cache.js
cacheScoringDetails(scoredResults, selectedIds)
// Expanded cached fields: +importance, +retrieval_hits, +mentions, +characters_involved
// Summary stored full (no truncation)

// src/retrieval/query-context.js
buildBM25Tokens(userMessage, extractedEntities, corpusVocab, meta)
// New optional meta parameter for tier count tracking
```

No new exports, no new files.

## 6. File Change Map

| File | Change | Scope |
|------|--------|-------|
| `src/ui/export-debug.js` | Restructure `buildExportPayload()`, add helpers (r2, compactScores, filterGraphByEntities, diffSettings) | ~120 lines modified |
| `src/retrieval/debug-cache.js` | Expand `cacheScoringDetails` fields, remove summary truncation | ~10 lines |
| `src/retrieval/scoring.js` | Cache token budget info via `cacheRetrievalDebug` | ~5 lines |
| `src/retrieval/query-context.js` | Add optional `meta` param to `buildBM25Tokens` | ~15 lines |
| `tests/ui/export-debug.test.js` | Update for new payload shape | ~60 lines |
| `tests/retrieval/debug-cache.test.js` | Update for new cached fields | ~20 lines |
| `include/ARCHITECTURE.md` | Update Performance Monitoring section | ~5 lines |

## 7. Risks & Edge Cases

### Risk: Missing query entities before first retrieval
- **Scenario**: `lastRetrieval` is null (button pressed before any generation).
- **Handling**: Graph falls back to summary-only (no `relevant` section). `scoring` is null. Same null pattern as current.

### Risk: All settings at defaults
- **Scenario**: User hasn't changed anything.
- **Handling**: `settings: {}`. Clear signal. No token waste.

### Risk: Summary truncation mid-word
- **Handling**: `slice(0, limit - 3) + '...'` pattern. Acceptable for debug.

### Risk: `buildBM25Tokens` meta parameter ignored by existing callers
- **Handling**: Default `meta = null`. No-op when not passed. Zero breakage.

### Edge case: Memories with no characters_involved
- **Handling**: Default to `[]`. Field always present in scoring entries for consistent shape.

### Edge case: Graph entities not in graph nodes
- **Scenario**: Query entity extracted from message but no matching graph node.
- **Handling**: `matchedEntities` shows what was searched. Empty nodes/edges sections. Still useful — shows "these entities were queried but had no graph presence."
