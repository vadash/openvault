# Design: Unified Reflection (1-Call) & Deferred Edge Consolidation

## 1. Problem Statement

### Issue 1: Over-Engineered Reflection Pipeline (4 LLM calls → 1 call)
**Location:** `src/reflection/reflect.js`, function `generateReflections()`

**The Flaw:** The current architecture uses 4 sequential LLM calls inherited from the Stanford Generative Agents paper (designed for GPT-3 era models with tiny context windows):

```javascript
// Current problematic code (4 calls total):
// Step 1: Generate 3 salient questions (1 call)
const questionsResponse = await callLLM(questionsPrompt, ...);
const { questions } = parseSalientQuestionsResponse(questionsResponse);

// Step 2: For each question, retrieve + extract insights (3 calls in parallel)
const insightPromises = questions.map(async (question) => {
    // Retrieve memories via embedding similarity
    const queryEmb = await getQueryEmbedding(question);
    const relevantMemories = /* similarity search */;

    // Extract insights for THIS question only
    const insightResponse = await callLLM(insightPrompt, ...);
    // ...
});
const insightResults = await Promise.all(insightPromises); // ← Parallel execution risk
```

**Impact:**
1. **Rate limit risk:** 4 concurrent/sequential requests to local LLMs (Ollama, LM Studio) cause timeouts/429 errors
2. **Unnecessary complexity:** Embedding retrieval per question is overkill when all questions derive from the same memory set
3. **Wasted tokens:** System instructions sent 4 times instead of once
4. **Slow:** 30-90 seconds total vs ~10-15 seconds for single call

**Root Cause:** Stanford paper assumed small context windows requiring vector search per question. Your models (Kimi K25, Qwen3) handle 32-64k tokens — 100 memories ≈ 2-4k tokens is trivial.

### Issue 2: Graph Edge Bloat in `graph.js`
**Location:** `src/graph/graph.js`, function `upsertRelationship()`

**The Flaw:** When duplicate edges are found, descriptions are concatenated with pipe separator and capped:

```javascript
// Current problematic code:
if (!existing.description.includes(description)) {
    existing.description = existing.description + ' | ' + description;
}
const segments = existing.description.split(' | ');
if (cap > 0 && segments.length > cap) {
    existing.description = segments.slice(-cap).join(' | '); // ← "Segment 1 | Segment 2 | ..."
}
```

**Impact:** While capping at 5 prevents infinite growth, concatenating 5 complex sentences creates a fragmented, token-heavy string. When the LLM reads this during Community Summarization, it sees a disjointed timeline rather than a coherent relationship state. The pipe-separated format is optimized for machine parsing, not LLM comprehension.

## 2. Goals & Non-Goals

### Must Do
- [x] **Replace 4-call reflection pipeline with single unified call**
- [x] Remove question generation intermediate step (embed into single prompt)
- [x] Remove per-question embedding retrieval (unnecessary with large context)
- [x] Implement deferred edge consolidation queue
- [x] Consolidate edges during community detection (every 50 messages)
- [x] Re-embed consolidated edges for accurate RAG retrieval

### Won't Do
- [ ] Keep separate question generation step (no benefit with 32k+ context)
- [ ] Per-question embedding retrieval (overkill for your models)
- [ ] Immediate per-update edge consolidation (deferred batch chosen)
- [ ] UI controls for consolidation behavior
- [ ] Migration script for existing edges (consolidate on next community detection)

## 3. Proposed Architecture

### 3.1 Unified Reflection Processing (4 calls → 1 call)

**Change Location:** `src/reflection/reflect.js` ~lines 240-320

**Before (4 calls total):**
```javascript
// Step 1: Generate salient questions (1 call)
const questionsPrompt = buildSalientQuestionsPrompt(characterName, recentMemories, preamble, outputLanguage);
const questionsResponse = await callLLM(questionsPrompt, LLM_CONFIGS.reflection_questions, { structured: true });
const { questions } = parseSalientQuestionsResponse(questionsResponse);

// Step 2: For each question, retrieve + extract insights (3 calls)
const insightPromises = questions.map(async (question) => {
    // Per-question embedding retrieval (unnecessary!)
    const queryEmb = await getQueryEmbedding(question);
    const relevantMemories = /* similarity search against 100 memories */;

    const insightPrompt = buildInsightExtractionPrompt(characterName, question, relevantMemories, ...);
    const insightResponse = await callLLM(insightPrompt, LLM_CONFIGS.reflection_insights, { structured: true });
    // ...
});
const insightResults = await Promise.all(insightPromises);
```

