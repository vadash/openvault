# Memory Retrieval & Scoring Subsystem

## WHAT
Selects optimal memories (events + reflections) and community summaries, then formats them for prompt injection via ST named slots (`openvault_memory`, `openvault_world`).

## RETRIEVAL PIPELINE (`retrieve.js`)
1. **Candidate Pool**: Hidden memories (visible ones are already in ST context) + Reflections (no message IDs).
2. **Hidden Memories for IDF**: `allAvailableMemories` in context includes all memories. Non-candidate memories are extracted and passed to `scoreMemories()` as `hiddenMemories` for expanded IDF corpus.
3. **POV Filter**: Strict filter. Characters only recall what they witnessed or are told (`known_events`).
4. **Budgeting**: **Pre-Allocated Quotas with Score Fill**. `selectMemoriesWithSoftBalance()` reserves `minRepresentation` (20%) per temporal bucket (old/mid/recent), filling each quota with highest-scoring memories from that bucket. Remaining budget (40%) is filled by highest score regardless of bucket. Guarantees minimum temporal representation without starvation.
5. **Formatting** (`formatting.js`): Grouped into temporal buckets: *The Story So Far*, *Leading Up To This Moment*, *Current Scene*. **No hard quotas** — scoring handles balance.
   - **Temporal Prefix**: Memories with a `temporal_anchor` field display as `[★★★] [Friday, June 14, 3:40 PM] Summary text`. When absent, no bracket is added. Placed before the `[Known]` prefix when both present.
   - **Subconscious Drives**: Reflections (`type: 'reflection'`) separated into `<subconscious_drives>` XML block. Events stay in `<scene_memory>`.
   - CRITICAL RULE text prevents therapist-speak — reflections are hidden psychological truths, never spoken aloud.

## SCORING MATH (Alpha-Blend in `math.js`)
**Formula**: `Total = Base + (Alpha * VectorBonus) + ((1 - Alpha) * BM25Bonus)`

### Two-Pass Retrieval Optimization
To keep retrieval fast with large memory corpora (2000+ memories), scoring uses a two-pass approach:
1. **Fast Pass**: Calculate `Base + BM25` for ALL memories (no embeddings). This is O(N) with cheap arithmetic.
2. **Cutoff**: Take top `VECTOR_PASS_LIMIT` (200) candidates from fast pass.
3. **Slow Pass**: Calculate expensive `cosineSimilarity` (typed-array dot product) ONLY on the 200 candidates.

**Performance**: With 2000 memories, vector calculations drop from 2000 to 200 (10x reduction). Critical path stays under 100ms.

**ST Vector Storage Branch** (when `embeddingSource: 'st_vector'`):
1. **Over-fetch**: Query ST Vector Storage with `topK = limit * OVER_FETCH_MULTIPLIER` (3x) for reranking headroom.
2. **Proxy Scores**: Assign `_proxyVectorScore` based on rank position (1.0 for rank 0, linear decay to 0.5 for last).
3. **Alpha-Blend**: Feed proxy scores into existing scoring pipeline (forgetfulness + BM25). No local cosine calculation needed.

- **Forgetfulness Curve (Base)**: Exponential decay by narrative distance.
  - Higher importance = slower decay. Importance 5 has a soft floor of `1.0`.
  - *Reflection Decay*: Level-aware decay. Reflections older than 750 messages suffer linear penalty (floor 0.25x). **Level Divisor**: Each level above 1 decays 2x slower (`reflectionLevelMultiplier=2.0`). Level 2 reflections at 1000 msgs retain ~91% vs ~83% for level 1.
  - *Transient Decay*: Memories with `is_transient: true` have lambda multiplied by `transientDecayMultiplier` (default 5.0, configurable in settings). Short-term plans and momentary states decay ~5x faster than permanent facts. Config passed via `scoringConfig.transientDecayMultiplier`.
- **BM25 Keyword Matching**:
  - *Token Caching*: Pre-computed `m.tokens` (stemmed) to save CPU.
  - *Graph-Anchored*: Extracts query entities directly from Graph Nodes (no regex guessing).
  - *IDF-Aware*: Query tokens weighted by Inverse Document Frequency.
  - *Expanded Corpus*: IDF calculated from **candidates + hidden memories** (not just candidates). Prevents common terms from getting artificially high IDF scores.
  - *Dynamic Stopwords*: Main character names are stripped from BM25 queries since they have near-zero IDF and waste scoring weight.
  - *Four-Token-Tier System*:
    - **Layer 0 (Exact Phrases)**: Multi-word entities (contain space) — added ONCE, boosted at scoring time via `hasExactPhrase()`. Configurable `exactPhraseBoostWeight=10.0`.
    - **Layer 1 (Entities)**: Single-word named entities from graph — stemmed, repeated at `entityBoostWeight` (5x).
    - **Layer 2 (Corpus-Grounded)**: User-message tokens filtered through **corpus vocabulary** (`buildCorpusVocab`). Only stems that exist in memories/graph are used. Gets 60% boost (3x).
    - **Layer 3 (Non-Grounded)**: User-message tokens NOT in corpus vocabulary. Gets 40% boost (2x). Preserves scene context and dialogue tokens.
  - *Event Gate*: BM25 skipped entirely when no events in candidate pool (returns empty token array).
- **Exact Phrase Matching**: `hasExactPhrase(phrase, memory)` checks if memory contains multi-word phrase. Case-insensitive, normalizes whitespace, strips punctuation. Used by Layer 0 scoring.
- **Vector Similarity**: Cosine similarity against last 3 user messages + top entities.

## WORLD CONTEXT (`world-context.js`)
- **Intent Routing**: Macro queries (summarize, recap, вкратце, etc.) use pre-computed global state. Local queries use vector search.
- `detectMacroIntent()`: Multilingual regex matches EN/RU keywords (summarize, recap, story so far, что было, расскажи, etc.).
- Global state: Map-reduce synthesis over all communities, stored in `chatMetadata.openvault.global_world_state`.
- Local retrieval: **Pure Vector Similarity** (bypasses BM25 entirely).
- Injects via `<world_context>` XML tag high up in the prompt (`openvault_world` slot).

## GOTCHAS & RULES
- **Pure Math**: `math.js` contains ZERO DOM/deps imports. Fully worker-safe.
- **Bucket Limits**: The *Old* bucket ("The Story So Far") is hard-capped at 50% of the memory budget to prevent ancient history from drowning out recent context.
- **Proxy Scores**: `rankToProxyScore(rank, totalResults)` converts ST rank to cosine similarity proxy (range 0.5-1.0).
- **ST Collection ID**: Format `openvault-{chatId}-{embeddingSource}` — prevents cross-chat data leakage.
- **Function Signatures**:
  - `buildCorpusVocab(memories, hiddenMemories, graphNodes, graphEdges)` — Returns `Set<string>` of all stems in corpus.
  - `buildBM25Tokens(userMessage, extractedEntities, corpusVocab = null)` — Third param optional. When provided, implements three-tier system (5x/3x/2x). Null → backward compat (all tokens at 1x).
  - `RetrievalContext` includes `graphEdges` for edge description tokenization.