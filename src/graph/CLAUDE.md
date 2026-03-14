# Graph & GraphRAG Subsystem

## WHAT
Flat-JSON entity and relationship storage with rigorous semantic deduplication, edge consolidation, and Louvain-based community detection.

## STORAGE STRUCTURE (`graph.js`)
- **Keys**: Normalized (`normalizeKey()`) — lowercased, possessives stripped ("Vova's" -> "vova"), whitespace collapsed.
- **Nodes**: `{ [key]: { name, type, description, mentions, embedding, aliases? } }`. Descriptions append with `|` (FIFO capped).
- **Edges**: `{ "source__target": { source, target, description, weight, _descriptionTokens } }`. Token count tracked for consolidation triggers.

## EDGE CONSOLIDATION
- **Token Tracking**: Each edge stores `_descriptionTokens` count (updated on every `upsertRelationship` call).
- **Trigger**: When `_descriptionTokens > CONSOLIDATION.TOKEN_THRESHOLD` (500), edge marked for consolidation via `_edgesNeedingConsolidation` queue.
- **Batch Processing**: During community detection, `consolidateEdges()` processes up to `MAX_CONSOLIDATION_BATCH` (10) edges per run.
- **LLM Consolidation**: Uses `LLM_CONFIGS.edge_consolidation` and `buildEdgeConsolidationPrompt()` (standard `buildMessages()` pattern with preamble + prefill). Bloated pipe-separated descriptions synthesized into single coherent summary (<100 tokens), re-embedded for RAG accuracy.

## SEMANTIC MERGE LOGIC
Prevents duplicate nodes (e.g., "The King" vs "King Aldric").
1. **Fast Path**: Exact key match -> basic upsert.
2. **Slow Path**: Embeds `Type: Name - Description`. If Cosine Sim >= `0.94`, proceeds to Guard.
3. **Token Overlap Guard**: Extracts tokens, strips base EN+RU stopwords (via `stopword` lib). Requires >= 50% overlap OR direct substring match.
4. **Aliases**: If merged, the absorbed name is pushed to the surviving node's `aliases` array for future retrieval matching.
5. **Redirects**: Transient `_mergeRedirects` map ensures edges pointing to the old node route to the merged one.

## GRAPHRAG COMMUNITIES (`communities.js`)
- **Trigger**: Every 50 messages during extraction.
- **Algorithm**: `graphology-communities-louvain` on an undirected graph.
- **Edge Consolidation**: Runs before summarization (`consolidateEdges()`). Processes bloated edges flagged in `_edgesNeedingConsolidation` queue.
- **Hairball Pruning**: Edges involving main characters (User/Char + their aliases) are temporarily removed. Prevents the "protagonist hairball" where all entities group into one giant cluster. Nodes re-assigned to strongest neighbor's community after.
- **Summarization**: LLM generates Title, Summary, and Findings. Injected into ST context.
- **Global World State**: `generateGlobalWorldState()` synthesizes all communities into single narrative (~300 tokens). Stored in `chatMetadata.openvault.global_world_state` as `{ summary, last_updated, community_count }`. Used for macro-intent queries.

## GOTCHAS & RULES
- **Embedding Storage**: Embeddings are stored as Base64-encoded `Float32Array` strings (`embedding_b64`) via the codec in `src/utils/embedding-codec.js`. Legacy `number[]` format (`embedding`) is read transparently but never written.
- **Orphaned Edges**: `upsertRelationship` quietly skips if source/target nodes don't exist.
- **CONSOLIDATION Constants**: `TOKEN_THRESHOLD: 500`, `MAX_CONSOLIDATION_BATCH: 10` defined in `src/constants.js`.
- **ESM Libraries**: Relies on `https://esm.sh/graphology`. Mapped in `vitest.config.js`.