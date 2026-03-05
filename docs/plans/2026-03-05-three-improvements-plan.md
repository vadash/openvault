# Implementation Plan - Three Improvements (Memory Creep, Split Extraction, Graph Merging)

> **Reference:** `tmp/task.md` (review feedback document)
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Fix Importance-5 Memory Creep (math.js + formatting.js)

**Goal:** Replace hard floor with slow decay; cap "The Story So Far" bucket at 50% of memory token budget.

### Step 1: Write Failing Test — math.js floor removal

- File: `tests/math.test.js`
- Add to existing `describe('math.js - alpha-blend scoring')`:
```javascript
it('importance-5 memory uses soft floor of 1.0 instead of hard IMPORTANCE_5_FLOOR', () => {
    const memory = { importance: 5, message_ids: [10], embedding: null };
    const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
    const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };
    // At distance 990 from chat position 1000, the natural decay should be well below 5
    const result = calculateScore(memory, null, 1000, constants, settings, 0);
    // With soft floor: baseAfterFloor should be >= 1.0 but NOT >= 5.0
    expect(result.baseAfterFloor).toBeGreaterThanOrEqual(1.0);
    expect(result.baseAfterFloor).toBeLessThan(5.0);
});

it('importance-5 memory still decays naturally when above soft floor', () => {
    const memory = { importance: 5, message_ids: [95], embedding: null };
    const constants = { BASE_LAMBDA: 0.05, IMPORTANCE_5_FLOOR: 5 };
    const settings = { vectorSimilarityThreshold: 0.5, alpha: 0.7, combinedBoostWeight: 15 };
    // At distance 5, natural decay is very small: 5 * e^(-0.002*5) ≈ 4.95
    const result = calculateScore(memory, null, 100, constants, settings, 0);
    // Should use natural value, no floor needed
    expect(result.baseAfterFloor).toBeCloseTo(result.base, 2);
});
```

### Step 2: Run Test (Red)

- Command: `npm test tests/math.test.js`
- Expect: First test fails because `baseAfterFloor` is 5.0 (hard floor), not < 5.0.

### Step 3: Implementation (Green)

- File: `src/retrieval/math.js`
- Line ~202 (the `IMPORTANCE_5_FLOOR` block). Replace:
```javascript
    // Importance-5 floor: never drops below minimum score
    let baseAfterFloor = base;
    if (importance === 5) {
        baseAfterFloor = Math.max(base, constants.IMPORTANCE_5_FLOOR);
    }
```
- With:
```javascript
    // Importance-5 soft floor: never drops below 1.0 (baseline relevant)
    let baseAfterFloor = base;
    if (importance === 5) {
        baseAfterFloor = Math.max(base, 1.0);
    }
```

### Step 4: Verify (Green)

- Command: `npm test tests/math.test.js`
- Expect: PASS

### Step 5: Write Failing Test — formatting.js old bucket cap

- File: `tests/formatting.test.js`
- Add new describe block:
```javascript
describe('old bucket 50% cap', () => {
    it('caps old bucket memories at 50% of available token budget', () => {
        // Create 20 old memories (~10 tokens each = ~200 tokens) and 5 recent (~50 tokens)
        const oldMemories = Array.from({ length: 20 }, (_, i) => ({
            id: `old_${i}`,
            summary: `Old event number ${i} happened long ago in the story`,
            importance: 3,
            message_ids: [i + 1],
            sequence: (i + 1) * 1000,
        }));
        const recentMemories = Array.from({ length: 5 }, (_, i) => ({
            id: `recent_${i}`,
            summary: `Recent event ${i} just happened in the current scene`,
            importance: 3,
            message_ids: [4950 + i],
            sequence: (4950 + i) * 1000,
        }));

        const allMemories = [...oldMemories, ...recentMemories];
        // Use a very small budget that can't fit all old memories
        const result = formatContextForInjection(allMemories, [], null, 'Test', 200, 5000);

        // Count how many old memories appear vs recent
        const oldCount = oldMemories.filter(m => result.includes(m.summary)).length;
        const recentCount = recentMemories.filter(m => result.includes(m.summary)).length;

        // Old memories should NOT consume everything — recent should still appear
        expect(recentCount).toBeGreaterThan(0);
        // Old should be capped (not all 20 should fit if budget is tight)
        expect(oldCount).toBeLessThan(20);
    });
});
```

