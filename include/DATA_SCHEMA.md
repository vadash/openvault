# OpenVault Data Schema & Core Algorithms

Reference document for data structures and non-obvious algorithm logic.

## 1. DATA SCHEMA (`chatMetadata.openvault`)

```typescript
{
  embedding_model_id: string,  // tracks which model generated stored embeddings
  st_vector_source: string,    // ST Vector source used for last sync (e.g., 'openrouter', 'openai')
  st_vector_model: string,     // ST Vector model used for last sync (for mismatch detection)
  memories: [{ // Both events and reflections
    id: string, type: "event"|"reflection", summary: string, importance: 1-5,
    tokens: string[], message_ids?: number[], source_ids?: string[], // source_ids for reflections
    level?: number, parent_ids?: string[], // Reflection hierarchy: level=1 (from events), level=2+ (from reflections)
    temporal_anchor: string|null,  // Extracted timestamp (e.g., "Friday, June 14, 3:40 PM"), null when absent
    is_transient: boolean,          // true for short-term intentions that decay ~5x faster
    characters_involved: string[], embedding_b64: string, _st_synced?: boolean, archived: boolean, mentions?: number
  }],
  graph: {
    nodes: { [normKey]: { name, type, description, mentions, embedding_b64: string, _st_synced?: boolean, aliases? } },
    edges: { "src__tgt": { source, target, description, weight, _descriptionTokens: number } },
    _edgesNeedingConsolidation: string[]  // Edge keys pending consolidation
  },
  communities: { "C0": { title, summary, findings: string[], nodeKeys: string[], embedding_b64: string, _st_synced?: boolean } },
  global_world_state: { summary: string, last_updated: number, community_count: number },
  character_states: { "Name": { current_emotion, emotion_intensity, known_events: string[] } },
  reflection_state: { "Name": { importance_sum: number } },
  processed_message_ids: number[],
  idf_cache: { [token]: number },  // Pre-computed BM25 IDF values
  perf: { [metricId]: { ms: number, size: string | null, ts: number } }
}
```

**Repository Methods (PR6)**: Data mutations use explicit methods from `store/chat-data.js`:
- `addMemories(newMemories)` - Append to memories array
- `markMessagesProcessed(fingerprints)` - Record processed message IDs
- `incrementGraphMessageCount(count)` - Update graph message counter
- `updateMemory(id, updates)` - Update memory fields
- `deleteMemory(id)` - Remove memory by ID
- `deleteCurrentChatData()` - Purge all data for current chat

## 2. RETRIEVAL MATH (Alpha-Blend)

**Formula**: `Score = (Base + (Alpha * VectorBonus) + ((1 - Alpha) * BM25Bonus)) × FrequencyFactor`

### Two-Pass Scoring Optimization
Fast pass scores all memories with `Base + BM25` (cheap). Top `VECTOR_PASS_LIMIT` (200) candidates proceed to slow pass with cosine similarity. Reduces vector calculations 10x with 2000+ memories.

### Base Score (Forgetfulness)
`Importance * e^(-Lambda * Distance)`. Lambda dampened by `hitDamping = max(0.5, 1/(1 + retrieval_hits × 0.1))` — frequently retrieved memories decay up to 50% slower. Imp 5 has soft floor of 1.0. Reflections > 750 msgs decay linearly to 0.25x. **Level Divisor**: Higher-level reflections decay 2x slower per level (`reflectionLevelMultiplier`). **Transient Decay**: When `is_transient: true`, lambda is multiplied by `transientDecayMultiplier` (default 5.0). Makes short-term memories fade ~5x faster.

### Frequency Factor
`1 + ln(mentions) × 0.05`. Sublinear boost from event repetitions. 10 mentions ≈ +11.5%, 50 mentions ≈ +20%.

### BM25 (Keyword Matching)
IDF-aware using **expanded corpus** (candidates + hidden memories). Dynamic Character Stopwords (names filtered to prevent inflation).

**Four-Token-Tier System**:
- **Layer 0**: Multi-word entities (contain space) — added ONCE as exact phrase tokens. Boosted at scoring time via `hasExactPhrase()` (`exactPhraseBoostWeight` = 10x).
- **Layer 1**: Single-word named entities from graph — stemmed, repeated at 5x boost.
- **Layer 2**: User-message stems that exist in corpus vocab — 3x boost.
- **Layer 3**: User-message stems NOT in corpus vocab — 2x boost.
- **Event Gate**: BM25 skipped when no events in candidates (returns empty token array).

