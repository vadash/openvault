# Prompt Module Refactoring — Implementation Plan

**Goal:** Restructure `src/prompts/` from a flat layout with a 620-line god file into domain-based folders with per-language example files, preserving the public API unchanged.

**Architecture:** 4 domain folders (events, graph, reflection, communities) each containing role/schema/rules/builder + examples/en.js + examples/ru.js. A `shared/` folder holds formatters, preambles, rules, and example formatting. A barrel `index.js` re-exports everything so consumers don't change.

**Tech Stack:** JavaScript ES modules, Vitest for testing.

**Test command:** `npx vitest run tests/prompts.test.js --reporter=verbose`

**Design doc:** `docs/designs/2026-03-15-prompt-refactoring.md`

---

### Task 1: Create shared/ — move formatters, preambles, rules, format-examples

**Files:**
- Create: `src/prompts/shared/formatters.js` (copy from `src/prompts/formatters.js`)
- Create: `src/prompts/shared/preambles.js` (copy from `src/prompts/preambles.js`)
- Create: `src/prompts/shared/rules.js` (copy from `src/prompts/rules.js`)
- Create: `src/prompts/shared/format-examples.js` (copy from `src/prompts/examples/format.js`)

These are pure copies. The old files remain until the final cleanup task.

- [ ] Step 1: Create `src/prompts/shared/` directory and copy 4 files

Copy each file verbatim. The only change is `shared/formatters.js` must update its internal imports to point to new locations:

`src/prompts/shared/formatters.js` — change these import paths:
```js
// OLD:
import { formatExamples } from './examples/format.js';
import { SYSTEM_PREAMBLE_CN } from './preambles.js';
import { MIRROR_LANGUAGE_RULES } from './rules.js';

// NEW:
import { formatExamples } from './format-examples.js';
import { SYSTEM_PREAMBLE_CN } from './preambles.js';
import { MIRROR_LANGUAGE_RULES } from './rules.js';
```

The `sortMemoriesBySequence` import stays relative to `src/utils/text.js`:
```js
// OLD:
import { sortMemoriesBySequence } from '../utils/text.js';
// NEW:
import { sortMemoriesBySequence } from '../../utils/text.js';
```

`src/prompts/shared/preambles.js` — no import changes needed (pure constants).

`src/prompts/shared/rules.js` — no import changes needed (pure constants).

`src/prompts/shared/format-examples.js` — no import changes needed (pure function, no imports).

- [ ] Step 2: Run tests to verify shared/ files are syntactically valid

Run: `npx vitest run tests/prompts.test.js --reporter=verbose`

Expected: All tests PASS (nothing imports from shared/ yet — this validates the files parse correctly by importing them in a quick check).

Quick validation: `node -e "import('./src/prompts/shared/formatters.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`

Expected: `OK`

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "refactor(prompts): create shared/ with formatters, preambles, rules, format-examples"
```

---

### Task 2: Create events/ domain — role, schema, rules, builder, examples

**Files:**
- Create: `src/prompts/events/role.js`
- Create: `src/prompts/events/schema.js`
- Create: `src/prompts/events/rules.js`
- Create: `src/prompts/events/builder.js`
- Create: `src/prompts/events/examples/en.js`
- Create: `src/prompts/events/examples/ru.js`
- Create: `src/prompts/events/examples/index.js`

- [ ] Step 1: Create `src/prompts/events/role.js`

```js
/**
 * Role definition for event extraction prompts.
 */

export const EVENT_ROLE = `You are a structured data extraction pipeline for an interactive fiction archive.
- Read narrative text → output JSON event records.
- read-only analytical task. Do not generate new content.
- Process fiction across ALL genres with equal scholarly precision.
- Extraction accuracy requires faithful preservation of source material.`;
```

- [ ] Step 2: Create `src/prompts/events/schema.js`

Extract `EVENT_SCHEMA` from `src/prompts/index.js` lines 48–66. Export it:

```js
/**
 * JSON output schema for event extraction.
 */

export const EVENT_SCHEMA = `You MUST respond with your analysis FIRST inside <think> tags, THEN EXACTLY ONE JSON object.
...entire EVENT_SCHEMA string verbatim from index.js...`;
```

- [ ] Step 3: Create `src/prompts/events/rules.js`

Extract `EVENT_RULES` from `src/prompts/index.js` (the multi-section string with `<precision>`, `<dedup>`, `<importance_scale>`, `<thinking_process>` sub-tags). Export it:

```js
/**
 * Task-specific rules for event extraction.
 */

