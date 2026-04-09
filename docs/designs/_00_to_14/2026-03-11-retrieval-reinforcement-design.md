# Design: Retrieval-Reinforced Scoring

## 1. Problem Statement

OpenVault tracks `retrieval_hits` on memories (how many times a memory was selected for injection) but never uses this signal in scoring. Additionally, when event deduplication drops a duplicate, the original event gets no record that the action repeated — the system can't distinguish a one-off event from a recurring habit.

Two related improvements:
- **A. Access-Reinforced Decay**: Memories retrieved often should decay slower (spaced repetition).
- **B. Event Frequency Counter**: Repeated events should increment a `mentions` counter instead of being silently dropped, and that counter should boost retrieval score.

## 2. Goals & Non-Goals

### Must do
- Wire existing `retrieval_hits` into the decay formula (dampen lambda).
- Increment `mentions` on existing memories when dedup catches a duplicate.
- Feed `mentions` into scoring as a sublinear frequency boost.
- Add both new factors to the score breakdown (debug cache + export).
- Update `ARCHITECTURE.md` to document the new scoring factors and schema fields.
- Add unit tests for both factors.

### Won't do
- No new UI settings or sliders (hardcoded constants, tunable later).
- No UI changes to memory browser (badges, frequency display — future scope).
- No `last_retrieved_at` tracking (nice-to-have but unnecessary for v1).
- No changes to reflection scoring (only events benefit from `mentions`).

## 3. Proposed Architecture

Both features modify the same scoring function (`calculateScore`) and require minimal schema evolution. No new files needed.

### Feature A: Access-Reinforced Decay

**Location**: `src/retrieval/math.js` → `calculateScore()`

Current decay:
```
lambda = BASE_LAMBDA / (importance²)
base = importance × e^(-lambda × distance)
```

New decay — dampen lambda by retrieval history:
```
hitDamping = max(0.5, 1 / (1 + hits × 0.1))
lambda = (BASE_LAMBDA / (importance²)) × hitDamping
```

The `hitDamping` factor:
- 0 hits → `1.0` (no change)
- 5 hits → `0.67` (33% slower decay)
- 10 hits → `0.5` (50% slower decay — hard cap)
- 100 hits → `0.5` (cap prevents immortal memories)

The cap at `0.5` means retrieval can never reduce decay by more than half. Memories still fade — just slower if they keep proving relevant.

### Feature B: Event Frequency Counter

**Two touch points:**

1. **Dedup** (`src/extraction/extract.js` → `filterSimilarEvents()`): When a duplicate is caught, increment `mentions` on the original instead of silently dropping.

2. **Scoring** (`src/retrieval/math.js` → `calculateScore()`): Multiply final score by a frequency factor.

```
frequencyFactor = 1 + log(mentions) × 0.05
total *= frequencyFactor
```

The factor:
- 1 mention (default) → `1.0×` (no boost)
- 2 mentions → `1.035×`
- 5 mentions → `1.08×`
- 10 mentions → `1.115×`
- 50 mentions → `1.196×`

Sublinear (logarithmic) scaling prevents runaway inflation. A memory repeated 50 times gets ~20% boost, not 50×.

### Combined Effect

Both features compound multiplicatively on the base score:

```
lambda = (BASE_LAMBDA / importance²) × hitDamping    ← Feature A
base = importance × e^(-lambda × distance)
total = base + vectorBonus + bm25Bonus
total *= frequencyFactor                              ← Feature B
```

Example: An importance-3 event retrieved 5 times, with 3 duplicate mentions, at distance 200:
- **Before**: base ≈ 3 × e^(-0.0056 × 200) ≈ 0.98
- **After**: lambda dampened to 0.0037, base ≈ 3 × e^(-0.0037 × 200) ≈ 1.42, then ×1.055 frequency → **1.50**
- Net effect: ~53% higher score. Noticeable but not dominant.

## 4. Data Models / Schema

