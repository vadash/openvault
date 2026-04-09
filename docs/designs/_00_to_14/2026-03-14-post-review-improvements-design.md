# Post-Review Improvements Design

**Date**: 2026-03-14
**Source**: Two independent LLM reviews of a 1000-message extraction run, cross-checked against codebase.
**Scope**: 6 items validated against actual code. Items 6 (502 retry) and 8 (BM25 main-character boost) skipped per user decision.

---

## Item 1: Strip `<tool_call>` Tags from LLM Responses

### Problem
`stripThinkingTags()` in `src/utils/text.js:34-49` handles `think|thinking|thought|reasoning|reflection` but not `tool_call` or `search` tags. Qwen/Kimi instruct models emit these automatically when they believe they're using a JSON tool, wrapping the actual JSON output in `<tool_call>...</tool_call>`. This causes `extractBalancedJSON` to fail with parse errors.

### Current Code
```javascript
.replace(/<(think|thinking|thought|reasoning|reflection)>[\s\S]*?<\/\1>/gi, '')
// ...
.replace(/^[\s\S]*?<\/(think|thinking|thought|reasoning)>\s*/i, '')
```

### Fix
Add `tool_call` and `search` to both regex alternations. Include `(?:\s+[^>]*)?` to match tag attributes (Qwen models emit `<tool_call name="extract_events">`):
```javascript
.replace(/<(think|thinking|thought|reasoning|reflection|tool_call|search)(?:\s+[^>]*)?>[\\s\\S]*?<\/\1>/gi, '')
// ...
.replace(/^[\s\S]*?<\/(think|thinking|thought|reasoning|tool_call|search)>\s*/i, '')
```

Also add `TOOL_CALL` to the bracket-tag regex:
```javascript
.replace(/\[(THINK|THOUGHT|REASONING|TOOL_CALL)\][\s\S]*?\[\/\1\]/gi, '')
```

### Files
- `src/utils/text.js` — `stripThinkingTags()`

### Tests
- Existing `stripThinkingTags` unit tests — add cases for `<tool_call>` paired tags, `<tool_call name="...">` with attributes, orphaned closing `</tool_call>`, and `[TOOL_CALL]` bracket tags.

---

## Item 2: Soften Dedup Prompt to Prevent "0 Events" Batches

### Problem
The `<dedup>` block in `src/prompts/index.js:223-239` tells the LLM: *"you MUST set 'events' to an empty array []"*. Two few-shot examples in `src/prompts/examples/events.js:185-209` reinforce this by demonstrating `{ "events": [] }` output. Together, they cause the LLM to over-suppress during long continuation scenes, returning 0 events for batches that contain genuine micro-progressions.

The programmatic `filterSimilarEvents()` (cosine + Jaccard dual-gate) already handles real duplicates reliably. The prompt should extract liberally and let code filter.

### Fix

**A. Rewrite the `<dedup>` block** (`src/prompts/index.js:223-239`):

Replace the current binary logic ("extract OR output `[]`") with progression-oriented guidance:

```
<dedup>
This is the MOST IMPORTANT rule. Duplicating memories already in established_memories is the worst error.

BEFORE creating ANY event, you MUST check the <established_memories> section in the user message.

If a scene is already recorded there, DO NOT repeat the same actions. Instead, look for the NEWEST change within that scene:
1. A shift in emotional state (e.g., confidence → vulnerability, pleasure → discomfort).
2. A new phase or escalation (e.g., foreplay → penetration, sparring → real fight).
3. The scene concluding (e.g., climax, falling asleep, location change, combat ends).
4. A power dynamic reversal (e.g., submissive takes control, ambush turns into retreat).
5. A new element changing the scene's nature (new character arrives, weapon drawn, secret revealed).
6. A safeword explicitly used to halt the scene.

If the messages contain ONLY a continuation of the exact same action with no shift, escalation, or conclusion — then output "events": [].

When in doubt, extract a brief progression event rather than output nothing. The system will automatically filter true duplicates.
</dedup>
```

Key changes:
- Removed "MUST set to empty array" imperative.
- Added "look for the NEWEST change" framing — guides toward extraction.
- Added fallback line: "extract a brief progression event rather than output nothing."
- Kept the "exact same action" clause as a safety valve for truly static batches.

**B. Rewrite the two few-shot examples** (`src/prompts/examples/events.js:185-209`):

Replace the `{ "events": [] }` outputs with selective progression extractions:

Example 1 (EN/Edge) — currently shows empty output for crop continuation:
```javascript
{
    label: 'Dedup - progression extraction (EN/Edge)',
    input: `The crop came down again — three, four, five. His thighs were crisscrossed with welts now. "Color?" she asked. "Green," he whispered, voice shaking.
She traced a welt with her fingertip, watching him shiver.

