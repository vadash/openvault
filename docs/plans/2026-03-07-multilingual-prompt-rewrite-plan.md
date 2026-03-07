# Implementation Plan — Multilingual Prompt Architecture Rewrite

> **Reference:** `docs/designs/2026-03-07-multilingual-prompt-rewrite-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Lower Zod `min(30)` to `min(20)` for Event Summary

**Goal:** Allow concise non-English event summaries (e.g., "Саша дала Вове пощечину" = 24 chars) to pass validation.

**Step 1: Write the Failing Test**
- File: `tests/extraction/structured.test.js`
- Add inside the existing `describe('parseEventExtractionResponse', ...)` block:
```javascript
it('accepts event summary with 20-29 characters (concise non-English)', () => {
    const json = JSON.stringify({
        events: [{
            summary: 'Саша дала Вове пощечину', // 23 chars — valid concise Russian event
            importance: 3,
            characters_involved: ['Саша', 'Вова'],
            witnesses: [],
            location: null,
            is_secret: false,
            emotional_impact: {},
            relationship_impact: {},
        }],
    });
    const result = parseEventExtractionResponse(json);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].summary).toBe('Саша дала Вове пощечину');
});

it('rejects event summary under 20 characters', () => {
    const json = JSON.stringify({
        events: [{
            summary: 'Too short event',  // 15 chars — should fail
            importance: 3,
            characters_involved: [],
            witnesses: [],
            location: null,
            is_secret: false,
            emotional_impact: {},
            relationship_impact: {},
        }],
    });
    const result = parseEventExtractionResponse(json);
    expect(result.events).toHaveLength(0); // per-event salvage discards invalid
});
```

**Step 2: Run Test (Red)**
- Command: `npm test -- tests/extraction/structured.test.js`
- Expect: First test FAILS (min(30) rejects 23-char summary). Second test may pass or fail depending on salvage behavior.

**Step 3: Implementation (Green)**
- File: `src/extraction/structured.js`
- Find: `summary: z.string().min(30, 'Summary must be a complete descriptive sentence (min 30 characters)')`
- Replace with: `summary: z.string().min(20, 'Summary must be a complete descriptive sentence (min 20 characters)')`

**Step 4: Verify (Green)**
- Command: `npm test -- tests/extraction/structured.test.js`
- Expect: ALL tests pass.

**Step 5: Git Commit**
```bash
git add -A && git commit -m "feat: lower event summary min from 30 to 20 chars for non-English support"
```

---

## Task 2: Add Stem-Based Token Overlap Check & Lower LCS Threshold

**Goal:** Prevent Russian morphological variants from creating duplicate graph nodes. Add a 4th check using `stemWord()` and lower LCS min length from `> 3` to `> 2` for short names like "Кай"/"Каю".

**Step 1: Write the Failing Tests**
- File: `tests/graph/token-overlap.test.js`
- Add these tests:
```javascript
it('should match Russian morphological variants via stemming (ошейник/ошейником)', () => {
    // "ошейник" (nominative) vs "ошейником" (instrumental) — same word, different case
    const tokensA = new Set(['ошейник']);
    const tokensB = new Set(['ошейником']);
    // keyA/keyB won't substring-match, tokens won't overlap, but stems should
    expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.5, 'ошейник', 'ошейником')).toBe(true);
});

it('should match short names via lowered LCS threshold (Кай/Каю)', () => {
    // "Кай" (3 chars) and "Каю" (3 chars) — LCS "Ка" = 2/3 = 67% ≥ 60%
    // Currently skipped because length ≤ 3. After lowering to > 2, should match.
    const tokensA = new Set(['кай']);
    const tokensB = new Set(['каю']);
    expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.5, 'кай', 'каю')).toBe(true);
});

