# Design: Prompt Rewrite for Medium Non-Reasoning Models

## 1. Problem Statement

The current prompts in `src/prompts.js` have structural issues that hurt quality on medium models (DeepSeek 3.1, Kimi K2 0905):
- `event_type` is requested by the prompt but **missing from the Zod schema** — silently dropped
- `reasoning` comes after `events` in schema — model commits before thinking
- Zero few-shot examples after the refactor — medium models need steering
- Smart retrieval uses `safeParseJSON` instead of structured output
- Prompt language is good but can be tighter for medium models

## 2. Goals & Non-Goals

**Must do:**
- Fix `event_type` bug: add to EventSchema as `z.enum()`
- Reorder schema: `reasoning` → `events` (think-before-act)
- Add 6-8 diverse examples (2 per event_type: 1 NSFW + 1 SFW each)
- Create `RetrievalResponseSchema` with Zod structured output
- Wire retrieval structured output through `llm.js`
- Optimize prompt language for medium non-reasoning models
- Keep multilingual censor bypass strategy (Russian anchoring)
- Keep memories token-efficient but detail-rich for relationships/kinks

**Won't do:**
- Change the extraction pipeline stages
- Change the memory data structure beyond adding `event_type`
- Add new event types beyond the existing 4
- Touch embeddings, BM25, or worker scoring
- Backward compatibility wrappers (user explicitly rejected)

## 3. Proposed Architecture

### 3.1 Schema Changes

**`src/extraction/schemas/event-schema.js`** — 3 changes:

```javascript
// 1. Add EventType enum
export const EventTypeEnum = z.enum([
    'action',
    'revelation',
    'emotion_shift',
    'relationship_change'
]);

// 2. Add event_type to EventSchema
export const EventSchema = z.object({
    event_type: EventTypeEnum,           // NEW - was missing
    summary: z.string().min(1),
    importance: z.number().int().min(1).max(5).default(3),
    characters_involved: z.array(z.string()).default([]),
    witnesses: z.array(z.string()).default([]),
    location: z.string().nullable().default(null),
    is_secret: z.boolean().default(false),
    emotional_impact: z.record(z.string(), z.string()).optional().default({}),
    relationship_impact: RelationshipImpactSchema.optional().default({}),
});

// 3. Reorder ExtractionResponseSchema — reasoning FIRST
export const ExtractionResponseSchema = z.object({
    reasoning: z.string().nullable().default(null),  // FIRST - think before act
    events: z.array(EventSchema),
});
```

### 3.2 New Retrieval Schema

**`src/extraction/schemas/retrieval-schema.js`** — new file:

```javascript
export const RetrievalResponseSchema = z.object({
    reasoning: z.string().nullable().default(null),  // Think first
    selected: z.array(z.number().int().min(1)),      // 1-indexed memory IDs
});
```

### 3.3 Prompt Rewrite Strategy

**Extraction prompt design principles for medium models:**

1. **System message**: Role + rules + importance scale + examples
2. **User message**: Context (memories, characters) + messages + task instruction
3. **Examples inside `<examples>` XML**: 8 examples, 2 per event_type
   - action: SFW combat + NSFW first sexual encounter
   - revelation: SFW secret + NSFW kink confession
   - emotion_shift: SFW anger shift + NSFW arousal/consent
   - relationship_change: SFW alliance + NSFW dom/sub negotiation
4. **Deduplication rules**: Keep but simplify language
5. **Multilingual anchoring**: Expand — add Japanese terms alongside Russian for broader model coverage (many medium models trained on JP data)
6. **Explicit output format in system message**: Show exact JSON shape matching the Zod schema

**Retrieval prompt design:**

1. **System message**: Role + selection criteria + output format
2. **User message**: Memories list + scene context + instruction
3. **2-3 examples** showing memory selection reasoning

### 3.4 Wire Changes

**`src/extraction/structured.js`** — add:
```javascript
export function getRetrievalJsonSchema() {
    return toJsonSchema(RetrievalResponseSchema, 'MemoryRetrieval');
}
export function parseRetrievalResponse(content) {
    return parseStructuredResponse(content, RetrievalResponseSchema);
}
```

**`src/llm.js`** — change:
```javascript
// callLLM now accepts any jsonSchema, not just extraction
// Import both getExtractionJsonSchema and getRetrievalJsonSchema
// callLLMForRetrieval gains structured output support
```

**`src/retrieval/scoring.js`** — change:
```javascript
// Replace safeParseJSON with parseRetrievalResponse
// Remove safeParseJSON import (if unused elsewhere)
// Use structured: true in callLLMForRetrieval
```

## 4. Data Models / Schema

### EventSchema (updated)
```json
{
  "reasoning": "string | null",
  "events": [{
    "event_type": "action | revelation | emotion_shift | relationship_change",
    "summary": "string (8-25 words, past tense, English)",
    "importance": 1-5,
    "characters_involved": ["string"],
    "witnesses": ["string"],
    "location": "string | null",
    "is_secret": true/false,
    "emotional_impact": {"CharName": "1-3 word emotion"},
    "relationship_impact": {"A->B": "1-3 word change"}
  }]
}
```

### RetrievalResponseSchema (new)
```json
{
  "reasoning": "string | null",
  "selected": [1, 3, 7]
}
```

## 5. Files Changed

| File | Change |
|------|--------|
| `src/extraction/schemas/event-schema.js` | Add EventTypeEnum, add event_type field, reorder reasoning first |
| `src/extraction/schemas/retrieval-schema.js` | **NEW** — RetrievalResponseSchema |
| `src/extraction/structured.js` | Add getRetrievalJsonSchema(), parseRetrievalResponse() |
| `src/prompts.js` | Complete rewrite of both prompt builders |
| `src/llm.js` | Support structured output for any schema (not just extraction) |
| `src/retrieval/scoring.js` | Use structured output + parseRetrievalResponse |
| `tests/extract.test.js` | Update for event_type, reasoning-first order |
| `tests/llm.test.js` | Update for retrieval structured output |
| `tests/llm-executor-structured.test.js` | Update schema expectations |
| `tests/scoring.test.js` | Update for structured retrieval |

## 6. Risks & Edge Cases

1. **Schema field order in JSON Schema**: Not all structured output implementations respect field order. OpenAI does. Others may not. Mitigation: the prompt text also says "write reasoning first", so even if the schema doesn't enforce order, the instruction does.

2. **`event_type` for existing memories**: Old memories in chatMetadata won't have `event_type`. Code already handles this with `m.event_type || 'event'` fallback. No migration needed.

3. **Retrieval structured output may not be available**: Some connection profiles may not support structured output. Mitigation: keep the `safeParseJSON` fallback in the catch block, but try structured first.

4. **8 examples increase system prompt size**: ~2000 extra tokens. User confirmed tokens are free. These models are instruction-dense, examples are the highest-ROI investment.

5. **Multilingual terms**: Adding Japanese alongside Russian assumes the model understands both. DeepSeek and Kimi both have strong CJK training data, so this is safe.
