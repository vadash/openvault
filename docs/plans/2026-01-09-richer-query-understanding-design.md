# Richer Query Understanding

**Date:** 2026-01-09
**Status:** Approved
**Goal:** Improve retrieval quality by extracting entities and themes from recent chat context, using weighted signals for smarter embedding and BM25 queries.

## Overview

Enhance OpenVault's retrieval by extracting entities from recent chat (10 messages), then building enriched queries for both embedding similarity and BM25 keyword matching. Works across Latin and Cyrillic text.

```
┌─────────────────────────────────────────────────────────┐
│                   Recent Chat (10 msgs)                 │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              extractQueryContext()                      │
│  - Rule-based entity extraction (Latin + Cyrillic)      │
│  - Recency-weighted scoring                             │
│  - Returns: { entities: [...], weights: {...} }         │
└─────────────────────┬───────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│ buildEmbedQuery  │    │  buildBM25Query  │
│ (5 msgs weighted │    │ (entities with   │
│  + top entities) │    │  boost weights)  │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│  getEmbedding()  │    │   bm25Score()    │
│    (existing)    │    │   (existing)     │
└──────────────────┘    └──────────────────┘
```

**Files affected:**
- New: `src/retrieval/query-context.js`
- Modified: `src/retrieval/scoring.js`, `src/retrieval/math.js`, `src/embeddings/strategies.js`
- Settings: `src/ui/settings.js`, `src/constants.js`

## Entity Extraction

**New file: `src/retrieval/query-context.js`**

### Extraction Rules (no ML model)

```javascript
// Capitalized words - Latin alphabet
/\b[A-Z][a-z]{2,}\b/g  // "Sarah", "Marcus", "Cabin"

// Capitalized words - Cyrillic alphabet
/\b[А-ЯЁ][а-яё]{2,}\b/g  // "Саша", "Москва"

// Quoted speech (captures emphasis)
/"([^"]+)"|«([^»]+)»/g  // "I love you" or «Я тебя люблю»

// Known character names (from getActiveCharacters())
// Direct match, highest priority
```

### Filtering

- Exclude common sentence starters: "The", "This", "Then", "После", "Когда"
- Exclude words appearing in >50% of messages (too common)
- Minimum 3 characters

### Weighting Calculation

```javascript
function extractEntities(messages) {
  const entityScores = new Map();

  messages.forEach((msg, index) => {
    const recencyWeight = 1 - (index * 0.09); // 1.0 → 0.19 over 10 msgs
    const entities = extractFromText(msg.mes);

    entities.forEach(entity => {
      const current = entityScores.get(entity) || { count: 0, weightSum: 0 };
      current.count++;
      current.weightSum += recencyWeight;
      entityScores.set(entity, current);
    });
  });

  // Final score = weightSum
  // Sort by weightSum, return top N
}
```

### Output Format

```javascript
{
  entities: ["Sasha", "cabin", "confession"],
  weights: { "Sasha": 2.4, "cabin": 1.1, "confession": 0.8 }
}
```

## Query Building

### Embedding Query Builder

```javascript
function buildEmbeddingQuery(messages, extractedEntities) {
  // Take last 5 messages (user + LLM)
  const recent = messages.slice(0, 5);

  // Weight by recency (repeat more recent content)
  const weighted = [
    recent[0]?.mes,           // 2x weight - repeat newest
    recent[0]?.mes,
    recent[1]?.mes,           // 1.5x weight
    recent[1]?.mes?.slice(0, recent[1]?.mes?.length / 2),
    recent[2]?.mes,
    recent[3]?.mes,
    recent[4]?.mes
  ].filter(Boolean).join(' ');

  // Append top 5 entities (adds semantic anchors)
  const topEntities = extractedEntities.entities.slice(0, 5).join(' ');

  // Cap at strategy's optimal chunk size
  const chunkSize = getOptimalChunkSize();
  return (weighted + ' ' + topEntities).slice(0, chunkSize);
}
```

### BM25 Query Builder

```javascript
function buildBM25Query(userMessage, extractedEntities) {
  // Start with original user message tokens
  const tokens = tokenize(userMessage);

  // Add entities with boost (repeat = higher term frequency)
  extractedEntities.entities.forEach((entity, i) => {
    const weight = extractedEntities.weights[entity];
    const repeats = Math.ceil(weight); // 2.4 → 3 repeats
    for (let r = 0; r < repeats; r++) {
      tokens.push(entity.toLowerCase());
    }
  });

  return tokens;
}
```

