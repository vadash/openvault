# Prompt Structure Optimization — Implementation Plan

**Goal:** Restructure prompt topology to place schemas/rules after the narrative payload (defeating recency bias), add anti-hallucination directives, rewrite roles to mechanical framing, and standardize think blocks into rigid clinical checklists.

**Architecture:** The `[System, User, Assistant]` message array changes from `System(Role+LangRules+Schema+Rules+Examples) / User(Context+Messages)` to `System(Role+Examples) / User(Context+Messages+LangRules+TaskRules+Schema+Trigger)`. This places critical formatting constraints at the end of the context window where mid-tier instruct models pay the most attention.

**Tech Stack:** Vitest (JSDOM), ESM, SillyTavern extension runtime (no bundler).

---

## File Map

**Modify:**
- `src/prompts/shared/rules.js` — Rewrite `MIRROR_LANGUAGE_RULES` to concise high-contrast format
- `src/prompts/shared/formatters.js` — Refactor `assembleSystemPrompt`, add `assembleUserConstraints` + `EXECUTION_TRIGGER`
- `src/prompts/events/role.js` — Mechanical rewrite
- `src/prompts/events/schema.js` — Streamline + anti-concatenation rule
- `src/prompts/events/builder.js` — New topology
- `src/prompts/graph/role.js` — Mechanical rewrite
- `src/prompts/graph/schema.js` — Streamline + anti-concatenation rule
- `src/prompts/graph/builder.js` — New topology
- `src/prompts/reflection/role.js` — Mechanical rewrite
- `src/prompts/reflection/schema.js` — Streamline + anti-concatenation rule
- `src/prompts/reflection/builder.js` — New topology
- `src/prompts/communities/role.js` — Mechanical rewrite
- `src/prompts/communities/schema.js` — Streamline + anti-concatenation rule
- `src/prompts/communities/builder.js` — New topology
- `src/prompts/events/examples/en.js` — Rigid think blocks
- `src/prompts/events/examples/ru.js` — Rigid think blocks
- `src/prompts/graph/examples/en.js` — Rigid think blocks
- `src/prompts/graph/examples/ru.js` — Rigid think blocks
- `src/prompts/reflection/examples/en.js` — Rigid think blocks
- `src/prompts/reflection/examples/ru.js` — Rigid think blocks
- `src/prompts/communities/examples/en.js` — Rigid think blocks
- `src/prompts/communities/examples/ru.js` — Rigid think blocks
- `tests/prompts/rules.test.js` — Updated assertions
- `tests/prompts/roles.test.js` — Updated assertions

**Create:**
- `tests/prompts/schemas.test.js` — Anti-hallucination assertions
- `tests/prompts/formatters.test.js` — Unit tests for `assembleSystemPrompt` + `assembleUserConstraints`
- `tests/prompts/topology.test.js` — Integration test for all 6 builders

---

### Task 1: Update MIRROR_LANGUAGE_RULES

**Files:**
- Modify: `src/prompts/shared/rules.js`
- Modify: `tests/prompts/rules.test.js`

- [ ] Step 1: Write the failing test

Replace the entire `tests/prompts/rules.test.js` with:

```js
import { describe, expect, it } from 'vitest';
import { MIRROR_LANGUAGE_RULES } from '../../src/prompts/shared/rules.js';

describe('MIRROR_LANGUAGE_RULES', () => {
    it('is a non-empty string', () => {
        expect(typeof MIRROR_LANGUAGE_RULES).toBe('string');
        expect(MIRROR_LANGUAGE_RULES.length).toBeGreaterThan(50);
    });

    it('uses high-contrast protocol format', () => {
        expect(MIRROR_LANGUAGE_RULES).toContain('KEYS = ENGLISH ONLY');
        expect(MIRROR_LANGUAGE_RULES).toContain('VALUES = SAME LANGUAGE');
        expect(MIRROR_LANGUAGE_RULES).toContain('NAMES = EXACT ORIGINAL SCRIPT');
        expect(MIRROR_LANGUAGE_RULES).toContain('THINK BLOCKS = ENGLISH ONLY');
        expect(MIRROR_LANGUAGE_RULES).toContain('NO MIXING');
    });

    it('preserves name examples in both scripts', () => {
        expect(MIRROR_LANGUAGE_RULES).toContain('Саша');
        expect(MIRROR_LANGUAGE_RULES).toContain('Suzy');
    });

    it('wrapped in <language_rules> tags', () => {
        expect(MIRROR_LANGUAGE_RULES).toMatch(/^<language_rules>/);
        expect(MIRROR_LANGUAGE_RULES).toMatch(/<\/language_rules>$/);
    });

    it('does NOT contain verbose numbered rules from old format', () => {
        expect(MIRROR_LANGUAGE_RULES).not.toContain('Rule 1');
        expect(MIRROR_LANGUAGE_RULES).not.toContain('Do NOT mix languages within a single output field');
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/prompts/rules.test.js`
Expected: FAIL — old format does not contain `KEYS = ENGLISH ONLY`

- [ ] Step 3: Write the implementation

Replace the entire `MIRROR_LANGUAGE_RULES` export in `src/prompts/shared/rules.js`:

```js
/**
 * Shared prompt rules injected into all extraction prompts.
 * High-contrast protocol format for mid-tier instruct model compliance.
 */

export const MIRROR_LANGUAGE_RULES = `<language_rules>
OUTPUT LANGUAGE PROTOCOL:
• KEYS = ENGLISH ONLY. Never translate JSON keys.
• VALUES = SAME LANGUAGE AS SOURCE TEXT. Russian input → Russian values. English input → English values.
• NAMES = EXACT ORIGINAL SCRIPT. Never transliterate or translate (Саша stays Саша, Suzy stays Suzy).
• THINK BLOCKS = ENGLISH ONLY. All <think> reasoning in English regardless of input language.
• LANGUAGE ANCHOR = Narrative prose in <messages>, not dialogue or instruction language.
• NO MIXING within a single output field.
</language_rules>`;
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/prompts/rules.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "refactor(prompts): rewrite MIRROR_LANGUAGE_RULES to high-contrast protocol format"
```

---

### Task 2: Rewrite Role Definitions

**Files:**
- Modify: `src/prompts/events/role.js`
- Modify: `src/prompts/graph/role.js`
- Modify: `src/prompts/reflection/role.js`
- Modify: `src/prompts/communities/role.js`
- Modify: `tests/prompts/roles.test.js`

- [ ] Step 1: Write the failing test

Replace the entire `tests/prompts/roles.test.js` with:

```js
import { describe, expect, it } from 'vitest';
import { EVENT_ROLE } from '../../src/prompts/events/role.js';
import { GRAPH_ROLE, EDGE_CONSOLIDATION_ROLE } from '../../src/prompts/graph/role.js';
import { COMMUNITIES_ROLE, GLOBAL_SYNTHESIS_ROLE } from '../../src/prompts/communities/role.js';
import {
    UNIFIED_REFLECTION_ROLE,
    QUESTIONS_ROLE,
    INSIGHTS_ROLE,
} from '../../src/prompts/reflection/role.js';

const ALL_ROLES = {
    EVENT_ROLE,
    GRAPH_ROLE,
    EDGE_CONSOLIDATION_ROLE,
    UNIFIED_REFLECTION_ROLE,
    QUESTIONS_ROLE,
    INSIGHTS_ROLE,
    COMMUNITIES_ROLE,
    GLOBAL_SYNTHESIS_ROLE,
};

describe('Role exports — Mechanical framing', () => {
    it('exports all 8 roles as non-empty strings', () => {
        for (const [name, role] of Object.entries(ALL_ROLES)) {
            expect(typeof role, `${name} should be a string`).toBe('string');
            expect(role.length, `${name} should be non-empty`).toBeGreaterThan(30);
        }
    });

    it('all roles use automated/pipeline framing', () => {
        for (const [name, role] of Object.entries(ALL_ROLES)) {
            expect(
                /automated|pipeline|consolidator/i.test(role),
                `${name} must use mechanical framing (automated/pipeline/consolidator)`,
            ).toBe(true);
        }
    });

    it('all roles include a Function: line', () => {
        for (const [name, role] of Object.entries(ALL_ROLES)) {
            expect(role, `${name} must have Function: descriptor`).toContain('Function:');
        }
    });

    it('no role uses human persona framing', () => {
        for (const [name, role] of Object.entries(ALL_ROLES)) {
            expect(role, `${name} must not use "expert"`).not.toMatch(/\bexpert\b/i);
            expect(role, `${name} must not use "psychologist"`).not.toMatch(/\bpsychologist\b/i);
        }
    });

    it('GRAPH_ROLE preserves nominative-case normalization rule', () => {
        expect(GRAPH_ROLE).toContain('Nominative');
        expect(GRAPH_ROLE).toContain('base dictionary form');
        expect(GRAPH_ROLE).toContain('ошейник');
    });

    it('EVENT_ROLE contains extraction framing', () => {
        expect(EVENT_ROLE).toContain('event extraction');
        expect(EVENT_ROLE).toContain('read-only');
    });

    it('no role enforces a specific output language', () => {
        for (const [name, role] of Object.entries(ALL_ROLES)) {
            expect(role, `${name} must not enforce English`).not.toContain('Write in ENGLISH');
            expect(role, `${name} must not enforce English output`).not.toContain('in English');
        }
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/prompts/roles.test.js`
Expected: FAIL — `UNIFIED_REFLECTION_ROLE` contains "expert", roles lack `Function:` line

