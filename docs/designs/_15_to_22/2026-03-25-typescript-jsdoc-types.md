# Design: TypeScript-Style Type Safety via `@ts-check`

## Summary
Enable TypeScript-level type checking across three core files without a build step. Uses inline JSDoc with centralized type definitions imported via JSDoc's native `import()` syntax.

## Goals
- Catch property-renaming typos and refactoring breaks at edit time
- Provide IntelliSense/autocomplete in VS Code
- Zero runtime impact — pure comments, no transpilation
- Maintain "ESM + No Bundler" architecture from CLAUDE.md

## Approach

### Centralized Type Definitions
Create `src/types.js` containing all domain type definitions as JSDoc comments. This file exports nothing at runtime — it's purely for TypeScript server's consumption via `import()`.

```javascript
// src/types.js
// @ts-check

/**
 * Core memory object stored in chatMetadata.openvault.memories
 * @typedef {Object} Memory
 * @property {string} id - Unique identifier (cyrb53 hash)
 * @property {string} summary - Human-readable event description
 * @property {number} importance - 1-5 scale, affects forgetfulness curve
 * @property {number[]} [embedding] - Vector embedding for similarity search
 * @property {number} message_id - Source message sequence number
 * @property {number} timestamp - Unix timestamp
 * @property {string[]} [witnesses] - Character names present
 * @property {string} [type] - 'event' | 'reflection' | 'global_synthesis'
 * @property {number} [level] - Reflection level (1-3) for decay calculation
 * @property {string[]} tokens - Pre-computed BM25 stem tokens
 * @property {boolean} [_st_synced] - Sync status for ST Vector Storage
 */

/**
 * Knowledge graph entity
 * @typedef {Object} Entity
 * @property {string} key - Normalized unique key (lowercase, no possessives)
 * @property {string} name - Display name
 * @property {string} [description] - LLM-generated description
 * @property {string} [entityType] - 'character' | 'object' | 'location' | 'abstract'
 * @property {number} [firstSeen] - Message ID where first extracted
 * @property {number} [lastSeen] - Message ID where last mentioned
 * @property {string[]} [aliases] - Alternative names
 * @property {number[]} [embedding] - Vector representation
 * @property {boolean} [_st_synced]
 */

/**
 * Relationship between two entities
 * @typedef {Object} Relationship
 * @property {string} source - Source entity key
 * @property {string} target - Target entity key
 * @property {string} relation - Relationship type (e.g., "friend_of", "enemy_of")
 * @property {number} [strength] - 1-10 scale
 * @property {number} [firstSeen]
 * @property {number} [lastSeen]
 * @property {string} [description]
 * @property {boolean} [_st_synced]
 */

/**
 * Extracted event from LLM
 * @typedef {Object} ExtractedEvent
 * @property {string} summary
 * @property {number} importance - 1-5
 * @property {string[]} witnesses
 * @property {string} [mood] - Emotional tone
 * @property {string[]} [tags]
 * @property {string} [thinking] - LLM reasoning (stripped before storage)
 */

/**
 * Graph extraction result from LLM
 * @typedef {Object} GraphExtraction
 * @property {Array<{name: string, entityType: string, description: string}>} entities
 * @property {Array<{source: string, target: string, relation: string, description: string}>} relationships
 */

/**
 * Scored memory result
 * @typedef {Object} ScoredMemory
 * @property {Memory} memory
 * @property {number} score - Final computed score
 * @property {Object} breakdown - Score components (base, bm25, vector)
 */

/**
 * BM25 calculation context
 * @typedef {Object} BM25Context
 * @property {Map<string, number>} idfMap - Term to IDF score
 * @property {number} avgDL - Average document length
 */

/**
 * Forgetfulness curve constants
 * @typedef {Object} ForgetfulnessConstants
 * @property {number} BASE_LAMBDA - Base decay rate
 * @property {number} IMPORTANCE_5_FLOOR - Floor for max importance memories
 * @property {number} reflectionDecayThreshold - Message distance for reflection penalty
 */

/**
 * Scoring configuration
 * @typedef {Object} ScoringConfig
 * @property {number} vectorSimilarityThreshold - Cosine similarity cutoff
 * @property {number} alpha - Blend factor between BM25 and vector
 * @property {number} combinedBoostWeight - Weight for combined score
 * @property {string} embeddingSource - 'local' | 'ollama' | 'st_vector'
 */

/**
 * Retrieval context for scoring
 * @typedef {Object} RetrievalContext
 * @property {string} recentContext - Recent chat messages
 * @property {string} userMessages - Last 3 user messages for embedding
 * @property {string[]} activeCharacters - Characters in scene
 * @property {number} chatLength - Current message count
 * @property {ScoringConfig} scoringConfig
 * @property {Object} queryConfig - Query construction settings
 */

/**
 * ST Vector sync changes
 * @typedef {Object} StSyncChanges
 * @property {Array<{id: string, embedding: number[], metadata: Object}>} toSync - Items to upsert
 * @property {string[]} toDelete - Item IDs to remove
 */

/**
 * Extraction phase options
 * @typedef {Object} ExtractionOptions
 * @property {boolean} [isBackfill] - Skip Phase 2 enrichment
 * @property {boolean} [isEmergencyCut] - Enable cancellation
 * @property {boolean} [silent] - Suppress toast notifications
 * @property {AbortSignal} [abortSignal] - Cancellation signal
 * @property {Function} [progressCallback] - Progress update handler
 * @property {Function} [onPhase2Start] - Phase 2 start callback
 */

/**
 * Queue item for ladder queue
 * @typedef {Object} QueueItem
 * @property {string} id
 * @property {number} priority
 * @property {number} addedAt
 */
```