### Step 6: Run Test (Red)

- Command: `npm test tests/formatting.test.js`
- Expect: Fail — current code iterates `[...old, ...mid, ...recent]` linearly, so old memories consume all budget.

### Step 7: Implementation (Green)

- File: `src/retrieval/formatting.js`
- Replace the token truncation block (lines ~168-183). Find:
```javascript
    const availableForMemories = tokenBudget - overheadTokens;

    // Truncate memories to fit budget (across all buckets)
    const allMemories = [...buckets.old, ...buckets.mid, ...buckets.recent];
    let currentTokens = 0;
    const fittingMemoryIds = new Set();

    for (const memory of allMemories) {
        const memoryTokens = estimateTokens(memory.summary || '') + 5;
        if (currentTokens + memoryTokens <= availableForMemories) {
            fittingMemoryIds.add(memory.id);
            currentTokens += memoryTokens;
        } else {
            break;
        }
    }
```
- Replace with:
```javascript
    const availableForMemories = tokenBudget - overheadTokens;
    const fittingMemoryIds = new Set();

    // Cap "The Story So Far" (old) bucket at 50% of memory budget
    const oldBudget = availableForMemories * 0.5;
    let oldTokens = 0;
    for (const memory of buckets.old) {
        const memoryTokens = estimateTokens(memory.summary || '') + 5;
        if (oldTokens + memoryTokens <= oldBudget) {
            fittingMemoryIds.add(memory.id);
            oldTokens += memoryTokens;
        } else {
            break;
        }
    }

    // Mid + Recent get remaining budget (including unused old budget)
    const remainingBudget = availableForMemories - oldTokens;
    let otherTokens = 0;
    for (const memory of [...buckets.mid, ...buckets.recent]) {
        const memoryTokens = estimateTokens(memory.summary || '') + 5;
        if (otherTokens + memoryTokens <= remainingBudget) {
            fittingMemoryIds.add(memory.id);
            otherTokens += memoryTokens;
        } else {
            break;
        }
    }
```

### Step 8: Verify (Green)

- Command: `npm test tests/formatting.test.js`
- Expect: PASS

### Step 9: Run full test suite

- Command: `npm test`
- Expect: All tests pass (existing tests use constants.IMPORTANCE_5_FLOOR but the logic change should not break them since old tests asserted `>= IMPORTANCE_5_FLOOR` only at short distances where natural decay was already above the floor).

### Step 10: Git Commit

- Command: `git add . && git commit -m "feat: soft floor for importance-5 memories + 50% old bucket cap"`

---

## Task 2: Fix Over-Aggressive Graph Merging (graph.js)

**Goal:** Include entity description in the embedding used for semantic merge to prevent false positives like "Cotton rope" → "White cotton panties."

### Step 1: Write Failing Test

- File: `tests/graph/graph.test.js`
- Add to existing test file. The mock for `getDocumentEmbedding` is already set up.
```javascript
import { getDocumentEmbedding } from '../../src/embeddings.js';

describe('mergeOrInsertEntity - description in embedding', () => {
    let graphData;

    beforeEach(() => {
        graphData = createEmptyGraph();
        vi.mocked(getDocumentEmbedding).mockReset();
    });

    it('passes type, name, AND description to getDocumentEmbedding', async () => {
        vi.mocked(getDocumentEmbedding).mockResolvedValue([1, 0, 0]);

        await mergeOrInsertEntity(graphData, 'Cotton Rope', 'OBJECT', 'A rough hemp rope used for bondage', 3, {});

        expect(getDocumentEmbedding).toHaveBeenCalledWith('OBJECT: Cotton Rope - A rough hemp rope used for bondage');
    });
});
```