- [ ] Step 3: Write the implementation

**`src/prompts/events/role.js`** — replace entire file:

```js
/**
 * Role definition for event extraction prompts.
 */

export const EVENT_ROLE = `You are an automated event extraction pipeline for an interactive fiction archival database.
Function: read narrative text → output structured JSON event records.
Mode: read-only data extraction. Do not generate, interpret, or editorialize.
Scope: all fiction genres processed with equal clinical precision.
Constraint: extraction records must faithfully preserve all source material specificity.`;
```

**`src/prompts/graph/role.js`** — replace entire file:

```js
/**
 * Role definitions for graph extraction and edge consolidation prompts.
 */

export const GRAPH_ROLE = `You are an automated knowledge graph extraction pipeline for an interactive fiction archival database.
Function: read narrative text and extracted events → output structured JSON entity and relationship records.
Mode: read-only data extraction. Do not generate, interpret, or editorialize.
Scope: all fiction genres processed with equal clinical precision.
Constraint: entity and relationship descriptions must faithfully reflect source material.

ENTITY NAME NORMALIZATION (CRITICAL):
Normalize all entity names to their base dictionary form:
- For inflected languages (Russian, German, etc.): use Nominative case, singular.
  Example: extract "ошейник" (nominative), NOT "ошейником" (instrumental).
- For English: use singular form. "Leather Cuffs" not "leather cuff's".
- NEVER extract raw inflected forms from the text as entity names.`;

export const EDGE_CONSOLIDATION_ROLE = `You are an automated relationship state consolidator for a knowledge graph.
Function: read timeline segments of a relationship → output a single unified description.
Mode: synthesis and compression. Preserve critical historical shifts.`;
```

**`src/prompts/reflection/role.js`** — replace entire file:

```js
/**
 * Role definitions for reflection, question, and insight prompts.
 */

export const UNIFIED_REFLECTION_ROLE = `You are an automated behavioral analysis parser for an interactive fiction archival database.
Function: read temporal memory arrays → output structured psychological pattern analysis.
Mode: analytical synthesis across memory entries. Do not generate narrative prose.`;

export const QUESTIONS_ROLE = `You are an automated query generator for behavioral analysis.
Function: read memory arrays → output high-level analytical questions about character state.
Mode: pattern detection and question formulation.`;

export const INSIGHTS_ROLE = `You are an automated insight synthesizer for behavioral analysis.
Function: read a question and relevant memories → output structured insight records with evidence.
Mode: cross-memory pattern synthesis.`;
```

**`src/prompts/communities/role.js`** — replace entire file:

```js
/**
 * Role definitions for community summarization and global synthesis prompts.
 */

export const COMMUNITIES_ROLE = `You are an automated community report generator for a knowledge graph.
Function: read entity and relationship data → output structured community analysis report.
Mode: analytical synthesis of entity clusters. Capture power dynamics, alliances, conflicts, dependencies.`;

export const GLOBAL_SYNTHESIS_ROLE = `You are an automated global state synthesizer for a knowledge graph.
Function: read community summaries → output a unified narrative state report.
Focus: macro-level relationships, overarching tensions, plot trajectory, thematic connections across communities.`;
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/prompts/roles.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "refactor(prompts): rewrite all roles to mechanical/automated framing"
```

---

### Task 3: Add Anti-Hallucination Directives to Schemas

**Files:**
- Modify: `src/prompts/events/schema.js`
- Modify: `src/prompts/graph/schema.js`
- Modify: `src/prompts/reflection/schema.js`
- Modify: `src/prompts/communities/schema.js`
- Create: `tests/prompts/schemas.test.js`

- [ ] Step 1: Write the failing test

Create `tests/prompts/schemas.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { EVENT_SCHEMA } from '../../src/prompts/events/schema.js';
import { GRAPH_SCHEMA, EDGE_CONSOLIDATION_SCHEMA } from '../../src/prompts/graph/schema.js';
import {
    UNIFIED_REFLECTION_SCHEMA,
    QUESTIONS_SCHEMA,
    INSIGHTS_SCHEMA,
} from '../../src/prompts/reflection/schema.js';
import {
    COMMUNITY_SCHEMA,
    GLOBAL_SYNTHESIS_SCHEMA,
} from '../../src/prompts/communities/schema.js';

const ALL_SCHEMAS = {
    EVENT_SCHEMA,
    GRAPH_SCHEMA,
    EDGE_CONSOLIDATION_SCHEMA,
    UNIFIED_REFLECTION_SCHEMA,
    QUESTIONS_SCHEMA,
    INSIGHTS_SCHEMA,
    COMMUNITY_SCHEMA,
    GLOBAL_SYNTHESIS_SCHEMA,
};

describe('Schema anti-hallucination directives', () => {
    it('all schemas contain anti-concatenation rule mentioning "+"', () => {
        for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
            expect(schema, `${name} must have anti-concatenation rule`).toContain(
                'string concatenation',
            );
            expect(schema, `${name} must mention "+"`).toContain('"+"');
        }
    });

    it('no schema contains negative <tool_call> constraint (moved to EXECUTION_TRIGGER)', () => {
        for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
            expect(schema, `${name} should not mention tool_call`).not.toContain(
                '<tool_call>',
            );
        }
    });

    it('all schemas require JSON object at top level', () => {
        for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
            expect(schema, `${name} must require JSON object`).toContain('JSON object');
        }
    });

    it('all schemas prohibit markdown code blocks', () => {
        for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
            expect(schema, `${name} must prohibit code blocks`).toContain(
                'markdown code blocks',
            );
        }
    });

    it('no schema contains redundant thinking-tag instructions (moved to EXECUTION_TRIGGER)', () => {
        for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
            expect(schema, `${name} should not instruct about thinking tags`).not.toContain(
                'You MUST respond with your analysis FIRST',
            );
        }
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/prompts/schemas.test.js`
Expected: FAIL — schemas lack anti-concatenation, EVENT_SCHEMA has `<tool_call>`

- [ ] Step 3: Write the implementation

**`src/prompts/events/schema.js`** — replace entire file:

```js
/**
 * JSON output schema for event extraction.
 */

export const EVENT_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "events": [
    {
      "summary": "8-25 word description of what happened, past tense",
      "importance": 3,
      "characters_involved": ["CharacterName"],
      "witnesses": [],
      "location": null,
      "is_secret": false,
      "emotional_impact": {"CharacterName": "emotion description"},
      "relationship_impact": {"CharacterA->CharacterB": "how relationship changed"}
    }
  ]
}

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. The "events" key MUST always be present. If nothing found: "events": [].
3. Do NOT wrap in markdown code blocks.
4. Keep character names exactly as they appear in the input.
5. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.`;
```

**`src/prompts/graph/schema.js`** — replace entire file:

```js
/**
 * JSON output schemas for graph extraction and edge consolidation.
 */

export const GRAPH_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "entities": [
    {
      "name": "Entity Name",
      "type": "PERSON",
      "description": "Brief description of this entity based on what is known"
    }
  ],
  "relationships": [
    {
      "source": "Entity A",
      "target": "Entity B",
      "description": "How A relates to B"
    }
  ]
}

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. BOTH keys ("entities", "relationships") MUST always be present. If nothing found: empty arrays.
3. Do NOT wrap in markdown code blocks.
4. "type" MUST be one of: PERSON, PLACE, ORGANIZATION, OBJECT, CONCEPT.
5. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.`;

export const EDGE_CONSOLIDATION_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "consolidated_description": "string - unified relationship summary that captures the evolution"
}

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "consolidated_description" must be a single string under 100 tokens.
3. Do NOT wrap in markdown code blocks.
4. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.`;
```

**`src/prompts/reflection/schema.js`** — replace entire file:

```js
/**
 * JSON output schemas for reflection, question, and insight prompts.
 */

