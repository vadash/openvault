# Prompt Module Refactoring

**Date**: 2026-03-15
**Status**: Approved
**Scope**: `src/prompts/` directory restructuring

## Problem

`src/prompts/index.js` is a 620-line god file containing 8 JSON schemas, 8 rule sets, and 6 builder functions. The flat structure makes navigation difficult, and adding a new language requires editing 7 example files with mixed EN/RU content.

**Current structure** (13 files, 1,972 lines):
```
src/prompts/
  index.js          (620 lines — schemas, rules, builders all mixed)
  formatters.js     (134 lines)
  preambles.js      (112 lines)
  roles.js          (37 lines — all 6 roles)
  rules.js          (25 lines — only MIRROR_LANGUAGE_RULES)
  examples/
    events.js       (211 lines — 5 EN + 5 RU mixed)
    communities.js  (178 lines)
    reflections.js  (163 lines)
    insights.js     (165 lines)
    graph.js        (123 lines)
    questions.js    (120 lines)
    global-synthesis.js (59 lines)
    format.js       (25 lines)
```

## Design

### Split Axis: By Task Domain

Each pipeline stage gets its own folder with a consistent internal structure. Related sub-concerns are grouped by pipeline phase:

| Domain Folder | Primary Concern | Grouped Sub-concerns |
|---|---|---|
| `events/` | Event extraction (Stage A) | — |
| `graph/` | Entity/relationship extraction (Stage B) | Edge consolidation (graph maintenance) |
| `reflection/` | Unified reflection synthesis | Questions + insights (sub-components of unified prompt) |
| `communities/` | Community summarization | Global synthesis (post-community step) |

### Target Structure

```
src/prompts/
  index.js                          → Barrel re-exports only (~25 lines)

  shared/
    formatters.js                   → assembleSystemPrompt, buildMessages, language resolution
    preambles.js                    → SYSTEM_PREAMBLE_CN/EN, PREFILL_PRESETS, resolver functions
    rules.js                        → MIRROR_LANGUAGE_RULES
    format-examples.js              → formatExamples (XML formatting utility)

  events/
    role.js                         → EVENT_ROLE
    schema.js                       → EVENT_SCHEMA
    rules.js                        → EVENT_RULES
    builder.js                      → buildEventExtractionPrompt
    examples/
      en.js                         → 5 EN event examples
      ru.js                         → 5 RU event examples
      index.js                      → getExamples(lang) → filtered array

  graph/
    role.js                         → GRAPH_ROLE
    schema.js                       → GRAPH_SCHEMA, EDGE_CONSOLIDATION_SCHEMA
    rules.js                        → GRAPH_RULES, EDGE_CONSOLIDATION_RULES
    builder.js                      → buildGraphExtractionPrompt, buildEdgeConsolidationPrompt
    examples/
      en.js                         → 4 EN graph examples
      ru.js                         → 4 RU graph examples
      index.js                      → getExamples(lang) → filtered array

  reflection/
    role.js                         → UNIFIED_REFLECTION_ROLE, QUESTIONS_ROLE, INSIGHTS_ROLE
    schema.js                       → UNIFIED_REFLECTION_SCHEMA, QUESTIONS_SCHEMA, INSIGHTS_SCHEMA
    rules.js                        → UNIFIED_REFLECTION_RULES, QUESTIONS_RULES, INSIGHTS_RULES
    builder.js                      → buildUnifiedReflectionPrompt
    examples/
      en.js                         → questions + reflections + insights EN (named exports)
      ru.js                         → questions + reflections + insights RU (named exports)
      index.js                      → getExamples(type, lang) → filtered array

  communities/
    role.js                         → COMMUNITIES_ROLE
    schema.js                       → COMMUNITY_SCHEMA, GLOBAL_SYNTHESIS_SCHEMA
    rules.js                        → COMMUNITY_RULES, GLOBAL_SYNTHESIS_RULES
    builder.js                      → buildCommunitySummaryPrompt, buildGlobalSynthesisPrompt
    examples/
      en.js                         → community + global-synthesis EN (named exports)
      ru.js                         → community + global-synthesis RU (named exports)
      index.js                      → getExamples(type, lang) → filtered array
```