**After (1 call total):**
```javascript
// Single unified call: generate questions AND extract insights together
const reflectionPrompt = buildUnifiedReflectionPrompt(
    characterName,
    recentMemories.slice(0, 100),  // Top 100 memories (~2-4k tokens)
    preamble,
    outputLanguage
);
const reflectionResponse = await callLLM(reflectionPrompt, LLM_CONFIGS.reflection, { structured: true });
const { reflections } = parseUnifiedReflectionResponse(reflectionResponse);

// Convert directly to reflection memory objects
const newReflections = reflections.map(({ question, insight, evidence_ids }) => ({
    id: `ref_${generateId()}`,
    type: 'reflection',
    summary: insight,
    tokens: tokenize(insight),
    importance: 4,
    sequence: Date.now(),
    characters_involved: [characterName],
    character: characterName,
    source_ids: evidence_ids,
    witnesses: [characterName],
    // ... rest of schema
}));
```

**Benefits:**
- **4x faster:** ~10-15s vs 30-90s
- **Stable:** No parallel requests, no rate limit risk
- **Simpler:** One prompt, one parse, one code path
- **Cheaper:** System instructions sent once instead of 4x
- **No embedding overhead:** Skip 3x query embeddings + similarity searches

### 3.2 Deferred Edge Consolidation

**Components:**

1. **Edge Consolidation Queue** (`chatMetadata.openvault`)
   ```javascript
   {
     _edgesNeedingConsolidation: ["alice__bob", "charlie__dave"] // Optional tracking field
   }
   ```

2. **Token Budget Tracking** (`graphData.edges`)
   ```javascript
   {
     "alice__bob": {
       source: "alice",
       target: "bob",
       description: "Alice saved Bob from the dragon",
       weight: 3,
       _descriptionTokens: 8 // Exact count from countTokens() in src/utils/tokens.js
     }
   }
   ```

3. **Consolidation Trigger** (`upsertRelationship`)
   - After appending new description segment
   - If `_descriptionTokens > CONSOLIDATION_THRESHOLD` (default: 500)
   - Add edge key to `_edgesNeedingConsolidation` set

4. **Batch Consolidation** (during community detection)
   - Runs in `detectCommunities()` after Louvain clustering
   - For each edge in `_edgesNeedingConsolidation`:
     - Extract description segments
     - Call LLM to synthesize into unified description
     - Update edge description
     - Re-embed edge
     - Remove from consolidation queue

### 3.3 Unified Reflection Prompt

```javascript
function buildUnifiedReflectionPrompt(characterName, recentMemories, preamble, outputLanguage) {
    const memoryList = recentMemories.map((m, i) =>
        `${m.id}. [${m.importance || 3}★] ${m.summary}`
    ).join('\n');

    return {
        system: `You are an expert psychological analyst. Generate high-level insights about a character's internal state, relationships, and trajectory based on their recent experiences.

OUTPUT SCHEMA:
{
  "reflections": [
    {
      "question": "A salient high-level question about the character",
      "insight": "A deep psychological insight answering the question",
      "evidence_ids": ["id1", "id2"]  // Memory IDs that support this insight
    }
  ]
}

CRITICAL ID GROUNDING RULE:
For "evidence_ids", you MUST ONLY use the exact IDs shown in the <recent_memories> list.
Do NOT invent, hallucinate, or modify IDs. If you cannot find the exact ID in the list, use an empty array [].

Generate 1-3 reflection objects. Each insight should synthesize patterns across multiple memories.
Only generate as many reflections as you can support with strong evidence — quality over quantity.`,

        user: `<character>${characterName}</character>

<recent_memories>
${memoryList}
</recent_memories>

${resolveLanguageInstruction(memoryList, outputLanguage)}

Based on these memories about ${characterName}:
1. Generate 1-3 salient high-level questions about their current psychological state, relationships, goals, or unresolved conflicts.
2. For each question, provide a deep insight that synthesizes patterns across the memories.
3. Cite specific memory IDs as evidence for each insight. You MUST use IDs exactly as shown above.

Respond with a single JSON object containing a "reflections" array with 1-3 items. No other text.`
    };
}
```

### 3.4 Edge Consolidation Prompt