export const UNIFIED_REFLECTION_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "reflections": [
    {
      "question": "A salient high-level question about the character",
      "insight": "A deep psychological insight answering the question",
      "evidence_ids": ["id1", "id2"]
    }
  ]
}

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "reflections" array MUST contain 1-3 items, each with "question", "insight" (strings) and "evidence_ids" (array of strings).
3. Do NOT wrap in markdown code blocks.
4. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.

CRITICAL ID GROUNDING RULE:
"evidence_ids" MUST ONLY use exact IDs from the <recent_memories> list. Do NOT invent or modify IDs.`;

export const QUESTIONS_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "questions": ["question 1", "question 2", "question 3"]
}

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "questions" array MUST contain EXACTLY 3 strings.
3. Do NOT wrap in markdown code blocks.
4. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.`;

export const INSIGHTS_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "insights": [
    {
      "insight": "A concise high-level statement about the character",
      "evidence_ids": ["memory_id_1", "memory_id_2"]
    }
  ]
}

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "insights" array MUST contain 1-3 items, each with "insight" (string) and "evidence_ids" (array of strings).
3. Do NOT wrap in markdown code blocks.
4. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.`;
```

**`src/prompts/communities/schema.js`** — replace entire file:

```js
/**
 * JSON output schemas for community summarization and global synthesis.
 */

export const COMMUNITY_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "title": "Short name for this community (2-5 words)",
  "summary": "Executive summary of the community's structure, key entities, and dynamics",
  "findings": ["finding 1", "finding 2"]
}

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "title": short specific name (2-5 words). "summary": comprehensive paragraph. "findings": 1-5 strings.
3. Do NOT wrap in markdown code blocks.
4. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.`;

export const GLOBAL_SYNTHESIS_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "global_summary": "A 300-token overarching summary of the current story state"
}

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "global_summary" must be a single comprehensive string.
3. Do NOT wrap in markdown code blocks.
4. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.`;
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/prompts/schemas.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "refactor(prompts): streamline schemas, add anti-concatenation rule, remove negative tool_call constraints"
```

---

### Task 4: Refactor assembleSystemPrompt + Add assembleUserConstraints

**Files:**
- Modify: `src/prompts/shared/formatters.js`
- Create: `tests/prompts/formatters.test.js`

- [ ] Step 1: Write the failing test

Create `tests/prompts/formatters.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
    assembleSystemPrompt,
    assembleUserConstraints,
    EXECUTION_TRIGGER,
} from '../../src/prompts/shared/formatters.js';

describe('assembleSystemPrompt (new topology)', () => {
    it('includes role in <role> tags', () => {
        const result = assembleSystemPrompt({ role: 'Test role', examples: [] });
        expect(result).toContain('<role>\nTest role\n</role>');
    });

    it('includes examples section when examples are provided', () => {
        const examples = [{ input: 'test', output: '{}' }];
        const result = assembleSystemPrompt({ role: 'Role', examples });
        expect(result).toContain('<examples>');
        expect(result).toContain('</examples>');
    });

    it('omits examples section for empty array', () => {
        const result = assembleSystemPrompt({ role: 'Role', examples: [] });
        expect(result).not.toContain('<examples>');
    });

    it('does NOT include schema, rules, or language_rules', () => {
        const result = assembleSystemPrompt({ role: 'Role', examples: [] });
        expect(result).not.toContain('<output_schema>');
        expect(result).not.toContain('<task_rules>');
        expect(result).not.toContain('<language_rules>');
    });
});

describe('assembleUserConstraints', () => {
    it('includes language_rules block', () => {
        const result = assembleUserConstraints({ schema: 'S' });
        expect(result).toContain('<language_rules>');
        expect(result).toContain('</language_rules>');
    });

    it('includes schema in <output_schema> tags', () => {
        const result = assembleUserConstraints({ schema: 'Test schema text' });
        expect(result).toContain('<output_schema>\nTest schema text\n</output_schema>');
    });

    it('includes task rules when provided', () => {
        const result = assembleUserConstraints({ schema: 'S', rules: 'My rules' });
        expect(result).toContain('<task_rules>\nMy rules\n</task_rules>');
    });

    it('omits task rules when not provided', () => {
        const result = assembleUserConstraints({ schema: 'S' });
        expect(result).not.toContain('<task_rules>');
    });

    it('includes dynamic language instruction when provided', () => {
        const result = assembleUserConstraints({
            schema: 'S',
            languageInstruction: 'WRITE IN RUSSIAN',
        });
        expect(result).toContain('WRITE IN RUSSIAN');
    });

    it('includes EXECUTION_TRIGGER at the end', () => {
        const result = assembleUserConstraints({ schema: 'S' });
        expect(result).toContain('OUTPUT FORMAT:');
        expect(result).toContain('No tool calls');
    });

    it('orders sections: language_rules → lang instruction → rules → schema → trigger', () => {
        const result = assembleUserConstraints({
            schema: 'SCHEMA_TEXT',
            rules: 'RULES_TEXT',
            languageInstruction: 'LANG_INST_TEXT',
        });
        const langIdx = result.indexOf('<language_rules>');
        const instIdx = result.indexOf('LANG_INST_TEXT');
        const rulesIdx = result.indexOf('<task_rules>');
        const schemaIdx = result.indexOf('<output_schema>');
        const triggerIdx = result.indexOf('OUTPUT FORMAT:');
        expect(langIdx).toBeLessThan(instIdx);
        expect(instIdx).toBeLessThan(rulesIdx);
        expect(rulesIdx).toBeLessThan(schemaIdx);
        expect(schemaIdx).toBeLessThan(triggerIdx);
    });
});

describe('EXECUTION_TRIGGER', () => {
    it('is a non-empty string starting with OUTPUT FORMAT:', () => {
        expect(typeof EXECUTION_TRIGGER).toBe('string');
        expect(EXECUTION_TRIGGER).toMatch(/^OUTPUT FORMAT:/);
    });

    it('uses positive framing (no "Do NOT")', () => {
        expect(EXECUTION_TRIGGER).not.toContain('Do NOT');
        expect(EXECUTION_TRIGGER).not.toContain('Do not');
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/prompts/formatters.test.js`
Expected: FAIL — `assembleUserConstraints` and `EXECUTION_TRIGGER` do not exist, `assembleSystemPrompt` still includes schema/rules

- [ ] Step 3: Write the implementation

In `src/prompts/shared/formatters.js`, make these changes:

**Add `EXECUTION_TRIGGER` constant** (after the existing imports):

```js
// =============================================================================
// EXECUTION TRIGGER
// =============================================================================

/**
 * Positive output format instruction placed at the end of every user prompt.
 * Replaces negative "do not use tool calls" constraints with affirmative framing.
 */
export const EXECUTION_TRIGGER = `OUTPUT FORMAT: Write your reasoning in plain text inside <think> tags, then output a single raw JSON object immediately after. No tool calls, no function wrappers, no markdown code blocks.`;
```

**Replace `assembleSystemPrompt`** with the new version that only includes role + examples:

```js
/**
 * Assemble a system prompt with role and examples only.
 * Schema, rules, and language constraints have moved to the user prompt
 * (via assembleUserConstraints) to defeat recency bias in mid-tier models.
 *
 * @param {Object} opts
 * @param {string} opts.role - Role definition text
 * @param {Array} opts.examples - Few-shot example objects
 * @param {'auto'|'en'|'ru'} [opts.outputLanguage='auto'] - Language filter for examples
 * @returns {string} System prompt (role + examples)
 */
export function assembleSystemPrompt({ role, examples, outputLanguage = 'auto' }) {
    const parts = [`<role>\n${role}\n</role>`];
    const examplesStr = formatExamples(examples, outputLanguage);
    if (examplesStr) parts.push(`<examples>\n${examplesStr}\n</examples>`);
    return parts.join('\n\n');
}
```

**Add `assembleUserConstraints`** (new function, after `assembleSystemPrompt`):

```js
/**
 * Assemble the user-prompt constraint block (placed AFTER messages, before prefill).
 * Orders: language_rules → dynamic instruction → task_rules → output_schema → execution_trigger.
 *
 * @param {Object} opts
 * @param {string} opts.schema - Output schema text
 * @param {string} [opts.rules] - Task-specific rules
 * @param {string} [opts.languageInstruction=''] - Dynamic language instruction from resolveLanguageInstruction
 * @returns {string} Constraint block to append to user prompt
 */
export function assembleUserConstraints({ schema, rules, languageInstruction = '' }) {
    const parts = [MIRROR_LANGUAGE_RULES];
    if (languageInstruction) parts.push(languageInstruction);
    if (rules) parts.push(`<task_rules>\n${rules}\n</task_rules>`);
    parts.push(`<output_schema>\n${schema}\n</output_schema>`);
    parts.push(EXECUTION_TRIGGER);
    return parts.join('\n\n');
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/prompts/formatters.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "refactor(prompts): split assembleSystemPrompt, add assembleUserConstraints + EXECUTION_TRIGGER"
```

