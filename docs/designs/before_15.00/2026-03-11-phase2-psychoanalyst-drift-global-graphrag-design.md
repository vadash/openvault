# Design: Phase 2 - Psychoanalyst Persona Drift & Global GraphRAG

**Date:** 2026-03-11
**Status:** Proposed
**Related:** Phase 1 bug fixes (see separate design)

## 1. Problem Statement

### Issue A: Psychoanalyst Persona Drift
Reflections are currently written in a clinical, analytical tone (e.g., *"Кай's submission is an emotional regulation mechanism..."*). When these insights are injected into the `<scene_memory>` prompt slot, the RP model naturally mimics this tone, causing characters to speak like therapists rather than behaving naturally.

**Root Cause:** The `INSIGHT_EXAMPLES` in `src/prompts/examples/insights.js` demonstrate clinically written insights. These are injected into `<scene_memory>` via `formatContextForInjection()` in `src/retrieval/formatting.js`. Modern LLMs are highly obedient to in-context examples and will adopt the tone they see in the prompt.

### Issue B: Missing Global GraphRAG Intent
Microsoft's GraphRAG is designed for *Global Sensemaking* queries (e.g., *"How has the relationship between A and B evolved?"*) using a Map-Reduce approach over all community summaries. Currently, `retrieveWorldContext()` in `src/retrieval/world-context.js` only performs standard Cosine Similarity search, treating community summaries like standard vector chunks. This approach fails to capture the "big picture" for macro-level queries.

**Root Cause:** The retrieval pipeline lacks an intent classifier to distinguish between:
- **Local queries**: Specific RP actions (e.g., *"Let's go to the kitchen"*) → Vector search works well
- **Global queries**: Macro-level understanding (e.g., *"What's the story so far?"*) → Requires synthesized global context

---

## 2. Goals & Non-Goals

### Must Do (Goals)
1. **Eliminate therapist-speak** from RP character dialogue caused by clinical reflections
2. **Enable global sensemaking** queries without adding latency to the critical path (`GENERATION_AFTER_COMMANDS`)
3. **Preserve existing extraction pipeline** — no changes to reflection generation prompts
4. **Maintain backward compatibility** — existing chats should continue working
5. **Keep retrieval fast** — intent detection must be a simple heuristic, not an LLM call

### Won't Do (Non-Goals)
1. Rewrite reflection extraction prompts (A-1 approach rejected)
2. Implement real-time Map-Reduce during generation (too slow)
3. Use LLM-based intent classification (adds unacceptable latency)
4. Modify event or graph extraction logic
5. Change the community detection algorithm

---

## 3. Proposed Architecture

### Part 1: XML Isolation for Reflections (Issue A)

**High-Level Approach:** Separate reflections from events in the formatted output and wrap them in a dedicated `<subconscious_drives>` tag with explicit subtext instructions.

**Key Components:**

1. **Modify `src/retrieval/formatting.js`**:
   - Extract all `type === 'reflection'` memories *out* of temporal buckets (Old/Mid/Recent)
   - Render `<scene_memory>` with just the events
   - Append `<subconscious_drives>` block directly **after** `</scene_memory>`
   - Include critical rule: *"The following are hidden psychological truths. The character is NOT consciously aware of these dynamics and would NEVER speak them aloud. Use this ONLY as subtext to influence their subtle actions and emotional reactions."*

2. **Placement Rationale:**
   - LLMs suffer from recency bias
   - Placing the constraint immediately before generation ensures it's one of the last system directives read
   - Separating structural concerns (events vs. subconscious) creates cleaner prompting architecture

**Output Structure:**
```xml
<scene_memory>
(#1234 messages | ★=minor ★★★=notable ★★★★★=critical)

## The Story So Far
[events...]

## Leading Up To This Moment
[events...]

## Current Scene
Present: CharacterA, CharacterB
[events...]
</scene_memory>

<subconscious_drives>
[CRITICAL RULE: The following are hidden psychological truths. The character is NOT consciously aware of these dynamics and would NEVER speak them aloud. Use this ONLY as subtext to influence their subtle actions and emotional reactions.]
- CharacterA's submission serves as an emotional regulation mechanism...
- The power dynamic has shifted from reluctant to voluntary...
</subconscious_drives>
```