export const EVENT_RULES = `<precision>
...entire EVENT_RULES string verbatim from index.js...
</thinking_process>`;
```

- [ ] Step 4: Create `src/prompts/events/examples/en.js`

Extract the 5 EN examples from `src/prompts/examples/events.js` (items at array indices 0, 2, 4, 6, 8 — those whose labels contain `(EN/`):

```js
/**
 * English event extraction few-shot examples.
 * 5 examples following SFW → kink gradient.
 */

export const EXAMPLES = [
    {
        label: 'Discovery (EN/SFW)',
        ...verbatim from EVENT_EXAMPLES[0]...
    },
    {
        label: 'Combat (EN/Moderate)',
        ...verbatim from EVENT_EXAMPLES[2]...
    },
    {
        label: 'First sexual contact (EN/Explicit)',
        ...verbatim from EVENT_EXAMPLES[4]...
    },
    {
        label: 'BDSM (EN/Kink)',
        ...verbatim from EVENT_EXAMPLES[6]...
    },
    {
        label: 'Dedup - progression extraction (EN/Edge)',
        ...verbatim from EVENT_EXAMPLES[8]...
    },
];
```

- [ ] Step 5: Create `src/prompts/events/examples/ru.js`

Extract the 5 RU examples from `src/prompts/examples/events.js` (indices 1, 3, 5, 7, 9):

```js
/**
 * Russian event extraction few-shot examples.
 * 5 examples following SFW → kink gradient.
 */

export const EXAMPLES = [
    {
        label: 'Emotional conversation (RU/SFW)',
        ...verbatim from EVENT_EXAMPLES[1]...
    },
    {
        label: 'Romantic tension (RU/Moderate)',
        ...verbatim from EVENT_EXAMPLES[3]...
    },
    {
        label: 'Sexual scene (RU/Explicit)',
        ...verbatim from EVENT_EXAMPLES[5]...
    },
    {
        label: 'Power dynamic (RU/Kink)',
        ...verbatim from EVENT_EXAMPLES[7]...
    },
    {
        label: 'Dedup - continuation (RU/Edge)',
        ...verbatim from EVENT_EXAMPLES[9]...
    },
];
```

- [ ] Step 6: Create `src/prompts/events/examples/index.js`

```js
import { EXAMPLES as EN } from './en.js';
import { EXAMPLES as RU } from './ru.js';

export function getExamples(language = 'auto') {
    if (language === 'en') return EN;
    if (language === 'ru') return RU;
    return [...EN, ...RU];
}
```

- [ ] Step 7: Create `src/prompts/events/builder.js`

Extract `buildEventExtractionPrompt` from `src/prompts/index.js`. Update imports to reference new locations:

```js
/**
 * Event extraction prompt builder (Stage A).
 */

import {
    assembleSystemPrompt,
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
 * Extracts events only, not entities or relationships.
 * @returns {Array<{role: string, content: string}>} Array of message objects
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
        schema: EVENT_SCHEMA,
        rules: EVENT_RULES,
        examples: getExamples(outputLanguage),
        outputLanguage,
    });

    const memoriesSection = formatEstablishedMemories(existingMemories);
    const charactersSection = formatCharacters(characterName, userName, characterDescription, personaDescription);
    const contextParts = [memoriesSection, charactersSection].filter(Boolean).join('\n');
    const contextSection = contextParts ? `<context>\n${contextParts}\n</context>\n` : '';

    const languageInstruction = resolveLanguageInstruction(messages, outputLanguage);
    const userPrompt = `${contextSection}
<messages>
${messages}
</messages>
${languageInstruction}
Analyze the messages above. Extract events only.
Use EXACT character names: ${characterName}, ${userName}. Never transliterate these names into another script.
Write your analysis inside <think> tags FIRST, then output the JSON object with "events" key. No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill ?? '<think>\n', preamble);
}
```

Note: The key change is `examples: getExamples(outputLanguage)` instead of `examples: EVENT_EXAMPLES`. The `getExamples` function returns the same array shape, so `assembleSystemPrompt` → `formatExamples` works unchanged.

- [ ] Step 8: Run tests to verify events/ files parse correctly

Run: `node -e "import('./src/prompts/events/builder.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`

Expected: `OK`

- [ ] Step 9: Commit

```bash
git add -A && git commit -m "refactor(prompts): create events/ domain (role, schema, rules, builder, examples)"
```

---

### Task 3: Create graph/ domain — role, schema, rules, builder, examples

**Files:**
- Create: `src/prompts/graph/role.js`
- Create: `src/prompts/graph/schema.js`
- Create: `src/prompts/graph/rules.js`
- Create: `src/prompts/graph/builder.js`
- Create: `src/prompts/graph/examples/en.js`
- Create: `src/prompts/graph/examples/ru.js`
- Create: `src/prompts/graph/examples/index.js`

- [ ] Step 1: Create `src/prompts/graph/role.js`