<established_memories>
[★★★★] She restrained him with leather cuffs and struck him with a riding crop after a green-light color check
</established_memories>`,
    thinking: `Step 1: More crop strikes, welts accumulating, another color check, aftercare touch (tracing welt).
Step 2: Existing memory covers: restraints, crop strikes, initial color check.
Step 3: The scene is intensifying — welts accumulating, his voice is shaking (emotional shift from composure to strain). But the core action (crop impact) is the same type. Borderline.
Step 4: The emotional shift (shaking voice) and physical escalation (welts accumulating) are a genuine progression from the initial strike.`,
    output: `{ "events": [{ "summary": "His thighs became crisscrossed with welts from repeated crop strikes; his voice shook during the color check", "importance": 2, "characters_involved": ["She", "He"], "witnesses": [], "location": null, "is_secret": false, "emotional_impact": { "He": "strained but consenting" }, "relationship_impact": {} }] }`,
}
```

Example 2 (RU/Edge) — currently shows empty output for sex continuation:
```javascript
{
    label: 'Dedup - progression extraction (RU/Edge)',
    input: `Саша ускорила ритм, вцепившись в его плечи. Вова приподнял бёдра ей навстречу, стискивая зубы. "Да, вот так," — простонала она. Их дыхание смешалось, тела двигались в унисон.

<established_memories>
[★★★] Саша села на Вову сверху, они занялись сексом в позе наездницы до близости к оргазму
</established_memories>`,
    thinking: `Step 1: Input is Russian. Rhythm acceleration, mutual physical intensity, approaching climax.
Step 2: Existing memory: cowgirl sex, near-orgasm — already recorded.
Step 3: Same position, same act. The rhythm acceleration and mutual intensity are continuation, not a new phase. No dynamic shift.
Step 4: This is a continuation of the exact same action with no new element. Output empty.`,
    output: `{ "events": [] }`,
}
```

Note: Example 1 is rewritten to show extraction; Example 2 is kept as `[]` to show the LLM that truly static continuations should still produce nothing. This gives balanced calibration — one extract, one skip.

**C. Update thinking process** (`src/prompts/index.js:254-258`):

Change Step 3 from:
```
Step 3: Apply dedup rules. If this is a continuation with no escalation, plan to output "events": [].
```
To:
```
Step 3: Apply dedup rules. If this is a continuation, look for the newest progression. If there is none at all, plan to output "events": [].
```

### Files
- `src/prompts/index.js` — `<dedup>` block, thinking process Step 3
- `src/prompts/examples/events.js` — rewrite example at line 185, keep example at line 199

### Tests
- No unit tests (prompt text). Verify via manual extraction run.

---

## Item 3: Lower Edge Consolidation Threshold

### Problem
`CONSOLIDATION.TOKEN_THRESHOLD` is 500 in `src/constants.js:228`. For Russian text, 500 tokens is ~300-400 words of pipe-separated relationship descriptions. Edges grow too large before consolidation fires, creating context noise during community detection and RAG injection.

### Fix
Change `TOKEN_THRESHOLD` from 500 to 250:
```javascript
export const CONSOLIDATION = {
    TOKEN_THRESHOLD: 250,
    MAX_CONSOLIDATION_BATCH: 10,
    CONSOLIDATED_DESCRIPTION_CAP: 2,
};
```

### Files
- `src/constants.js` — `CONSOLIDATION.TOKEN_THRESHOLD`

### Tests
- Existing consolidation tests should pass with lower threshold (they test logic, not specific threshold values).

---

## Item 4: Map-Reduce for Global World State Synthesis

### Problem
`generateGlobalWorldState()` in `src/graph/communities.js:305-325` passes ALL community summaries into a single LLM prompt. At 30+ communities (~200 tokens each = ~6,000+ tokens), the prompt causes API gateway timeouts (502 Bad Gateway). On failure, it returns `null` — global state is silently lost.

### Fix
Add a map-reduce step when community count exceeds a threshold.

**New private function** `synthesizeInChunks()` in `communities.js`:

