# Enhanced Memory Weights Debug Output

## Date
2025-01-09

## Overview
Add detailed debug information to the "Copy Memory Weights" feature to help users understand why memories are scored the way they are. Currently only shows final score; this design adds breakdown of contributing factors.

## Motivation
Users debugging retrieval often want to understand:
- Which keywords triggered BM25 matching
- What query context was used
- How much each scoring factor contributed
- Why certain memories ranked higher/lower

## Output Format

```
=== OpenVault Memory Debug Info ===
Query Context: "last 3 user messages excerpt..."
BM25 Keywords: [token1, token2, entity1, entity1, entity2] (boosted entities repeated)

Memory Scores:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[12.3] ★★★★★ Important memory summary
  ├─ Base: 5.0 (importance 5)
  ├─ Recency penalty: -0.2 (distance 5)
  ├─ Vector similarity: +7.5 (sim 0.75 > threshold 0.5)
  └─ BM25 keywords: +0.0 (no matches)

[8.7] ★★★☆☆ Another memory summary
  ├─ Base: 3.0 (importance 3)
  ├─ Recency penalty: -1.5 (distance 50)
  ├─ Vector similarity: +0.0 (below threshold)
  └─ BM25 keywords: +7.2 (3 keyword matches)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: 2 memories
Settings: vectorWeight=15, keywordWeight=1.0, threshold=0.5
```

## Implementation Changes

### 1. `src/retrieval/math.js`

Modify `calculateScore()` to return breakdown object instead of single number:

```javascript
// Current: returns number
export function calculateScore(...) { return score; }

// New: returns breakdown
export function calculateScore(...) {
    // ... calculations ...
    return {
        total: score,
        base: importance * Math.exp(-lambda * distance), // before floor
        baseAfterFloor: importance === 5 ? Math.max(...) : ..., // after floor applied
        recencyPenalty: importance * Math.exp(-lambda * distance) - (importance === 5 ? ... : ...),
        vectorBonus: normalizedSim * maxBonus,
        vectorSimilarity: similarity,
        bm25Bonus: bm25Score * keywordWeight,
        bm25Score: bm25Score,
        distance: distance,
        importance: importance
    };
}
```

Modify `scoreMemories()` to pass through breakdowns:

```javascript
return {
    memory,
    score: breakdown.total,
    breakdown  // <-- include full breakdown
};
```

### 2. `src/ui/settings.js`

Modify `copyMemoryWeights()` to format with breakdowns:

```javascript
// Build header with query context
const queryHeader = `Query Context: "${userMessages.slice(0, 100)}..."`;
const bm25Header = `BM25 Keywords: [${tokens.join(', ')}]`;

// Format each memory with breakdown tree
const output = scored.map(({ memory, score, breakdown }) => {
    const stars = '*'.repeat(memory.importance || 3);
    let lines = [
        `[${score.toFixed(1)}] [${stars}] ${memory.summary}`,
        `  ├─ Base: ${breakdown.base.toFixed(1)} (importance ${breakdown.importance})`,
        `  ├─ Recency penalty: ${breakdown.recencyPenalty.toFixed(1)} (distance ${breakdown.distance})`
    ];

    if (breakdown.vectorSimilarity > 0) {
        lines.push(`  ├─ Vector similarity: +${breakdown.vectorBonus.toFixed(1)} (sim ${breakdown.vectorSimilarity.toFixed(2)})`);
    } else {
        lines.push(`  ├─ Vector similarity: +0.0 (below threshold)`);
    }

    if (breakdown.bm25Score > 0) {
        lines.push(`  └─ BM25 keywords: +${breakdown.bm25Bonus.toFixed(1)} (${breakdown.bm25Score.toFixed(2)} raw)`);
    } else {
        lines.push(`  └─ BM25 keywords: +0.0 (no matches)`);
    }

    return lines.join('\n');
}).join('\n');
```

## Files to Modify

1. `src/retrieval/math.js` - Return breakdown from `calculateScore()`, pass through in `scoreMemories()`
2. `src/ui/settings.js` - Format output with breakdowns in `copyMemoryWeights()`

## Backward Compatibility

The `scoreMemories()` return value shape changes. Callers that expect `{memory, score}` need updating:

- `src/retrieval/worker.js` - Already destructures `s.memory`, needs to handle new shape
- `src/retrieval/scoring.js` - Uses `scored.map(({ memory, score }) => ...)` - needs update

## Testing

1. Unit test `calculateScore()` returns correct breakdown structure
2. Unit test breakdown values sum to total
3. Manual test: click "Copy Memory Weights", verify format
4. Test with memories that have:
   - High vector similarity
   - High BM25 matches
   - High importance with floor applied
