# Design: Zod v4 + Structured Outputs for Memory Extraction

## 1. Problem Statement

Current OpenVault extraction relies on unstructured JSON responses from LLMs, leading to:
- **JSON hallucinations** - LLMs return malformed JSON, wrap in markdown, or add conversational text
- **Missing/extra fields** - Responses don't match expected schema
- **Fragile parsing** - No validation, silent failures when structure is wrong

## 2. Goals & Non-Goals

**Must do:**
- Integrate Zod v4 for schema definition and validation
- Enable structured output via ConnectionManager's `jsonSchema` parameter
- Handle both strict-structured responses AND fallback markdown-wrapped JSON
- Validate responses client-side before committing to memory events

**Won't do:**
- Modify SillyTavern ConnectionManager code (it already supports what we need)
- Build step for bundling (use CDN ESM import)
- Server-side validation (all client-side)

## 3. Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXTRACTION PIPELINE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Define Zod Schema (NEW)                                                 │
│     ┌─────────────────────────────────────────────────────────────┐         │
│     │ const EventSchema = z.object({                              │         │
│     │   summary: z.string(),                                      │         │
│     │   importance: z.number().int().min(1).max(5),               │         │
│     │   ...                                                       │         │
│     │ })                                                          │         │
│     └─────────────────────────────────────────────────────────────┘         │
│                                    │                                         │
│                                    ▼                                         │
│  2. Convert to JSON Schema (NEW)                                            │
│     ┌─────────────────────────────────────────────────────────────┐         │
│     │ zodToJsonSchema(EventSchema, { target: 'jsonSchema4' })    │         │
│     └─────────────────────────────────────────────────────────────┘         │
│                                    │                                         │
│                                    ▼                                         │
│  3. Call ConnectionManager with jsonSchema (MODIFIED)                       │
│     ┌─────────────────────────────────────────────────────────────┐         │
│     │ sendRequest(                                                │         │
│     │   profileId, messages, maxTokens,                           │         │
│     │   { includePreset: true, ... },                             │         │
│     │   { jsonSchema: { name, strict, value } }  // 5th param     │         │
│     │ )                                                            │         │
│     └─────────────────────────────────────────────────────────────┘         │
│                                    │                                         │
│                                    ▼                                         │
│  4. Parse with Fallback (NEW)                                              │
│     ┌─────────────────────────────────────────────────────────────┐         │
│     │ try {                                                       │         │
│     │   const parsed = JSON.parse(content)                        │         │
│     │   return EventSchema.parse(parsed)                          │         │
│     │ } catch {                                                   │         │
│     │   // Strip markdown, retry, or return partial               │         │
│     │ }                                                            │         │
│     └─────────────────────────────────────────────────────────────┘         │
│                                    │                                         │
│                                    ▼                                         │
│  5. Validated Events → Storage                                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 4. Data Models / Schema

### Zod Schema Definition

```typescript
// src/extraction/schemas/event-schema.js
import { z } from 'https://esm.sh/zod@4';

export const CharacterStateSchema = z.object({
  name: z.string().min(1),
  emotion: z.string().default('neutral'),
  intensity: z.number().int().min(1).max(10).default(5),
});

export const RelationshipImpactSchema = z.record(
  z.string(), // character name
  z.object({
    change: z.enum(['improved', 'worsened', 'unchanged']),
    new_dynamic: z.string().optional(),
  })
);

export const EventSchema = z.object({
  summary: z.string().min(1).describe('Brief summary of what happened'),
  importance: z.number().int().min(1).max(5).default(3),
  emotional_impact: z.record(z.string(), z.string()).optional(),
  relationship_impact: RelationshipImpactSchema.optional(),
  characters_involved: z.array(z.string()).min(1),
  witnesses: z.array(z.string()).default([]),
  location: z.string().nullable().default(null),
  is_secret: z.boolean().default(false),
});

export const ExtractionResponseSchema = z.object({
  events: z.array(EventSchema).min(1),
  reasoning: z.string().nullable().default(null),
});
```

### JSON Schema (Generated)

```javascript
// Generated by z.toJSONSchema(EventSchema, { target: 'jsonSchema4' })
const jsonSchema = {
  name: 'ExtractionResponse',
  strict: true,
  value: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            importance: { type: 'integer', minimum: 1, maximum: 5 },
            // ... other fields
          },
          required: ['summary', 'importance', 'characters_involved'],
        },
      },
      reasoning: { type: ['string', 'null'] },
    },
    required: ['events'],
  },
};
```

## 5. Interface / API Design

### New Module: `src/extraction/structured.js`