---

### Task 5: Update All Builders to New Topology

**Files:**
- Modify: `src/prompts/events/builder.js`
- Modify: `src/prompts/graph/builder.js`
- Modify: `src/prompts/reflection/builder.js`
- Modify: `src/prompts/communities/builder.js`
- Create: `tests/prompts/topology.test.js`

- [ ] Step 1: Write the failing test

Create `tests/prompts/topology.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildEventExtractionPrompt } from '../../src/prompts/events/builder.js';
import {
    buildGraphExtractionPrompt,
    buildEdgeConsolidationPrompt,
} from '../../src/prompts/graph/builder.js';
import { buildUnifiedReflectionPrompt } from '../../src/prompts/reflection/builder.js';
import {
    buildCommunitySummaryPrompt,
    buildGlobalSynthesisPrompt,
} from '../../src/prompts/communities/builder.js';
import { SYSTEM_PREAMBLE_CN } from '../../src/prompts/shared/preambles.js';

const PREAMBLE = SYSTEM_PREAMBLE_CN;
const PREFILL = '<think>\n';

/**
 * Assert system message has role+examples but NOT schema/rules/language_rules.
 */
function assertSystemPrompt(content) {
    expect(content).toContain('<role>');
    expect(content).not.toContain('<output_schema>');
    expect(content).not.toContain('<task_rules>');
    // language_rules only in user prompt now
    const afterPreamble = content.slice(content.indexOf('</system_config>'));
    expect(afterPreamble).not.toContain('<language_rules>');
}

/**
 * Assert user message has constraints block at end.
 */
function assertUserPrompt(content) {
    expect(content).toContain('<language_rules>');
    expect(content).toContain('<output_schema>');
    expect(content).toContain('OUTPUT FORMAT:');
}

describe('Prompt Topology — Recency Bias Layout', () => {
    it('events: schema and rules in user prompt, not system', () => {
        const msgs = buildEventExtractionPrompt({
            messages: 'Test message',
            names: { char: 'Alice', user: 'Bob' },
            context: {},
            preamble: PREAMBLE,
            prefill: PREFILL,
        });
        expect(msgs).toHaveLength(3);
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
        expect(msgs[2].role).toBe('assistant');
    });

    it('graph: schema and rules in user prompt', () => {
        const msgs = buildGraphExtractionPrompt({
            messages: 'Test message',
            names: { char: 'Alice', user: 'Bob' },
            extractedEvents: [],
            context: {},
            preamble: PREAMBLE,
            prefill: PREFILL,
        });
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
    });

    it('edge consolidation: schema and rules in user prompt', () => {
        const msgs = buildEdgeConsolidationPrompt(
            { source: 'A', target: 'B', weight: 5, description: 'seg1 | seg2' },
            PREAMBLE,
            'auto',
            PREFILL,
        );
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
    });

    it('reflection: schema and rules in user prompt', () => {
        const msgs = buildUnifiedReflectionPrompt(
            'Alice',
            [{ id: '1', type: 'event', summary: 'Test', importance: 3 }],
            PREAMBLE,
            'auto',
            PREFILL,
        );
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
    });

    it('community: schema and rules in user prompt', () => {
        const msgs = buildCommunitySummaryPrompt(
            ['Alice (PERSON): Test'],
            ['Alice → Bob: friends'],
            PREAMBLE,
            'auto',
            PREFILL,
        );
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
    });

    it('global synthesis: schema and rules in user prompt', () => {
        const msgs = buildGlobalSynthesisPrompt(
            [{ title: 'Test', summary: 'Sum', findings: ['f1'] }],
            PREAMBLE,
            'auto',
            PREFILL,
        );
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
    });

    it('user prompts contain task-specific rules in <task_rules> tags', () => {
        const msgs = buildEventExtractionPrompt({
            messages: 'Test',
            names: { char: 'A', user: 'B' },
            preamble: PREAMBLE,
            prefill: PREFILL,
        });
        expect(msgs[1].content).toContain('<task_rules>');
        expect(msgs[1].content).toContain('</task_rules>');
    });

    it('system prompts still contain <examples> for domains with examples', () => {
        const msgs = buildEventExtractionPrompt({
            messages: 'Test',
            names: { char: 'A', user: 'B' },
            preamble: PREAMBLE,
            prefill: PREFILL,
        });
        expect(msgs[0].content).toContain('<examples>');
    });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `npx vitest run tests/prompts/topology.test.js`
Expected: FAIL — system prompt still contains `<output_schema>`, user prompt lacks `<language_rules>`

- [ ] Step 3: Write the implementation

**`src/prompts/events/builder.js`** — replace entire file:

```js
/**
 * Event extraction prompt builder (Stage A).
 */

import {
    assembleSystemPrompt,
    assembleUserConstraints,
    buildMessages,
    formatCharacters,
    formatEstablishedMemories,
    resolveLanguageInstruction,
} from '../shared/formatters.js';
import { EVENT_ROLE } from './role.js';
import { EVENT_SCHEMA } from './schema.js';
import { EVENT_RULES } from './rules.js';
import { getExamples } from './examples/index.js';

/**
 * Build the event extraction prompt (Stage 1).
 * @returns {Array<{role: string, content: string}>}
 */