### Part 2: Global GraphRAG Intent (Issue B)

**High-Level Approach:** Pre-compute a global world state in the background and use keyword-based intent routing to inject it when appropriate.

**Key Components:**

1. **Global World State Generation** (`src/graph/communities.js`):
   - After `updateCommunitySummaries()` completes, check if any communities were updated
   - If **0 communities updated** → Skip global synthesis (world unchanged)
   - If **1+ communities updated** → Fire global synthesis LLM call
   - Save result to `chatMetadata.openvault.global_world_state`
   - Regeneration is cheap (~5 community summaries ≈ 1000 input tokens)

2. **Global Synthesis Prompt** (`src/prompts/index.js`):
   - Create `buildGlobalSynthesisPrompt(communities, preamble, outputLanguage)`
   - Feed it the `title` and `summary` of every community
   - Target output: 300-token overarching summary focusing on macro-relationships, tensions, and plot trajectory

3. **Intent Detection** (`src/retrieval/world-context.js`):
   - Implement `detectMacroIntent(userMessagesString)` using regex
   - Multilingual trigger words (EN + RU):
     ```
     /(summarize|recap|story so far|overall|time skip|what has happened|lately|dynamic|вкратце|что было|расскажи|итог|наполни|напомни)/i
     ```
   - Use existing `userMessages` concatenated string from `retrieve.js` (already capped at 1000 chars)
   - If matched → inject `global_world_state` wrapped in `<world_context>` tag
   - If not matched → fall back to standard cosine similarity (Local RAG)

**Data Flow:**
```
Background (every 50 messages):
Louvain → Community Summaries → [if changed] → Global Synthesis → global_world_state

Critical Path (GENERATION_AFTER_COMMANDS):
Last 2 user messages → Intent Regex → [if macro] → Inject global_world_state
                                            → [if local] → Cosine search → Inject top communities
```

---

## 4. Data Models / Schema

### Schema Updates

#### 4.1 Global World State (`chatMetadata.openvault`)

```typescript
interface ChatMetadata {
  // ... existing fields ...

  // NEW: Pre-computed global state for macro queries
  global_world_state?: {
    summary: string;              // 300-token global synthesis
    last_updated: number;          // Timestamp
    community_count: number;       // Number of communities synthesized
  };
}
```

#### 4.2 Global Synthesis Schema (`src/extraction/structured.js`)

```javascript
export const GlobalSynthesisSchema = z.object({
    global_summary: z.string()
        .min(50, 'Global summary must be substantive')
        .max(300, 'Global summary must fit within token budget')
        .describe('Overarching summary of current story state, focusing on macro-relationships and trajectory'),
});
```

### No Schema Changes Required For
- Events (unchanged)
- Reflections (unchanged)
- Communities (unchanged)
- Graph nodes/edges (unchanged)

---

## 5. Interface / API Design

### 5.1 Formatting API Changes (`src/retrieval/formatting.js`)

**Current Signature:**
```javascript
export function formatContextForInjection(
    memories,
    presentCharacters,
    emotionalInfo,
    characterName,
    tokenBudget,
    chatLength
)
```

**Behavior Change:** The function will now:
1. Separate `type === 'reflection'` memories from `type === 'event'` memories
2. Assign only events to temporal buckets
3. Render `<scene_memory>` with events only
4. Render `<subconscious_drives>` with reflections
5. Return both sections concatenated

**Return Value:** Still returns a single string (for compatibility with `safeSetExtensionPrompt`)

### 5.2 World Context API Changes (`src/retrieval/world-context.js`)

**Current Signature:**
```javascript
export function retrieveWorldContext(communities, queryEmbedding, tokenBudget)
```

**New Behavior:**
```javascript
export function retrieveWorldContext(
    communities,
    globalState,
    userMessagesString,  // Existing concatenated string from retrieve.js (capped at 1000 chars)
    queryEmbedding,
    tokenBudget
)
```