### Target Files

#### 1. `src/retrieval/math.js`
Add at top:
```javascript
// @ts-check

/** @typedef {import('../types.js').Memory} Memory */
/** @typedef {import('../types.js').ScoredMemory} ScoredMemory */
/** @typedef {import('../types.js').BM25Context} BM25Context */
```

Type these functions:
- `tokenize(text)` → `string[]`
- `calculateIDF(memories, tokenizedMemories)` → `{idfMap: Map, avgDL: number}`
- `cosineSimilarity(a, b)` → `number`
- `scoreMemories(...)` with full params

#### 2. `src/retrieval/scoring.js`
Add at top:
```javascript
// @ts-check

/** @typedef {import('../types.js').Memory} Memory */
/** @typedef {import('../types.js').ScoredMemory} ScoredMemory */
/** @typedef {import('../types.js').RetrievalContext} RetrievalContext */
/** @typedef {import('../types.js').ScoringConfig} ScoringConfig */
```

Type these functions:
- `scoreMemoriesDirect()` params
- `selectRelevantMemoriesSimple()` params
- `selectRelevantMemoriesWithST()` params
- Internal helpers returning `ScoredMemory[]`

#### 3. `src/extraction/extract.js`
Add at top:
```javascript
// @ts-check

/** @typedef {import('../types.js').Memory} Memory */
/** @typedef {import('../types.js').Entity} Entity */
/** @typedef {import('../types.js').Relationship} Relationship */
/** @typedef {import('../types.js').ExtractedEvent} ExtractedEvent */
/** @typedef {import('../types.js').GraphExtraction} GraphExtraction */
/** @typedef {import('../types.js').StSyncChanges} StSyncChanges */
/** @typedef {import('../types.js').ExtractionOptions} ExtractionOptions */
```

Type these functions:
- `extractMemories()` params and return
- `fetchEventsFromLLM()` → `Promise<{events: ExtractedEvent[]}>`
- `fetchGraphFromLLM()` → `Promise<GraphExtraction>`
- `processGraphUpdates()` → `StSyncChanges`
- Stage 1-6 internal functions

## Implementation Steps

1. **Create `src/types.js`** with all typedefs above
2. **Add `@ts-check` to `math.js`**
   - Add import typedefs
   - Add JSDoc to all exported functions
   - Run `npm run lint` to verify no syntax errors
   - Open in VS Code, verify no red squiggles on function calls
3. **Add `@ts-check` to `scoring.js`**
   - Import types from `types.js`
   - Type function params that receive `Memory[]` and `ScoringConfig`
4. **Add `@ts-check` to `extract.js`**
   - Import types
   - Type the 6 stage functions and orchestrator
5. **Verify**
   - Check VS Code Problems panel — should show 0 errors
   - Run `npm run test:math` to ensure no runtime regressions
   - Run `npm run test:extract` to verify extraction tests pass

## Success Criteria

- [ ] `// @ts-check` present in all 3 target files
- [ ] VS Code shows IntelliSense for `Memory`, `Entity`, etc.
- [ ] Property access typos (e.g., `memry.summary`) show red underline
- [ ] All existing tests pass (`npm run test`)
- [ ] No new runtime dependencies added

## Future Expansion

After these 3 files are stable:
- Add `@ts-check` to `src/graph/graph.js` (import Entity types)
- Add `@ts-check` to `src/store/chat-data.js` (repository pattern)
- Add `@ts-check` to `src/prompts/**/*.js` (builder return types)
- Consider `src/types.js` re-export in `index.js` for consumers

## Notes

- JSDoc imports are TypeScript syntax understood by VS Code's TS server
- Runtime JavaScript ignores these comments entirely
- No `tsconfig.json` needed — VS Code infers check mode from `// @ts-check`
- If a file needs looser checking, use `// @ts-nocheck` at top
- For intentional type overrides, use `// @ts-expect-error` with explanation