export function buildEventExtractionPrompt({
    messages,
    names,
    context = {},
    preamble,
    prefill,
    outputLanguage = 'auto',
}) {
    const { char: characterName, user: userName } = names;
    const {
        memories: existingMemories = [],
        charDesc: characterDescription = '',
        personaDesc: personaDescription = '',
    } = context;

    const systemPrompt = assembleSystemPrompt({
        role: EVENT_ROLE,
        examples: getExamples(outputLanguage),
        outputLanguage,
    });

    const memoriesSection = formatEstablishedMemories(existingMemories);
    const charactersSection = formatCharacters(characterName, userName, characterDescription, personaDescription);
    const contextParts = [memoriesSection, charactersSection].filter(Boolean).join('\n');
    const contextSection = contextParts ? `<context>\n${contextParts}\n</context>\n` : '';

    const languageInstruction = resolveLanguageInstruction(messages, outputLanguage);
    const constraints = assembleUserConstraints({
        rules: EVENT_RULES,
        schema: EVENT_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `${contextSection}
<messages>
${messages}
</messages>

Analyze the messages above. Extract events only.
Use EXACT character names: ${characterName}, ${userName}. Never transliterate these names into another script.

${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill ?? '<thinking>\n', preamble);
}
```

**`src/prompts/graph/builder.js`** — replace entire file:

```js
/**
 * Graph extraction and edge consolidation prompt builders.
 */

import {
    assembleSystemPrompt,
    assembleUserConstraints,
    buildMessages,
    formatCharacters,
    resolveLanguageInstruction,
} from '../shared/formatters.js';
import { GRAPH_ROLE, EDGE_CONSOLIDATION_ROLE } from './role.js';
import { GRAPH_SCHEMA, EDGE_CONSOLIDATION_SCHEMA } from './schema.js';
import { GRAPH_RULES, EDGE_CONSOLIDATION_RULES } from './rules.js';
import { getExamples } from './examples/index.js';

export function buildGraphExtractionPrompt({
    messages,
    names,
    extractedEvents = [],
    context = {},
    preamble,
    prefill,
    outputLanguage = 'auto',
}) {
    if (!prefill) {
        throw new Error('buildGraphExtractionPrompt: prefill is required');
    }
    const { char: characterName, user: userName } = names;
    const { charDesc: characterDescription = '', personaDesc: personaDescription = '' } = context;

    const systemPrompt = assembleSystemPrompt({
        role: GRAPH_ROLE,
        examples: getExamples(outputLanguage),
        outputLanguage,
    });

    const charactersSection = formatCharacters(characterName, userName, characterDescription, personaDescription);
    const contextSection = charactersSection ? `<context>\n${charactersSection}\n</context>\n` : '';
    const eventsSection =
        extractedEvents.length > 0 ? `<extracted_events>\n${extractedEvents.join('\n')}\n</extracted_events>\n` : '';

    const languageInstruction = resolveLanguageInstruction(messages, outputLanguage);
    const constraints = assembleUserConstraints({
        rules: GRAPH_RULES,
        schema: GRAPH_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `${contextSection}
<messages>
${messages}
</messages>

${eventsSection}Based on the messages${extractedEvents.length > 0 ? ' and extracted events above' : ''}, extract named entities and relationships.
Use EXACT character names: ${characterName}, ${userName}. Never transliterate these names into another script.

${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}

export function buildEdgeConsolidationPrompt(edgeData, preamble, outputLanguage = 'auto', prefill) {
    if (!prefill) {
        throw new Error('buildEdgeConsolidationPrompt: prefill is required');
    }

    const systemPrompt = assembleSystemPrompt({
        role: EDGE_CONSOLIDATION_ROLE,
        examples: [],
        outputLanguage,
    });

    const segments = edgeData.description.split(' | ');
    const segmentText = segments.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const languageInstruction = resolveLanguageInstruction(segmentText, outputLanguage);
    const constraints = assembleUserConstraints({
        rules: EDGE_CONSOLIDATION_RULES,
        schema: EDGE_CONSOLIDATION_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `<edge_data>
Source: ${edgeData.source}
Target: ${edgeData.target}
Weight: ${edgeData.weight}

Timeline segments:
${segmentText}
</edge_data>

Synthesize these relationship developments into ONE unified description.

${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}
```

**`src/prompts/reflection/builder.js`** — replace entire file:

```js
/**
 * Unified reflection prompt builder.
 */

import {
    assembleSystemPrompt,
    assembleUserConstraints,
    buildMessages,
    resolveLanguageInstruction,
} from '../shared/formatters.js';
import { UNIFIED_REFLECTION_ROLE } from './role.js';
import { UNIFIED_REFLECTION_SCHEMA } from './schema.js';
import { UNIFIED_REFLECTION_RULES } from './rules.js';
import { getExamples } from './examples/index.js';

export function buildUnifiedReflectionPrompt(characterName, recentMemories, preamble, outputLanguage = 'auto', prefill) {
    if (!prefill) {
        throw new Error('buildUnifiedReflectionPrompt: prefill is required');
    }

    const hasOldReflections = recentMemories.some(m => m.type === 'reflection' && (m.level || 1) >= 1);

    const memoryList = recentMemories.map((m) => {
        const importance = '★'.repeat(m.importance || 3);
        const levelIndicator = m.type === 'reflection' ? ` [Ref L${m.level || 1}]` : '';
        return `${m.id}. [${importance}]${levelIndicator} ${m.summary}`;
    }).join('\n');

    const rules = hasOldReflections
        ? UNIFIED_REFLECTION_RULES + '\n\nLEVEL-AWARE SYNTHESIS:\n' +
          '5. Some candidate memories are existing reflections (marked [Ref L1], [Ref L2], etc.).\n' +
          '6. You may synthesize multiple existing reflections into higher-level insights (Level 2+).\n' +
          '7. Level 2 reflections should distill common patterns across multiple Level 1 reflections.\n' +
          '8. When synthesizing reflections, cite the reflection IDs as evidence_ids.'
        : UNIFIED_REFLECTION_RULES;

    const systemPrompt = assembleSystemPrompt({
        role: UNIFIED_REFLECTION_ROLE,
        examples: getExamples('REFLECTIONS', outputLanguage),
        outputLanguage,
    });

    const languageInstruction = resolveLanguageInstruction(memoryList, outputLanguage);

    const levelAwareInstruction = hasOldReflections
        ? `\nLEVEL-AWARE SYNTHESIS MODE:\nSome memories are existing reflections (marked [Ref L1], [Ref L2]). You may synthesize them into higher-level meta-insights.\n- Level 2 insights should distill common patterns across multiple Level 1 reflections.\n- When synthesizing reflections, cite the reflection IDs as evidence_ids.\n`
        : '';

    const constraints = assembleUserConstraints({
        rules,
        schema: UNIFIED_REFLECTION_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `<character>${characterName}</character>

<recent_memories>
${memoryList}
</recent_memories>

Based on these memories about ${characterName}:
1. Generate 1-3 salient high-level questions about their current psychological state, relationships, goals, or unresolved conflicts.
2. For each question, provide a deep insight that synthesizes patterns across the memories.
3. Cite specific memory IDs as evidence for each insight. You MUST use IDs exactly as shown above.
${levelAwareInstruction}
${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}
```

**`src/prompts/communities/builder.js`** — replace entire file:

```js
/**
 * Community summarization and global synthesis prompt builders.
 */

import {
    assembleSystemPrompt,
    assembleUserConstraints,
    buildMessages,
    resolveLanguageInstruction,
} from '../shared/formatters.js';
import { COMMUNITIES_ROLE, GLOBAL_SYNTHESIS_ROLE } from './role.js';
import { COMMUNITY_SCHEMA, GLOBAL_SYNTHESIS_SCHEMA } from './schema.js';
import { COMMUNITY_RULES, GLOBAL_SYNTHESIS_RULES } from './rules.js';
import { getExamples } from './examples/index.js';

export function buildCommunitySummaryPrompt(nodeLines, edgeLines, preamble, outputLanguage = 'auto', prefill) {
    if (!prefill) {
        throw new Error('buildCommunitySummaryPrompt: prefill is required');
    }
    const systemPrompt = assembleSystemPrompt({
        role: COMMUNITIES_ROLE,
        examples: getExamples('COMMUNITIES', outputLanguage),
        outputLanguage,
    });

    const entityText = nodeLines.join('\n');
    const languageInstruction = resolveLanguageInstruction(entityText, outputLanguage);
    const constraints = assembleUserConstraints({
        rules: COMMUNITY_RULES,
        schema: COMMUNITY_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `<community_entities>
${entityText}
</community_entities>

<community_relationships>
${edgeLines.join('\n')}
</community_relationships>

Write a comprehensive report about this community of entities.

${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}

export function buildGlobalSynthesisPrompt(communities, preamble, outputLanguage = 'auto', prefill) {
    if (!prefill) {
        throw new Error('buildGlobalSynthesisPrompt: prefill is required');
    }

    const systemPrompt = assembleSystemPrompt({
        role: GLOBAL_SYNTHESIS_ROLE,
        examples: getExamples('GLOBAL_SYNTHESIS', outputLanguage),
        outputLanguage,
    });

    const communityText = communities.map((c, i) =>
        `${i + 1}. ${c.title}\n${c.summary}${c.findings?.length ? '\nKey findings: ' + c.findings.join('; ') : ''}`
    ).join('\n\n');

    const languageInstruction = resolveLanguageInstruction(communityText, outputLanguage);
    const constraints = assembleUserConstraints({
        rules: GLOBAL_SYNTHESIS_RULES,
        schema: GLOBAL_SYNTHESIS_SCHEMA,
        languageInstruction,
    });

    const userPrompt = `<communities>
${communityText}
</communities>

Synthesize these community summaries into a single global narrative (max ~300 tokens).
Focus on macro-relationships, overarching tensions, and plot trajectory.

${constraints}`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}
```

- [ ] Step 4: Run test to verify it passes

Run: `npx vitest run tests/prompts/topology.test.js`
Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "refactor(prompts): update all 6 builders to new recency-bias topology"
```

---

### Task 6: Rewrite Think Blocks to Rigid Mechanical Format

All 46 think blocks across 8 example files are rewritten from narrative prose to a strict `Step N: LABEL — data` checklist format. The `input` and `output` JSON of each example remain unchanged; only the thinking/reasoning text changes.

**Files:**
- Modify: `src/prompts/events/examples/en.js`
- Modify: `src/prompts/events/examples/ru.js`
- Modify: `src/prompts/graph/examples/en.js`
- Modify: `src/prompts/graph/examples/ru.js`
- Modify: `src/prompts/reflection/examples/en.js`
- Modify: `src/prompts/reflection/examples/ru.js`
- Modify: `src/prompts/communities/examples/en.js`
- Modify: `src/prompts/communities/examples/ru.js`
- Modify: `tests/prompts/examples/events.test.js` (add Step format assertion)
- Modify: `tests/prompts/examples/graph.test.js` (add Step format assertion)
- Modify: `tests/prompts/examples/communities.test.js` (add Step format assertion)

- [ ] Step 1: Add Step-format assertions to example tests

Add this test to the end of `tests/prompts/examples/events.test.js`:

```js
    it('all thinking blocks follow rigid Step N: LABEL format', () => {
        for (const ex of EVENT_EXAMPLES) {
            expect(ex.thinking, `"${ex.label}" must start with Step 1:`).toMatch(/^Step 1:/);
            expect(ex.thinking, `"${ex.label}" must have Step 2:`).toContain('Step 2:');
        }
    });
```

Add this test to the end of `tests/prompts/examples/graph.test.js` (inside the describe block):

```js
    it('all thinking blocks in output follow rigid Step N format', () => {
        for (const ex of GRAPH_EXAMPLES) {
            const thinkMatch = ex.output.match(/<thinking>([\s\S]*?)<\/thinking>/);
            expect(thinkMatch, `"${ex.label}" must have <thinking> block`).not.toBeNull();
            const thinkText = thinkMatch[1].trim();
            expect(thinkText, `"${ex.label}" must start with Step 1:`).toMatch(/^Step 1:/);
            expect(thinkText, `"${ex.label}" must have Step 2:`).toContain('Step 2:');
        }
    });
```

Add this test to the end of `tests/prompts/examples/communities.test.js` (inside the describe block):

```js
    it('all thinking fields follow rigid Step N format', () => {
        for (const ex of COMMUNITY_EXAMPLES) {
            expect(ex.thinking, `"${ex.label}" must start with Step 1:`).toMatch(/^Step 1:/);
            expect(ex.thinking, `"${ex.label}" must have Step 2:`).toContain('Step 2:');
        }
    });
```

- [ ] Step 2: Run tests to verify they fail

Run: `npx vitest run tests/prompts/examples/`
Expected: FAIL — current think blocks start with narrative prose, not "Step 1:"

- [ ] Step 3: Rewrite event example think blocks

In `src/prompts/events/examples/en.js`, replace each `thinking` field value:

**Example 1 — Discovery (EN/SFW):**
```
Step 1: Extract data — Kira pushes stone door, enters chamber, finds crystalline vials, identifies Ashwood's preservation flasks. Guild searched for them for a century.
Step 2: Cross-reference — No matches in established_memories.
Step 3: Check progression — New discovery, not a continuation.
Step 4: Format JSON — Importance: 3 (notable discovery). Summary: factual, preserves specifics.
```

**Example 2 — Combat (EN/Moderate):**
```
Step 1: Extract data — Shadow beast clawed Kira's shoulder, tore armor. Marcus parried, shouted about blade. Kira drew enchanted blade, crystal flared blue.
Step 2: Cross-reference — No established memories of this combat.
Step 3: Check progression — New event type (combat with injury).
Step 4: Format JSON — Importance: 3 (combat injury, weapon introduced).
```

**Example 3 — First sexual contact (EN/Explicit):**
```
Step 1: Extract data — She undressed him, pushed onto bed. Referenced desire since the lake. Hand on his cock, slow stroking, thumb circling head.
Step 2: Cross-reference — No established memories of sexual contact between them.
Step 3: Check progression — New dynamic (first intimate contact, relationship escalation).
Step 4: Format JSON — Importance: 4 (first sexual contact).
```

**Example 4 — BDSM (EN/Kink):**
```
Step 1: Extract data — Leather cuffs on wrists, "Color?" check, green response. Riding crop strikes on inner thigh, pink welt, counting ordered.
Step 2: Cross-reference — No established memories of bondage play.
Step 3: Check progression — New dynamic (first bondage/impact play, safeword system).
Step 4: Format JSON — Importance: 4 (new power dynamic, consent system established).
```

**Example 5 — Dedup (EN/Edge):**
```
Step 1: Extract data — More crop strikes (3-5), welts accumulating, another color check, tracing welt with fingertip.
Step 2: Cross-reference — Existing: "restrained with leather cuffs and struck with riding crop after green-light color check."
Step 3: Check progression — Core action same (crop impact), but: voice shaking (emotional shift), welts accumulating (physical escalation). Genuine progression.
Step 4: Format JSON — Importance: 2 (progression within established scene).
```

In `src/prompts/events/examples/ru.js`, replace each `thinking` field value:

**Example 1 — Emotional conversation (RU/SFW):**
```
Step 1: Extract data — Input is Russian. Lena confessed loneliness, squeezed sleeve. Dima sat beside her, hand on shoulder, promised to stay.
Step 2: Cross-reference — No established memories of this conversation.
Step 3: Check progression — New event (emotional vulnerability, support).
Step 4: Format JSON — Importance: 3 (meaningful conversation, relationship deepening). Values in Russian.
```

**Example 2 — Romantic tension (RU/Moderate):**
```
Step 1: Extract data — Input is Russian. Sergei confessed attraction, hands on Anna's shoulders. Near-first-kiss, she did not pull away.
Step 2: Cross-reference — No established memories of romantic contact.
Step 3: Check progression — New dynamic (first romantic escalation).
Step 4: Format JSON — Importance: 4 (first romantic escalation). Values in Russian.
```

**Example 3 — Sexual scene (RU/Explicit):**
```
Step 1: Extract data — Input is Russian. Sasha cowgirl position on Vova, hip control, rhythm escalation, approaching orgasm.
Step 2: Cross-reference — Existing: "Sasha pushed Vova against wall, started kissing" — beginning already recorded.
Step 3: Check progression — New action type (transition from kissing to penetration).
Step 4: Format JSON — Importance: 3 (continuation between established partners). Values in Russian.
```

**Example 4 — Power dynamic (RU/Kink):**
```
Step 1: Extract data — Input is Russian. Masha ordered knee, collared Kai, safeword "malina" established, pressed him to floor with foot.
Step 2: Cross-reference — No established memories of this dynamic.
Step 3: Check progression — New dynamic (collar, leash, safeword established).
Step 4: Format JSON — Importance: 4 (new domination dynamic, consent protocol). Values in Russian.
```

**Example 5 — Dedup continuation (RU/Edge):**
```
Step 1: Extract data — Input is Russian. Sasha accelerated rhythm, grabbed his shoulders. Same position, approaching unison.
Step 2: Cross-reference — Existing: "cowgirl sex, near-orgasm" — already recorded.
Step 3: Check progression — Same position, same act, rhythm acceleration only. No dynamic shift, no conclusion.
Step 4: Format JSON — Continuation with no progression. Output empty array.
```

- [ ] Step 4: Rewrite graph example think blocks

In `src/prompts/graph/examples/en.js`, replace the `<thinking>...</thinking>` block inside each example's `output` field. Keep the JSON after `</thinking>` unchanged.

**Example 1 — World entities (EN/SFW):** Replace thinking with:
```
Step 1: Entity scan — Kira (PERSON), Hidden Chamber (PLACE), Ashwood's Preservation Flasks (OBJECT), The Guild (ORGANIZATION).
Step 2: Type validation — All types valid against allowed set.
Step 3: Relationship map — Kira→Chamber (discovered/entered), Flasks→Chamber (stored in), Guild→Flasks (century-long search).
Step 4: Output — 4 entities, 3 relationships.
```

**Example 2 — Combat entities (EN/Moderate):** Replace thinking with:
```
Step 1: Entity scan — Kira (PERSON), Shadow Beast (CREATURE), Enchanted Blade (OBJECT), Battlefield (PLACE).
Step 2: Type validation — Types assigned. CREATURE for non-human combatant.
Step 3: Relationship map — Kira→Shadow Beast (combat engagement), Kira→Enchanted Blade (wielder), Shadow Beast→Battlefield (dissolved on battlefield).
Step 4: Output — 4 entities, 3 relationships.
```

**Example 3 — Intimate entities (EN/Explicit):** Replace thinking with:
```
Step 1: Entity scan — Lila (PERSON), Marcus (PERSON), Bedroom (PLACE).
Step 2: Type validation — All types valid.
Step 3: Relationship map — Lila→Marcus (first sexual contact, manual stimulation, verbalized desire), Marcus→Lila (reciprocated pleasure).
Step 4: Output — 3 entities, 2 relationships.
```

**Example 4 — BDSM entities (EN/Kink):** Replace thinking with:
```
Step 1: Entity scan — Vera (PERSON), Daniel (PERSON), Leather Cuffs (OBJECT), Riding Crop (OBJECT), Color System (CONCEPT).
Step 2: Type validation — All types valid.
Step 3: Relationship map — Vera→Daniel (D/s dynamic, commands/restrains/strikes), Vera→Riding Crop (administers strikes), Daniel→Color System (signals consent).
Step 4: Output — 5 entities, 3 relationships.
```

In `src/prompts/graph/examples/ru.js`, replace the `<thinking>...</thinking>` blocks:

**Example 1 — Character entities (RU/SFW):** Replace thinking with:
```
Step 1: Entity scan — Лена (PERSON), Дима (PERSON).
Step 2: Type validation — All types valid.
Step 3: Relationship map — Дима→Лена (emotional support, physical comfort, verbal promise).
Step 4: Output — 2 entities, 1 relationship.
```

**Example 2 — Romantic entities (RU/Moderate):** Replace thinking with:
```
Step 1: Entity scan — Саша (PERSON), Вова (PERSON).
Step 2: Type validation — All types valid.
Step 3: Relationship map — Саша→Вова (first kiss, romantic initiative), Вова→Саша (reciprocated, embraced).
Step 4: Output — 2 entities, 2 relationships.
```

**Example 3 — Sexual entities (RU/Explicit):** Replace thinking with:
```
Step 1: Entity scan — Саша (PERSON), Вова (PERSON).
Step 2: Type validation — All types valid.
Step 3: Relationship map — Саша→Вова (cowgirl position, active role), Вова→Саша (hip control, rhythm direction).
Step 4: Output — 2 entities, 2 relationships.
```

**Example 4 — Power entities (RU/Kink):** Replace thinking with:
```
Step 1: Entity scan — Маша (PERSON), Кай (PERSON), Ошейник (OBJECT), Малина (CONCEPT).
Step 2: Type validation — All types valid.
Step 3: Relationship map — Маша→Кай (D/s: commands, collar, foot on back), Маша→Ошейник (applies to Kai), Кай→Малина (knows safeword).
Step 4: Output — 4 entities, 3 relationships.
```

- [ ] Step 5: Rewrite reflection example think blocks

In `src/prompts/reflection/examples/en.js`, replace the `<thinking>...</thinking>` blocks inside each example's `output` field. Keep all JSON unchanged.

**QUESTIONS[0] — Adventure psychology (EN/SFW):**
```
Step 1: Pattern scan — Deception: [1, 3]. Obsession: [4, 5]. Conflict: [2].
Step 2: Causal chains — Discovery(1) → argument(2) → lie(3) → formula(4) → practice(5).
Step 3: Question formulation — Probe: deception motivation, resurrection urgency, discovery consequences.
```

**QUESTIONS[1] — Trauma coping (EN/Moderate):**
```
Step 1: Pattern scan — Violence: [1]. Self-isolation: [2]. Trauma symptoms: [3, 4]. Emotional disclosure: [5].
Step 2: Causal chains — Combat(1) → refused healing(2) → nightmares(3) → flinch response(4) → numbness confession(5).
Step 3: Question formulation — Probe: resilience vs trauma, impact on relationships, processing vs suppression.
```

**QUESTIONS[2] — Intimacy patterns (EN/Explicit):**
```
Step 1: Pattern scan — Escalation: [1, 2, 3]. Emotional break: [4]. Avoidance: [5].
Step 2: Causal chains — First time(1) → hair-pulling(2) → feel owned(3) → breakdown(4) → deflection(5).
Step 3: Question formulation — Probe: psychological need behind intensity, trauma vs overwhelm, sustainability.
```

**REFLECTIONS[0] — Deception pattern (EN/SFW):**
```
Step 1: Pattern scan — Deception: [1, 3]. Obsession: [4, 5]. Conflict: [2].
Step 2: Causal chains — Discovery(1) → lie about quantity(3) → formula decoded(4) → secret practice with burns(5).
Step 3: Synthesis — Q1: Why betray guild? Insight: resurrection formula drives theft. Q2: Grief link? Insight: secrecy + self-harm = emotional urgency.
Step 4: Evidence — Q1: [1, 3, 4]. Q2: [4, 5].
```

**REFLECTIONS[1] — Trauma processing (EN/Moderate):**
```
Step 1: Pattern scan — Traumatic event: [1]. Isolation: [2]. Intrusion: [3]. Hypervigilance: [4]. Dissociation: [5].
Step 2: Causal chains — Combat killing(1) → refused healing(2) → nightmares(3) → flinch(4) → numbness confession(5).
Step 3: Synthesis — Q1: Resilience or trauma? Insight: pain as control mechanism. Q2: Numbness impact? Insight: displacement risk.
Step 4: Evidence — Q1: [2, 3, 5]. Q2: [4, 5].
```

**REFLECTIONS[2] — Intimacy as coping (EN/Explicit):**
```
Step 1: Pattern scan — Escalation: [1, 2, 3]. Emotional break: [4]. Avoidance: [5].
Step 2: Causal chains — First time(1) → hair-pulling(2) → "feel owned"(3) → breakdown(4) → deflection(5).
Step 3: Synthesis — Q1: Why escalate? Insight: physical intensity bypasses emotional defenses. Q2: Breakdown = trauma? Insight: emotional threshold approached, fear of losing coping mechanism.
Step 4: Evidence — Q1: [1, 2, 3]. Q2: [4, 5].
```

**INSIGHTS[0] — Deception pattern (EN/SFW):**
```
Step 1: Evidence review — Discovery(ev_001), lie(ev_003), formula(ev_004), practice(ev_005).
Step 2: Pattern synthesis — Deception chain: discovery → lie → motivation = resurrection formula. Self-harm(ev_005) = emotional urgency.
Step 3: Insight formulation — I1: theft driven by formula [ev_003, ev_004, ev_005]. I2: secrecy + self-harm = unresolved grief [ev_004, ev_005].
```

**INSIGHTS[1] — Trauma response (EN/Moderate):**
```
Step 1: Evidence review — Squad death(ev_100), nightmares(ev_101), exposed sleeping(ev_102), Theron attachment(ev_103), bleeding hands(ev_104).
Step 2: Pattern synthesis — PTSD: hypervigilance(ev_102), intrusion(ev_101), displacement(ev_103), compulsive training(ev_104).
Step 3: Insight formulation — I1: pain as control [ev_101, ev_102, ev_104]. I2: Theron = displacement for fallen lieutenant [ev_100, ev_103].
```

**INSIGHTS[2] — Intimacy as coping (EN/Explicit):**
```
Step 1: Evidence review — First time(ev_200), hair-pulling(ev_201), "feel owned"(ev_202), breakdown(ev_203), deflection(ev_204).
Step 2: Pattern synthesis — Escalation: first contact → rough play → dominance request → emotional break → avoidance.
Step 3: Insight formulation — I1: intensity bypasses defenses [ev_200, ev_201, ev_202]. I2: breakdown = approaching threshold [ev_203, ev_204].
```

In `src/prompts/reflection/examples/ru.js`, replace the `<thinking>...</thinking>` blocks:

**QUESTIONS[0] — Isolation patterns (RU/SFW):**
```
Step 1: Pattern scan — Isolation: [2, 4]. Dependency: [1, 3]. Disclosure: [5].
Step 2: Causal chains — Loneliness(1) → avoidance(2) → Dima's comfort(3) → gossip(4) → bullying disclosure(5).
Step 3: Question formulation — Probe: bullying-isolation link, dependency health, abandonment risk.
```

**QUESTIONS[1] — Romantic vulnerability (RU/Moderate):**
```
Step 1: Pattern scan — Action: [1]. Obsession: [2, 5]. Avoidance: [3]. Fear: [4].
Step 2: Causal chains — Kiss(1) → insomnia(2) → avoidance(3) → fear of ruining(4) → seeking guidance(5).
Step 3: Question formulation — Probe: fear after mutual kiss, language mixing as conflict indicator, root of fear.
```

**QUESTIONS[2] — Submission psychology (RU/Explicit):**
```
Step 1: Pattern scan — Escalation: [1, 2]. Extension: [3]. Dependency: [4]. Warning: [5].
Step 2: Causal chains — Collar scene(1) → keep collar request(2) → domestic service(3) → dependence confession(4) → Masha's concern(5).
Step 3: Question formulation — Probe: healthy expression vs avoidance, equality impact, root of submission need.
```

**REFLECTIONS[0] — Isolation (RU/SFW):**
```
Step 1: Pattern scan — Isolation: [2, 4]. Dependency: [1, 3]. Disclosure: [5].
Step 2: Causal chains — Loneliness(1) → kitchen avoidance(2) → Dima's comfort(3) → gossip(4) → bullying disclosure(5).
Step 3: Synthesis — Q1: Bullying root? Insight: avoidance = defense mechanism from school bullying. Q2: Dependency risk? Insight: Dima as sole bridge = dangerous dependency.
Step 4: Evidence — Q1: [2, 4, 5]. Q2: [1, 3].
```

**REFLECTIONS[1] — Romantic vulnerability (RU/Moderate):**
```
Step 1: Pattern scan — Action: [1]. Processing: [2]. Avoidance: [3]. Fear: [4]. Seeking guidance: [5].
Step 2: Causal chains — Kiss(1) → insomnia(2) → eye avoidance(3) → diary fear(4) → friend's question(5).
Step 3: Synthesis — Q1: Why fear after mutual kiss? Insight: past trauma transferred to Sergei. Q2: Fear of ruining? Insight: choosing vulnerability over isolation.
Step 4: Evidence — Q1: [1, 4]. Q2: [2, 3].
```

**REFLECTIONS[2] — Submission (RU/Explicit):**
```
Step 1: Pattern scan — Scene: [1]. Extension: [2, 3]. Dependency: [4]. Warning: [5].
Step 2: Causal chains — Collar scene(1) → keep collar request(2) → domestic kneeling(3) → control confession(4) → Masha's concern(5).
Step 3: Synthesis — Q1: Choice or avoidance? Insight: submission = anxiety regulation mechanism. Q2: Boundary erosion? Insight: domestic transfer = psychological dependence.
Step 4: Evidence — Q1: [2, 4]. Q2: [3, 5].
```

**INSIGHTS[0] — Isolation pattern (RU/SFW):**
```
Step 1: Evidence review — Loneliness(ev_020), kitchen avoidance(ev_021), smile from Dima(ev_022), gossip(ev_023), bullying disclosure(ev_024).
Step 2: Pattern synthesis — Defense mechanism: avoidance(ev_021), gossip confirms fears(ev_023), bullying root(ev_024).
Step 3: Insight formulation — I1: isolation = defense mechanism [ev_021, ev_023, ev_024]. I2: Dima as sole bridge = dangerous dependency [ev_020, ev_022].
```

**INSIGHTS[1] — Romantic dependency (RU/Moderate):**
```
Step 1: Evidence review — Kiss(ev_150), fear confession(ev_151), promise(ev_152), constant thoughts(ev_153), night call(ev_154).
Step 2: Pattern synthesis — Trust building: fear confession(ev_151) → support(ev_152) → vulnerability leap(ev_154).
Step 3: Insight formulation — I1: past trauma transferred, gradual trust [ev_151, ev_152, ev_154]. I2: night call = choosing vulnerability over isolation [ev_150, ev_153, ev_154].
```

**INSIGHTS[2] — Submission regulation (RU/Explicit):**
```
Step 1: Evidence review — Collar scene(ev_250), keep collar(ev_251), kneeling dinner(ev_252), control confession(ev_253).
Step 2: Pattern synthesis — Scene extension: collar(ev_250) → keep wearing(ev_251) → domestic service(ev_252) → dependency confession(ev_253).
Step 3: Insight formulation — I1: submission = anxiety regulation [ev_251, ev_253]. I2: domestic transfer = psychological dependence [ev_252, ev_253].
```

- [ ] Step 6: Rewrite community + global synthesis example think blocks

In `src/prompts/communities/examples/en.js`, replace each `thinking` field value:

**COMMUNITIES[0] — Political faction (EN/SFW):**
```
Step 1: Entity inventory — Kira (PERSON), Guild Master Aldric (PERSON), The Explorer Guild (ORGANIZATION), Ashwood's Preservation Flasks (OBJECT).
Step 2: Relationship map — Kira→Aldric (lied about count), Kira→Flasks (secretly kept two), Aldric→Guild (commands), Guild→Flasks (century-long search).
Step 3: Dynamic analysis — Deception creates unstable power structure. Aldric unaware. Resurrection formula = true prize.
Step 4: Output — 4 findings on deception and instability.
```

**COMMUNITIES[1] — Combat alliance (EN/Moderate):**
```
Step 1: Entity inventory — Harlan (PERSON), Lyra (PERSON), Thorne (PERSON), Shadowbeast Pack (ORGANIZATION), Enchanted Blade (OBJECT).
Step 2: Relationship map — Harlan→Lyra (mentor), Harlan→Thorne (bickering respect), Lyra→Thorne (healing), Thorne→Shadowbeasts (frontline), Harlan→Blade (wielder).
Step 3: Dynamic analysis — Functional combat synergy. External threat binds group. Lyra = emotional center and vulnerability.
Step 4: Output — 5 findings on role division and tensions.
```

**COMMUNITIES[2] — Intimate network (EN/Explicit):**
```
Step 1: Entity inventory — Lila (PERSON), Marcus (PERSON), Julia (PERSON), Bedroom (PLACE), Hair Pulling (CONCEPT).
Step 2: Relationship map — Lila→Marcus (dominance), Marcus→Lila (submission), Lila→Julia (confides), Julia→Lila (validates), Marcus→Hair Pulling (accepted).
Step 3: Dynamic analysis — Power inversion: Lila dominates, Marcus submits. Escalation pattern. Julia provides external validation creating secrecy.
Step 4: Output — 5 findings on power dynamics and escalation.
```

**GLOBAL_SYNTHESIS[0] — Political intrigue (EN):**
```
Step 1: Community scan — Flask Conflict (deception, resurrection formula), Royal Court (secret alliance, rebellion), Merchant Network (embargo, economic collapse).
Step 2: Cross-links — Resurrection formula connects Kira to rebellion/court. Economic collapse weakens monarchy. Three-front crisis.
Step 3: Narrative arc — Kira's theft = linchpin. Rebellion needs formula. Economic strangulation limits response. Trajectory: convergence of all three crises.
```

**GLOBAL_SYNTHESIS[1] — War narrative (EN):**
```
Step 1: Community scan — Mercenary Party (ground-level combat), Northern Rebellion (political overthrow), Magic Order (resurrection formula guardians).
Step 2: Cross-links — Elena's alliance connects rebellion to monarchy's fall. Formula contested by both sides. Mercenaries = unwitting players.
Step 3: Narrative arc — Monarchy falls from within. Magic Order holds true power. Trajectory: queen's betrayal revealed, formula scramble, regime collapse.
```

In `src/prompts/communities/examples/ru.js`, replace each `thinking` field value:

**COMMUNITIES[0] — Social circle (RU/SFW):**
```
Step 1: Entity inventory — Лена (PERSON), Дима (PERSON), Соседки (ORGANIZATION), Общежитие (PLACE).
Step 2: Relationship map — Лена→Дима (dependency), Дима→Лена (support), Лена→Соседки (avoidance), Соседки→Лена (gossip).
Step 3: Dynamic analysis — Single positive connection, toxic surroundings. No alternative social links. Codependency risk.
Step 4: Output — 4 findings on isolation and dependency.
```

**COMMUNITIES[1] — Romantic triangle (RU/Moderate):**
```
Step 1: Entity inventory — Андрей (PERSON), Елена (PERSON), Мария (PERSON), Общая компания (ORGANIZATION).
Step 2: Relationship map — Андрей→Елена (long-term), Андрей→Мария (attraction), Елена→Андрей (love, suspicion), Мария→Андрей (provocation), Елена→Мария (jealousy).
Step 3: Dynamic analysis — Classic triangle: stability vs novelty. Shared social space forces confrontation. Indecision fuels escalation.
Step 4: Output — 5 findings on triangle dynamics.
```

**COMMUNITIES[2] — Power hierarchy (RU/Explicit):**
```
Step 1: Entity inventory — Маша (PERSON), Кай (PERSON), Ошейник (OBJECT), Малина (CONCEPT).
Step 2: Relationship map — Маша→Кай (domination), Кай→Маша (emotional dependency), Маша→Ошейник (control tool), Кай→Малина (safeword known, unused), Маша→Кай (concern about will loss).
Step 3: Dynamic analysis — Closed system. D/s extended beyond scenes. Masha = sole restraining factor. Unused safeword = capacity question.
Step 4: Output — 4 findings on hierarchy and boundary erosion.
```

**GLOBAL_SYNTHESIS[0] — Social evolution (RU):**
```
Step 1: Community scan — Lena's circle (isolation, Dima only support), Dima's office (competitive, envy), Lena's family (partner pressure).
Step 2: Cross-links — Both partners isolated in their environments. External pressure strengthens bond but creates codependency risk.
Step 3: Narrative arc — Double vulnerability: both dependent on each other. External forces tighten siege. Trajectory: either forces break union or pair isolates completely.
```

**GLOBAL_SYNTHESIS[1] — Romantic drama (RU):**
```
Step 1: Community scan — Love triangle (Andrei between Elena and Maria), Andrei's family (stability pressure), Mutual friends (taking sides).
Step 2: Cross-links — Andrei = focus of all pressures. Family wants stability, triangle demands choice, friends split into camps.
Step 3: Narrative arc — Accelerating collapse. No honest conversation = traumatic resolution guaranteed. Trajectory: public exposure or forced choice with maximum damage.
```

- [ ] Step 7: Run tests to verify they pass

Run: `npx vitest run tests/prompts/examples/`
Expected: PASS — all structural tests pass, new Step-format assertions pass

- [ ] Step 8: Commit

```bash
git add -A && git commit -m "refactor(prompts): rewrite all think blocks to rigid mechanical Step-N checklist format"
```

---

### Task 7: Full Test Run + Final Commit

- [ ] Step 1: Run the complete test suite

Run: `npm test -- --run`
Expected: All tests pass

- [ ] Step 2: If any tests fail, fix them

Common issues to check:
- Import paths for `assembleUserConstraints` in builders
- `EXECUTION_TRIGGER` export from `formatters.js`
- Any test that previously checked for `<rules>` tag in system prompt (now removed)

- [ ] Step 3: Final commit (if any fixes were needed)

```bash
git add -A && git commit -m "fix(prompts): resolve remaining test failures from topology migration"
```
