# Agentic Reflection Engine

## WHAT
Synthesizes raw event memories into high-level psychological insights, adapting concepts from the Generative Agents (Smallville) paper.

## THE PIPELINE (`reflect.js`)
1. **Accumulate**: Each extracted event adds its `importance` to the involved characters' `importance_sum`.
2. **Trigger**: When `importance_sum >= 40`, reflection begins.
3. **Pre-flight Gate**: Aborts if top recent events are >85% similar to existing reflections (prevents wasting tokens on repetitive insights).
4. **Candidate Set**: Recent events (top `REFLECTION_CANDIDATE_LIMIT` = 50) + **old reflections** (all levels). Enables synthesizing higher-level insights (level 2+).
5. **Generate**: Single unified LLM call (with configurable prefill from `resolveExtractionPrefill`) generates 1-3 question+insight pairs with evidence citations (`UNIFIED_REFLECTION_EXAMPLES` - 6 bilingual EN/RU).
6. **3-Tier Dedup & Embed**: (See below).
7. **Reset**: Clears accumulator to 0 **before** the LLM call (restored on failure to prevent data loss while avoiding infinite retry loops).



## PERFORMANCE
- **Unified Call**: Replaced old 4-call pipeline (questions + 3 parallel insights) with single unified call.
- **Threshold**: `llm_reflection` perf metric set to 20000ms (down from 45000ms).

## REFLECTION SCHEMA
- `type: 'reflection'` (distinguishes from events).
- `level`: Hierarchy depth (1 = from events, 2+ = from other reflections). Default: 1.
- `parent_ids`: Source reflection IDs for level 2+. Empty for level 1 (derived from events).
- `source_ids`: Array of evidence memory IDs (event IDs for level 1, reflection IDs for level 2+).
- `witnesses`: Only the reflecting character (internal thought).
- `importance`: Fixed default of 4.

## 3-TIER DEDUP LIFECYCLE
Compares new reflection embeddings vs existing ones for that character:
- **>= 90%**: **Reject**. Concept already exists.
- **80% - 89%**: **Replace**. Theme matches but evidence evolved. Old reflection marked `archived: true` (ignored by retrieval), new one added.
- **< 80%**: **Add**. Genuinely new insight.

## GOTCHAS & RULES
- **Recursive Linking**: Reflections can cite other older reflections as evidence in `source_ids`. This hierarchical abstraction is intentional. `parent_ids` tracks direct reflection ancestors.
- **Level-Aware Decay**: Higher-level reflections (level 2+) decay slower. `maxReflectionLevel=3`, `reflectionLevelMultiplier=2.0`. Each level doubles decay threshold divisor.
- **POV Strictness**: Uses `filterMemoriesByPOV()` before unified reflection call. A character can only reflect on things they know.