**Logic:**
1. Check `detectMacroIntent(userMessagesString)` using multilingual regex
2. If macro intent AND `globalState` exists:
   - Return `{ text: `<world_context>\n${globalState.summary}\n</world_context>`, communityIds: [] }`
3. Otherwise, run existing cosine similarity search

### 5.3 Global Synthesis API (`src/graph/communities.js`)

**New Function:**
```javascript
/**
 * Generate global world state from all community summaries.
 * Called after community updates, only if 1+ communities changed.
 *
 * @param {Object} communities - All community summaries
 * @param {string} preamble - Extraction preamble language
 * @param {string} outputLanguage - Output language setting
 * @returns {Promise<{ summary: string }>}
 */
export async function generateGlobalWorldState(communities, preamble, outputLanguage)
```

### 5.4 Prompt API (`src/prompts/index.js`)

**New Function:**
```javascript
/**
 * Build the global synthesis prompt for Map-Reduce over communities.
 *
 * @param {Object[]} communities - Array of { title, summary, findings }
 * @param {string} preamble - Extraction preamble
 * @param {string} outputLanguage - Output language setting
 * @returns {object} { system, user } prompt object
 */
export function buildGlobalSynthesisPrompt(communities, preamble, outputLanguage)
```

---

## 6. Risks & Edge Cases

### Issue A Risks

| Risk | Mitigation |
|------|------------|
| **LLM ignores negative constraint** | Modern models (Kimi K25) are highly obedient to "subtext only" framing. The XML tag wrapper + explicit CRITICAL RULE provides strong instruction. If testing shows leakage, we can add a reinforcing prompt in the main system prompt. |
| **Reflections become less useful** | Clinical insights remain valuable for debugging and may be used for other features (e.g., character arc analysis). The subtext wrapper ensures they still guide RP without contaminating dialogue. |
| **Multi-character chat confusion** | This was the primary reason to reject A-1 (1st-person diegetic). XML isolation works for any character count since it's framed as "hidden truths about the POV character" rather than "I think..." |

### Issue B Risks

| Risk | Mitigation |
|------|------------|
| **Regex false positives** | User says "I need to summarize my thoughts" in dialogue → triggers macro intent. This is acceptable; global context provides background that doesn't harm local scenes. Cost is minimal (~300 tokens). |
| **Regex false negatives** | User asks "What's going on?" → no match, falls back to local search. Result: Less comprehensive global context. User can retry with "Give me a summary". |
| **Global state is stale** | Global synthesis only runs when communities update (every 50 messages or on change). For long chats, this may miss recent developments. Mitigation: The staleness threshold (100 messages in `updateCommunitySummaries`) ensures periodic refresh. |
| **Empty global state** | New chats have no communities → no global state. Intent detection falls back gracefully to local search. |
| **LLM synthesis is poor quality** | Map-Reduce is a well-studied pattern; community summaries provide strong input. If quality is insufficient, we can add few-shot examples to the synthesis prompt. |

### Integration Risks

| Risk | Mitigation |
|------|------------|
| **Breaking existing chats** | Schema changes are additive only (`global_world_state` is optional). Old chats without this field simply skip global injection. |
| **Performance regression** | Intent detection is O(n) regex over 2 messages (negligible). Global synthesis runs in background, not on critical path. |
| **Token budget overflow** | `<subconscious_drives>` is not included in token budget calculation for `<scene_memory>`. May need separate budget or implicit limit on number of reflections injected. |
| **Test coverage gaps** | Need integration tests for: (1) formatting with reflections separated, (2) intent detection edge cases, (3) global state generation trigger conditions. |

### Edge Cases to Handle

1. **No reflections exist**: `<subconscious_drives>` section should be omitted entirely (not rendered as empty tag)
2. **No global state exists**: Intent detection should return `false` (macro intent requires global state to be useful)
3. **All communities skipped**: If `updateCommunitySummaries` updates 0 communities, global synthesis should be skipped
4. **Single community**: Louvain may return only 1 community. Global synthesis should still run (summarizes the entire graph)
5. **User messages are empty**: Intent detection should return `false` gracefully

