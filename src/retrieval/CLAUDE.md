# Retrieval, Scoring, and World Context

## TWO-PASS ALPHA-BLEND SCORING
- **Apply Alpha-Blend formula:** `Total = Base + (Alpha * VectorBonus) + ((1 - Alpha) * BM25Bonus) * FrequencyFactor`.
- **Run O(N) Fast Pass first.** Calculate `Base + BM25` for all memories.
- **Run O(1) Slow Pass second.** Execute heavy typed-array Cosine Similarity only on the top `VECTOR_PASS_LIMIT` (200) candidates.

## FORGETFULNESS & DECAY
- **Calculate narrative distance.** Resolve `message_fingerprints` via `chatFingerprintMap` to find current positions, then `chat.length - max(resolvedPosition)`. Falls back to `message_ids` for unmigrated v2 data.
- **Apply Transient Multiplier.** Multiply lambda by 5x (`transientDecayMultiplier`) for short-term intentions (`is_transient: true`).
- **Decay high-level reflections slower.** Divide decay penalty by `reflectionLevelMultiplier` (2.0) for level-2+ reflections past 750 messages.

## 4-TIER BM25 KEYWORD MATCHING
- **Expand the IDF corpus.** Calculate document frequencies using candidates *plus* all hidden memories. 
- **Strip main character stopwords.** Remove POV names dynamically to prevent them from diluting the IDF math.
- **Apply tiered boosts:**
  - **Layer 0:** Multi-word exact phrase matches (Flat 10x maxIDF boost).
  - **Layer 1:** Single-word graph entity stems (5x boost).
  - **Layer 2:** Corpus-grounded message stems (3x boost).
  - **Layer 3:** Non-grounded message stems (2x boost).

## WORLD CONTEXT & INTENT ROUTING
- **Route via multilingual intent.** Use `detectMacroIntent()` (matches "recap", "вкратце", etc.).
- **Macro queries:** Inject the pre-computed `global_world_state`.
- **Local queries:** Execute pure vector similarity search against specific community summaries.

## CONTEXT BUDGETING
- **Never spread large iterables into Math.max.** Use `for...of` loops with manual tracking instead of `Math.max(...array)` — spreads hit JS argument limits (~65K) with large IDF maps.
- **Use Score-First Soft Balancing.** Reserve `minRepresentation` (20%) of the token budget per chronological bucket (Old/Mid/Recent).
- **Fill the remainder by raw score.** Allocate the remaining 40% purely to the highest-scoring memories regardless of bucket.