```javascript
import { z } from 'https://esm.sh/zod@4';
import { ExtractionResponseSchema, EventSchema } from './schemas/event-schema.js';

/**
 * Convert Zod schema to ConnectionManager jsonSchema format
 */
function toJsonSchema(zodSchema, schemaName) {
  // Zod v4 native toJSONSchema
  const draft = z.toJSONSchema(zodSchema, { target: 'jsonSchema4' });

  return {
    name: schemaName,
    strict: true,
    value: draft,
  };
}

/**
 * Parse LLM response with markdown stripping and Zod validation
 */
function parseStructuredResponse(content, schema = ExtractionResponseSchema) {
  let jsonContent = content.trim();

  // Strip ```json or ``` code blocks
  const fenceMatch = jsonContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    jsonContent = fenceMatch[1].trim();
  }

  // Parse JSON
  let parsed;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}`);
  }

  // Validate with Zod
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Schema validation failed: ${result.error.message}`);
  }

  return result.data;
}

/**
 * Get jsonSchema for ConnectionManager sendRequest
 */
export function getExtractionJsonSchema() {
  return toJsonSchema(ExtractionResponseSchema, 'MemoryExtraction');
}

/**
 * Parse extraction response with full validation
 */
export function parseExtractionResponse(content) {
  return parseStructuredResponse(content, ExtractionResponseSchema);
}

/**
 * Parse single event (for backfill/retry scenarios)
 */
export function parseEvent(content) {
  return parseStructuredResponse(content, EventSchema);
}
```

### Modified: `src/llm.js`

```javascript
import { getExtractionJsonSchema } from './extraction/structured.js';

// Add jsonSchema to 5th parameter
export async function callLLMForExtraction(prompt, options = {}) {
    const { profileSettingKey, maxTokens, errorContext } = LLM_CONFIGS.extraction;
    // ... existing profile resolution ...

    const jsonSchema = options.structured
      ? getExtractionJsonSchema()
      : undefined;

    const result = await deps.connectionManager.sendRequest(
        profileId,
        [{ role: 'user', content: prompt }],
        maxTokens,
        { includePreset: true, includeInstruct: true, stream: false },
        jsonSchema ? { jsonSchema } : {} // 5th param - NEW!
    );

    // ... existing response handling ...
}
```

### Modified: `src/extraction/stages/llm-executor.js`

```javascript
import { parseExtractionResponse } from '../structured.js';

export async function executeLLM(prompt, messages, context, batchId, data) {
    // Enable structured output
    const extractedJson = await callLLMForExtraction(prompt, { structured: true });

    // Parse with Zod validation instead of safeParseJSON
    const validated = parseExtractionResponse(extractedJson);

    // Convert to event objects (add metadata)
    const events = validated.events.map((event, index) => ({
        id: generateId(),
        ...event,
        message_ids: messages.map(m => m.id),
        sequence: Math.min(...messages.map(m => m.id)) * 1000 + index,
        created_at: Date.now(),
        batch_id: batchId,
        // ... existing enrichment ...
    }));

    // ... existing tracking ...
    return events;
}
```

## 6. Risks & Edge Cases

### Risk 1: CDN Import Reliability
**Problem:** esm.sh could be down, blocked, or serve incorrect versions
**Mitigation:**
- Pin specific version in URL (`@4` not `@latest`)
- Consider local fallback or version pinning

### Risk 2: ConnectionManager Silent Failure
**Problem:** Per docs, structured outputs fail silently on unsupported models, returning `'{}'`
**Mitigation:**
- Check for empty object response
- Log warning and fall back to unstructured parsing
- Allow user to disable structured output per profile

### Risk 3: Markdown Stripping Needed Anyway
**Problem:** Even with `jsonSchema`, some models still wrap in markdown
**Mitigation:**
- Always run markdown stripper before JSON.parse
- Order: strip → parse → validate

### Risk 4: Zod Validation Too Strict
**Problem:** Valid LLM responses rejected due to minor schema mismatches
**Mitigation:**
- Use `.optional()` and `.default()` liberally
- Log validation errors for debugging
- Consider `.passthrough()` to allow extra fields

### Risk 5: Browser CSP Blocking CDN
**Problem:** Some environments block esm.sh
**Mitigation:**
- Document requirement for users
- Consider alternative CDN (skypack.dev)

## 7. Implementation Steps

1. **Create schema module** (`src/extraction/schemas/`)
   - Define Zod schemas for events
   - Export JSON schema converter

2. **Create structured parser** (`src/extraction/structured.js`)
   - Import Zod from esm.sh
   - Implement toJsonSchema() converter
   - Implement parseStructuredResponse() with markdown stripping

3. **Modify llm.js**
   - Add `structured` option to callLLMForExtraction()
   - Pass jsonSchema to 5th parameter of sendRequest()

4. **Modify llm-executor.js**
   - Use parseExtractionResponse() instead of safeParseJSON()
   - Handle validation errors gracefully

5. **Update tests**
   - Mock Zod module in tests
   - Add tests for structured parsing
   - Test markdown stripping edge cases

6. **Settings UI** (optional)
   - Add toggle for "Use Structured Output" per profile
   - Default: enabled for OpenAI-compatible, disabled for others

## 8. Validation Checklist

- [ ] Schema definitions match current event structure
- [ ] JSON Schema output matches ConnectionManager expected format
- [ ] Markdown stripping handles all common formats
- [ ] Validation errors are logged with helpful messages
- [ ] Fallback to unstructured parsing works when jsonSchema fails
- [ ] Tests pass with mocked Zod
- [ ] CDN import works in browser environment