**~27 files, same total lines.** Largest file drops from 620 to ~80-100 lines.

### Conventions

#### Per-Domain File Contract

Every domain folder has exactly 4 files + 1 examples directory:

| File | Exports | Notes |
|---|---|---|
| `role.js` | Role string constant(s) | One-liner for simple domains |
| `schema.js` | JSON schema string constant(s) | Defines expected LLM output format |
| `rules.js` | Task-specific rule string constant(s) | Extraction/synthesis instructions |
| `builder.js` | Builder function(s) | Assembles system+user+assistant messages |
| `examples/` | Per-language example files | See below |

#### Example File Convention

**Single-type domains** (events, graph) — default export is an array:
```js
// events/examples/en.js
export const EXAMPLES = [
  { label: '(EN/SFW) Discovery', input: '...', thinking: '...', output: '...' },
  // ...
];
```

**Multi-type domains** (reflection, communities) — named exports per sub-type:
```js
// reflection/examples/en.js
export const QUESTIONS = [
  { label: '(EN/SFW) Adventure psychology', input: '...', thinking: '...', output: '...' },
  // ...
];
export const REFLECTIONS = [/* ... */];
export const INSIGHTS = [/* ... */];
```

**Each examples/index.js** provides a `getExamples()` function that handles language filtering:
```js
// events/examples/index.js
import { EXAMPLES as EN } from './en.js';
import { EXAMPLES as RU } from './ru.js';

export function getExamples(language = 'auto') {
  if (language === 'en') return EN;
  if (language === 'ru') return RU;
  return [...EN, ...RU];
}
```

For multi-type domains, the function takes a type parameter:
```js
// reflection/examples/index.js
import * as en from './en.js';
import * as ru from './ru.js';

const langs = { en, ru };

export function getExamples(type, language = 'auto') {
  if (language !== 'auto') return langs[language]?.[type] || [];
  return [...(en[type] || []), ...(ru[type] || [])];
}
```

#### Barrel Index

`src/prompts/index.js` re-exports the public API with zero changes to the consumer-facing surface:

```js
// Shared
export {
  PREFILL_PRESETS, SYSTEM_PREAMBLE_CN, SYSTEM_PREAMBLE_EN,
  resolveExtractionPreamble, resolveExtractionPrefill, resolveOutputLanguage,
} from './shared/preambles.js';

// Builders
export { buildEventExtractionPrompt } from './events/builder.js';
export { buildGraphExtractionPrompt, buildEdgeConsolidationPrompt } from './graph/builder.js';
export { buildUnifiedReflectionPrompt } from './reflection/builder.js';
export { buildCommunitySummaryPrompt, buildGlobalSynthesisPrompt } from './communities/builder.js';
```

**No consumer changes required.** All 5 import sites (`extract.js`, `reflect.js`, `communities.js`, `graph.js`, `settings.js`) keep existing imports.

### Adding a New Language

To add Japanese support:

1. **Create 4 example files** (mechanical — copy EN files, translate content):
   - `events/examples/ja.js`
   - `graph/examples/ja.js`
   - `reflection/examples/ja.js`
   - `communities/examples/ja.js`

2. **Register in each domain's `examples/index.js`** (one import + one spread per file):
   ```js
   import { EXAMPLES as JA } from './ja.js';
   // Add to getExamples: if (language === 'ja') return JA;
   // Add to 'auto' spread: [...EN, ...RU, ...JA]
   ```

3. **Add language instruction** in `shared/formatters.js` (one constant):
   ```js
   const LANG_INSTRUCTION_JA = 'Output all string values in Japanese.';
   ```