### Step 2: Run Test (Red)

- Command: `npm test tests/graph/graph.test.js`
- Expect: Fail — currently calls `getDocumentEmbedding('OBJECT: Cotton Rope')` without description.

### Step 3: Implementation (Green)

- File: `src/graph/graph.js`
- In `mergeOrInsertEntity` (~line 240), change:
```javascript
        newEmbedding = await getDocumentEmbedding(`${type}: ${name}`);
```
- To:
```javascript
        newEmbedding = await getDocumentEmbedding(`${type}: ${name} - ${description}`);
```

- In `consolidateGraph` (~line 368), change:
```javascript
                node.embedding = await getDocumentEmbedding(`${node.type}: ${node.name}`);
```
- To:
```javascript
                node.embedding = await getDocumentEmbedding(`${node.type}: ${node.name} - ${node.description}`);
```

### Step 4: Verify (Green)

- Command: `npm test tests/graph/graph.test.js`
- Expect: PASS

### Step 5: Git Commit

- Command: `git add . && git commit -m "feat: include entity description in merge embeddings to reduce false merges"`

---

## Task 3: Split Extraction into Two LLM Calls

**Goal:** Split the single extraction call into Stage A (events) and Stage B (entities/relationships) to reduce LLM cognitive load and JSON failures.

### Step 3.1: New Schemas in structured.js

#### Step 1: Write Failing Test — new schemas exist

- File: `tests/extraction/structured.test.js`
```javascript
import {
    getEventExtractionJsonSchema,
    getGraphExtractionJsonSchema,
    parseEventExtractionResponse,
    parseGraphExtractionResponse,
} from '../../src/extraction/structured.js';

describe('getEventExtractionJsonSchema', () => {
    it('returns schema with reasoning and events only', () => {
        const schema = getEventExtractionJsonSchema();
        expect(schema.name).toBe('EventExtraction');
        expect(schema.value.properties).toHaveProperty('events');
        expect(schema.value.properties).toHaveProperty('reasoning');
        expect(schema.value.properties).not.toHaveProperty('entities');
        expect(schema.value.properties).not.toHaveProperty('relationships');
    });
});

describe('getGraphExtractionJsonSchema', () => {
    it('returns schema with entities and relationships only', () => {
        const schema = getGraphExtractionJsonSchema();
        expect(schema.name).toBe('GraphExtraction');
        expect(schema.value.properties).toHaveProperty('entities');
        expect(schema.value.properties).toHaveProperty('relationships');
        expect(schema.value.properties).not.toHaveProperty('events');
    });
});

describe('parseEventExtractionResponse', () => {
    it('parses valid event extraction JSON', () => {
        const json = JSON.stringify({
            reasoning: 'test reasoning',
            events: [{
                summary: 'A significant event happened in the story today',
                importance: 3,
                characters_involved: ['Alice'],
                witnesses: [],
                location: null,
                is_secret: false,
                emotional_impact: {},
                relationship_impact: {},
            }],
        });
        const result = parseEventExtractionResponse(json);
        expect(result.events).toHaveLength(1);
        expect(result.reasoning).toBe('test reasoning');
    });
});

describe('parseGraphExtractionResponse', () => {
    it('parses valid graph extraction JSON', () => {
        const json = JSON.stringify({
            entities: [{ name: 'Alice', type: 'PERSON', description: 'A character' }],
            relationships: [{ source: 'Alice', target: 'Bob', description: 'Friends' }],
        });
        const result = parseGraphExtractionResponse(json);
        expect(result.entities).toHaveLength(1);
        expect(result.relationships).toHaveLength(1);
    });
});
```

#### Step 2: Run Test (Red)

- Command: `npm test tests/extraction/structured.test.js`
- Expect: Fail — functions don't exist yet.

#### Step 3: Implementation (Green)

