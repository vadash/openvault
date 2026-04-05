# Graph & GraphRAG Subsystem

## WHAT
Flat-JSON entity and relationship storage with rigorous semantic deduplication, edge consolidation, and Louvain-based community detection.

## STORAGE STRUCTURE (`graph.js`)
- **Keys**: Normalized (`normalizeKey()`) — lowercased, possessives stripped ("Vova's" -> "vova"), whitespace collapsed.
- **Nodes**: `{ [key]: { name, type, description, mentions, embedding, aliases? } }`. Descriptions append with `|` (FIFO capped).
- **Edges**: `{ "source__target": { source, target, description, weight, _descriptionTokens } }`. Token count tracked for consolidation triggers.

## EDGE CONSOLIDATION
- **Token Tracking**: Each edge stores `_descriptionTokens` count (updated on every `upsertRelationship` call).
- **Trigger**: When `_descriptionTokens > CONSOLIDATION.TOKEN_THRESHOLD` (`150`), edge marked for consolidation via `_edgesNeedingConsolidation` queue.
- **Jaccard Guard (Append-time)**: Before appending `old | new`, `upsertRelationship` computes Jaccard similarity between existing and new descriptions. If similarity >= `0.6`, the new description is dropped (considered duplicate), but weight still increments. Only sufficiently distinct descriptions (< 60% overlap) are appended.
- **Batch Processing**: During community detection, `consolidateEdges()` processes up to `MAX_CONSOLIDATION_BATCH` (10) edges per run.
- **LLM Consolidation**: Uses `LLM_CONFIGS.edge_consolidation` and `buildEdgeConsolidationPrompt()` (standard `buildMessages()` pattern with preamble + prefill). Bloated pipe-separated descriptions synthesized into single coherent summary (<100 tokens), re-embedded for RAG accuracy.

## SEMANTIC MERGE LOGIC
Prevents duplicate nodes (e.g., "The King" vs "King Aldric"). Uses `shouldMergeEntities()` DRY helper with type-aware logic. Extraction uses delta approach — focuses on NEW entities or CHANGES to existing ones, not re-describing static relationships. Schema limits to 5 entities/relationships per batch.

**Type-Aware Merging**: PERSON entities can merge on high cosine similarity alone (names are unique identifiers). All other types (OBJECT, CONCEPT, PLACE, ORGANIZATION) ALWAYS require token overlap confirmation to prevent false merges when embeddings are inflated by shared context.

**stChanges Return Pattern (PR2)**: `mergeOrInsertEntity()` returns `{ key, stChanges: { toSync: [], toDelete: [] } }`. New nodes push `{ hash, text, item }` to `toSync`. Semantic merge deletions push `{ hash }` to `toDelete`. Orchestrator applies bulk network I/O. `consolidateEdges()` returns `{ count, stChanges }`. Dead functions `consolidateGraph()` and `redirectEdges()` were deleted.
1. **Fast Path**: Exact key match -> basic upsert.
2. **Slow Path**: Embeds `Type: Name - Description`. Cosine computed first, then routed by type:
   - **PERSON**: High cosine (>= threshold) → merge directly. Grey zone → require token overlap.
   - **Other types**: Always require token overlap regardless of cosine.
   - **Below grey zone**: Skip (no merge).
3. **Token Overlap Guard**: Strips base EN+RU stopwords (via `stopword` lib). Requires >= 60% stem/token overlap OR direct substring match OR fuzzy LCS match (≥ 70% ratio AND ≥ 4 absolute chars; short keys ≤ 4 chars: ≥ 60% ratio AND ≥ 2 chars).
4. **Aliases**: If merged, the absorbed name is pushed to the surviving node's `aliases` array for future retrieval matching.
4b. **Cross-Script Merge** (PERSON only): Before creating a new node, `mergeOrInsertEntity` checks if the transliterated name matches any known main character (Levenshtein ≤ 2). Force-merges Cyrillic variants (Сузи→Suzy, Вова→Vova) into the English node. English name stays primary, Cyrillic added as alias.
4c. **Cross-Script Guard** (semantic merge loop): PERSON entities with keys in different scripts (Latin vs Cyrillic) are skipped in the semantic merge loop. Cross-script PERSON merges should ONLY happen via transliteration match, not semantic similarity. Prevents false merges when descriptions share context but names are unrelated.
5. **Redirects**: Transient `_mergeRedirects` map ensures edges pointing to the old node route to the merged one.

## GRAPHRAG COMMUNITIES (`communities.js`)
- **Trigger**: Every 50 messages during extraction.
- **Algorithm**: `graphology-communities-louvain` on an undirected graph.
- **Edge Consolidation**: Runs before summarization (`consolidateEdges()`). Processes bloated edges flagged in `_edgesNeedingConsolidation` queue.
- **Hairball Prevention**: Edges involving main characters (User/Char + their aliases) are attenuated by `MAIN_CHARACTER_ATTENUATION` (95% weight reduction) instead of dropped. Prevents the "protagonist hairball" without orphaning objects in hub-and-spoke topologies. Nodes re-anchored to strongest neighbor's community using original un-attenuated weights after Louvain. Fallback for tiny graphs (< 3 nodes) uses logarithmic weight scaling + resolution bump. `findCrossScriptCharacterKeys()` also expands the key set with Cyrillic PERSON nodes that transliterate close to main character names (Levenshtein ≤ 2).
- **Summarization**: LLM generates Title, Summary, and Findings. Injected into ST context.
- **Global World State**: `generateGlobalWorldState()` delegates to `synthesizeInChunks()` for map-reduce synthesis. <= `GLOBAL_SYNTHESIS_CHUNK_SIZE` (10) communities: single-pass. Larger sets: chunked into regional summaries, then reduced into final narrative (~300 tokens). Per-chunk try/catch for resiliency. Stored in `chatMetadata.openvault.global_world_state` as `{ summary, last_updated, community_count }`. Used for macro-intent queries.

## GOTCHAS & RULES
- **Embedding Storage**: Embeddings are stored as Base64-encoded `Float32Array` strings (`embedding_b64`) via the codec in `src/utils/embedding-codec.js`. Legacy `number[]` format (`embedding`) is read transparently but never written.
- **Preference Capture**: Durable character preferences (likes, dislikes, dietary restrictions) are stored as CONCEPT nodes with relationship edges (e.g., `Character -> CONCEPT: "Strongly dislikes"`). CONCEPT definition expanded beyond abilities/spells/diseases to include `dietary/lifestyle requirements` (e.g., "Peanut Allergy", "Veganism").
- **Orphaned Edges**: `upsertRelationship` quietly skips if source/target nodes don't exist.
- **CONSOLIDATION Constants**: `TOKEN_THRESHOLD: 150`, `MAX_CONSOLIDATION_BATCH: 10` defined in `src/constants.js`.
- **ESM Libraries**: Relies on `https://esm.sh/graphology`. Mapped in `vitest.config.js`.