```js
/**
 * Role definitions for graph extraction and edge consolidation prompts.
 */

export const GRAPH_ROLE = `You are a knowledge graph extraction pipeline for an interactive fiction archive.
...verbatim from roles.js GRAPH_ROLE...`;

export const EDGE_CONSOLIDATION_ROLE = `You are a relationship state synthesizer for a knowledge graph.
Combine multiple relationship description segments into a single, coherent summary that preserves narrative depth.`;
```

- [ ] Step 2: Create `src/prompts/graph/schema.js`

Extract `GRAPH_SCHEMA` and `EDGE_CONSOLIDATION_SCHEMA` from `src/prompts/index.js`:

```js
/**
 * JSON output schemas for graph extraction and edge consolidation.
 */

export const GRAPH_SCHEMA = `...verbatim...`;

export const EDGE_CONSOLIDATION_SCHEMA = `...verbatim...`;
```

- [ ] Step 3: Create `src/prompts/graph/rules.js`

Extract `GRAPH_RULES` and `EDGE_CONSOLIDATION_RULES` from `src/prompts/index.js`:

```js
/**
 * Task-specific rules for graph extraction and edge consolidation.
 */

export const GRAPH_RULES = `...verbatim...`;

export const EDGE_CONSOLIDATION_RULES = `...verbatim...`;
```

- [ ] Step 4: Create `src/prompts/graph/examples/en.js`

Extract the 4 EN examples from `src/prompts/examples/graph.js` (indices 0, 2, 4, 6):

```js
/**
 * English graph extraction few-shot examples.
 */

export const EXAMPLES = [
    { label: 'World entities (EN/SFW)', ... },
    { label: 'Combat entities (EN/Moderate)', ... },
    { label: 'Intimate entities (EN/Explicit)', ... },
    { label: 'BDSM entities (EN/Kink)', ... },
];
```

- [ ] Step 5: Create `src/prompts/graph/examples/ru.js`

Extract the 4 RU examples (indices 1, 3, 5, 7):

```js
/**
 * Russian graph extraction few-shot examples.
 */

export const EXAMPLES = [
    { label: 'Character entities (RU/SFW)', ... },
    { label: 'Romantic entities (RU/Moderate)', ... },
    { label: 'Sexual entities (RU/Explicit)', ... },
    { label: 'Power entities (RU/Kink)', ... },
];
```

- [ ] Step 6: Create `src/prompts/graph/examples/index.js`

```js
import { EXAMPLES as EN } from './en.js';
import { EXAMPLES as RU } from './ru.js';

export function getExamples(language = 'auto') {
    if (language === 'en') return EN;
    if (language === 'ru') return RU;
    return [...EN, ...RU];
}
```

- [ ] Step 7: Create `src/prompts/graph/builder.js`

Extract `buildGraphExtractionPrompt` and `buildEdgeConsolidationPrompt` from `src/prompts/index.js`. Update imports:

```js
/**
 * Graph extraction and edge consolidation prompt builders.
 */

import {
    assembleSystemPrompt,
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
        schema: GRAPH_SCHEMA,
        rules: GRAPH_RULES,
        examples: getExamples(outputLanguage),
        outputLanguage,
    });

    const charactersSection = formatCharacters(characterName, userName, characterDescription, personaDescription);
    const contextSection = charactersSection ? `<context>\n${charactersSection}\n</context>\n` : '';
    const eventsSection =
        extractedEvents.length > 0 ? `<extracted_events>\n${extractedEvents.join('\n')}\n</extracted_events>\n` : '';

    const languageInstruction = resolveLanguageInstruction(messages, outputLanguage);
    const userPrompt = `${contextSection}
<messages>
${messages}
</messages>

${eventsSection}${languageInstruction}
Based on the messages${extractedEvents.length > 0 ? ' and extracted events above' : ''}, extract named entities and relationships.
Use EXACT character names: ${characterName}, ${userName}. Never transliterate these names into another script.
Respond with a single JSON object containing 'entities' and 'relationships' keys. No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}

