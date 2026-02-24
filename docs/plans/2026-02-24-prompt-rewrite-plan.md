# Implementation Plan - Prompt Rewrite for Medium Non-Reasoning Models

> **Reference:** `docs/designs/2026-02-24-prompt-rewrite-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Add `event_type` to EventSchema and reorder reasoning-first

**Goal:** Fix the `event_type` ghost field bug and make the LLM reason before committing to events.

**Step 1: Write the Failing Test**
- File: `tests/extraction/structured.test.js`
- Add tests that assert `event_type` is present in parsed output and `reasoning` comes before `events` in schema properties:

```javascript
// Inside describe('parseExtractionResponse')
it('parses event_type from response', () => {
    const json = JSON.stringify({
        reasoning: 'Test reasoning',
        events: [
            { event_type: 'action', summary: 'Alice attacked Bob', importance: 3, characters_involved: ['Alice'] }
        ],
    });
    const result = parseExtractionResponse(json);
    expect(result.events[0].event_type).toBe('action');
});

it('rejects invalid event_type', () => {
    const json = JSON.stringify({
        reasoning: null,
        events: [
            { event_type: 'invalid_type', summary: 'Test', importance: 3, characters_involved: [] }
        ],
    });
    expect(() => parseExtractionResponse(json)).toThrow('Schema validation failed');
});

it('accepts all four valid event types', () => {
    for (const type of ['action', 'revelation', 'emotion_shift', 'relationship_change']) {
        const json = JSON.stringify({
            reasoning: null,
            events: [{ event_type: type, summary: `Test ${type}`, importance: 3, characters_involved: [] }],
        });
        const result = parseExtractionResponse(json);
        expect(result.events[0].event_type).toBe(type);
    }
});

// Inside describe('getExtractionJsonSchema')
it('has reasoning as first property in schema', () => {
    const schema = getExtractionJsonSchema();
    const propKeys = Object.keys(schema.value.properties);
    expect(propKeys[0]).toBe('reasoning');
    expect(propKeys[1]).toBe('events');
});

it('includes event_type enum in event items schema', () => {
    const schema = getExtractionJsonSchema();
    const eventItemProps = schema.value.properties.events.items.properties;
    expect(eventItemProps).toHaveProperty('event_type');
});
```

**Step 2: Run Test (Red)**
- Command: `npm test tests/extraction/structured.test.js`
- Expect: Failures — `event_type` not in schema, property order wrong.

**Step 3: Implementation (Green)**
- File: `src/extraction/schemas/event-schema.js`
- Changes:
  1. Add `EventTypeEnum`:
     ```javascript
     export const EventTypeEnum = z.enum(['action', 'revelation', 'emotion_shift', 'relationship_change']);
     ```
  2. Add `event_type: EventTypeEnum` as the first field in `EventSchema`.
  3. Reorder `ExtractionResponseSchema` to `{ reasoning, events }`.

**Step 4: Verify (Green)**
- Command: `npm test tests/extraction/structured.test.js`
- Expect: PASS

**Step 5: Fix Downstream Test Breakage**
- Files to update (tests that build mock JSON with `events` first or missing `event_type`):
  - `tests/extract.test.js` — All `JSON.stringify({ events: [...], reasoning: ... })` mocks need `event_type` added to event objects. The field order in the mock JSON doesn't matter for `JSON.parse`, but events must now include `event_type`.
  - `tests/extraction/stages/llm-executor-structured.test.js` — Same: add `event_type` to all mock event objects.
  - `tests/llm-structured.test.js` — Update jsonSchema assertions: `schema.value.properties` should now have `reasoning` first, `events` should include `event_type` in items.

**Step 6: Full Verify**
- Command: `npm test`
- Expect: ALL tests pass.

**Step 7: Git Commit**
- Command: `git add . && git commit -m "fix: add event_type to EventSchema, reorder reasoning-first"`

---

## Task 2: Create RetrievalResponseSchema with Zod structured output

**Goal:** Add a Zod schema for smart retrieval responses and wire it through `structured.js`.

**Step 1: Write the Failing Test**
- File: `tests/extraction/structured.test.js`
- Add new describe block:

```javascript
import {
    getExtractionJsonSchema,
    getRetrievalJsonSchema,
    parseExtractionResponse,
    parseRetrievalResponse,
    parseEvent,
} from '../../src/extraction/structured.js';