## Embedding Strategy Chunk Sizes

Each embedding strategy reports its optimal chunk size:

```javascript
// src/embeddings/strategies.js

const strategies = {
  transformers: {
    name: 'Transformers.js (WASM)',
    optimalChunkSize: 500,  // chars, conservative for 512 tokens
    // ...
  },

  webgpu: {
    name: 'WebGPU (Gemma)',
    optimalChunkSize: 1200,  // larger context window
    // ...
  },

  ollama: {
    name: 'Ollama',
    optimalChunkSize: 800,  // safe default
    // ...
  }
};

export function getOptimalChunkSize() {
  const strategy = getCurrentStrategy();
  return strategy?.optimalChunkSize || 1000;
}
```

## Integration

### Changes to `src/retrieval/scoring.js`

```javascript
import { extractQueryContext, buildEmbeddingQuery, buildBM25Tokens } from './query-context.js';

export async function selectRelevantMemoriesSimple(
  memories, recentContext, userMessages, characterName,
  activeCharacters, limit, chatLength
) {
  // NEW: Extract context from recent messages
  const recentMessages = parseRecentMessages(recentContext, 10);
  const queryContext = extractQueryContext(recentMessages, activeCharacters);

  // NEW: Build enriched queries
  const embeddingQuery = buildEmbeddingQuery(recentMessages, queryContext);
  const bm25Tokens = buildBM25Tokens(userMessages, queryContext);

  // EXISTING: Get embedding (now with enriched query)
  let contextEmbedding = null;
  if (isEmbeddingsEnabled() && embeddingQuery) {
    contextEmbedding = await getEmbedding(embeddingQuery);
  }

  // EXISTING: Run worker (pass enriched BM25 tokens)
  return runWorkerScoring(memories, contextEmbedding, chatLength, limit, bm25Tokens);
}
```

### Changes to `src/retrieval/math.js`

```javascript
export function scoreMemories(memories, contextEmbedding, chatLength,
                              constants, settings, queryTokens) {
  // If queryTokens is array, use directly; if string, tokenize
  const tokens = Array.isArray(queryTokens)
    ? queryTokens
    : tokenize(queryTokens);
  // ... rest unchanged ...
}
```

## Configuration

### Default Values (`src/constants.js`)

```javascript
export const QUERY_CONTEXT_DEFAULTS = {
  entityWindowSize: 10,       // messages to scan for entities
  embeddingWindowSize: 5,     // messages for embedding query
  recencyDecayFactor: 0.09,   // weight reduction per position
  topEntitiesCount: 5,        // max entities to inject
  entityBoostWeight: 1.5      // BM25 boost for extracted entities
};
```

### Settings UI

New collapsible "Advanced Retrieval" section:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Entity window | slider | 10 | Messages to scan for names/places |
| Embedding window | slider | 5 | Messages to include in semantic query |
| Top entities | slider | 5 | Max entities to inject into query |
| Entity boost | slider | 1.5 | BM25 weight multiplier for entities |

**Not exposed in UI:**
- `optimalChunkSize` — auto from strategy
- `recencyDecayFactor` — sane default

## Testing

### Unit Tests (`tests/retrieval/query-context.test.js`)

```javascript
// Entity extraction
test('extracts Latin capitalized names', () => {
  expect(extractEntities('Sarah went to the Cabin'))
    .toContain('Sarah', 'Cabin');
});

test('extracts Cyrillic names', () => {
  expect(extractEntities('Саша пошла домой'))
    .toContain('Саша');
});

test('weights recent messages higher', () => {
  const result = extractQueryContext([
    { mes: 'Marcus arrived' },  // newest
    { mes: 'Sarah left' },
    { mes: 'Marcus spoke' }     // oldest
  ]);
  expect(result.weights['Marcus']).toBeGreaterThan(result.weights['Sarah']);
});

// Query building
test('respects chunk size limit', () => {
  const query = buildEmbeddingQuery(longMessages, entities);
  expect(query.length).toBeLessThanOrEqual(getOptimalChunkSize());
});

test('boosts entities in BM25 tokens', () => {
  const tokens = buildBM25Tokens('hello', { entities: ['Sasha'], weights: { Sasha: 2 }});
  expect(tokens.filter(t => t === 'sasha').length).toBe(2);
});
```

### Manual Verification

- Enable debug logging for extracted entities
- Compare retrieval results before/after on existing chat
- Check browser console for `[OpenVault] Query context: {...}`