- File: `src/extraction/structured.js`
- Add these new schemas and functions after the existing `ExtractionResponseSchema`:

```javascript
/**
 * Schema for Stage 1: Event extraction only
 */
export const EventExtractionSchema = z.object({
    reasoning: z.string().nullable().default(null),
    events: z.array(EventSchema),
});

/**
 * Schema for Stage 2: Graph extraction only
 */
export const GraphExtractionSchema = z.object({
    entities: z.array(EntitySchema).default([]),
    relationships: z.array(RelationshipSchema).default([]),
});

export function getEventExtractionJsonSchema() {
    return toJsonSchema(EventExtractionSchema, 'EventExtraction');
}

export function getGraphExtractionJsonSchema() {
    return toJsonSchema(GraphExtractionSchema, 'GraphExtraction');
}

export function parseEventExtractionResponse(content) {
    const cleanedContent = stripThinkingTags(content);
    const jsonContent = stripMarkdown(cleanedContent);

    let parsed;
    try {
        const repaired = jsonrepair(jsonContent);
        parsed = JSON.parse(repaired);
    } catch (e) {
        throw new Error(`JSON parse failed: ${e.message}`);
    }

    // Array recovery
    if (Array.isArray(parsed)) {
        parsed = { events: parsed, reasoning: null };
    }

    const result = EventExtractionSchema.safeParse(parsed);
    if (!result.success) {
        throw new Error(`Schema validation failed: ${result.error.message}`);
    }
    return result.data;
}

export function parseGraphExtractionResponse(content) {
    const cleanedContent = stripThinkingTags(content);
    const jsonContent = stripMarkdown(cleanedContent);

    let parsed;
    try {
        const repaired = jsonrepair(jsonContent);
        parsed = JSON.parse(repaired);
    } catch (e) {
        throw new Error(`JSON parse failed: ${e.message}`);
    }

    const result = GraphExtractionSchema.safeParse(parsed);
    if (!result.success) {
        throw new Error(`Schema validation failed: ${result.error.message}`);
    }
    return result.data;
}
```

#### Step 4: Verify (Green)

- Command: `npm test tests/extraction/structured.test.js`
- Expect: PASS

#### Step 5: Git Commit

- Command: `git add . && git commit -m "feat: add split EventExtraction and GraphExtraction schemas"`

---

### Step 3.2: Split Prompts in prompts.js

#### Step 1: Write Failing Test — new prompt functions exist

- File: `tests/prompts.test.js`
- Add:
```javascript
import { buildEventExtractionPrompt, buildGraphExtractionPrompt } from '../src/prompts.js';

describe('buildEventExtractionPrompt', () => {
    it('returns message array with system and user roles', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello world',
            names: { char: 'Alice', user: 'Bob' },
            context: {},
        });
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
    });

    it('does NOT mention entities or relationships in system prompt', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            context: {},
        });
        const systemContent = result[0].content;
        expect(systemContent).not.toContain('"entities"');
        expect(systemContent).not.toContain('"relationships"');
    });
});

describe('buildGraphExtractionPrompt', () => {
    it('returns message array with system and user roles', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[Alice]: Hello world',
            names: { char: 'Alice', user: 'Bob' },
            extractedEvents: ['Alice greeted Bob warmly'],
            context: {},
        });
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
    });

    it('includes extracted events in user prompt', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            extractedEvents: ['Alice greeted Bob warmly'],
            context: {},
        });
        const userContent = result[1].content;
        expect(userContent).toContain('Alice greeted Bob warmly');
    });

    it('does NOT mention events schema in system prompt', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            extractedEvents: [],
            context: {},
        });
        const systemContent = result[0].content;
        expect(systemContent).not.toContain('"importance"');
        expect(systemContent).not.toContain('"is_secret"');
    });
});
```

#### Step 2: Run Test (Red)

- Command: `npm test tests/prompts.test.js`
- Expect: Fail — functions don't exist.

#### Step 3: Implementation (Green)