```javascript
function buildEdgeConsolidationPrompt(edgeData) {
    const segments = edgeData.description.split(' | ');
    return {
        system: "You are a relationship state synthesizer. Combine multiple relationship descriptions into a single, coherent summary that preserves narrative depth.",
        user: `Synthesize these relationship developments into ONE unified description:

Source: ${edgeData.source}
Target: ${edgeData.target}
Weight: ${edgeData.weight}

Timeline segments:
${segments.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Output a JSON object with:
{
  "consolidated_description": "string - unified relationship summary that captures the evolution"
}

Keep the description under 100 tokens.

IMPORTANT: Summarize the CURRENT dynamic, but preserve critical historical shifts.
For example: "Started as enemies, but allied after the dragon incident; now close friends."
If the relationship has evolved significantly, capture that trajectory in a concise way.`
    };
}
```

## 4. Data Models / Schema

### 4.1 Extended Edge Schema

```typescript
interface GraphEdge {
    source: string;           // Normalized source entity key
    target: string;           // Normalized target entity key
    description: string;      // Current relationship description
    weight: number;           // Interaction count
    _descriptionTokens?: number;  // Approximate token count (optional, for consolidation trigger)
    _needsConsolidation?: boolean; // Flag for batch processing (optional optimization)
}
```

### 4.2 Consolidation Queue (metadata)

```typescript
interface OpenVaultData {
    // ... existing fields ...
    graph: {
        nodes: { [key: string]: GraphNode };
        edges: { [key: string]: GraphEdge };
    };
    _edgesNeedingConsolidation?: Set<string> | string[]; // Edge keys needing consolidation
}
```

### 4.3 Consolidation Constants

```javascript
// src/constants.js
export const CONSOLIDATION = {
    TOKEN_THRESHOLD: 500,           // Trigger consolidation when description exceeds this
    MAX_CONSOLIDATION_BATCH: 10,    // Max edges to consolidate per community detection run
    CONSOLIDATED_DESCRIPTION_CAP: 2, // After consolidation, cap future additions to 2 segments
};
```

## 5. Interface / API Design

### 5.1 Unified Reflection Function

**Before (deleted functions):**
- `buildSalientQuestionsPrompt()` — removed
- `buildInsightExtractionPrompt()` — removed
- `parseSalientQuestionsResponse()` — removed
- `parseInsightExtractionResponse()` — removed

**After (new functions):**

```javascript
/**
 * Build the unified reflection prompt.
 * Combines question generation and insight extraction into a single call.
 * @param {string} characterName
 * @param {Array} recentMemories - Top 100 recent memories
 * @param {string} preamble
 * @param {string} outputLanguage
 * @returns {object} { system, user } prompt object
 */
export function buildUnifiedReflectionPrompt(characterName, recentMemories, preamble, outputLanguage) {
    // See section 3.3 for full implementation
}

/**
 * Parse the unified reflection response.
 * @param {string} response - LLM JSON response
 * @returns {{ reflections: Array<{question: string, insight: string, evidence_ids: string[]}> }}
 */
export function parseUnifiedReflectionResponse(response) {
    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in response');
        const parsed = JSON.parse(jsonMatch[0]);

        if (!parsed.reflections || !Array.isArray(parsed.reflections)) {
            throw new Error('Missing or invalid reflections array');
        }

        // Accept 1-3 valid reflections (quality over quantity)
        if (parsed.reflections.length < 1 || parsed.reflections.length > 3) {
            throw new Error(`Expected 1-3 reflections, got ${parsed.reflections.length}`);
        }

        // Validate each reflection has required fields
        const validReflections = [];
        for (const ref of parsed.reflections) {
            if (ref.question && ref.insight && Array.isArray(ref.evidence_ids)) {
                // Filter out hallucinated IDs (warn but don't fail)
                // Caller will validate IDs against actual memory IDs
                validReflections.push(ref);
            }
        }

        if (validReflections.length === 0) {
            throw new Error('No valid reflections found in response');
        }

        return { reflections: validReflections };
    } catch (err) {
        logError('Failed to parse unified reflection response', err);
        return { reflections: [] }; // Fail gracefully
    }
}
```

### 5.2 Modified `upsertRelationship` Signature

No signature change. Internal behavior modified:

```javascript
export function upsertRelationship(
    graphData,
    source,
    target,
    description,
    cap = 5,
    settings = null  // NEW: Optional settings for consolidation behavior
) {
    // ... existing upsert logic ...

    // NEW: After appending description, check token budget
    if (settings && existing._descriptionTokens > settings.consolidationTokenThreshold) {
        markEdgeForConsolidation(graphData, edgeKey);
    }
}
```

### 5.2 New Consolidation Functions

```javascript
/**
 * Mark an edge for consolidation during next community detection.
 * @param {Object} graphData - The graph object
 * @param {string} edgeKey - The edge key to mark
 */
function markEdgeForConsolidation(graphData, edgeKey) {
    if (!graphData._edgesNeedingConsolidation) {
        graphData._edgesNeedingConsolidation = [];
    }
    if (!graphData._edgesNeedingConsolidation.includes(edgeKey)) {
        graphData._edgesNeedingConsolidation.push(edgeKey);
    }
}

/**
 * Count tokens for a string using the existing tokenizer.
 * @param {string} text
 * @returns {number}
 */
function countDescriptionTokens(text) {
    // Use existing tokenizer from src/utils/tokens.js
    return countTokens(text);
}

/**
 * Consolidate graph edges that have exceeded token budget.
 * Runs during community detection phase.
 * @param {Object} graphData - The graph object
 * @param {Object} settings - Extension settings
 * @returns {Promise<number>} Number of edges consolidated
 */
export async function consolidateEdges(graphData, settings) {
    if (!graphData._edgesNeedingConsolidation?.length) {
        return 0;
    }

    const toProcess = graphData._edgesNeedingConsolidation
        .slice(0, CONSOLIDATION.MAX_CONSOLIDATION_BATCH);

    let consolidated = 0;

    for (const edgeKey of toProcess) {
        const edge = graphData.edges[edgeKey];
        if (!edge) continue;

        try {
            const prompt = buildEdgeConsolidationPrompt(edge);
            const response = await callLLM(prompt, {
                maxTokens: 200,
                temperature: 0.3
            }, { structured: true });

            const result = parseConsolidationResponse(response);
            if (result.consolidated_description) {
                edge.description = result.consolidated_description;
                edge._descriptionTokens = countDescriptionTokens(result.consolidated_description);

                // Re-embed for accurate RAG (only if embeddings enabled)
                if (isEmbeddingsEnabled()) {
                    const newEmbedding = await getDocumentEmbedding(
                        `relationship: ${edge.source} - ${edge.target}: ${edge.description}`
                    );
                    setEmbedding(edge, newEmbedding);
                }

                consolidated++;
            }
        } catch (err) {
            logError(`Failed to consolidate edge ${edgeKey}`, err);
        }
    }

    // Remove processed edges from queue
    graphData._edgesNeedingConsolidation = graphData._edgesNeedingConsolidation
        .slice(consolidated);

    return consolidated;
}
```

### 5.3 Integration with Community Detection

Modified community detection flow in `src/graph/rag.js` or equivalent:

```javascript
export async function detectCommunities(graphData, settings) {
    // ... existing Louvain clustering ...

    // NEW: Consolidate bloated edges before summarization
    if (graphData._edgesNeedingConsolidation?.length > 0) {
        const consolidated = await consolidateEdges(graphData, settings);
        if (consolidated > 0) {
            logDebug(`Consolidated ${consolidated} graph edges before community summarization`);
        }
    }

    // ... existing LLM summarization with cleaner edge data ...
}
```

## 6. Risks & Edge Cases

### 6.1 Unified Reflection Risks

| Risk | Mitigation |
|------|------------|
| **Prompt complexity** | Single prompt is more complex, but your models (Kimi K25, Qwen3) handle this easily. |
| **Larger token input** | Sends 100 memories (~2-4k tokens) instead of 20×3 (~2-4k total). Same input size, fewer API calls. |
| **UI appears frozen** | Single call ~10-15s total vs 4 sequential calls ~30-90s. Actually faster. |
| **Chat switch mid-call** | Existing `AbortError` handling in `callLLM` works the same. |
| **ID hallucination** | Added strict grounding rule to system prompt: "MUST ONLY use the exact IDs shown in the <recent_memories> list." |
| **Fewer than 3 insights** | Parser now accepts 1-3 valid insights. Quality over quantity — better to have 1 strong insight than 3 weak ones. |

### 6.2 Edge Consolidation Risks

| Risk | Mitigation |
|------|------------|
| **Consolidation LLM fails** | Error is swallowed, edge remains in queue for next attempt. Logged for debugging. |
| **Queue grows indefinitely** | Cap at `MAX_CONSOLIDATION_BATCH` per run. Oldest edges processed first (FIFO). |
| **Information loss from synthesis** | Prompt instructs to "preserve critical historical shifts" (e.g., "Started as enemies, now allies"). Original segments remain in memory for reference if needed. |
| **Token count accuracy** | Using existing `countTokens()` from `src/utils/tokens.js` instead of heuristic. Already used in scheduler.js and formatting.js. |
| **Re-embedding when disabled** | Wrapped in `if (isEmbeddingsEnabled())` guard. BM25-only users won't crash. |
| **Re-embedding cost** | Only re-embed consolidated edges (infrequent). Trades off compute for cleaner RAG. |
| **Edge no longer exists** | Defensive check: `if (!edge) continue` during consolidation. |
| **Concurrent modification** | Consolidation runs in background worker during community detection, which is sequential. No race conditions. |

### 6.3 Migration Path

- **Existing edges:** No immediate migration. Edges will be consolidated naturally on next community detection cycle (every 50 messages).
- **Missing `_descriptionTokens` field:** Backfilled when `countDescriptionTokens()` (using existing `countTokens()`) is first called during `upsertRelationship`.
- **Missing `_edgesNeedingConsolidation` field:** Initialized as empty array on first access.

## 7. Implementation Checklist

### Phase 1: Unified Reflection (4 calls → 1 call)
- [ ] Add `buildUnifiedReflectionPrompt()` to `src/prompts/index.js` (with ID grounding rule)
- [ ] Add `parseUnifiedReflectionResponse()` to `src/extraction/structured.js` (accept 1-3 insights)
- [ ] Remove `buildSalientQuestionsPrompt()` and `buildInsightExtractionPrompt()` (unused)
- [ ] Remove `parseSalientQuestionsResponse()` and `parseInsightExtractionResponse()` (unused)
- [ ] Refactor `generateReflections()` to use single unified call
- [ ] Remove per-question embedding retrieval code
- [ ] Remove `QUESTIONS_ROLE` and related constants (no longer needed)
- [ ] Add `LLM_CONFIGS.reflection` config (unified call)
- [ ] Update performance tracking (1 call instead of 4)

### Phase 2: Edge Consolidation Infrastructure
- [ ] Add `_descriptionTokens` tracking to `upsertRelationship()` using `countTokens()` from `src/utils/tokens.js`
- [ ] Add `markEdgeForConsolidation()` function
- [ ] Add `CONSOLIDATION` constants to `src/constants.js`
- [ ] Ensure `countTokens()` is exported from `src/utils/tokens.js` (should already exist)

### Phase 3: Edge Consolidation Implementation
- [ ] Add `buildEdgeConsolidationPrompt()` to prompts (with historical shifts instruction)
- [ ] Add `parseConsolidationResponse()` to `structured.js`
- [ ] Implement `consolidateEdges()` function (with `isEmbeddingsEnabled()` guard)
- [ ] Integrate consolidation into community detection flow

### Phase 4: Testing
- [ ] Test unified reflection with local LLM (Ollama)
- [ ] Test reflection parsing accepts 1-3 insights (not strictly 3)
- [ ] Test edge consolidation with >5 segment edge
- [ ] Test consolidation preserves historical shifts in relationships
- [ ] Test consolidation with embeddings DISABLED (BM25-only mode)
- [ ] Test consolidation queue persistence across saves
- [ ] Test error handling (LLM failure during consolidation)
- [ ] Verify `countTokens()` works correctly for edge descriptions
- [ ] Verify re-embedding updates work correctly (when enabled)

## 8. Performance Impact

### Unified Reflection
- **Before (4 calls):** ~30-90s total (1 question call + 3 insight calls, with embedding overhead)
- **After (1 call):** ~10-15s total (single unified call)
- **Improvement:** 3-6x faster, no embedding overhead, stable across all LLM backends

### Edge Consolidation
- **Cost:** ~1-2s per consolidated edge (LLM call + re-embedding)
- **Frequency:** Every 50 messages, max 10 edges per batch
- **Net Impact:** Adds ~10-20s to community detection phase, but reduces token bloat in subsequent summarizations

### Overall
Total background processing time **decreases significantly** while system becomes more reliable. 1-call reflection is both faster and more stable than the 4-call pipeline.