```javascript
const GLOBAL_SYNTHESIS_CHUNK_SIZE = 10;

async function synthesizeInChunks(communityList, preamble, outputLanguage) {
    if (communityList.length <= GLOBAL_SYNTHESIS_CHUNK_SIZE) {
        // Small set: single-pass (current behavior)
        const prompt = buildGlobalSynthesisPrompt(communityList, preamble, outputLanguage);
        const response = await callLLM(prompt, LLM_CONFIGS.community, { structured: true });
        return parseGlobalSynthesisResponse(response).global_summary;
    }

    // Map phase: chunk communities, get regional summaries
    // Each chunk is independently try/caught so a single LLM failure
    // doesn't lose the entire global state.
    const chunks = [];
    for (let i = 0; i < communityList.length; i += GLOBAL_SYNTHESIS_CHUNK_SIZE) {
        chunks.push(communityList.slice(i, i + GLOBAL_SYNTHESIS_CHUNK_SIZE));
    }

    const regionalSummaries = [];
    for (const chunk of chunks) {
        try {
            const prompt = buildGlobalSynthesisPrompt(chunk, preamble, outputLanguage);
            const response = await callLLM(prompt, LLM_CONFIGS.community, { structured: true });
            const parsed = parseGlobalSynthesisResponse(response);
            regionalSummaries.push(parsed.global_summary);
        } catch (err) {
            logDebug(`Regional synthesis chunk failed, skipping: ${err.message}`);
        }
    }

    if (regionalSummaries.length === 0) return null; // All chunks failed

    // Reduce phase: synthesize regional summaries into final global summary
    const pseudoCommunities = regionalSummaries.map((summary, i) => ({
        title: `Region ${i + 1}`,
        summary,
        findings: [],
    }));
    const reducePrompt = buildGlobalSynthesisPrompt(pseudoCommunities, preamble, outputLanguage);
    const reduceResponse = await callLLM(reducePrompt, LLM_CONFIGS.community, { structured: true });
    return parseGlobalSynthesisResponse(reduceResponse).global_summary;
}
```

**Update `generateGlobalWorldState()`** to call `synthesizeInChunks()` instead of direct prompt build:

```javascript
export async function generateGlobalWorldState(communities, preamble, outputLanguage) {
    const communityList = Object.values(communities || {});
    if (communityList.length === 0) return null;

    const t0 = performance.now();
    const deps = getDeps();

    try {
        const summary = await synthesizeInChunks(communityList, preamble, outputLanguage);

        const result = {
            summary,
            last_updated: deps.Date.now(),
            community_count: communityList.length,
        };

        logDebug(`Global world state synthesized from ${communityList.length} communities`);
        record('global_synthesis', performance.now() - t0, `${communityList.length} communities`);
        return result;
    } catch (error) {
        logDebug(`Global world state synthesis failed: ${error.message}`);
        return null;
    }
}
```

### Constant
Add `GLOBAL_SYNTHESIS_CHUNK_SIZE = 10` to `src/constants.js` or keep local to `communities.js` (single use site).

### Files
- `src/graph/communities.js` — new `synthesizeInChunks()`, updated `generateGlobalWorldState()`
- Optionally `src/constants.js` if externalizing the chunk size

### Tests
- Unit test `synthesizeInChunks` with mocked `callLLM`:
  - <= 10 communities: single call
  - 25 communities: 3 map calls + 1 reduce call
  - 1 of 3 chunks fails: reduce still runs with 2 regional summaries
  - All chunks fail: returns null
  - Verify `buildGlobalSynthesisPrompt` called with correct chunks

---

## Item 5: Reduce Reflection Candidate Limit

### Problem
`reflect.js:217` uses a hardcoded `.slice(0, 100)` for reflection candidates. 100 memories (especially from repetitive scenes) bloats the reflection prompt, slowing generation (79.5s observed) and confusing the LLM with redundant content.

### Fix

**A. Add constant** to `src/constants.js`:
```javascript
// In the defaultSettings object or as a standalone constant
reflectionCandidateLimit: 50,
```

Since there are already many reflection-related settings (`reflectionThreshold`, `reflectionDedupThreshold`, `maxReflectionLevel`, etc.), this fits naturally as a setting. However, it's not user-facing — it's a tuning knob. Decision: add as a constant near the `CONSOLIDATION` block, not as a setting.

```javascript
export const REFLECTION_CANDIDATE_LIMIT = 50;
```

**B. Update `reflect.js:217`**:
```javascript
import { REFLECTION_CANDIDATE_LIMIT } from '../constants.js';
// ...
const recentMemories = sortMemoriesBySequence(accessibleMemories, false).slice(0, REFLECTION_CANDIDATE_LIMIT);
```

### Files
- `src/constants.js` — new `REFLECTION_CANDIDATE_LIMIT`
- `src/reflection/reflect.js` — import and use

### Tests
- Existing reflection tests (if any mock the memory array) should still pass.

---

## Item 7: Reorder Entity Merge — Cosine First, Token Overlap as Secondary Guard

### Problem
Both `mergeOrInsertEntity()` (graph.js:340-346) and `consolidateGraph()` (graph.js:485-500) check token overlap BEFORE cosine similarity. True synonyms with different spellings (zero shared tokens, no substring match) never reach the cosine check and are incorrectly kept as separate entities.

### Current Flow (both sites)
```
tokenOverlap(A, B) → fail → SKIP (cosine never checked)
                   → pass → cosine >= threshold → merge
```

### New Flow
```
cosine(A, B) >= threshold           → merge directly (token overlap skipped)
cosine(A, B) >= threshold - 0.10    → require tokenOverlap(A, B) to confirm
cosine(A, B) < threshold - 0.10    → skip
```