4. **Add language option** in `shared/preambles.js` (one case in switch):
   ```js
   case 'ja': return 'ja';
   ```

Steps 1-2 are copy-and-translate. Steps 3-4 are one-line additions.

### Migration Strategy

Pure file reorganization — extract constants and functions from `index.js` into domain files, move examples into per-language files, update internal imports. The barrel `index.js` preserves the external API.

**Execution order:**
1. Create `shared/` — move `formatters.js`, `preambles.js`, `rules.js`, relocate `examples/format.js` to `shared/format-examples.js`
2. Create domain folders one at a time (events → graph → reflection → communities), extracting from `index.js`
3. Split each existing `examples/*.js` into `domain/examples/en.js` + `domain/examples/ru.js`
4. Replace `index.js` with barrel re-exports
5. Delete old `roles.js` and `examples/` directory
6. Verify all 5 consumer import sites still resolve

### Risks

- **Only risk**: Incorrect re-export in barrel causing runtime `undefined`. Mitigated by verifying each consumer import after migration.
- No behavior change — purely structural.

### File Mapping Reference

| Current Location | New Location |
|---|---|
| `index.js` → EVENT_SCHEMA | `events/schema.js` |
| `index.js` → EVENT_RULES | `events/rules.js` |
| `index.js` → buildEventExtractionPrompt | `events/builder.js` |
| `roles.js` → EVENT_ROLE | `events/role.js` |
| `examples/events.js` → EN examples | `events/examples/en.js` |
| `examples/events.js` → RU examples | `events/examples/ru.js` |
| `index.js` → GRAPH_SCHEMA, EDGE_CONSOLIDATION_SCHEMA | `graph/schema.js` |
| `index.js` → GRAPH_RULES, EDGE_CONSOLIDATION_RULES | `graph/rules.js` |
| `index.js` → buildGraphExtractionPrompt, buildEdgeConsolidationPrompt | `graph/builder.js` |
| `roles.js` → GRAPH_ROLE | `graph/role.js` |
| `examples/graph.js` → EN examples | `graph/examples/en.js` |
| `examples/graph.js` → RU examples | `graph/examples/ru.js` |
| `index.js` → UNIFIED_REFLECTION_SCHEMA, QUESTIONS_SCHEMA, INSIGHTS_SCHEMA | `reflection/schema.js` |
| `index.js` → UNIFIED_REFLECTION_RULES, QUESTIONS_RULES, INSIGHTS_RULES | `reflection/rules.js` |
| `index.js` → buildUnifiedReflectionPrompt | `reflection/builder.js` |
| `roles.js` → UNIFIED_REFLECTION_ROLE, QUESTIONS_ROLE, INSIGHTS_ROLE | `reflection/role.js` |
| `examples/questions.js` → EN | `reflection/examples/en.js` (QUESTIONS) |
| `examples/reflections.js` → EN | `reflection/examples/en.js` (REFLECTIONS) |
| `examples/insights.js` → EN | `reflection/examples/en.js` (INSIGHTS) |
| `index.js` → COMMUNITY_SCHEMA, GLOBAL_SYNTHESIS_SCHEMA | `communities/schema.js` |
| `index.js` → COMMUNITY_RULES, GLOBAL_SYNTHESIS_RULES | `communities/rules.js` |
| `index.js` → buildCommunitySummaryPrompt, buildGlobalSynthesisPrompt | `communities/builder.js` |
| `roles.js` → COMMUNITIES_ROLE | `communities/role.js` |
| `examples/communities.js` → EN | `communities/examples/en.js` (COMMUNITIES) |
| `examples/global-synthesis.js` → EN | `communities/examples/en.js` (GLOBAL_SYNTHESIS) |
| `formatters.js` | `shared/formatters.js` |
| `preambles.js` | `shared/preambles.js` |
| `rules.js` | `shared/rules.js` |
| `examples/format.js` | `shared/format-examples.js` |