### IDF Caching
Pre-computed during Phase 1 commit (`updateIDFCache()` in `extract.js`). Stored in `chatMetadata.openvault.idf_cache`. Retrieval loads for O(1) lookup instead of O(N) recalculation.

## 3. ENTITY SEMANTIC MERGE

Prevents duplicates ("The King" vs "King Aldric"). Four-guard system:

**Guard 1 (Cosine)**: Embeddings (type + name + description) cosine similarity checked first via `shouldMergeEntities()`:
- **Above threshold** (>= `0.94`): merge directly (cosine alone sufficient)
- **Grey zone** (threshold - 0.10 to threshold): proceeds to token overlap guard
- **Below grey zone**: skip

**Guard 2 (Token Overlap)**: >= 50% overlap filtering base EN+RU stopwords. `tokensB` lazily constructed only in grey zone. Old names saved to `aliases`. Does NOT bridge script boundaries (Latin↔Cyrillic) — prompt rules enforce name preservation.

**Guard 3 (LCS)**: Longest Common Substring ratio >= 60% for keys longer than 2 chars.

**Guard 4 (Stems)**: `stemWord()`-based token overlap catches Russian morphological variants (e.g., "ошейник"/"ошейником").

**Cross-Script Merge (PERSON only)**: Before creating new node, `mergeOrInsertEntity` checks if transliterated name matches known main character (Levenshtein ≤ 2). Force-merges Cyrillic variants (Сузи→Suzy, Вова→Vova) into English node.

## 4. GRAPHRAG COMMUNITIES

**Edge Consolidation**: When `_descriptionTokens > 150`, edge marked for consolidation. Jaccard guard (>= 0.6 similarity) drops duplicate descriptions before they bloat.

**Louvain Detection**: `graphology-communities-louvain` on undirected graph. Edges involving main characters attenuated 95% (not dropped) to prevent hairball clusters. Nodes re-anchored to strongest neighbor's community after.

**Map-Reduce Synthesis**: `synthesizeInChunks()` handles global state. <= 10 communities: single-pass LLM. Larger: chunked into regional summaries, then reduced. Per-chunk try/catch for resiliency.

## 5. EMBEDDING MODEL MISMATCH PROTECTION

`embedding_model_id` at root tracks which model generated stored vectors. On `CHAT_CHANGED` and embedding source dropdown change:
1. `invalidateStaleEmbeddings()` compares stored tag to current `embeddingSource` setting
2. Mismatch triggers bulk wipe of all `embedding_b64` fields across memories, graph nodes, communities
3. Tag updated to new model
4. `backfillAllEmbeddings()` auto-triggers in background

Legacy chats without tag treated as mismatch on first load (one-time re-embed). Manual "Backfill Embeddings" button also triggers full re-embed.

## 6. MULTILINGUAL PROMPT ARCHITECTURE

**Output Language Setting**: User-configurable (`auto`/`ru`/`en`). `auto` preserves heuristic script detection. `ru`/`en` forces deterministic language instruction and filters examples to matching language only.

**Mirror Language Rule**: Auto-detect input language, mirror it in output string values. JSON keys remain English.

**User-Message Reinforcement**: `buildLanguageReminder()` detects non-Latin script, injects explicit "do NOT translate to English" reminder. Includes exception for character names (must stay in original script).

**Character Name Enforcement**: Prompt injects canonical names directly. Transliteration slips caught by Semantic Merge (cosine + token overlap, adds variant to `aliases`).

**Bilingual Examples**: Every prompt includes paired EN/RU few-shot examples using think-then-JSON pattern via `thinking` property (wrapped in `<tool_call>` tags by `format-examples.js`).

## 7. EVENT DEDUPLICATION

**Phase 1 (Cross-batch)**: Cosine similarity >= threshold AND Jaccard token overlap >= half the Jaccard threshold. Dual-gate prevents false positives.

**Phase 2 (Intra-batch)**: Jaccard token overlap >= threshold between events in same extraction batch.

Both phases increment `mentions` on surviving memory, enabling Frequency Factor boost.

## 8. SCORE-FIRST BUDGETING

`selectMemoriesWithSoftBalance()`:
- **Phase 1**: Reserve 20% per bucket (old/mid/recent), fill with highest-scoring memories from each bucket
- **Phase 2**: Pool remaining 40%, fill strictly by highest score regardless of bucket
- Guarantees minimum temporal representation without starvation