Using the existing `entityMergeSimilarityThreshold` setting (default 0.94):
- >= 0.94: cosine alone is sufficient (catches synonyms)
- 0.84–0.94: grey zone, cosine + token overlap required (catches morphological variants)
- < 0.84: skip entirely

### DRY Implementation

Extract the decision logic into a shared helper in `graph.js`:

```javascript
/**
 * Determine if two entities should merge based on cosine similarity
 * and optional token overlap confirmation.
 *
 * Above threshold: cosine alone is sufficient (catches true synonyms).
 * Grey zone (threshold - 0.10 to threshold): requires token overlap confirmation.
 * Below grey zone: no merge.
 *
 * tokensA is pre-computed by the caller (outer loop). tokensB is constructed
 * lazily from keyB only when cosine lands in the grey zone, avoiding
 * Set allocation on every iteration of the tight inner loop.
 *
 * @param {number} cosine - Cosine similarity between embeddings
 * @param {number} threshold - entityMergeSimilarityThreshold from settings
 * @param {Set<string>} tokensA - Word tokens from entity A's key (pre-computed)
 * @param {string} keyA - Entity A's normalized key (for LCS/substring checks)
 * @param {string} keyB - Entity B's normalized key
 * @returns {boolean}
 */
export function shouldMergeEntities(cosine, threshold, tokensA, keyA, keyB) {
    if (cosine >= threshold) return true;
    const greyZoneFloor = threshold - 0.10;
    if (cosine >= greyZoneFloor) {
        const tokensB = new Set(keyB.split(/\s+/));
        return hasSufficientTokenOverlap(tokensA, tokensB, 0.5, keyA, keyB);
    }
    return false;
}
```

**Update `mergeOrInsertEntity()`** (graph.js:338-352):
```javascript
for (const [existingKey, existingEmbedding] of existingEmbeddings) {
    const sim = cosineSimilarity(newEmbedding, existingEmbedding);
    if (!shouldMergeEntities(sim, threshold, newTokens, key, existingKey)) {
        continue;
    }
    if (sim > bestScore) {
        bestMatch = existingKey;
        bestScore = sim;
    }
}
```

**Update `consolidateGraph()`** (graph.js:483-500):
```javascript
for (let j = i + 1; j < keys.length; j++) {
    if (mergeMap.has(keys[j])) continue;
    const nodeB = graphData.nodes[keys[j]];
    const sim = cosineSimilarity(getEmbedding(nodeA), getEmbedding(nodeB));
    if (!shouldMergeEntities(sim, threshold, tokensI, keys[i], keys[j])) {
        continue;
    }
    // merge logic...
}
```

### Why NOT apply this to `filterSimilarEvents`
`filterSimilarEvents` (extract.js) uses cosine-first + Jaccard-veto — the **opposite** pattern. Its Jaccard check is a false-positive guard (prevents merging structurally similar but narratively different events like "tied to bed" vs "untied from bed"). Removing the Jaccard veto for high-cosine matches would lose distinct events. The two systems have opposite failure modes and should remain separate.

### Performance Note
This change means more cosine computations per entity (previously short-circuited by token overlap). However:
- `mergeOrInsertEntity`: embeddings are pre-decoded into a `Map` — cosine is just a dot product on `Float32Array` (microseconds).
- `consolidateGraph`: already O(n^2) within type groups — adding dot products doesn't change the complexity class.

### Files
- `src/graph/graph.js` — new `shouldMergeEntities()`, updated `mergeOrInsertEntity()`, updated `consolidateGraph()`

### Tests
- Unit test `shouldMergeEntities()`:
  - cosine above threshold → true (no token overlap needed, tokensB never constructed)
  - cosine in grey zone + token overlap passes → true
  - cosine in grey zone + token overlap fails → false
  - cosine below grey zone → false (tokensB never constructed)
- Update existing `mergeOrInsertEntity` / `consolidateGraph` tests if they assert on call order.

---

## Summary Table

| # | Item | Files | Risk | Complexity |
|---|------|-------|------|-----------|
| 1 | Strip `<tool_call>` tags | `text.js` | Low | Regex addition |
| 2 | Soften dedup prompt | `index.js`, `events.js` | Medium | Prompt rewrite |
| 3 | Lower edge consolidation threshold | `constants.js` | Low | Number change |
| 4 | Map-reduce global synthesis | `communities.js` | Medium | New function |
| 5 | Reduce reflection candidate limit | `constants.js`, `reflect.js` | Low | Extract constant |
| 7 | Reorder entity merge checks | `graph.js` | Medium | Logic restructure + DRY helper |

## Implementation Order
1 → 3 → 5 → 1 (trivial changes first)
2 (prompt, independent)
7 → 4 (structural changes, can parallelize)