export function buildEdgeConsolidationPrompt(edgeData, preamble, outputLanguage = 'auto', prefill) {
    if (!prefill) {
        throw new Error('buildEdgeConsolidationPrompt: prefill is required');
    }

    const systemPrompt = assembleSystemPrompt({
        role: EDGE_CONSOLIDATION_ROLE,
        schema: EDGE_CONSOLIDATION_SCHEMA,
        rules: EDGE_CONSOLIDATION_RULES,
        examples: [],
        outputLanguage,
    });

    const segments = edgeData.description.split(' | ');
    const segmentText = segments.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const languageInstruction = resolveLanguageInstruction(segmentText, outputLanguage);
    const userPrompt = `<edge_data>
Source: ${edgeData.source}
Target: ${edgeData.target}
Weight: ${edgeData.weight}

Timeline segments:
${segmentText}
</edge_data>
${languageInstruction}
Synthesize these relationship developments into ONE unified description.
Respond with a single JSON object containing "consolidated_description". No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}
```

- [ ] Step 8: Verify graph/ files parse

Run: `node -e "import('./src/prompts/graph/builder.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`

Expected: `OK`

- [ ] Step 9: Commit

```bash
git add -A && git commit -m "refactor(prompts): create graph/ domain (role, schema, rules, builder, examples)"
```

---

### Task 4: Create reflection/ domain — role, schema, rules, builder, examples

**Files:**
- Create: `src/prompts/reflection/role.js`
- Create: `src/prompts/reflection/schema.js`
- Create: `src/prompts/reflection/rules.js`
- Create: `src/prompts/reflection/builder.js`
- Create: `src/prompts/reflection/examples/en.js`
- Create: `src/prompts/reflection/examples/ru.js`
- Create: `src/prompts/reflection/examples/index.js`

- [ ] Step 1: Create `src/prompts/reflection/role.js`

```js
/**
 * Role definitions for reflection, question, and insight prompts.
 */

export const UNIFIED_REFLECTION_ROLE = `You are an expert psychological analyst. Generate high-level insights about a character's internal state, relationships, and trajectory based on their recent experiences.`;

export const QUESTIONS_ROLE = `You are a character psychologist analyzing a character's memory stream in an ongoing narrative.
- Generate high-level questions that capture the most important themes about the character's current state.
- Focus on patterns, emotional arcs, and unresolved conflicts.`;

export const INSIGHTS_ROLE = `You are a narrative analyst synthesizing memories into high-level insights for a character in an ongoing story.
- Given a question and relevant memories, extract insights that answer the question.
- Synthesize across multiple memories to reveal patterns and dynamics.`;
```

- [ ] Step 2: Create `src/prompts/reflection/schema.js`

Extract `UNIFIED_REFLECTION_SCHEMA`, `QUESTIONS_SCHEMA`, and `INSIGHTS_SCHEMA` from `src/prompts/index.js`:

```js
/**
 * JSON output schemas for reflection, question, and insight prompts.
 */

export const UNIFIED_REFLECTION_SCHEMA = `...verbatim...`;

export const QUESTIONS_SCHEMA = `...verbatim...`;

export const INSIGHTS_SCHEMA = `...verbatim...`;
```

- [ ] Step 3: Create `src/prompts/reflection/rules.js`

Extract `UNIFIED_REFLECTION_RULES`, `QUESTIONS_RULES`, and `INSIGHTS_RULES`:

```js
/**
 * Task-specific rules for reflection, question, and insight prompts.
 */

export const UNIFIED_REFLECTION_RULES = `...verbatim...`;

export const QUESTIONS_RULES = `...verbatim...`;

export const INSIGHTS_RULES = `...verbatim...`;
```

- [ ] Step 4: Create `src/prompts/reflection/examples/en.js`

This file has **named exports** for the 3 sub-types.

Extract from:
- `src/prompts/examples/questions.js` — items with `(EN/` in label (indices 0, 2, 4)
- `src/prompts/examples/reflections.js` — items with `(EN/` in label (indices 0, 2, 4)
- `src/prompts/examples/insights.js` — items with `(EN/` in label (indices 0, 2, 4)

```js
/**
 * English reflection-domain few-shot examples.
 * Covers questions, unified reflections, and insights.
 */

export const QUESTIONS = [
    { label: 'Adventure psychology (EN/SFW)', ...verbatim from QUESTION_EXAMPLES[0]... },
    { label: 'Trauma coping (EN/Moderate)', ...verbatim from QUESTION_EXAMPLES[2]... },
    { label: 'Intimacy patterns (EN/Explicit)', ...verbatim from QUESTION_EXAMPLES[4]... },
];

export const REFLECTIONS = [
    { label: 'Deception pattern (EN/SFW)', ...verbatim from UNIFIED_REFLECTION_EXAMPLES[0]... },
    { label: 'Trauma processing (EN/Moderate)', ...verbatim from UNIFIED_REFLECTION_EXAMPLES[2]... },
    { label: 'Intimacy as coping (EN/Explicit)', ...verbatim from UNIFIED_REFLECTION_EXAMPLES[4]... },
];

export const INSIGHTS = [
    { label: 'Deception pattern (EN/SFW)', ...verbatim from INSIGHT_EXAMPLES[0]... },
    { label: 'Trauma response (EN/Moderate)', ...verbatim from INSIGHT_EXAMPLES[2]... },
    { label: 'Intimacy as coping (EN/Explicit)', ...verbatim from INSIGHT_EXAMPLES[4]... },
];
```

- [ ] Step 5: Create `src/prompts/reflection/examples/ru.js`

Same structure, RU examples (indices 1, 3, 5):

```js
/**
 * Russian reflection-domain few-shot examples.
 */

export const QUESTIONS = [
    { label: 'Isolation patterns (RU/SFW)', ...verbatim from QUESTION_EXAMPLES[1]... },
    { label: 'Romantic vulnerability (RU/Moderate)', ...verbatim from QUESTION_EXAMPLES[3]... },
    { label: 'Submission psychology (RU/Explicit)', ...verbatim from QUESTION_EXAMPLES[5]... },
];

export const REFLECTIONS = [
    { label: 'Изоляция и зависимость (RU/SFW)', ...verbatim from UNIFIED_REFLECTION_EXAMPLES[1]... },
    { label: 'Романтическая уязвимость (RU/Moderate)', ...verbatim from UNIFIED_REFLECTION_EXAMPLES[3]... },
    { label: 'Субмиссия как регуляция (RU/Explicit)', ...verbatim from UNIFIED_REFLECTION_EXAMPLES[5]... },
];

export const INSIGHTS = [
    { label: 'Isolation pattern (RU/SFW)', ...verbatim from INSIGHT_EXAMPLES[1]... },
    { label: 'Romantic dependency (RU/Moderate)', ...verbatim from INSIGHT_EXAMPLES[3]... },
    { label: 'Submission regulation (RU/Explicit)', ...verbatim from INSIGHT_EXAMPLES[5]... },
];
```

- [ ] Step 6: Create `src/prompts/reflection/examples/index.js`

```js
import * as en from './en.js';
import * as ru from './ru.js';

const langs = { en, ru };

/**
 * Get examples for a specific sub-type and language.
 * @param {'QUESTIONS'|'REFLECTIONS'|'INSIGHTS'} type - Example sub-type
 * @param {'auto'|'en'|'ru'} [language='auto'] - Language filter
 * @returns {Array} Filtered examples
 */
export function getExamples(type, language = 'auto') {
    if (language !== 'auto') return langs[language]?.[type] || [];
    return [...(en[type] || []), ...(ru[type] || [])];
}
```

- [ ] Step 7: Create `src/prompts/reflection/builder.js`

Extract `buildUnifiedReflectionPrompt` from `src/prompts/index.js`. Update imports:

```js
/**
 * Unified reflection prompt builder.
 */

import {
    assembleSystemPrompt,
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
        schema: UNIFIED_REFLECTION_SCHEMA,
        rules,
        examples: getExamples('REFLECTIONS', outputLanguage),
        outputLanguage,
    });

    const languageInstruction = resolveLanguageInstruction(memoryList, outputLanguage);

    const levelAwareInstruction = hasOldReflections
        ? `\n\nLEVEL-AWARE SYNTHESIS MODE:\nSome memories are existing reflections (marked [Ref L1], [Ref L2]). You may synthesize them into higher-level meta-insights.\n- Level 2 insights should distill common patterns across multiple Level 1 reflections.\n- When synthesizing reflections, cite the reflection IDs as evidence_ids.\n`
        : '';

    const userPrompt = `<character>${characterName}</character>

<recent_memories>
${memoryList}
</recent_memories>

${languageInstruction}${levelAwareInstruction}
Based on these memories about ${characterName}:
1. Generate 1-3 salient high-level questions about their current psychological state, relationships, goals, or unresolved conflicts.
2. For each question, provide a deep insight that synthesizes patterns across the memories.
3. Cite specific memory IDs as evidence for each insight. You MUST use IDs exactly as shown above.

Respond with a single JSON object containing a "reflections" array with 1-3 items. No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}
```

**Critical note:** The original `index.js` used `UNIFIED_REFLECTION_EXAMPLES` (the full mixed array). The new code uses `getExamples('REFLECTIONS', outputLanguage)`. This returns the same items — the REFLECTIONS named export in en.js/ru.js contains exactly the same objects that were in `UNIFIED_REFLECTION_EXAMPLES` filtered by language tag.

- [ ] Step 8: Verify reflection/ files parse

Run: `node -e "import('./src/prompts/reflection/builder.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`

Expected: `OK`

- [ ] Step 9: Commit

```bash
git add -A && git commit -m "refactor(prompts): create reflection/ domain (role, schema, rules, builder, examples)"
```

---

### Task 5: Create communities/ domain — role, schema, rules, builder, examples

**Files:**
- Create: `src/prompts/communities/role.js`
- Create: `src/prompts/communities/schema.js`
- Create: `src/prompts/communities/rules.js`
- Create: `src/prompts/communities/builder.js`
- Create: `src/prompts/communities/examples/en.js`
- Create: `src/prompts/communities/examples/ru.js`
- Create: `src/prompts/communities/examples/index.js`

- [ ] Step 1: Create `src/prompts/communities/role.js`

```js
/**
 * Role definitions for community summarization and global synthesis prompts.
 */

export const COMMUNITIES_ROLE = `You are a knowledge graph analyst summarizing communities of related entities from a narrative.
- Write comprehensive reports about groups of connected entities and their relationships.
- Capture narrative significance, power dynamics, alliances, conflicts, and dependencies.`;

export const GLOBAL_SYNTHESIS_ROLE = `You are a narrative synthesis expert. Your task is to weave multiple community summaries into a single, coherent global narrative that captures the current state of the story.

Focus on:
- Macro-level relationships and tensions between communities
- Overarching plot trajectory and unresolved conflicts
- Thematic connections across different story threads
- The "big picture" of what is happening in the world

Write in a storytelling style that emphasizes patterns, evolution, and cause-effect relationships across communities. Your summary should feel like a narrator stepping back to describe the forest rather than individual trees.`;
```

- [ ] Step 2: Create `src/prompts/communities/schema.js`

Extract `COMMUNITY_SCHEMA` and `GLOBAL_SYNTHESIS_SCHEMA`:

```js
/**
 * JSON output schemas for community summarization and global synthesis.
 */

export const COMMUNITY_SCHEMA = `...verbatim...`;

export const GLOBAL_SYNTHESIS_SCHEMA = `...verbatim...`;
```

- [ ] Step 3: Create `src/prompts/communities/rules.js`

Extract `COMMUNITY_RULES` and `GLOBAL_SYNTHESIS_RULES`:

```js
/**
 * Task-specific rules for community summarization and global synthesis.
 */

export const COMMUNITY_RULES = `...verbatim...`;

export const GLOBAL_SYNTHESIS_RULES = `...verbatim...`;
```

- [ ] Step 4: Create `src/prompts/communities/examples/en.js`

Named exports for COMMUNITIES (3 EN from `communities.js` indices 0, 2, 4) and GLOBAL_SYNTHESIS (2 EN from `global-synthesis.js` indices 0, 2):

```js
/**
 * English community and global synthesis few-shot examples.
 */

export const COMMUNITIES = [
    { label: 'Political faction (EN/SFW)', ...verbatim from COMMUNITY_EXAMPLES[0]... },
    { label: 'Combat alliance (EN/Moderate)', ...verbatim from COMMUNITY_EXAMPLES[2]... },
    { label: 'Intimate network (EN/Explicit)', ...verbatim from COMMUNITY_EXAMPLES[4]... },
];

export const GLOBAL_SYNTHESIS = [
    { label: 'Political intrigue (EN)', ...verbatim from GLOBAL_SYNTHESIS_EXAMPLES[0]... },
    { label: 'War narrative (EN)', ...verbatim from GLOBAL_SYNTHESIS_EXAMPLES[2]... },
];
```

- [ ] Step 5: Create `src/prompts/communities/examples/ru.js`

```js
/**
 * Russian community and global synthesis few-shot examples.
 */

export const COMMUNITIES = [
    { label: 'Social circle (RU/SFW)', ...verbatim from COMMUNITY_EXAMPLES[1]... },
    { label: 'Romantic triangle (RU/Moderate)', ...verbatim from COMMUNITY_EXAMPLES[3]... },
    { label: 'Power hierarchy (RU/Explicit)', ...verbatim from COMMUNITY_EXAMPLES[5]... },
];

export const GLOBAL_SYNTHESIS = [
    { label: 'Social evolution (RU)', ...verbatim from GLOBAL_SYNTHESIS_EXAMPLES[1]... },
    { label: 'Romantic drama (RU)', ...verbatim from GLOBAL_SYNTHESIS_EXAMPLES[3]... },
];
```

- [ ] Step 6: Create `src/prompts/communities/examples/index.js`

```js
import * as en from './en.js';
import * as ru from './ru.js';

const langs = { en, ru };

/**
 * Get examples for a specific sub-type and language.
 * @param {'COMMUNITIES'|'GLOBAL_SYNTHESIS'} type - Example sub-type
 * @param {'auto'|'en'|'ru'} [language='auto'] - Language filter
 * @returns {Array} Filtered examples
 */
export function getExamples(type, language = 'auto') {
    if (language !== 'auto') return langs[language]?.[type] || [];
    return [...(en[type] || []), ...(ru[type] || [])];
}
```

- [ ] Step 7: Create `src/prompts/communities/builder.js`

Extract `buildCommunitySummaryPrompt` and `buildGlobalSynthesisPrompt`:

```js
/**
 * Community summarization and global synthesis prompt builders.
 */

import {
    assembleSystemPrompt,
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
        schema: COMMUNITY_SCHEMA,
        rules: COMMUNITY_RULES,
        examples: getExamples('COMMUNITIES', outputLanguage),
        outputLanguage,
    });

    const entityText = nodeLines.join('\n');
    const languageInstruction = resolveLanguageInstruction(entityText, outputLanguage);
    const userPrompt = `<community_entities>
${entityText}
</community_entities>

<community_relationships>
${edgeLines.join('\n')}
</community_relationships>
${languageInstruction}
Write a comprehensive report about this community of entities.
Respond with a single JSON object containing title, summary, and 1-5 findings. No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}

export function buildGlobalSynthesisPrompt(communities, preamble, outputLanguage = 'auto', prefill) {
    if (!prefill) {
        throw new Error('buildGlobalSynthesisPrompt: prefill is required');
    }

    const systemPrompt = assembleSystemPrompt({
        role: GLOBAL_SYNTHESIS_ROLE,
        schema: GLOBAL_SYNTHESIS_SCHEMA,
        rules: GLOBAL_SYNTHESIS_RULES,
        examples: getExamples('GLOBAL_SYNTHESIS', outputLanguage),
        outputLanguage,
    });

    const communityText = communities.map((c, i) =>
        `${i + 1}. ${c.title}\n${c.summary}${c.findings?.length ? '\nKey findings: ' + c.findings.join('; ') : ''}`
    ).join('\n\n');

    const languageInstruction = resolveLanguageInstruction(communityText, outputLanguage);
    const userPrompt = `<communities>
${communityText}
</communities>

${languageInstruction}
Synthesize these community summaries into a single global narrative (max ~300 tokens).
Focus on macro-relationships, overarching tensions, and plot trajectory.

Respond with a single JSON object containing "global_summary". No other text.`;

    return buildMessages(systemPrompt, userPrompt, prefill, preamble);
}
```

- [ ] Step 8: Verify communities/ files parse

Run: `node -e "import('./src/prompts/communities/builder.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`

Expected: `OK`

- [ ] Step 9: Commit

```bash
git add -A && git commit -m "refactor(prompts): create communities/ domain (role, schema, rules, builder, examples)"
```

---

### Task 6: Replace index.js with barrel re-exports, delete old files

**Files:**
- Modify: `src/prompts/index.js` (replace 620-line god file with ~25-line barrel)
- Delete: `src/prompts/formatters.js`
- Delete: `src/prompts/preambles.js`
- Delete: `src/prompts/roles.js`
- Delete: `src/prompts/rules.js`
- Delete: `src/prompts/examples/events.js`
- Delete: `src/prompts/examples/graph.js`
- Delete: `src/prompts/examples/questions.js`
- Delete: `src/prompts/examples/reflections.js`
- Delete: `src/prompts/examples/insights.js`
- Delete: `src/prompts/examples/communities.js`
- Delete: `src/prompts/examples/global-synthesis.js`
- Delete: `src/prompts/examples/format.js`

- [ ] Step 1: Replace `src/prompts/index.js` with barrel re-exports

Replace the entire file with:

```js
/**
 * OpenVault Prompts — Public API
 *
 * Barrel re-exports from domain modules.
 * Consumers import from this file; internal structure is hidden.
 */

// Shared
export {
    PREFILL_PRESETS,
    SYSTEM_PREAMBLE_CN,
    SYSTEM_PREAMBLE_EN,
    resolveExtractionPreamble,
    resolveExtractionPrefill,
    resolveOutputLanguage,
} from './shared/preambles.js';

// Events
export { buildEventExtractionPrompt } from './events/builder.js';

// Graph
export { buildGraphExtractionPrompt, buildEdgeConsolidationPrompt } from './graph/builder.js';

// Reflection
export { buildUnifiedReflectionPrompt } from './reflection/builder.js';

// Communities
export { buildCommunitySummaryPrompt, buildGlobalSynthesisPrompt } from './communities/builder.js';
```

- [ ] Step 2: Update `src/ui/settings.js` import path

The file at `src/ui/settings.js:70` imports directly from the old preambles path:
```js
// OLD:
import { PREFILL_PRESETS } from '../prompts/preambles.js';
// NEW:
import { PREFILL_PRESETS } from '../prompts/index.js';
```

This is the only consumer that imports from a non-index path. All other consumers already import from `../prompts/index.js`.

- [ ] Step 3: Delete old files

```bash
rm src/prompts/formatters.js
rm src/prompts/preambles.js
rm src/prompts/roles.js
rm src/prompts/rules.js
rm -rf src/prompts/examples/
```

- [ ] Step 4: Run full test suite

Run: `npx vitest run tests/prompts.test.js --reporter=verbose`

Expected: All existing tests PASS. Every test imports from `src/prompts/index.js`, which now re-exports from domain modules. The public API is identical.

- [ ] Step 5: Run full project tests

Run: `npx vitest run --reporter=verbose`

Expected: All tests PASS.

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "refactor(prompts): replace index.js with barrel, delete old files

index.js is now a ~25-line barrel re-exporting from domain modules.
Old flat files (formatters.js, preambles.js, roles.js, rules.js,
examples/) deleted. settings.js import updated to use index.js.

Zero consumer API changes — all 5 import sites unchanged."
```

---

### Task 7: Add structural smoke tests for new module organization

**Files:**
- Modify: `tests/prompts.test.js` (add new describe blocks)

These tests validate the new structure works correctly beyond just "old tests still pass."

- [ ] Step 1: Add smoke tests to `tests/prompts.test.js`

Append to the end of the file:

```js
describe('domain module structure', () => {
    it('events/examples returns correct count per language', async () => {
        const { getExamples } = await import('../src/prompts/events/examples/index.js');
        expect(getExamples('en')).toHaveLength(5);
        expect(getExamples('ru')).toHaveLength(5);
        expect(getExamples('auto')).toHaveLength(10);
    });

    it('graph/examples returns correct count per language', async () => {
        const { getExamples } = await import('../src/prompts/graph/examples/index.js');
        expect(getExamples('en')).toHaveLength(4);
        expect(getExamples('ru')).toHaveLength(4);
        expect(getExamples('auto')).toHaveLength(8);
    });

    it('reflection/examples returns correct count per type and language', async () => {
        const { getExamples } = await import('../src/prompts/reflection/examples/index.js');
        expect(getExamples('REFLECTIONS', 'en')).toHaveLength(3);
        expect(getExamples('REFLECTIONS', 'ru')).toHaveLength(3);
        expect(getExamples('REFLECTIONS', 'auto')).toHaveLength(6);
        expect(getExamples('QUESTIONS', 'en')).toHaveLength(3);
        expect(getExamples('INSIGHTS', 'ru')).toHaveLength(3);
    });

    it('communities/examples returns correct count per type and language', async () => {
        const { getExamples } = await import('../src/prompts/communities/examples/index.js');
        expect(getExamples('COMMUNITIES', 'en')).toHaveLength(3);
        expect(getExamples('COMMUNITIES', 'ru')).toHaveLength(3);
        expect(getExamples('COMMUNITIES', 'auto')).toHaveLength(6);
        expect(getExamples('GLOBAL_SYNTHESIS', 'en')).toHaveLength(2);
        expect(getExamples('GLOBAL_SYNTHESIS', 'ru')).toHaveLength(2);
        expect(getExamples('GLOBAL_SYNTHESIS', 'auto')).toHaveLength(4);
    });

    it('all example objects have required fields', async () => {
        const events = await import('../src/prompts/events/examples/index.js');
        const graph = await import('../src/prompts/graph/examples/index.js');
        const reflection = await import('../src/prompts/reflection/examples/index.js');
        const communities = await import('../src/prompts/communities/examples/index.js');

        const allExamples = [
            ...events.getExamples(),
            ...graph.getExamples(),
            ...reflection.getExamples('REFLECTIONS'),
            ...reflection.getExamples('QUESTIONS'),
            ...reflection.getExamples('INSIGHTS'),
            ...communities.getExamples('COMMUNITIES'),
            ...communities.getExamples('GLOBAL_SYNTHESIS'),
        ];

        for (const ex of allExamples) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(typeof ex.label).toBe('string');
            expect(typeof ex.input).toBe('string');
            expect(typeof ex.output).toBe('string');
        }
    });

    it('EN examples only have EN labels, RU examples only have RU labels', async () => {
        const { getExamples } = await import('../src/prompts/events/examples/index.js');
        for (const ex of getExamples('en')) {
            expect(ex.label).toContain('(EN/');
        }
        for (const ex of getExamples('ru')) {
            expect(ex.label).toContain('(RU/');
        }
    });
});
```

- [ ] Step 2: Run tests

Run: `npx vitest run tests/prompts.test.js --reporter=verbose`

Expected: All old tests PASS + all new `domain module structure` tests PASS.

- [ ] Step 3: Commit

```bash
git add -A && git commit -m "test(prompts): add structural smoke tests for domain modules"
```

---

## Final State

```
src/prompts/
  index.js                              (~25 lines, barrel only)
  shared/
    formatters.js                        (134 lines)
    preambles.js                         (112 lines)
    rules.js                             (25 lines)
    format-examples.js                   (25 lines)
  events/
    role.js, schema.js, rules.js, builder.js
    examples/  en.js, ru.js, index.js
  graph/
    role.js, schema.js, rules.js, builder.js
    examples/  en.js, ru.js, index.js
  reflection/
    role.js, schema.js, rules.js, builder.js
    examples/  en.js, ru.js, index.js
  communities/
    role.js, schema.js, rules.js, builder.js
    examples/  en.js, ru.js, index.js
```

**27 files.** Largest file ~100 lines (builders). All existing tests pass unchanged.