- File: `src/prompts.js`
- Add two new functions (old `buildExtractionPrompt` will be removed in Task 4):

**`buildEventExtractionPrompt`**: Copy the system prompt from `buildExtractionPrompt` but:
  - Remove `<entity_rules>` section entirely.
  - Remove `entities` and `relationships` from `<output_schema>`. The schema should only require `reasoning` (if enabled) and `events`.
  - Update CRITICAL FORMAT RULES to reference only `events` (and optionally `reasoning`).
  - Remove entity/relationship examples from `<examples>` (strip the `"entities":` and `"relationships":` keys from example outputs).
  - User prompt: same as current, but final instruction says "Extract events only."

**`buildGraphExtractionPrompt`**: New function:
  - System prompt: role is "knowledge graph extractor for roleplay." Include the `<entity_rules>` section. Output schema demands only `entities` and `relationships`.
  - User prompt: include `<context>` (characters), `<messages>`, AND a new `<extracted_events>` section with the formatted event list. Final instruction: "Based on the messages and extracted events above, extract named entities and relationships. Respond with a JSON object containing 'entities' and 'relationships' keys."

Signature:
```javascript
export function buildEventExtractionPrompt({ messages, names, context = {} })
export function buildGraphExtractionPrompt({ messages, names, extractedEvents = [], context = {} })
```

#### Step 4: Verify (Green)

- Command: `npm test tests/prompts.test.js`
- Expect: PASS

#### Step 5: Git Commit

- Command: `git add . && git commit -m "feat: add split event and graph extraction prompts"`

---

### Step 3.3: Add LLM Configs in llm.js

#### Step 1: Write Failing Test

- File: `tests/llm.test.js`
- Add:
```javascript
import { LLM_CONFIGS } from '../src/llm.js';

describe('LLM_CONFIGS split extraction', () => {
    it('has extraction_events config', () => {
        expect(LLM_CONFIGS.extraction_events).toBeDefined();
        expect(LLM_CONFIGS.extraction_events.maxTokens).toBe(4000);
    });

    it('has extraction_graph config', () => {
        expect(LLM_CONFIGS.extraction_graph).toBeDefined();
        expect(LLM_CONFIGS.extraction_graph.maxTokens).toBe(2000);
    });
});
```

#### Step 2: Run Test (Red)

- Command: `npm test tests/llm.test.js`
- Expect: Fail — configs don't exist.

#### Step 3: Implementation (Green)

- File: `src/llm.js`
- Add imports for the new schema functions:
```javascript
import {
    getCommunitySummaryJsonSchema,
    getEventExtractionJsonSchema,
    getGraphExtractionJsonSchema,
    getExtractionJsonSchema,
    getInsightExtractionJsonSchema,
    getSalientQuestionsJsonSchema,
} from './extraction/structured.js';
```
Note: `getExtractionJsonSchema` will be removed in Task 4.
- Add to `LLM_CONFIGS` (old `extraction` config will be removed in Task 4):
```javascript
    extraction_events: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 4000,
        errorContext: 'Event Extraction',
        timeoutMs: 120000,
        getJsonSchema: getEventExtractionJsonSchema,
    },
    extraction_graph: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 2000,
        errorContext: 'Graph Extraction',
        timeoutMs: 90000,
        getJsonSchema: getGraphExtractionJsonSchema,
    },
```

#### Step 4: Verify (Green)

- Command: `npm test tests/llm.test.js`
- Expect: PASS

#### Step 5: Git Commit

- Command: `git add . && git commit -m "feat: add extraction_events and extraction_graph LLM configs"`

---

### Step 3.4: Refactor extract.js to Use Two-Stage Pipeline

#### Step 1: Write Failing Test

- File: `tests/extraction/extract.test.js`
- Add a test that verifies `callLLM` is called twice during extraction (once for events, once for graph). This requires mocking `callLLM` and checking call count.

