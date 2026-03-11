# Agentic Reflection Engine

## WHAT
Synthesizes raw event memories into high-level psychological insights, adapting concepts from the Generative Agents (Smallville) paper.

## THE PIPELINE (`reflect.js`)
1. **Accumulate**: Each extracted event adds its `importance` to the involved characters' `importance_sum`.
2. **Trigger**: When `importance_sum >= 40`, reflection begins.
3. **Pre-flight Gate**: Aborts if top recent events are >85% similar to existing reflections (prevents wasting tokens on repetitive insights).
4. **Generate**: Single unified LLM call generates 1-3 question+insight pairs with evidence citations (`UNIFIED_REFLECTION_EXAMPLES` - 6 bilingual EN/RU).
5. **3-Tier Dedup & Embed**: (See below).
6. **Reset**: Clears accumulator to 0.

## PERFORMANCE
- **Unified Call**: Replaced old 4-call pipeline (questions + 3 parallel insights) with single unified call.
- **Threshold**: `llm_reflection` perf metric set to 20000ms (down from 45000ms).

## REFLECTION SCHEMA
- `type: 'reflection'` (distinguishes from events).
- `source_ids`: Array of evidence memory IDs.
- `witnesses`: Only the reflecting character (internal thought).
- `importance`: Fixed default of 4.

## 3-TIER DEDUP LIFECYCLE
Compares new reflection embeddings vs existing ones for that character:
- **>= 90%**: **Reject**. Concept already exists.
- **80% - 89%**: **Replace**. Theme matches but evidence evolved. Old reflection marked `archived: true` (ignored by retrieval), new one added.
- **< 80%**: **Add**. Genuinely new insight.

## GOTCHAS & RULES
- **Recursive Linking**: Reflections can cite other older reflections as evidence in `source_ids`. This hierarchical abstraction is intentional.
- **POV Strictness**: Uses `filterMemoriesByPOV()` before unified reflection call. A character can only reflect on things they know.
- **Decay**: To prevent early insights from dominating late-game context, reflections > 750 messages old suffer linear decay down to 0.25x score in `math.js`.