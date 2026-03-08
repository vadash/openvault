# Graph & GraphRAG Subsystem

## WHAT
Flat-JSON entity and relationship storage with rigorous semantic deduplication and Louvain-based community detection.

## STORAGE STRUCTURE (`graph.js`)
- **Keys**: Normalized (`normalizeKey()`) — lowercased, possessives stripped ("Vova's" -> "vova"), whitespace collapsed.
- **Nodes**: `{ [key]: { name, type, description, mentions, embedding, aliases? } }`. Descriptions append with `|` (FIFO capped).
- **Edges**: `{ "source__target": { source, target, description, weight } }`.

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
- **Hairball Pruning**: Edges involving main characters (User/Char + their aliases) are temporarily removed. Prevents the "protagonist hairball" where all entities group into one giant cluster. Nodes re-assigned to strongest neighbor's community after.
- **Summarization**: LLM generates Title, Summary, and Findings. Injected into ST context.

## GOTCHAS & RULES
- **Embedding Rounding**: Embeddings are rounded to 4 decimal places via `maybeRoundEmbedding()` to reduce `chatMetadata` JSON bloat by ~60%.
- **Orphaned Edges**: `upsertRelationship` quietly skips if source/target nodes don't exist.
- **ESM Libraries**: Relies on `https://esm.sh/graphology`. Mapped in `vitest.config.js`.