```javascript
// In existing test file, add:
describe('two-stage extraction pipeline', () => {
    it('calls LLM twice: once for events, once for graph', async () => {
        // This test should verify that extractMemories makes two separate LLM calls
        // Mock callLLM to return valid responses for each stage
        const { callLLM } = await import('../../src/llm.js');

        // Track calls
        const calls = vi.mocked(callLLM).mock.calls;
        // After extractMemories runs, expect 2 calls
        // First call config should be extraction_events
        // Second call config should be extraction_graph
    });
});
```

**Note:** The exact test setup depends on existing mocking patterns in `extract.test.js`. The executor should read the full file to understand the mock setup, then write a test that:
1. Mocks `callLLM` to return valid event JSON on first call and valid graph JSON on second call.
2. Runs `extractMemories`.
3. Asserts `callLLM` was called exactly 2 times.
4. Asserts first call used `LLM_CONFIGS.extraction_events`.
5. Asserts second call used `LLM_CONFIGS.extraction_graph`.

#### Step 2: Run Test (Red)

- Command: `npm test tests/extraction/extract.test.js`
- Expect: Fail — currently makes 1 call.

#### Step 3: Implementation (Green)

- File: `src/extraction/extract.js`

**Changes to imports:**
```javascript
// Replace:
import { callLLMForExtraction } from '../llm.js';
import { buildExtractionPrompt } from '../prompts.js';
import { parseExtractionResponse } from './structured.js';

// With:
import { callLLM, LLM_CONFIGS } from '../llm.js';
import { buildEventExtractionPrompt, buildGraphExtractionPrompt } from '../prompts.js';
import { parseEventExtractionResponse, parseGraphExtractionResponse } from './structured.js';
```

**Changes to `extractMemories` Stage 2-3 block** (around lines 300-320). Replace the single LLM call:

```javascript
        // Stage 2: Prompt Building
        // ... (keep existing messagesText, existingMemories, characterDescription, personaDescription setup)

        // Stage 3A: Event Extraction (LLM Call 1)
        const eventPrompt = buildEventExtractionPrompt({
            messages: messagesText,
            names: { char: characterName, user: userName },
            context: {
                memories: existingMemories,
                charDesc: characterDescription,
                personaDesc: personaDescription,
                extractionReasoning: settings.extractionReasoning ?? false,
            },
        });

        const eventJson = await callLLM(eventPrompt, LLM_CONFIGS.extraction_events, { structured: true });
        const eventResult = parseEventExtractionResponse(eventJson);
        let events = eventResult.events;

        // Stage 3B: Graph Extraction (LLM Call 2) — skip if no events
        let graphResult = { entities: [], relationships: [] };
        if (events.length > 0) {
            const formattedEvents = events.map((e, i) => `${i + 1}. [${e.importance}★] ${e.summary}`);
            const graphPrompt = buildGraphExtractionPrompt({
                messages: messagesText,
                names: { char: characterName, user: userName },
                extractedEvents: formattedEvents,
                context: {
                    charDesc: characterDescription,
                    personaDesc: personaDescription,
                },
            });

            const graphJson = await callLLM(graphPrompt, LLM_CONFIGS.extraction_graph, { structured: true });
            graphResult = parseGraphExtractionResponse(graphJson);
        }

        // Merge into unified validated object for downstream stages
        const validated = {
            events,
            entities: graphResult.entities,
            relationships: graphResult.relationships,
            reasoning: eventResult.reasoning,
        };
```

Then update all downstream references from `validated.events` → `events` is already used. The `validated.entities` and `validated.relationships` references in Stage 4.5 should continue to work unchanged.

#### Step 4: Verify (Green)

- Command: `npm test tests/extraction/extract.test.js`
- Expect: PASS

#### Step 5: Run full test suite

- Command: `npm test`
- Expect: All tests pass.

#### Step 6: Git Commit

- Command: `git add . && git commit -m "feat: split extraction into two-stage pipeline (events then graph)"`

---

## Task 4: Remove Legacy Unified Extraction API

