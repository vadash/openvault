# Agentic Reflection Engine

## WHAT
Synthesizes raw event memories into high-level psychological insights, adapting concepts from the Generative Agents (Smallville) paper.

## THE PIPELINE (`reflect.js`)
1. **Accumulate**: Each extracted event adds its `importance` to the involved characters' `importance_sum`.
2. **Trigger**: When `importance_sum >= 40`, reflection begins.
3. **Pre-flight Gate**: Aborts if top recent events are >85% similar to existing reflections (prevents wasting tokens on repetitive insights).
4. **Candidate Set**: Recent events only (events are the sole candidate type since reflections are capped at Level 1).
5. **Generate**: Single unified LLM call generates 1-3 question+insight pairs with evidence citations.
6. **3-Tier Dedup & Embed**: Compares new reflection embeddings vs existing ones.
7. **Reset**: Clears accumulator to 0 **before** the LLM call (restored on failure to prevent data loss while avoiding infinite retry loops).



## PERFORMANCE
- **Unified Call**: Replaced old 4-call pipeline (questions + 3 parallel insights) with single unified call.
- **Threshold**: `llm_reflection` perf metric set to 20000ms (down from 45000ms).

## REFLECTION SCHEMA
- `type: 'reflection'` (distinguishes from events).
- `source_ids`: Array of evidence memory IDs (event IDs only — reflections never cite other reflections).
- `witnesses`: Only the reflecting character (internal thought).
- `importance`: Fixed default of 4.
- `level`: Always 1 (multi-tier synthesis removed — reflections only cite raw events).
- `parent_ids`: Always empty array (no parent reflection references).

## 3-TIER DEDUP LIFECYCLE
Compares new reflection embeddings vs existing ones for that character:
- **>= 90%**: **Reject**. Concept already exists.
- **80% - 89%**: **Replace**. Theme matches but evidence evolved. Old reflection marked `archived: true` (ignored by retrieval), new one added.
- **< 80%**: **Add**. Genuinely new insight.

## GOTCHAS & RULES
- **Reflection Decay**: Reflections older than the threshold get a linear penalty (down to 0.25x).
- **POV Strictness**: Uses `filterMemoriesByPOV()` before unified reflection call. A character can only reflect on things they know.
- **Level 1 Cap**: Reflections always cite raw events only. Multi-tier synthesis (Level 2+) was removed to prevent abstraction degradation.