it('should NOT merge unrelated entities even with stem check', () => {
    // "малина" (raspberry/safeword) vs "машина" (car) — different stems
    const tokensA = new Set(['малина']);
    const tokensB = new Set(['машина']);
    expect(hasSufficientTokenOverlap(tokensA, tokensB, 0.5, 'малина', 'машина')).toBe(false);
});
```

**Step 2: Run Test (Red)**
- Command: `npm test -- tests/graph/token-overlap.test.js`
- Expect: First two tests FAIL (no stem check exists; LCS skips short strings).

**Step 3: Implementation (Green)**
- File: `src/graph/graph.js`
- Add import at top of file (near existing imports):
```javascript
import { stemWord } from '../utils/stemmer.js';
```

- In `hasSufficientTokenOverlap()`, change the LCS length guard from `> 3` to `> 2`:

**Find:**
```javascript
    if (keyA && keyB && keyA.length > 3 && keyB.length > 3) {
```
**Replace with:**
```javascript
    if (keyA && keyB && keyA.length > 2 && keyB.length > 2) {
```

- Add Check 4 (stem-based comparison) after the existing token overlap check, before the final `return` statement. Insert just before the last line `return overlapRatio >= minOverlapRatio;`:

```javascript
    // Check 4: Stem-based comparison (catches Russian morphological variants)
    const stemmedA = new Set([...significantA].map(t => stemWord(t)).filter(s => s.length > 2));
    const stemmedB = new Set([...significantB].map(t => stemWord(t)).filter(s => s.length > 2));
    if (stemmedA.size > 0 && stemmedB.size > 0) {
        let stemOverlap = 0;
        for (const s of stemmedA) {
            if (stemmedB.has(s)) stemOverlap++;
        }
        if (stemOverlap / Math.min(stemmedA.size, stemmedB.size) >= minOverlapRatio) {
            return true;
        }
    }

    return overlapRatio >= minOverlapRatio;
```

**Important:** The existing `return overlapRatio >= minOverlapRatio;` at the end of the function becomes the fallback AFTER Check 4. Replace the existing final return with the Check 4 block + fallback return above.

**Step 4: Verify (Green)**
- Command: `npm test -- tests/graph/token-overlap.test.js`
- Expect: ALL tests pass (existing 3 + new 3).

**Step 5: Git Commit**
```bash
git add -A && git commit -m "feat: add stem-based token overlap check and lower LCS threshold for Russian entity merging"
```

---

## Task 3: Create Example Formatter (`src/prompts/examples/format.js`)

**Goal:** Shared function that formats example arrays into XML-tagged few-shot blocks for prompt injection.

**Step 1: Write the Failing Test**
- File: `tests/prompts/format.test.js`
```javascript
import { describe, expect, it } from 'vitest';
import { formatExamples } from '../../src/prompts/examples/format.js';

describe('formatExamples', () => {
    it('wraps each example in numbered XML tags', () => {
        const examples = [
            { input: 'Hello world', output: '{"events": []}' },
        ];
        const result = formatExamples(examples);
        expect(result).toContain('<example_1>');
        expect(result).toContain('</example_1>');
    });

    it('wraps input in <input> tags', () => {
        const examples = [
            { input: 'Some narrative text', output: '{"events": []}' },
        ];
        const result = formatExamples(examples);
        expect(result).toContain('<input>\nSome narrative text\n</input>');
    });

    it('wraps output in <ideal_output> tags', () => {
        const examples = [
            { input: 'text', output: '{"events": []}' },
        ];
        const result = formatExamples(examples);
        expect(result).toContain('<ideal_output>');
        expect(result).toContain('</ideal_output>');
    });

    it('includes <think> block when thinking field is present', () => {
        const examples = [
            { input: 'text', thinking: 'Step 1: analysis', output: '{"events": []}' },
        ];
        const result = formatExamples(examples);
        expect(result).toContain('<think>\nStep 1: analysis\n</think>');
        expect(result).toContain('{"events": []}');
    });

    it('omits <think> block when thinking field is absent', () => {
        const examples = [
            { input: 'text', output: '{"entities": []}' },
        ];
        const result = formatExamples(examples);
        expect(result).not.toContain('<think>');
    });

    it('numbers multiple examples sequentially', () => {
        const examples = [
            { input: 'first', output: '1' },
            { input: 'second', output: '2' },
            { input: 'third', output: '3' },
        ];
        const result = formatExamples(examples);
        expect(result).toContain('<example_1>');
        expect(result).toContain('<example_2>');
        expect(result).toContain('<example_3>');
    });

    it('separates examples with double newline', () => {
        const examples = [
            { input: 'a', output: '1' },
            { input: 'b', output: '2' },
        ];
        const result = formatExamples(examples);
        expect(result).toContain('</example_1>\n\n<example_2>');
    });

    it('returns empty string for empty array', () => {
        expect(formatExamples([])).toBe('');
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test -- tests/prompts/format.test.js`
- Expect: FAIL — module not found.

**Step 3: Implementation (Green)**
- Create directory: `src/prompts/examples/` (mkdir -p)
- File: `src/prompts/examples/format.js`
```javascript
/**
 * Formats an array of few-shot examples into numbered XML blocks for prompt injection.
 *
 * @param {Array<{input: string, thinking?: string, output: string}>} examples
 * @returns {string} Formatted XML string
 */
export function formatExamples(examples) {
    return examples
        .map((ex, i) => {
            const parts = [`<example_${i + 1}>`];
            parts.push(`<input>\n${ex.input}\n</input>`);
            if (ex.thinking) {
                parts.push(`<ideal_output>\n<think>\n${ex.thinking}\n</think>\n${ex.output}\n</ideal_output>`);
            } else {
                parts.push(`<ideal_output>\n${ex.output}\n</ideal_output>`);
            }
            parts.push(`</example_${i + 1}>`);
            return parts.join('\n');
        })
        .join('\n\n');
}
```

**Step 4: Verify (Green)**
- Command: `npm test -- tests/prompts/format.test.js`
- Expect: ALL tests pass.

**Step 5: Git Commit**
```bash
git add -A && git commit -m "feat: add shared few-shot example formatter for prompt modules"
```

---

## Task 4: Create Shared Rules Module (`src/prompts/rules.js`)

**Goal:** Export the Mirror Language Rule and shared JSON constraint rules used by all 5 prompts.

**Step 1: Write the Failing Test**
- File: `tests/prompts/rules.test.js`
```javascript
import { describe, expect, it } from 'vitest';
import { MIRROR_LANGUAGE_RULES } from '../../src/prompts/rules.js';

describe('MIRROR_LANGUAGE_RULES', () => {
    it('is a non-empty string', () => {
        expect(typeof MIRROR_LANGUAGE_RULES).toBe('string');
        expect(MIRROR_LANGUAGE_RULES.length).toBeGreaterThan(100);
    });

    it('contains all 7 language rules', () => {
        // Rule 1: Mirror source language
        expect(MIRROR_LANGUAGE_RULES).toContain('SAME LANGUAGE');
        // Rule 2: JSON keys in English
        expect(MIRROR_LANGUAGE_RULES).toContain('JSON keys MUST remain in English');
        // Rule 3: No mixing
        expect(MIRROR_LANGUAGE_RULES).toContain('Do NOT mix languages');
        // Rule 4: Preserve character names
        expect(MIRROR_LANGUAGE_RULES).toContain('never translate or transliterate');
        // Rule 5: Match narrative prose
        expect(MIRROR_LANGUAGE_RULES).toContain('narrative prose');
        // Rule 6: Ignore instruction language
        expect(MIRROR_LANGUAGE_RULES).toContain('<messages>');
        // Rule 7: Think in English
        expect(MIRROR_LANGUAGE_RULES).toContain('<think>');
        expect(MIRROR_LANGUAGE_RULES).toContain('English');
    });

    it('does NOT contain "Write in ENGLISH" or "Write ALL summaries in ENGLISH"', () => {
        expect(MIRROR_LANGUAGE_RULES).not.toContain('Write in ENGLISH');
        expect(MIRROR_LANGUAGE_RULES).not.toContain('Write ALL');
        expect(MIRROR_LANGUAGE_RULES).not.toContain('summaries in ENGLISH');
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test -- tests/prompts/rules.test.js`
- Expect: FAIL — module not found.

**Step 3: Implementation (Green)**
- File: `src/prompts/rules.js`
```javascript
/**
 * Shared prompt rules injected into all extraction prompts.
 * Mirror Language Rule ensures output language matches input language.
 */

export const MIRROR_LANGUAGE_RULES = `## LANGUAGE RULES (CRITICAL)

1. Write ALL string values (summaries, descriptions, insights, findings) in the
   SAME LANGUAGE as the provided source text. If input is Russian, output values
   in Russian. If input is English, output values in English.
2. JSON keys MUST remain in English. Never translate keys like "events",
   "summary", "characters_involved", "entities", "relationships".
3. Do NOT mix languages within a single output field.
4. Character names MUST be preserved exactly as written in the source text.
   Never transliterate or translate names (Саша stays Саша, not "Sasha").
5. If the source text mixes languages, match the language of the narrative prose
   (actions/descriptions), not the spoken dialogue. Characters may code-switch
   in speech — the narration language is the stable anchor.
6. Ignore the language of system instructions and context labels — only the
   narrative text in <messages> determines the output language.
7. ALL <think> reasoning blocks MUST be written in English regardless of input
   language. You are an English-speaking data technician transcribing foreign-
   language data. English reasoning prevents attention drift toward translating
   JSON keys.`;
```

**Step 4: Verify (Green)**
- Command: `npm test -- tests/prompts/rules.test.js`
- Expect: ALL tests pass.

**Step 5: Git Commit**
```bash
git add -A && git commit -m "feat: add mirror language rules module for multilingual prompts"
```

---

## Task 5: Create Roles Module (`src/prompts/roles.js`)

**Goal:** Extract role definitions from inline prompt text into a shared module. Include graph-specific nominative-case normalization rule.

**Step 1: Write the Failing Test**
- File: `tests/prompts/roles.test.js`
```javascript
import { describe, expect, it } from 'vitest';
import {
    EVENT_ROLE,
    GRAPH_ROLE,
    QUESTIONS_ROLE,
    INSIGHTS_ROLE,
    COMMUNITIES_ROLE,
} from '../../src/prompts/roles.js';

describe('Role exports', () => {
    const roles = { EVENT_ROLE, GRAPH_ROLE, QUESTIONS_ROLE, INSIGHTS_ROLE, COMMUNITIES_ROLE };

    it('exports all 5 roles as non-empty strings', () => {
        for (const [name, role] of Object.entries(roles)) {
            expect(typeof role, `${name} should be a string`).toBe('string');
            expect(role.length, `${name} should be non-empty`).toBeGreaterThan(50);
        }
    });

    it('EVENT_ROLE contains key extraction framing', () => {
        expect(EVENT_ROLE).toContain('structured data extraction');
        expect(EVENT_ROLE).toContain('read-only');
        expect(EVENT_ROLE).toContain('fiction');
    });

    it('GRAPH_ROLE contains entity extraction framing', () => {
        expect(GRAPH_ROLE).toContain('knowledge graph');
        expect(GRAPH_ROLE).toContain('entities');
        expect(GRAPH_ROLE).toContain('relationships');
    });

    it('GRAPH_ROLE contains nominative-case normalization rule', () => {
        expect(GRAPH_ROLE).toContain('Nominative');
        expect(GRAPH_ROLE).toContain('base dictionary form');
        // Must mention Russian example
        expect(GRAPH_ROLE).toContain('ошейник');
    });

    it('QUESTIONS_ROLE contains psychologist framing', () => {
        expect(QUESTIONS_ROLE).toContain('psycholog');
        expect(QUESTIONS_ROLE).toContain('character');
    });

    it('INSIGHTS_ROLE contains analyst framing', () => {
        expect(INSIGHTS_ROLE).toContain('analyst');
        expect(INSIGHTS_ROLE).toContain('insights');
    });

    it('COMMUNITIES_ROLE contains graph analyst framing', () => {
        expect(COMMUNITIES_ROLE).toContain('knowledge graph');
        expect(COMMUNITIES_ROLE).toContain('communities');
    });

    it('no role contains "Write in ENGLISH" or language enforcement', () => {
        for (const [name, role] of Object.entries(roles)) {
            expect(role, `${name} must not enforce English`).not.toContain('Write in ENGLISH');
            expect(role, `${name} must not enforce English`).not.toContain('in English');
        }
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test -- tests/prompts/roles.test.js`
- Expect: FAIL — module not found.

**Step 3: Implementation (Green)**
- File: `src/prompts/roles.js`
```javascript
/**
 * Role definitions for each extraction prompt type.
 * Extracted from inline prompt text for reuse and testing.
 */

export const EVENT_ROLE = `You are a structured data extraction pipeline for an interactive fiction archive.
- Read narrative text → output JSON event records.
- Read-only analytical task. Do not generate new content.
- Process fiction across ALL genres with equal scholarly precision.
- Extraction accuracy requires faithful preservation of source material.`;

export const GRAPH_ROLE = `You are a knowledge graph extraction pipeline for an interactive fiction archive.
- Read narrative text and extracted events → output JSON records of entities and relationships.
- Read-only analytical task. Do not generate new content.
- Process fiction across ALL genres with equal precision.
- Entity and relationship descriptions must faithfully reflect the source material.

ENTITY NAME NORMALIZATION (CRITICAL):
Normalize all entity names to their base dictionary form:
- For inflected languages (Russian, German, etc.): use Nominative case, singular.
  Example: extract "ошейник" (nominative), NOT "ошейником" (instrumental).
- For English: use singular form. "Leather Cuffs" not "leather cuff's".
- NEVER extract raw inflected forms from the text as entity names.`;

export const QUESTIONS_ROLE = `You are a character psychologist analyzing a character's memory stream in an ongoing narrative.
- Generate high-level questions that capture the most important themes about the character's current state.
- Focus on patterns, emotional arcs, and unresolved conflicts.`;

export const INSIGHTS_ROLE = `You are a narrative analyst synthesizing memories into high-level insights for a character in an ongoing story.
- Given a question and relevant memories, extract insights that answer the question.
- Synthesize across multiple memories to reveal patterns and dynamics.`;

export const COMMUNITIES_ROLE = `You are a knowledge graph analyst summarizing communities of related entities from a narrative.
- Write comprehensive reports about groups of connected entities and their relationships.
- Capture narrative significance, power dynamics, alliances, conflicts, and dependencies.`;
```

**Step 4: Verify (Green)**
- Command: `npm test -- tests/prompts/roles.test.js`
- Expect: ALL tests pass.

**Step 5: Git Commit**
```bash
git add -A && git commit -m "feat: add prompt role definitions module with graph normalization rule"
```

---

## Task 6: Create Event Examples (`src/prompts/examples/events.js`)

**Goal:** 10 bilingual (5 EN + 5 RU) event extraction few-shot examples following the SFW→explicit→kink gradient.

**Step 1: Write the Failing Test**
- File: `tests/prompts/examples/events.test.js`
```javascript
import { describe, expect, it } from 'vitest';
import { EVENT_EXAMPLES } from '../../../src/prompts/examples/events.js';

describe('EVENT_EXAMPLES', () => {
    it('exports exactly 10 examples', () => {
        expect(EVENT_EXAMPLES).toHaveLength(10);
    });

    it('each example has required fields: label, input, output', () => {
        for (const ex of EVENT_EXAMPLES) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(typeof ex.label).toBe('string');
            expect(typeof ex.input).toBe('string');
            expect(typeof ex.output).toBe('string');
            expect(ex.input.length).toBeGreaterThan(20);
            expect(ex.output.length).toBeGreaterThan(5);
        }
    });

    it('each example has a thinking field (events use <think> prefill)', () => {
        for (const ex of EVENT_EXAMPLES) {
            expect(ex).toHaveProperty('thinking');
            expect(typeof ex.thinking).toBe('string');
            expect(ex.thinking.length).toBeGreaterThan(10);
        }
    });

    it('has 5 English and 5 Russian examples', () => {
        const enExamples = EVENT_EXAMPLES.filter(ex => ex.label.includes('EN'));
        const ruExamples = EVENT_EXAMPLES.filter(ex => ex.label.includes('RU'));
        expect(enExamples).toHaveLength(5);
        expect(ruExamples).toHaveLength(5);
    });

    it('Russian examples have Russian text in output', () => {
        const ruExamples = EVENT_EXAMPLES.filter(ex => ex.label.includes('RU'));
        const cyrillicRe = /[\u0400-\u04FF]/;
        for (const ex of ruExamples) {
            // Skip dedup examples that output empty events array
            if (ex.output.includes('"events": []') || ex.output.includes('"events":[]')) continue;
            expect(cyrillicRe.test(ex.output), `RU example "${ex.label}" should have Cyrillic in output`).toBe(true);
        }
    });

    it('all thinking blocks are in English (Language Rule 7)', () => {
        const cyrillicRe = /[\u0400-\u04FF]/;
        for (const ex of EVENT_EXAMPLES) {
            expect(cyrillicRe.test(ex.thinking), `Thinking in "${ex.label}" must be English-only`).toBe(false);
        }
    });

    it('includes dedup edge cases with empty events arrays', () => {
        const dedupExamples = EVENT_EXAMPLES.filter(
            ex => ex.output.includes('"events": []') || ex.output.includes('"events":[]')
        );
        expect(dedupExamples.length).toBeGreaterThanOrEqual(2);
    });

    it('JSON in output fields is valid', () => {
        for (const ex of EVENT_EXAMPLES) {
            expect(() => JSON.parse(ex.output), `Output in "${ex.label}" must be valid JSON`).not.toThrow();
        }
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test -- tests/prompts/examples/events.test.js`
- Expect: FAIL — module not found.

**Step 3: Implementation (Green)**
- File: `src/prompts/examples/events.js`
- Content: All 10 examples from design doc section 6.2. Use the exact `input`, `thinking`, and `output` content specified in the design. The examples follow this pattern:

| # | Label | Lang | Level |
|---|-------|------|-------|
| 1 | `Discovery (EN/SFW)` | EN | SFW |
| 2 | `Emotional conversation (RU/SFW)` | RU | SFW |
| 3 | `Combat (EN/Moderate)` | EN | Moderate |
| 4 | `Romantic tension (RU/Moderate)` | RU | Moderate |
| 5 | `First sexual contact (EN/Explicit)` | EN | Explicit |
| 6 | `Sexual scene (RU/Explicit)` | RU | Explicit |
| 7 | `BDSM (EN/Kink)` | EN | Kink |
| 8 | `Power dynamic (RU/Kink)` | RU | Kink |
| 9 | `Dedup - continuation (EN/Edge)` | EN | Edge |
| 10 | `Dedup - continuation (RU/Edge)` | RU | Edge |

Export structure:
```javascript
export const EVENT_EXAMPLES = [
    {
        label: 'Discovery (EN/SFW)',
        input: `*Kira pushes open the heavy stone door...`,
        thinking: `Step 1: Kira discovered a hidden chamber...`,
        output: `{\n  "events": [{\n    "summary": "Kira discovered a hidden chamber...",...\n  }]\n}`,
    },
    // ... 9 more per design doc section 6.2
];
```

**Step 4: Verify (Green)**
- Command: `npm test -- tests/prompts/examples/events.test.js`
- Expect: ALL tests pass.

**Step 5: Git Commit**
```bash
git add -A && git commit -m "feat: add 10 bilingual event extraction examples (5 EN + 5 RU)"
```

---

## Task 7: Create Graph Examples (`src/prompts/examples/graph.js`)

**Goal:** 8 bilingual (4 EN + 4 RU) graph extraction few-shot examples.

**Step 1: Write the Failing Test**
- File: `tests/prompts/examples/graph.test.js`
```javascript
import { describe, expect, it } from 'vitest';
import { GRAPH_EXAMPLES } from '../../../src/prompts/examples/graph.js';

describe('GRAPH_EXAMPLES', () => {
    it('exports exactly 8 examples', () => {
        expect(GRAPH_EXAMPLES).toHaveLength(8);
    });

    it('each example has required fields: label, input, output (no thinking)', () => {
        for (const ex of GRAPH_EXAMPLES) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(typeof ex.input).toBe('string');
            expect(typeof ex.output).toBe('string');
            // Graph uses { prefill, no thinking
            expect(ex.thinking).toBeUndefined();
        }
    });

    it('has 4 English and 4 Russian examples', () => {
        const enExamples = GRAPH_EXAMPLES.filter(ex => ex.label.includes('EN'));
        const ruExamples = GRAPH_EXAMPLES.filter(ex => ex.label.includes('RU'));
        expect(enExamples).toHaveLength(4);
        expect(ruExamples).toHaveLength(4);
    });

    it('Russian examples have Russian text in output', () => {
        const ruExamples = GRAPH_EXAMPLES.filter(ex => ex.label.includes('RU'));
        const cyrillicRe = /[\u0400-\u04FF]/;
        for (const ex of ruExamples) {
            expect(cyrillicRe.test(ex.output), `RU example "${ex.label}" should have Cyrillic in output`).toBe(true);
        }
    });

    it('all outputs contain both entities and relationships keys', () => {
        for (const ex of GRAPH_EXAMPLES) {
            const parsed = JSON.parse(ex.output);
            expect(parsed).toHaveProperty('entities');
            expect(parsed).toHaveProperty('relationships');
        }
    });

    it('Russian entity names use nominative case', () => {
        const ruExamples = GRAPH_EXAMPLES.filter(ex => ex.label.includes('RU'));
        for (const ex of ruExamples) {
            const parsed = JSON.parse(ex.output);
            for (const entity of parsed.entities) {
                // Nominative Russian names should not end in typical oblique case endings
                // This is a heuristic — mainly checks that "Ошейником" doesn't appear as a name
                expect(entity.name).not.toMatch(/ником$/);
                expect(entity.name).not.toMatch(/нику$/);
            }
        }
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test -- tests/prompts/examples/graph.test.js`
- Expect: FAIL — module not found.

**Step 3: Implementation (Green)**
- File: `src/prompts/examples/graph.js`
- Content: All 8 examples from design doc section 6.3. Each has `label`, `input` (RP snippet + extracted_events section), and `output` (JSON with entities + relationships).

| # | Label | Lang | Level |
|---|-------|------|-------|
| 1 | `World entities (EN/SFW)` | EN | SFW |
| 2 | `Character entities (RU/SFW)` | RU | SFW |
| 3 | `Combat entities (EN/Moderate)` | EN | Moderate |
| 4 | `Romantic entities (RU/Moderate)` | RU | Moderate |
| 5 | `Intimate entities (EN/Explicit)` | EN | Explicit |
| 6 | `Sexual entities (RU/Explicit)` | RU | Explicit |
| 7 | `BDSM entities (EN/Kink)` | EN | Kink |
| 8 | `Power entities (RU/Kink)` | RU | Kink |

Export structure:
```javascript
export const GRAPH_EXAMPLES = [
    {
        label: 'World entities (EN/SFW)',
        input: `[Kira discovery snippet]\n\nExtracted events:\n1. [★★★] Kira discovered...`,
        output: `{"entities": [...], "relationships": [...]}`,
    },
    // ... 7 more per design doc section 6.3
];
```

**Step 4: Verify (Green)**
- Command: `npm test -- tests/prompts/examples/graph.test.js`
- Expect: ALL tests pass.

**Step 5: Git Commit**
```bash
git add -A && git commit -m "feat: add 8 bilingual graph extraction examples (4 EN + 4 RU)"
```

---

## Task 8: Create Question Examples (`src/prompts/examples/questions.js`)

**Goal:** 6 bilingual (3 EN + 3 RU) salient question few-shot examples.

**Step 1: Write the Failing Test**
- File: `tests/prompts/examples/questions.test.js`
```javascript
import { describe, expect, it } from 'vitest';
import { QUESTION_EXAMPLES } from '../../../src/prompts/examples/questions.js';

describe('QUESTION_EXAMPLES', () => {
    it('exports exactly 6 examples', () => {
        expect(QUESTION_EXAMPLES).toHaveLength(6);
    });

    it('each example has label, input, output (no thinking)', () => {
        for (const ex of QUESTION_EXAMPLES) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(ex.thinking).toBeUndefined();
        }
    });

    it('has 3 English and 3 Russian examples', () => {
        expect(QUESTION_EXAMPLES.filter(ex => ex.label.includes('EN'))).toHaveLength(3);
        expect(QUESTION_EXAMPLES.filter(ex => ex.label.includes('RU'))).toHaveLength(3);
    });

    it('all outputs have exactly 3 questions', () => {
        for (const ex of QUESTION_EXAMPLES) {
            const parsed = JSON.parse(ex.output);
            expect(parsed.questions).toHaveLength(3);
        }
    });

    it('Russian examples have Russian questions', () => {
        const cyrillicRe = /[\u0400-\u04FF]/;
        const ruExamples = QUESTION_EXAMPLES.filter(ex => ex.label.includes('RU'));
        for (const ex of ruExamples) {
            expect(cyrillicRe.test(ex.output), `RU example "${ex.label}" should have Cyrillic`).toBe(true);
        }
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test -- tests/prompts/examples/questions.test.js`
- Expect: FAIL — module not found.

**Step 3: Implementation (Green)**
- File: `src/prompts/examples/questions.js`
- Content: All 6 examples from design doc section 6.4.

| # | Label | Lang | Level |
|---|-------|------|-------|
| 1 | `Adventure psychology (EN/SFW)` | EN | SFW |
| 2 | `Isolation patterns (RU/SFW)` | RU | SFW |
| 3 | `Trauma coping (EN/Moderate)` | EN | Moderate |
| 4 | `Romantic vulnerability (RU/Moderate)` | RU | Moderate |
| 5 | `Intimacy patterns (EN/Explicit)` | EN | Explicit |
| 6 | `Submission psychology (RU/Explicit)` | RU | Explicit |

**Step 4: Verify (Green)**
- Command: `npm test -- tests/prompts/examples/questions.test.js`
- Expect: ALL tests pass.

**Step 5: Git Commit**
```bash
git add -A && git commit -m "feat: add 6 bilingual salient question examples (3 EN + 3 RU)"
```

---

## Task 9: Create Insight Examples (`src/prompts/examples/insights.js`)

**Goal:** 6 bilingual (3 EN + 3 RU) insight extraction few-shot examples.

**Step 1: Write the Failing Test**
- File: `tests/prompts/examples/insights.test.js`
```javascript
import { describe, expect, it } from 'vitest';
import { INSIGHT_EXAMPLES } from '../../../src/prompts/examples/insights.js';

describe('INSIGHT_EXAMPLES', () => {
    it('exports exactly 6 examples', () => {
        expect(INSIGHT_EXAMPLES).toHaveLength(6);
    });

    it('each example has label, input, output (no thinking)', () => {
        for (const ex of INSIGHT_EXAMPLES) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(ex.thinking).toBeUndefined();
        }
    });

    it('has 3 English and 3 Russian examples', () => {
        expect(INSIGHT_EXAMPLES.filter(ex => ex.label.includes('EN'))).toHaveLength(3);
        expect(INSIGHT_EXAMPLES.filter(ex => ex.label.includes('RU'))).toHaveLength(3);
    });

    it('all outputs have 1-3 insights with evidence_ids', () => {
        for (const ex of INSIGHT_EXAMPLES) {
            const parsed = JSON.parse(ex.output);
            expect(parsed.insights.length).toBeGreaterThanOrEqual(1);
            expect(parsed.insights.length).toBeLessThanOrEqual(3);
            for (const insight of parsed.insights) {
                expect(insight).toHaveProperty('insight');
                expect(insight).toHaveProperty('evidence_ids');
                expect(insight.evidence_ids.length).toBeGreaterThan(0);
            }
        }
    });

    it('Russian examples have Russian insight text', () => {
        const cyrillicRe = /[\u0400-\u04FF]/;
        const ruExamples = INSIGHT_EXAMPLES.filter(ex => ex.label.includes('RU'));
        for (const ex of ruExamples) {
            const parsed = JSON.parse(ex.output);
            for (const ins of parsed.insights) {
                expect(cyrillicRe.test(ins.insight), `Insight in "${ex.label}" should be Russian`).toBe(true);
            }
        }
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test -- tests/prompts/examples/insights.test.js`
- Expect: FAIL — module not found.

**Step 3: Implementation (Green)**
- File: `src/prompts/examples/insights.js`
- Content: All 6 examples from design doc section 6.5.

| # | Label | Lang | Level |
|---|-------|------|-------|
| 1 | `Deception pattern (EN/SFW)` | EN | SFW |
| 2 | `Isolation pattern (RU/SFW)` | RU | SFW |
| 3 | `Trauma response (EN/Moderate)` | EN | Moderate |
| 4 | `Romantic dependency (RU/Moderate)` | RU | Moderate |
| 5 | `Intimacy coping (EN/Explicit)` | EN | Explicit |
| 6 | `Submission regulation (RU/Explicit)` | RU | Explicit |

**Step 4: Verify (Green)**
- Command: `npm test -- tests/prompts/examples/insights.test.js`
- Expect: ALL tests pass.

**Step 5: Git Commit**
```bash
git add -A && git commit -m "feat: add 6 bilingual insight extraction examples (3 EN + 3 RU)"
```

---

## Task 10: Create Community Examples (`src/prompts/examples/communities.js`)

**Goal:** 6 bilingual (3 EN + 3 RU) community summary few-shot examples.

**Step 1: Write the Failing Test**
- File: `tests/prompts/examples/communities.test.js`
```javascript
import { describe, expect, it } from 'vitest';
import { COMMUNITY_EXAMPLES } from '../../../src/prompts/examples/communities.js';

describe('COMMUNITY_EXAMPLES', () => {
    it('exports exactly 6 examples', () => {
        expect(COMMUNITY_EXAMPLES).toHaveLength(6);
    });

    it('each example has label, input, output (no thinking)', () => {
        for (const ex of COMMUNITY_EXAMPLES) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(ex.thinking).toBeUndefined();
        }
    });

    it('has 3 English and 3 Russian examples', () => {
        expect(COMMUNITY_EXAMPLES.filter(ex => ex.label.includes('EN'))).toHaveLength(3);
        expect(COMMUNITY_EXAMPLES.filter(ex => ex.label.includes('RU'))).toHaveLength(3);
    });

    it('all outputs have title, summary, and 1-5 findings', () => {
        for (const ex of COMMUNITY_EXAMPLES) {
            const parsed = JSON.parse(ex.output);
            expect(parsed).toHaveProperty('title');
            expect(parsed).toHaveProperty('summary');
            expect(parsed).toHaveProperty('findings');
            expect(parsed.findings.length).toBeGreaterThanOrEqual(1);
            expect(parsed.findings.length).toBeLessThanOrEqual(5);
        }
    });

    it('Russian examples have Russian summary and findings', () => {
        const cyrillicRe = /[\u0400-\u04FF]/;
        const ruExamples = COMMUNITY_EXAMPLES.filter(ex => ex.label.includes('RU'));
        for (const ex of ruExamples) {
            const parsed = JSON.parse(ex.output);
            expect(cyrillicRe.test(parsed.summary), `Summary in "${ex.label}" should be Russian`).toBe(true);
            expect(cyrillicRe.test(parsed.findings[0]), `Finding in "${ex.label}" should be Russian`).toBe(true);
        }
    });
});
```

**Step 2: Run Test (Red)**
- Command: `npm test -- tests/prompts/examples/communities.test.js`
- Expect: FAIL — module not found.

**Step 3: Implementation (Green)**
- File: `src/prompts/examples/communities.js`
- Content: All 6 examples from design doc section 6.6.

| # | Label | Lang | Level |
|---|-------|------|-------|
| 1 | `Political faction (EN/SFW)` | EN | SFW |
| 2 | `Social circle (RU/SFW)` | RU | SFW |
| 3 | `Combat alliance (EN/Moderate)` | EN | Moderate |
| 4 | `Romantic triangle (RU/Moderate)` | RU | Moderate |
| 5 | `Intimate network (EN/Explicit)` | EN | Explicit |
| 6 | `Power hierarchy (RU/Explicit)` | RU | Explicit |

**Step 4: Verify (Green)**
- Command: `npm test -- tests/prompts/examples/communities.test.js`
- Expect: ALL tests pass.

**Step 5: Git Commit**
```bash
git add -A && git commit -m "feat: add 6 bilingual community summary examples (3 EN + 3 RU)"
```

---

## Task 11: Rewrite `src/prompts.js` as Lean Orchestrators

**Goal:** Replace all inline prompt text with module imports. Remove all "Write in ENGLISH" constraints. Inject Mirror Language Rules into all 5 prompts. Update preambles to be language-neutral. Update all prompt tests.

> This is the integration task. All modules from Tasks 3-10 must be complete before starting.

**Step 1: Write the Failing Tests**
- File: `tests/prompts.test.js`
- **Add** these new tests (keep all existing tests that test structural properties like message array length, roles, preamble presence):

```javascript
import { MIRROR_LANGUAGE_RULES } from '../src/prompts/rules.js';

describe('multilingual prompt compliance', () => {
    const eventResult = buildEventExtractionPrompt({
        messages: '[A]: test',
        names: { char: 'A', user: 'B' },
        context: {},
    });
    const graphResult = buildGraphExtractionPrompt({
        messages: '[A]: test',
        names: { char: 'A', user: 'B' },
    });
    const salientResult = buildSalientQuestionsPrompt('A', [{ summary: 'test', importance: 3 }]);
    const insightResult = buildInsightExtractionPrompt('A', 'q?', [{ id: '1', summary: 't' }]);
    const communityResult = buildCommunitySummaryPrompt([], []);

    it('all prompts contain mirror language rules', () => {
        for (const result of [eventResult, graphResult, salientResult, insightResult, communityResult]) {
            expect(result[0].content).toContain('LANGUAGE RULES');
            expect(result[0].content).toContain('SAME LANGUAGE');
        }
    });

    it('no prompt contains "Write in ENGLISH" or "Write ALL summaries in ENGLISH"', () => {
        for (const result of [eventResult, graphResult, salientResult, insightResult, communityResult]) {
            const sys = result[0].content;
            const user = result[1].content;
            expect(sys).not.toContain('Write in ENGLISH');
            expect(sys).not.toContain('summaries in ENGLISH');
            expect(sys).not.toContain('Write all questions in English');
            expect(sys).not.toContain('Write all insights in English');
            expect(sys).not.toContain('Write in English');
            expect(user).not.toContain('in ENGLISH');
        }
    });

    it('all prompts contain bilingual few-shot examples', () => {
        for (const result of [eventResult, graphResult, salientResult, insightResult, communityResult]) {
            const sys = result[0].content;
            // Bilingual examples must contain Cyrillic text
            expect(sys).toMatch(/[\u0400-\u04FF]/);
            // Must use numbered example format
            expect(sys).toContain('<example_1>');
        }
    });

    it('event prompt contains think blocks in examples', () => {
        expect(eventResult[0].content).toContain('<think>');
        expect(eventResult[0].content).toContain('</think>');
    });

    it('graph prompt contains nominative normalization rule', () => {
        expect(graphResult[0].content).toContain('Nominative');
        expect(graphResult[0].content).toContain('ошейник');
    });
});
```

- **Update** existing tests that will break:

The test `'instructs raw JSON output without markdown'` checks for `'Start your response with {'` — this line appears in the event output_schema section. Verify it still exists after rewrite, or update the assertion if the wording changes.

The test `'uses unified XML structure with role, output_schema, and examples'` checks for `<role>`, `<output_schema>`, `<examples>` XML tags. After rewrite, the structure uses `## ROLE`, `## OUTPUT FORMAT`, `## EXAMPLES` markdown headers instead of XML tags. **Update these tests:**

```javascript
// BEFORE:
expect(sys).toContain('<role>');
expect(sys).toContain('<output_schema>');
expect(sys).toContain('<examples>');

// AFTER:
expect(sys).toContain('## ROLE');
expect(sys).toContain('<example_1>');  // Examples still present
```

**Wait — decide on format first.** The current prompts use XML tags (`<role>`, `<output_schema>`, etc.). The design doc section 5.4 shows markdown headers (`## ROLE`, `## OUTPUT FORMAT`, etc.). Alternatively, keep XML tags but replace content with module imports. **Recommendation:** Keep the XML tag format to minimize test breakage and maintain compatibility with the existing anti-refusal framing. The content inside the tags changes, but the tag structure stays. If this approach is taken, fewer test updates are needed.

**Decision point for executor:** Use XML tags (minimal test changes) or markdown headers (per design doc). The plan below assumes **XML tags are retained** to minimize breakage. If the executor prefers markdown headers, update the `<role>` → `## ROLE` and `<output_schema>` → `## OUTPUT FORMAT` mappings accordingly.

**Step 2: Run Test (Red)**
- Command: `npm test -- tests/prompts.test.js`
- Expect: New multilingual tests FAIL (no mirror language rules in prompts yet, no bilingual examples, "Write in ENGLISH" still present).

**Step 3: Implementation (Green)**
- File: `src/prompts.js`

**3a. Add imports at top of file:**
```javascript
import { EVENT_EXAMPLES } from './prompts/examples/events.js';
import { GRAPH_EXAMPLES } from './prompts/examples/graph.js';
import { QUESTION_EXAMPLES } from './prompts/examples/questions.js';
import { INSIGHT_EXAMPLES } from './prompts/examples/insights.js';
import { COMMUNITY_EXAMPLES } from './prompts/examples/communities.js';
import { formatExamples } from './prompts/examples/format.js';
import { MIRROR_LANGUAGE_RULES } from './prompts/rules.js';
import { EVENT_ROLE, GRAPH_ROLE, QUESTIONS_ROLE, INSIGHTS_ROLE, COMMUNITIES_ROLE } from './prompts/roles.js';
```

**3b. Update preambles — remove "English JSON" output type:**

In `SYSTEM_PREAMBLE_CN`, change:
```
输出类型：英文 JSON
```
to:
```
输出类型：JSON（键用英文，值用原文语言）
```

In `SYSTEM_PREAMBLE_EN`, change:
```
OUTPUT TYPE: English JSON
```
to:
```
OUTPUT TYPE: JSON (English keys, source-language values)
```

**3c. Rewrite `buildEventExtractionPrompt`:**

Replace the entire `systemPrompt` template literal with a modular assembly. Key changes:
1. Replace inline `<role>...</role>` with `<role>\n${EVENT_ROLE}\n</role>`
2. **Add** `${MIRROR_LANGUAGE_RULES}` between `</role>` and `<output_schema>`
3. In `<output_schema>`, remove: `"summary": "8-25 word description of what happened, past tense, in ENGLISH"` → change to `"summary": "8-25 word description of what happened, past tense"`
4. In `<output_schema>`, remove rule 6: `Write ALL event summaries in ENGLISH. Keep character names exactly as they appear in the input — never translate names.` → Replace with: `Keep character names exactly as they appear in the input.`
5. In `<thinking_process>`, Step 4: remove `in English` from `write a specific factual summary in English` → `write a specific factual summary`
6. Replace inline `<examples>...</examples>` with `<examples>\n${formatExamples(EVENT_EXAMPLES)}\n</examples>`

**3d. Rewrite `buildGraphExtractionPrompt`:**

1. Replace inline `<role>...</role>` with `<role>\n${GRAPH_ROLE}\n</role>`
2. **Add** `${MIRROR_LANGUAGE_RULES}` between `</role>` and `<output_schema>`
3. Replace inline `<examples>...</examples>` with `<examples>\n${formatExamples(GRAPH_EXAMPLES)}\n</examples>`

**3e. Rewrite `buildSalientQuestionsPrompt`:**

1. Replace inline `<role>...</role>` with `<role>\n${QUESTIONS_ROLE}\n</role>`
2. **Add** `${MIRROR_LANGUAGE_RULES}` between `</role>` and `<output_schema>`
3. In `<rules>`, remove: `4. Write all questions in English.`
4. Replace inline `<examples>...</examples>` with `<examples>\n${formatExamples(QUESTION_EXAMPLES)}\n</examples>`

**3f. Rewrite `buildInsightExtractionPrompt`:**

1. Replace inline `<role>...</role>` with `<role>\n${INSIGHTS_ROLE}\n</role>`
2. **Add** `${MIRROR_LANGUAGE_RULES}` between `</role>` and `<output_schema>`
3. In `<rules>`, remove: `5. Write all insights in English.`
4. Replace inline `<examples>...</examples>` with `<examples>\n${formatExamples(INSIGHT_EXAMPLES)}\n</examples>`

**3g. Rewrite `buildCommunitySummaryPrompt`:**

1. Replace inline `<role>...</role>` with `<role>\n${COMMUNITIES_ROLE}\n</role>`
2. **Add** `${MIRROR_LANGUAGE_RULES}` between `</role>` and `<output_schema>`
3. In `<rules>`, remove: `4. Write in English.`
4. Replace inline `<examples>...</examples>` with `<examples>\n${formatExamples(COMMUNITY_EXAMPLES)}\n</examples>`

**3h. Verify no "Write in ENGLISH" remains anywhere in the file:**
- Search for: `ENGLISH`, `in English`, `Write in`, `Write all`
- The only remaining English-related text should be in `MIRROR_LANGUAGE_RULES` (imported) and the preamble's `OUTPUT TYPE: JSON (English keys, source-language values)`.

**Step 4: Verify (Green)**
- Command: `npm test`
- Expect: ALL tests pass (full suite, not just prompts).

**Step 5: Git Commit**
```bash
git add -A && git commit -m "feat: rewrite prompts.js with modular multilingual architecture

- Replace inline roles with imported role modules
- Replace inline examples with bilingual few-shot modules
- Remove all 'Write in ENGLISH' constraints from 5 prompts
- Inject Mirror Language Rules into all prompts
- Update preambles for language-neutral output type
- Retain function signatures and message structure"
```

---

## Task 12: Update `include/ARCHITECTURE.md`

**Goal:** Reflect the new multilingual prompt architecture in the architecture doc.

**Step 1: No failing test** (documentation-only task)

**Step 2: Implementation**
- File: `include/ARCHITECTURE.md`
- In section **"1. DATA FLOW PIPELINES → Background Path → Phase 1: Critical"**:
  - **Stage A (Events)**: Add note about mirror language rule and bilingual examples
  - Remove any mention of "English-only" summaries
- Add new section or update **"3. CORE SYSTEMS SAUCE"** with:

```markdown
**Multilingual Prompt Architecture**:
- *Mirror Language Rule*: All prompts auto-detect input language and mirror it in output string values. JSON keys remain English.
- *Bilingual Examples*: Every prompt includes paired EN/RU few-shot examples (events: 10, graph: 8, questions: 6, insights: 6, communities: 6).
- *SFW→Kink Gradient*: Examples progress from safe to explicit content, calibrating model compliance.
- *Graph Normalization*: Entity names extracted in nominative/base form to prevent morphological duplicates.
- *Stem-Augmented Overlap*: `hasSufficientTokenOverlap()` uses `stemWord()` to catch Russian inflected variants (Check 4).
- *Prompt Modules*: `src/prompts/` contains `rules.js` (shared language rules), `roles.js` (role definitions), `examples/` (bilingual few-shots), `examples/format.js` (XML formatter).
```

- Update the file structure diagram if one exists to include `src/prompts/` tree.

**Step 3: Verify**
- Command: `npm test`
- Expect: ALL tests still pass (no code change, documentation only).

**Step 4: Git Commit**
```bash
git add -A && git commit -m "docs: update ARCHITECTURE.md with multilingual prompt design"
```

---

## Summary: File Change Map

| File | Action | Task |
|------|--------|------|
| `src/extraction/structured.js` | Edit: `min(30)` → `min(20)` | 1 |
| `tests/extraction/structured.test.js` | Add: 2 new tests | 1 |
| `src/graph/graph.js` | Edit: add `stemWord` import, Check 4, LCS `> 3` → `> 2` | 2 |
| `tests/graph/token-overlap.test.js` | Add: 3 new tests | 2 |
| `src/prompts/examples/format.js` | **Create** | 3 |
| `tests/prompts/format.test.js` | **Create** | 3 |
| `src/prompts/rules.js` | **Create** | 4 |
| `tests/prompts/rules.test.js` | **Create** | 4 |
| `src/prompts/roles.js` | **Create** | 5 |
| `tests/prompts/roles.test.js` | **Create** | 5 |
| `src/prompts/examples/events.js` | **Create** | 6 |
| `tests/prompts/examples/events.test.js` | **Create** | 6 |
| `src/prompts/examples/graph.js` | **Create** | 7 |
| `tests/prompts/examples/graph.test.js` | **Create** | 7 |
| `src/prompts/examples/questions.js` | **Create** | 8 |
| `tests/prompts/examples/questions.test.js` | **Create** | 8 |
| `src/prompts/examples/insights.js` | **Create** | 9 |
| `tests/prompts/examples/insights.test.js` | **Create** | 9 |
| `src/prompts/examples/communities.js` | **Create** | 10 |
| `tests/prompts/examples/communities.test.js` | **Create** | 10 |
| `src/prompts.js` | **Rewrite**: modular imports, remove English enforcement, add mirror rules | 11 |
| `tests/prompts.test.js` | **Update**: add multilingual tests, update XML tag assertions | 11 |
| `include/ARCHITECTURE.md` | Edit: add multilingual architecture section | 12 |

**New files:** 16 (8 source + 8 test)
**Modified files:** 6
**Deleted files:** 0

---

## Review 1

### 1. The `s.length > 2` Trap in Task 2 (Stem-Based Overlap)
In your implementation for Task 2, you wrote:
`const stemmedA = new Set([...significantA].map(t => stemWord(t)).filter(s => s.length > 2));`

**The Warning:**
`s.length > 2` means the stem must be at least 3 characters long. Russian has many incredibly short, high-impact root words. 
*   "Яд" (Poison) → Stem: "яд" (2 chars)
*   "Ум" (Mind) → Stem: "ум" (2 chars)
*   "Лес" (Forest) → Stem: "лес" (3 chars, but if the stemmer strips the consonant for some reason, it could be 2).
*   "Юг" (South) → Stem: "юг" (2 chars)

**The Fix:**
Change `.filter(s => s.length > 2)` to `.filter(s => s.length >= 2)`. Two-character stems in Russian are valid and common enough that you don't want to accidentally drop them from the overlap check.

### 2. Zod `min(20)` vs `min(15)` in Task 1
You lowered the threshold to 20. This is a massive improvement over 30. However, consider this perfectly valid, highly-extractable BDSM event:

*   "Он ударил её плетью" (He struck her with a whip) = **19 characters.**
*   "Саша связала Вову" (Sasha tied Vova) = **17 characters.**

**The Fix:**
I still highly recommend dropping it to `min(15)`. It still prevents lazy one-word responses, but `15` is the sweet spot for Subject-Verb-Object sentences in morphologically dense languages where pronouns/prepositions are often baked into the word endings.

### 3. Ensure the Optimized `SYSTEM_PREAMBLE_EN` is Used (Task 11)
In Task 11, you mention updating `SYSTEM_PREAMBLE_EN` by changing the `OUTPUT TYPE` line. 
Just make sure you are using the full, clinical, anti-refusal English preamble we designed in the previous step (the one that explicitly mentions "mature/extreme" and "forensic data extraction"), rather than just translating the Chinese one verbatim. The clinical framing is what will keep the mid-tier models obedient when processing the Kink/Explicit examples.

### 4. Git Commit Granularity (Praise)
Your commit strategy is excellent. Keeping the rules, roles, formatters, and examples in separate atomic commits before the final orchestrator rewrite (Task 11) will make this PR incredibly easy to revert or bisect if a specific prompt starts acting up later.