describe('getRetrievalJsonSchema', () => {
    it('returns ConnectionManager-compatible jsonSchema', () => {
        const schema = getRetrievalJsonSchema();
        expect(schema).toMatchObject({
            name: 'MemoryRetrieval',
            strict: true,
            value: expect.any(Object),
        });
        expect(schema.value).toHaveProperty('type', 'object');
        expect(schema.value.properties).toHaveProperty('reasoning');
        expect(schema.value.properties).toHaveProperty('selected');
    });

    it('has reasoning as first property', () => {
        const schema = getRetrievalJsonSchema();
        const propKeys = Object.keys(schema.value.properties);
        expect(propKeys[0]).toBe('reasoning');
    });

    it('selected is array of positive integers', () => {
        const schema = getRetrievalJsonSchema();
        const selectedProp = schema.value.properties.selected;
        expect(selectedProp.type).toBe('array');
    });
});

describe('parseRetrievalResponse', () => {
    it('parses valid retrieval response', () => {
        const json = JSON.stringify({ reasoning: 'Chose based on scene', selected: [1, 3, 5] });
        const result = parseRetrievalResponse(json);
        expect(result.selected).toEqual([1, 3, 5]);
        expect(result.reasoning).toBe('Chose based on scene');
    });

    it('handles null reasoning', () => {
        const json = JSON.stringify({ reasoning: null, selected: [2] });
        const result = parseRetrievalResponse(json);
        expect(result.reasoning).toBeNull();
        expect(result.selected).toEqual([2]);
    });

    it('handles empty selected array', () => {
        const json = JSON.stringify({ reasoning: 'Nothing relevant', selected: [] });
        const result = parseRetrievalResponse(json);
        expect(result.selected).toEqual([]);
    });

    it('strips markdown before parsing', () => {
        const content = '```json\n{"reasoning": null, "selected": [1]}\n```';
        const result = parseRetrievalResponse(content);
        expect(result.selected).toEqual([1]);
    });

    it('throws on invalid JSON', () => {
        expect(() => parseRetrievalResponse('not json')).toThrow('JSON parse failed');
    });

    it('throws on missing selected field', () => {
        const json = JSON.stringify({ reasoning: 'test' });
        expect(() => parseRetrievalResponse(json)).toThrow('Schema validation failed');
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test tests/extraction/structured.test.js`
- Expect: Import errors — `getRetrievalJsonSchema` and `parseRetrievalResponse` don't exist yet.

**Step 3: Implementation (Green)**
- File: `src/extraction/schemas/retrieval-schema.js` (NEW)
  ```javascript
  import { z } from 'https://esm.sh/zod@4';

  /**
   * Schema for smart retrieval LLM response
   * Reasoning first to enable chain-of-thought before selection.
   */
  export const RetrievalResponseSchema = z.object({
      reasoning: z.string().nullable().default(null),
      selected: z.array(z.number().int().min(1)),
  });
  ```

- File: `src/extraction/structured.js`
  - Add import: `import { RetrievalResponseSchema } from './schemas/retrieval-schema.js';`
  - Add two new exports:
    ```javascript
    export function getRetrievalJsonSchema() {
        return toJsonSchema(RetrievalResponseSchema, 'MemoryRetrieval');
    }

    export function parseRetrievalResponse(content) {
        return parseStructuredResponse(content, RetrievalResponseSchema);
    }
    ```

**Step 4: Verify (Green)**
- Command: `npm test tests/extraction/structured.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add RetrievalResponseSchema with Zod structured output"`

---

## Task 3: Wire retrieval structured output through `llm.js`

**Goal:** Make `callLLM` accept any JSON schema (not just extraction) and enable structured output for retrieval.

**Step 1: Write the Failing Test**
- File: `tests/llm-structured.test.js`
- Add new test:

```javascript
import { callLLMForRetrieval } from '../src/llm.js';

// (inside existing describe or new one)
describe('callLLMForRetrieval with structured output', () => {
    it('passes retrieval jsonSchema when structured option is true', async () => {
        await callLLMForRetrieval(testMessages, { structured: true });

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        expect(callArgs[4]).toHaveProperty('jsonSchema');
        expect(callArgs[4].jsonSchema).toMatchObject({
            name: 'MemoryRetrieval',
            strict: true,
        });
    });

    it('does not pass jsonSchema when structured option is false for retrieval', async () => {
        await callLLMForRetrieval(testMessages, { structured: false });

        const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
        expect(callArgs[4]).toEqual({});
    });
});
```

- File: `tests/llm.test.js`
- In the `callLLMForRetrieval` describe block, add:

```javascript
it('passes structured option through', async () => {
    await callLLMForRetrieval(testMessages, { structured: true });

    const callArgs = mockConnectionManager.sendRequest.mock.calls[0];
    expect(callArgs[4]).toHaveProperty('jsonSchema');
    expect(callArgs[4].jsonSchema.name).toBe('MemoryRetrieval');
});
```

**Step 2: Run Test (Red)**
- Command: `npm test tests/llm-structured.test.js tests/llm.test.js`
- Expect: Failure — retrieval doesn't use structured output yet.

**Step 3: Implementation (Green)**
- File: `src/llm.js`
- Changes:
  1. Add import: `import { getRetrievalJsonSchema } from './extraction/structured.js';`
  2. Rename existing import for clarity (both now imported):
     ```javascript
     import { getExtractionJsonSchema, getRetrievalJsonSchema } from './extraction/structured.js';
     ```
  3. Change `callLLM` to accept a `getJsonSchema` function per config instead of hardcoding extraction:
     ```javascript
     // In LLM_CONFIGS:
     extraction: {
         profileSettingKey: 'extractionProfile',
         maxTokens: 4000,
         errorContext: 'Extraction',
         getJsonSchema: getExtractionJsonSchema,
     },
     retrieval: {
         profileSettingKey: 'retrievalProfile',
         maxTokens: 4000,
         errorContext: 'Smart retrieval',
         getJsonSchema: getRetrievalJsonSchema,
     },

     // In callLLM:
     const { profileSettingKey, maxTokens, errorContext, getJsonSchema } = config;
     // ...
     const jsonSchema = options.structured && getJsonSchema ? getJsonSchema() : undefined;
     ```

**Step 4: Verify (Green)**
- Command: `npm test tests/llm-structured.test.js tests/llm.test.js`
- Expect: PASS

**Step 5: Full Verify**
- Command: `npm test`
- Expect: ALL tests pass.

**Step 6: Git Commit**
- Command: `git add . && git commit -m "feat: wire retrieval structured output through llm.js"`

---

## Task 4: Update `scoring.js` to use structured retrieval output

**Goal:** Replace `safeParseJSON` with `parseRetrievalResponse` and pass `{ structured: true }` to `callLLMForRetrieval`.

**Step 1: Write the Failing Test**
- File: `tests/scoring.test.js`
- Modify the `selectRelevantMemoriesSmart` tests:
  - Change `callLLMForRetrieval.mockResolvedValue('{"selected": [1, 2, 3]}')` to return values that match the new structured format (these should already work since JSON.stringify produces valid JSON, but verify `{ structured: true }` is passed).
  - Add assertion test:

```javascript
it('calls LLM with structured output option', async () => {
    const memories = Array.from({ length: 5 }, (_, i) => ({
        id: `${i}`,
        summary: `Memory ${i}`,
        importance: 3,
    }));

    callLLMForRetrieval.mockResolvedValue(JSON.stringify({ reasoning: null, selected: [1, 2, 3] }));

    await selectRelevantMemoriesSmart(memories, makeCtx({ recentContext: 'recent context' }), 3);

    expect(callLLMForRetrieval).toHaveBeenCalledWith(
        expect.any(Array),  // messages array
        { structured: true }
    );
});
```

**Step 2: Run Test (Red)**
- Command: `npm test tests/scoring.test.js`
- Expect: Failure — `callLLMForRetrieval` is not called with `{ structured: true }` yet.

**Step 3: Implementation (Green)**
- File: `src/retrieval/scoring.js`
- Changes:
  1. Replace import: `safeParseJSON` → `parseRetrievalResponse` from `../extraction/structured.js`
     ```javascript
     import { parseRetrievalResponse } from '../extraction/structured.js';
     ```
  2. Remove `safeParseJSON` from the utils import (check if used elsewhere in this file first — it's used only for retrieval parsing).
  3. In `selectRelevantMemoriesSmart`:
     - Change: `const response = await callLLMForRetrieval(prompt);` → `const response = await callLLMForRetrieval(prompt, { structured: true });`
     - Change: `const parsed = safeParseJSON(response);` → `const parsed = parseRetrievalResponse(response);`
     - The error handling already has a try/catch that falls back to simple mode. `parseRetrievalResponse` throws on failure, so the catch block handles it. Remove the null-check after parse since `parseRetrievalResponse` throws instead of returning null.
     - Keep the `selectedIndices` empty check and invalid index filtering as-is.

**Step 4: Verify (Green)**
- Command: `npm test tests/scoring.test.js`
- Expect: PASS

**Step 5: Update scoring test mocks**
- The `safeParseJSON` mock in `tests/scoring.test.js` may no longer be needed. Check if it's still imported — if `scoring.js` no longer imports it, the mock can be removed from the `vi.mock('../src/utils.js')` block. But keep it if other code paths still use it.
- The mock for `callLLMForRetrieval.mockResolvedValue('{"selected": [1, 3]}')` should still work since `parseRetrievalResponse` handles raw JSON strings.
- Update the "falls back on invalid JSON" test: `callLLMForRetrieval.mockResolvedValue('not valid json')` — this now throws `JSON parse failed` inside `parseRetrievalResponse`, caught by the try/catch, triggering fallback. Test should still pass.

**Step 6: Full Verify**
- Command: `npm test`
- Expect: ALL tests pass.

**Step 7: Git Commit**
- Command: `git add . && git commit -m "refactor: use structured output for smart retrieval, remove safeParseJSON"`

---

## Task 5: Rewrite extraction prompt

**Goal:** Complete rewrite of `buildExtractionPrompt` with 8 few-shot examples, multilingual anchoring, optimized language for medium models.

**Step 1: Write the Failing Test**
- File: `tests/extraction/structured.test.js` (or a new `tests/prompts.test.js`)
- Add prompt content assertions:

```javascript
import { buildExtractionPrompt } from '../../src/prompts.js';

describe('buildExtractionPrompt', () => {
    const baseArgs = {
        messages: '[Alice]: Hello\n[Bob]: Hi there',
        names: { char: 'Alice', user: 'Bob' },
        context: { memories: [], charDesc: '', personaDesc: '' },
    };

    it('returns system and user message array', () => {
        const result = buildExtractionPrompt(baseArgs);
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
    });

    it('system prompt contains all four event types', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toContain('action');
        expect(sys).toContain('revelation');
        expect(sys).toContain('emotion_shift');
        expect(sys).toContain('relationship_change');
    });

    it('system prompt contains examples section', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toContain('<examples>');
        expect(sys).toContain('</examples>');
    });

    it('system prompt contains at least 6 examples', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        const exampleCount = (sys.match(/<example /g) || []).length;
        expect(exampleCount).toBeGreaterThanOrEqual(6);
    });

    it('system prompt contains multilingual anchoring terms', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        // Russian terms
        expect(sys).toContain('эротика');
        // Should contain importance scale
        expect(sys).toContain('1');
        expect(sys).toContain('5');
    });

    it('system prompt instructs reasoning-first', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toMatch(/reasoning.*first|think.*before|reasoning.*field.*before/i);
    });

    it('user prompt contains messages in XML tags', () => {
        const result = buildExtractionPrompt(baseArgs);
        const usr = result[1].content;
        expect(usr).toContain('<messages>');
        expect(usr).toContain('[Alice]: Hello');
    });

    it('user prompt includes established memories when provided', () => {
        const args = {
            ...baseArgs,
            context: {
                memories: [
                    { event_type: 'action', importance: 3, summary: 'Alice waved at Bob', sequence: 1 }
                ],
                charDesc: '',
                personaDesc: '',
            },
        };
        const result = buildExtractionPrompt(args);
        const usr = result[1].content;
        expect(usr).toContain('established_memories');
        expect(usr).toContain('Alice waved at Bob');
    });

    it('user prompt includes character descriptions when provided', () => {
        const args = {
            ...baseArgs,
            context: {
                memories: [],
                charDesc: 'A brave warrior',
                personaDesc: 'A curious traveler',
            },
        };
        const result = buildExtractionPrompt(args);
        const usr = result[1].content;
        expect(usr).toContain('A brave warrior');
        expect(usr).toContain('A curious traveler');
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test tests/prompts.test.js` (or wherever placed)
- Expect: Failures — current prompt lacks examples, multilingual terms may differ.

**Step 3: Implementation (Green)**
- File: `src/prompts.js`
- Rewrite `buildExtractionPrompt` with:
  1. **System message** containing:
     - Role definition with multilingual anchoring (Russian + Japanese terms)
     - Core directives (detail retention, deduplication — simplified for medium models)
     - Event type definitions
     - Importance scale (1-5, with forced ratings for NSFW milestones)
     - Thinking process instructions ("Write your analysis in the `reasoning` field FIRST, then produce events")
     - 8 few-shot examples inside `<examples>` XML:
       - `<example type="action_combat">` — SFW sword fight
       - `<example type="action_intimate">` — NSFW first sexual encounter
       - `<example type="revelation_secret">` — SFW confession of secret
       - `<example type="revelation_desire">` — NSFW kink/desire confession
       - `<example type="emotion_shift_anger">` — SFW anger/betrayal shift
       - `<example type="emotion_shift_arousal">` — NSFW arousal/consent shift
       - `<example type="relationship_change_alliance">` — SFW trust/alliance formed
       - `<example type="relationship_change_dynamic">` — NSFW dom/sub negotiation
     - Each example shows the exact JSON shape matching the Zod schema (with `reasoning` first, `event_type` included)
     - One "deduplication example" showing empty `events: []` when act continues
  2. **User message** containing:
     - `<context>` with established memories and character descriptions (reuse existing formatters)
     - `<messages>` with the conversation
     - Clear instruction to analyze and produce JSON

**Step 4: Verify (Green)**
- Command: `npm test tests/prompts.test.js`
- Expect: PASS

**Step 5: Full Verify**
- Command: `npm test`
- Expect: ALL tests pass (other tests mock `buildExtractionPrompt`, so they're unaffected).

**Step 6: Git Commit**
- Command: `git add . && git commit -m "feat: rewrite extraction prompt with 8 examples, multilingual anchoring"`

---

## Task 6: Rewrite retrieval prompt

**Goal:** Rewrite `buildSmartRetrievalPrompt` with examples and structured output format guidance.

**Step 1: Write the Failing Test**
- File: `tests/prompts.test.js` (add to existing or create)

```javascript
import { buildSmartRetrievalPrompt } from '../../src/prompts.js';

describe('buildSmartRetrievalPrompt', () => {
    it('returns system and user message array', () => {
        const result = buildSmartRetrievalPrompt('scene text', '1. [action] Memory 1', 'Alice', 5);
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
    });

    it('system prompt contains selection criteria', () => {
        const result = buildSmartRetrievalPrompt('scene', 'memories', 'Alice', 5);
        const sys = result[0].content;
        expect(sys).toContain('selection_criteria');
    });

    it('system prompt contains examples', () => {
        const result = buildSmartRetrievalPrompt('scene', 'memories', 'Alice', 5);
        const sys = result[0].content;
        expect(sys).toContain('<examples>');
    });

    it('system prompt instructs reasoning-first output', () => {
        const result = buildSmartRetrievalPrompt('scene', 'memories', 'Alice', 5);
        const sys = result[0].content;
        expect(sys).toMatch(/reasoning.*first|think.*before/i);
    });

    it('user prompt contains character name', () => {
        const result = buildSmartRetrievalPrompt('scene', 'memories', 'Alice', 5);
        const usr = result[1].content;
        expect(usr).toContain('Alice');
    });

    it('user prompt contains memory list', () => {
        const list = '1. [action] [★★★] Alice fought\n2. [revelation] [★★★★★] Bob confessed';
        const result = buildSmartRetrievalPrompt('scene', list, 'Alice', 3);
        const usr = result[1].content;
        expect(usr).toContain('Alice fought');
        expect(usr).toContain('Bob confessed');
    });

    it('user prompt contains limit', () => {
        const result = buildSmartRetrievalPrompt('scene', 'memories', 'Alice', 7);
        const usr = result[1].content;
        expect(usr).toContain('7');
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test tests/prompts.test.js`
- Expect: Some failures — current retrieval prompt may lack examples section.

**Step 3: Implementation (Green)**
- File: `src/prompts.js`
- Rewrite `buildSmartRetrievalPrompt` with:
  1. **System message** containing:
     - Role definition
     - Selection criteria (relevance to current act, importance weight, history/boundaries, emotional echo)
     - Output format matching `RetrievalResponseSchema` (reasoning first, then selected array)
     - 2-3 examples:
       - Example 1: Intimate scene → selects past intimacy memories, kink history
       - Example 2: Emotional conversation → selects past revelations, relationship milestones
       - Example 3: Tense confrontation → selects past betrayals, arguments
  2. **User message** containing:
     - `<memories>` list
     - `<character>` name
     - `<scene>` context
     - Instruction with limit

**Step 4: Verify (Green)**
- Command: `npm test tests/prompts.test.js`
- Expect: PASS

**Step 5: Full Verify**
- Command: `npm test`
- Expect: ALL tests pass.

**Step 6: Git Commit**
- Command: `git add . && git commit -m "feat: rewrite retrieval prompt with examples, structured output format"`

---

## Task 7: Final integration verification

**Goal:** Run full test suite and verify nothing is broken across all tasks.

**Step 1: Run full test suite**
- Command: `npm test`
- Expect: ALL tests pass.

**Step 2: Run linter**
- Command: `npm run lint`
- Expect: No errors.

**Step 3: Verify no unused imports**
- Check `src/retrieval/scoring.js` — verify `safeParseJSON` is no longer imported (unless used elsewhere in the file).
- Check `src/llm.js` — verify old `getExtractionJsonSchema`-only import is replaced with combined import.

**Step 4: Git Commit (if any fixes needed)**
- Command: `git add . && git commit -m "chore: final cleanup after prompt rewrite"`