### Memory object changes (backward compatible)

```javascript
{
    // ... existing fields ...
    retrieval_hits: number,  // Already tracked in scoring.js:180. Now READ in calculateScore().
    mentions: number,        // NEW. Defaults to 1 via (memory.mentions || 1). Incremented on dedup.
}
```

No migration needed — both fields use `|| default` patterns:
- `memory.retrieval_hits || 0`
- `memory.mentions || 1`

### Score breakdown changes

`calculateScore()` return object gains two fields:

```javascript
{
    // ... existing: total, base, baseAfterFloor, recencyPenalty, vectorBonus, vectorSimilarity, bm25Bonus, bm25Score, distance, importance
    hitDamping: number,        // NEW: 0.5–1.0, decay dampening factor from retrieval_hits
    frequencyFactor: number,   // NEW: ≥1.0, multiplicative boost from mentions
}
```

### Debug cache changes

`cacheScoringDetails()` already serializes the full `breakdown` object via `scores: { ... }`. The two new fields will auto-propagate to `getCachedScoringDetails()` and `buildExportPayload()` without changes to `debug-cache.js` or `export-debug.js`.

## 5. Interface / API Design

### Modified functions

```javascript
// src/retrieval/math.js
calculateScore(memory, contextEmbedding, chatLength, constants, settings, bm25Score)
// Returns: { ...existing, hitDamping: number, frequencyFactor: number }

// src/extraction/extract.js
filterSimilarEvents(newEvents, existingMemories, cosineThreshold, jaccardThreshold)
// Side effect: mutates existingMemories[i].mentions on cross-batch dedup match
// Side effect: mutates kept[i].mentions on intra-batch dedup match
// Return value unchanged: filtered event array
```

No new exports, no new files, no signature changes.

## 6. File Change Map

| File | Change | Lines |
|------|--------|-------|
| `src/retrieval/math.js` | Add hitDamping + frequencyFactor to `calculateScore()` | ~10 |
| `src/extraction/extract.js` | Increment `mentions` in both dedup phases of `filterSimilarEvents()` | ~4 |
| `src/retrieval/debug-cache.js` | Add `hitDamping`, `frequencyFactor` to `cacheScoringDetails()` | ~2 |
| `tests/retrieval/math.test.js` | Tests for decay dampening + frequency boost | ~80 |
| `tests/extraction/extract.test.js` | Test for mentions increment on dedup | ~40 |
| `include/ARCHITECTURE.md` | Document new scoring factors + schema fields | ~20 |

**Total: ~156 lines across 6 files.**

## 7. Risks & Edge Cases

### Risk: Immortal memories (Feature A)
- **Scenario**: High-importance memory retrieved every turn forever.
- **Mitigation**: Hard cap `hitDamping >= 0.5`. Even with maximum dampening, decay still operates at 50% rate. Existing importance-5 floor and reflection decay remain unchanged.

### Risk: Score inflation from combined features
- **Scenario**: Memory with 10 hits AND 10 mentions gets double boost.
- **Mitigation**: Both features are sublinear. Max combined effect: 50% slower decay × 1.115 frequency = at most ~60% higher score than vanilla. This is comparable to the existing importance-5 floor bump.

### Risk: Mutation during dedup (Feature B)
- **Scenario**: `filterSimilarEvents` mutates `existingMemories` array items in place.
- **Not a problem**: `existingMemories` references `data[MEMORIES_KEY]` which is the live store. Mutations persist on next `saveOpenVaultData()` call, which happens at the Phase 1 commit point right after dedup.

### Edge case: Old memories without `mentions`
- **Handling**: `memory.mentions || 1` treats missing field as "seen once" → `log(1) = 0` → no boost. Backward compatible by default.

### Edge case: Old memories without `retrieval_hits`
- **Handling**: `memory.retrieval_hits || 0` → `hitDamping = 1.0` → no change. Already handled by existing code pattern.
