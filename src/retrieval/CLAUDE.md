# Memory Retrieval & Scoring Subsystem

## WHAT
Selects optimal memories (events + reflections) and community summaries, then formats them for prompt injection via ST named slots (`openvault_memory`, `openvault_world`).

## RETRIEVAL PIPELINE (`retrieve.js`)
1. **Candidate Pool**: Hidden memories (visible ones are already in ST context) + Reflections (no message IDs).
2. **Hidden Memories for IDF**: `allAvailableMemories` in context includes all memories. Non-candidate memories are extracted and passed to `scoreMemories()` as `hiddenMemories` for expanded IDF corpus.
3. **POV Filter**: Strict filter. Characters only recall what they witnessed or are told (`known_events`).
4. **Budgeting**: Top-scored results sliced to `retrievalFinalTokens` limit.
5. **Formatting**: Grouped into temporal buckets: *The Story So Far*, *Leading Up To This Moment*, *Current Scene*.

## SCORING MATH (Alpha-Blend in `math.js`)
**Formula**: `Total = Base + (Alpha * VectorBonus) + ((1 - Alpha) * BM25Bonus)`

- **Forgetfulness Curve (Base)**: Exponential decay by narrative distance.
  - Higher importance = slower decay. Importance 5 has a soft floor of `1.0`.
  - *Reflection Decay*: Reflections older than 750 messages suffer linear penalty (floor 0.25x) to prevent stale insights.
- **BM25 Keyword Matching**:
  - *Token Caching*: Pre-computed `m.tokens` (stemmed) to save CPU.
  - *Graph-Anchored*: Extracts query entities directly from Graph Nodes (no regex guessing).
  - *IDF-Aware*: Query tokens weighted by Inverse Document Frequency.
  - *Expanded Corpus*: IDF calculated from **candidates + hidden memories** (not just candidates). Prevents common terms from getting artificially high IDF scores.
  - *Dynamic Stopwords*: Main character names are stripped from BM25 queries since they have near-zero IDF and waste scoring weight.
  - *Corpus-Grounded Tokens* (Layer 2): User-message tokens filtered through **corpus vocabulary** (`buildCorpusVocab`). Only stems that exist in memories/graph are used. Zero-impact noise tokens excluded.
  - *Half-Boost*: Grounded tokens get `ceil(entityBoostWeight / 2)` boost. Entities get full boost.
  - *Event Gate*: BM25 skipped entirely when no events in candidate pool (returns empty token array).
- **Vector Similarity**: Cosine similarity against last 3 user messages + top entities.

## WORLD CONTEXT (`world-context.js`)
- Retrieves GraphRAG community summaries.
- Uses **Pure Vector Similarity** (bypasses BM25 entirely).
- Injects via `<world_context>` XML tag high up in the prompt (`openvault_world` slot).

## GOTCHAS & RULES
- **Pure Math**: `math.js` contains ZERO DOM/deps imports. Fully worker-safe.
- **Bucket Limits**: The *Old* bucket ("The Story So Far") is hard-capped at 50% of the memory budget to prevent ancient history from drowning out recent context.
- **Function Signatures**:
  - `buildCorpusVocab(memories, hiddenMemories, graphNodes, graphEdges)` — Returns `Set<string>` of all stems in corpus.
  - `buildBM25Tokens(userMessage, extractedEntities, corpusVocab = null)` — Third param optional. Null → backward compat (all tokens).
  - `RetrievalContext` includes `graphEdges` for edge description tokenization.