---

## 7. Implementation Phases

### Phase 1: Subconscious Drives (Issue A)
1. Modify `formatContextForInjection()` in `src/retrieval/formatting.js`
2. Add tests for reflection separation
3. Verify RP output no longer has therapist-speak

### Phase 2: Global Synthesis (Issue B - Part 1)
1. Add `GlobalSynthesisSchema` to `src/extraction/structured.js`
2. Add `buildGlobalSynthesisPrompt()` to `src/prompts/index.js`
3. Implement `generateGlobalWorldState()` in `src/graph/communities.js`
4. Update `updateCommunitySummaries()` to trigger global synthesis

### Phase 3: Intent Routing (Issue B - Part 2)
1. Add `detectMacroIntent()` to `src/retrieval/world-context.js`
2. Modify `retrieveWorldContext()` to accept `globalState` and `lastTwoUserMessages`
3. Update caller (`retrieveAndInjectContext`) to pass these parameters
4. Add tests for intent detection edge cases

### Phase 4: Integration & Testing
1. End-to-end test with multi-message chat
2. Verify no performance regression on critical path
3. Test with existing chats (backward compatibility)
4. Manual RP testing for tone quality

---

## 8. Success Criteria

1. ✅ Character dialogue no longer contains clinical/therapeutic language patterns
2. ✅ Macro queries ("What's the story so far?") return coherent global summaries
3. ✅ Local queries continue to work with existing vector search
4. ✅ No measurable latency added to `GENERATION_AFTER_COMMANDS` event
5. ✅ Existing chats load and function without errors
6. ✅ Global synthesis only runs when communities actually change

---

## 9. Implementation Refinements

### Intent Detection Data Source
- Use the existing `userMessages` concatenated string from `retrieve.js` (already capped at 1000 chars for embedding query)
- Pass this exact string to `detectMacroIntent()` — no need for separate "last two messages" extraction
- `retrieve.js` location: `src/retrieval/retrieve.js`

### Empty Tag Guards
- If 0 reflections selected: **omit** `<subconscious_drives>` entirely (do not render empty tags)
- If no global state exists: Intent detection should return `false` gracefully
- Preserve clean prompt structure with no unnecessary XML wrappers

### Prompt Architecture
- `buildGlobalSynthesisPrompt()` must use existing `assembleSystemPrompt()` utility
- This ensures `<language_rules>` and anti-refusal preambles are automatically injected
- Keeps LLM obedient and maintains consistency with existing prompt builders

## 10. Open Questions (Answered)

1. **Token budget for `<subconscious_drives>`**: ✅ **Do not create separate budget.** Use existing `score.js` and `sliceToTokenBudget` to select best memories (mixing events and reflections). Route selected events to temporal buckets, selected reflections to `<subconscious_drives>` block. This guarantees we never overflow `retrievalFinalTokens` limit.

2. **Global state compression**: ✅ **300 tokens is perfect.** ~225 words is sufficient for LLM to outline macro-narrative and relationship dynamics without eating prompt budget. Keep hard limit.

3. **Intent trigger words**: ✅ **Yes, MUST add Russian triggers.** Extension officially supports RU/EN.
   - **Final regex:** `/(summarize|recap|story so far|overall|time skip|what has happened|lately|dynamic|вкратце|что было|расскажи|итог|наполни|напомни)/i`

4. **Global state format (Embeddings?)**: ✅ **No, do NOT embed `global_world_state`.** The keyword heuristic bypasses vector math entirely. If regex hits → inject text. If regex misses → don't. Embedding would waste CPU/WebGPU cycles.

---

## 11. References

- **Phase 2 Issues**: `tmp/p2` — Conceptual misalignments with GraphRAG paper
- **User Recommendations**: `tmp/rpz.txt` — Strategic decisions for A-2 and background synthesis
- **Current Architecture**: `include/ARCHITECTURE.md` — Data flow and schema
- **Related Design**: `docs/designs/2026-03-11-unified-reflection-edge-consolidation-plan.md` — Unified reflection schema
