# Graph & GraphRAG Subsystem

> For the big picture of how this fits into the whole app, see `docs/ARCHITECTURE.md`.

## WHAT
Flat-JSON entity/relationship storage with semantic deduplication and Louvain community detection. Data lives in `chatMetadata.openvault.graph` and `.communities`.

## HOW: Storage (`graph.js`)
- **Structure**: `{ nodes: { key: { name, type, description, mentions, embedding } }, edges: { ... }, _mergeRedirects: {} }`
- **Keys**: Nodes keyed by `normalizeKey(name)` (lowercase, strips possessives, collapses whitespace). Edges: `${source}__${target}`.
- **Entity Upsert**: `upsertEntity` merges descriptions with ` | `, caps at 3 segments (FIFO), increments mentions.
- **Relationship Upsert**: `upsertRelationship` increments weight, merges descriptions, caps at 5 segments.
- **Semantic Merge**: `mergeOrInsertEntity` — fast path for exact key match, slow path uses embedding similarity (threshold 0.94) to dedupe same-type entities. Embeddings include `type`, `name`, AND `description` to prevent false merges (e.g., "Cotton rope" vs "White cotton panties").
  - **Token Overlap Guard**: Breaks keys into word tokens, strips RP stopwords (via `stopword` lib + custom dicts: "the", "red", "large", "burgundy", etc.), requires >=50% token overlap OR direct substring match.
  - **Why**: Prevents "Burgundy panties" from merging with "Burgundy candle" despite high cosine similarity from the shared adjective.
- **Key Resolution**: `_resolveKey()` consults `_mergeRedirects` map to handle entity merge redirects when creating edges.

## HOW: Consolidation (`consolidateGraph`)
- Retroactive one-time merge for existing graphs with accumulated duplicates.
- Embeds all nodes lacking embeddings, pairwise-compares within each type.
- Merges nodes above threshold, redirects edges via `redirectEdges()`, removes old nodes.

## HOW: Communities (`communities.js`)
- **Library**: `graphology` via esm.sh. Test alias required in vitest.config.js.
- **Detection**: Louvain algorithm on undirected graph. Skip if < 3 nodes.
- **Summarization**: LLM generates title/summary/findings per community. Only re-summarize if node membership changed.
- **Island Guard**: Skip communities with < 2 nodes.
- **Trigger**: Every 50 messages in extraction pipeline.

## GOTCHAS & RULES
- **Orphaned Edges**: If `source`/`target` not in nodes, `upsertRelationship` silently skips.
- **CDN Imports**: `https://esm.sh/graphology`, `graphology-communities-louvain`, `graphology-operators`.
- **State Init**: Use `initGraphState(data)` to ensure all fields exist (non-destructive).
