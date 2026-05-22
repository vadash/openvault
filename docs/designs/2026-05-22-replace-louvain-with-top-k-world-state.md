# Replace Louvain Communities with Top-K World State

**Date:** 2026-05-22
**Status:** Approved

## Problem

Standard 1-on-1 roleplays form a star topology (user + character at the center, connected to everything). Louvain community detection needs `MAIN_CHARACTER_ATTENUATION` (95% edge weight reduction), re-anchoring heuristics, and fallback paths just to produce meaningful partitions. The Graphology + Louvain stack adds 3 CDN dependencies and ~400 lines of graph-math code for a result that's arguably no better than directly summarizing the most-active entities.

## Decision

Replace the Louvain community detection pipeline with a top-K entity selection approach:

1. **Global world state:** Sort entities by mention count, take top 20, pass to LLM for a single world-state summary.
2. **Local context retrieval:** Vector-search entity embeddings directly (entities already have embeddings) instead of searching community summary embeddings.

## What Gets Removed

### Files
- `src/graph/communities.js` — replaced by `src/graph/world-state.js`
- `tests/graph/communities.test.js` — replaced by `tests/graph/world-state.test.js`

### CDN Dependencies
- `graphology`
- `graphology-communities-louvain`
- `graphology-operators`

### Constants
- `MAIN_CHARACTER_ATTENUATION`
- `GLOBAL_SYNTHESIS_CHUNK_SIZE`
- `COMMUNITY_STALENESS_THRESHOLD`

### State Fields
- `communities` — deleted entirely
- `global_world_state.community_count` — removed

### Config
- `vitest.config.js` — remove Graphology aliases

## What Gets Added/Changed

### New File: `src/graph/world-state.js`

**`selectTopEntities(graphData, count)`**
- Sort `graphData.nodes` by `mentions` descending
- Take top `count` (default 20, configurable via `WORLD_STATE_ENTITY_COUNT`)
- Collect edges where both source and target are in the selected set
- Returns `{ entities: [{key, name, type, description, mentions}], edges: [{sourceName, targetName, description, weight}] }`

**`generateWorldState(entities, edges, preamble, outputLanguage, prefill)`**
- Formats entity list + edges into a single prompt (new dedicated prompt or adapted from existing)
- Single LLM call (no map-reduce, no chunking)
- Parses structured response: `{ title, summary, findings }`
- Returns `{ summary: string, last_updated: number }`

### Rewritten: `src/retrieval/world-context.js`

**Macro intent (unchanged):**
- Returns `global_world_state.summary` when macro keywords detected

**Local intent (rewritten):**
- Score all entities by `cosineSimilarity(queryEmbedding, entityEmbedding)`
- Sort descending, select top-K within `tokenBudget`
- For each selected entity, include description + top 3 edges (by weight) where the other endpoint exists
- Format: `## Entity Name (TYPE)\nDescription\nRelationships: ...`

### Changed: `src/extraction/extract.js`

`synthesizeCommunities()` → `synthesizeWorldState()`:
1. Run edge consolidation if `_edgesNeedingConsolidation` has entries (preserved, decoupled from community detection)
2. Call `selectTopEntities()` to pick top entities
3. Call `generateWorldState()` — single LLM call
4. Store result in `data.global_world_state`

### Changed: `src/constants.js`

- Remove: `MAIN_CHARACTER_ATTENUATION`, `GLOBAL_SYNTHESIS_CHUNK_SIZE`, `COMMUNITY_STALENESS_THRESHOLD`
- Add: `WORLD_STATE_ENTITY_COUNT: 20`
- Rename: `communityDetectionInterval` → `worldStateInterval`

### Changed: `src/utils/cdn.js`

- Remove graphology packages from `CDN_VERSIONS`

### Changed: `package.json`

- Remove graphology packages from devDependencies

### Migration (new schema version)

- Delete `data.communities`
- Remove `community_count` from `data.global_world_state`
- Rename `communityDetectionInterval` → `worldStateInterval` in settings

### UI Changes

- Settings label: "Community Detection Interval" → "World State Interval"
- DOM IDs and bindings updated

## What Stays the Same

- Edge consolidation (`consolidateEdges` in `graph.js`) — decoupled from community detection, triggered on the same interval
- Entity/edge storage structure in `graph.js`
- Semantic merge logic
- Graph embeddings (used for local retrieval directly)
- The trigger interval mechanism (every N messages)
- Macro intent detection keywords

## Testing Strategy

- `tests/graph/world-state.test.js`: `selectTopEntities` sorting, count limit, edge filtering; `generateWorldState` prompt building, LLM call, response parsing
- `tests/retrieval/world-context.test.js`: Entity-based vector retrieval, token budget enforcement, macro intent routing (mostly unchanged)
- Update `tests/extraction/extract.test.js`: Mock new `synthesizeWorldState` instead of `synthesizeCommunities`
- Migration test: Verify community data cleaned up, settings renamed
