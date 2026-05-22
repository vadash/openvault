# Graph & GraphRAG Subsystem

Flat-JSON entity/relationship storage with semantic dedup, edge consolidation, and top-K entity selection for world-state summarization.
For merge algorithm details (4-guard thresholds, cross-script rules) see `include/DATA_SCHEMA.md` Section 4.

## STORAGE STRUCTURE (`graph.js`)
- **Keys**: Normalized (`normalizeKey()`) — lowercased, possessives stripped ("Vova's" -> "vova"), whitespace collapsed.
- **Nodes**: `{ [key]: { name, type, description, mentions, aliases?, embedding_b64 } }`. Descriptions append with `|` (FIFO capped).
- **Edges**: `{ "source__target": { source, target, description, weight, _descriptionTokens } }`. Token count tracked for consolidation triggers.
- **Edges have embeddings.** Edges store `embedding_b64` after consolidation. Always iterate `graph.edges` in any embedding-related loop (migration, invalidation, sync).

## SEMANTIC MERGE (`shouldMergeEntities()`)
Extraction uses delta approach — focuses on NEW entities or CHANGES, not re-describing static relationships. Schema limits to 5 entities per batch.
- **Type-Aware Routing**: PERSON merges on high cosine alone. Other types ALWAYS require token overlap to prevent false merges.
- **Token Overlap Guard**: Strips EN+RU stopwords (via `stopword` lib). Short keys (<=4 chars) use lower thresholds.
- **Aliases**: Absorbed name pushed to surviving node's `aliases` array.
- **Redirects**: Transient `_mergeRedirects` map routes edges from old node key to merged key.

## EDGE CONSOLIDATION
- **Trigger**: `_descriptionTokens > 150` → queued in `_edgesNeedingConsolidation`.
- **Jaccard Guard (Append-time)**: Before `old | new` append, if Jaccard similarity >= 0.6 the new description is dropped (weight still increments). Uses `tokenize` stemmer from `retrieval/math.js`.
- **Batch Processing**: `consolidateEdges()` processes up to 10 edges per community detection run. LLM compresses pipe-separated descriptions into single summary (<100 tokens), re-embedded.

## TOP-K ENTITIES & WORLD STATE
- **Trigger**: Every 50 messages during extraction via `synthesizeWorldState()`.
- **Entity Selection**: Selects top-K entities by weighted score (mentions × type-weight) with main-character attenuation.
- **Global World State**: Single LLM call synthesizes top entities and their relationships into a ~300 token narrative. Stored in `global_world_state.summary`.

## GOTCHAS
- **Embedding codec**: Base64 `Float32Array` via `src/utils/embedding-codec.js`. Legacy `number[]` reads transparently but never written.
- **Preference Capture**: Character preferences stored as CONCEPT nodes with relationship edges (e.g., `Character -> CONCEPT: "Strongly dislikes"`). Includes dietary/lifestyle (e.g., "Peanut Allergy").
- **Orphaned Edges**: `upsertRelationship` quietly skips if source/target nodes don't exist.
- **Constants**: `TOKEN_THRESHOLD: 150`, `MAX_CONSOLIDATION_BATCH: 10` in `src/constants.js`.
- **Guard `_mergeRedirects` before access.** Older data may lack this field. Use `if (!graph._mergeRedirects) graph._mergeRedirects = {};`
- **Rewrite edges on rename.** Edge keys are `sourceKey__targetKey`. On node rename, iterate all edges, rebuild keys, delete old, write new.
- **Set merge redirect on rename.** `graph._mergeRedirects[oldKey] = newKey`. Also update any existing redirects pointing to `oldKey`. `_resolveKey()` follows redirect chains up to `MAX_REDIRECT_DEPTH` (10) with circular-reference guard.