**Goal:** Delete `buildExtractionPrompt`, `ExtractionResponseSchema`, `parseExtractionResponse`, `getExtractionJsonSchema`, `callLLMForExtraction`, and the `extraction` LLM config. Update all tests that referenced them.

### Step 1: Write Failing Test — old exports are gone

- File: `tests/extraction/structured.test.js`
- Add:
```javascript
describe('legacy extraction API removed', () => {
    it('does not export ExtractionResponseSchema', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.ExtractionResponseSchema).toBeUndefined();
    });

    it('does not export getExtractionJsonSchema', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.getExtractionJsonSchema).toBeUndefined();
    });

    it('does not export parseExtractionResponse', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.parseExtractionResponse).toBeUndefined();
    });
});
```

### Step 2: Run Test (Red)

- Command: `npm test tests/extraction/structured.test.js`
- Expect: Fail — old exports still exist.

### Step 3: Implementation — Remove from source files

**File: `src/extraction/structured.js`**
- Delete `ExtractionResponseSchema` (the `z.object` with reasoning, events, entities, relationships).
- Delete `getExtractionJsonSchema()` function.
- Delete `parseExtractionResponse()` function.
- Keep `EventSchema`, `EntitySchema`, `RelationshipSchema` (used by the new split schemas).

**File: `src/prompts.js`**
- Delete `buildExtractionPrompt()` function entirely (the large function with all examples, entity_rules, etc.).
- Keep private helpers `formatEstablishedMemories` and `formatCharacters` (used by the new split prompts).

**File: `src/llm.js`**
- Delete the `extraction` key from `LLM_CONFIGS`.
- Delete the `callLLMForExtraction` convenience function.
- Remove `getExtractionJsonSchema` from the import statement.

**File: `src/extraction/extract.js`**
- Should already have no references after Task 3.4. Verify no lingering imports of `callLLMForExtraction`, `buildExtractionPrompt`, or `parseExtractionResponse`.

### Step 4: Update existing tests that reference old API

**File: `tests/extraction/structured.test.js`**
- Remove `getExtractionJsonSchema` and `parseExtractionResponse` from the import statement.
- Delete the `describe('getExtractionJsonSchema')` block (tests the old unified schema).
- Delete the `describe('parseExtractionResponse')` block (tests the old unified parser).
- Delete the `describe('Extended ExtractionResponseSchema')` block.
- Replace all these with equivalent tests for the new `getEventExtractionJsonSchema`, `parseEventExtractionResponse`, `getGraphExtractionJsonSchema`, `parseGraphExtractionResponse` (already added in Task 3.1).

**File: `tests/prompts.test.js`**
- Remove `buildExtractionPrompt` from the import statement.
- Delete the `describe('buildExtractionPrompt')` block.
- Delete the `describe('buildExtractionPrompt entity/relationship instructions')` block.
- Delete the `describe('buildExtractionPrompt unified structure')` block.
- Replace with equivalent tests for `buildEventExtractionPrompt` and `buildGraphExtractionPrompt` (already added in Task 3.2).

**File: `tests/extraction/extract.test.js`**
- Update the mock: replace `callLLMForExtraction: vi.fn(...)` with `callLLM: vi.fn(...)` that returns appropriate responses for each stage.
- Update any test that asserts on the single-call behavior to assert on the two-call behavior.

**File: `tests/llm.test.js`**
- Remove any tests that reference `LLM_CONFIGS.extraction` or `callLLMForExtraction`.

### Step 5: Verify (Green)

- Command: `npm test`
- Expect: All tests pass. No references to old API remain.

### Step 6: Git Commit

- Command: `git add . && git commit -m "chore: remove legacy unified extraction API"`

---

## Task 5: Final Verification

### Step 1: Run full test suite

- Command: `npm test`
- Expect: All tests pass.

### Step 2: Run linter

- Command: `npm run lint`
- Expect: No errors.

### Step 3: Git Commit (if any lint fixes)

- Command: `npm run lint:fix && git add . && git commit -m "chore: lint fixes"`
