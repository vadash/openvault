# Design: Unify Extraction Prefill Across All LLM Operations

## Problem Statement

The `extractionPrefill` setting currently only affects **event extraction** (Stage A). When users configure a non-default prefill (e.g., `<thinking>` tag), the other 5 prompt types continue to hardcode `'{'` as the assistant prefill. This causes:

1. **Inconsistent behavior** — Event extraction uses user preference, other operations ignore it
2. **Potential JSON parsing issues** — Models expecting to continue a `<thinking>` block may emit `{` incorrectly
3. **User confusion** — Setting appears broken when only partial operations respect it

## Solution Overview

Extend the user-selected prefill to **ALL 6 LLM prompt types** with:
- **Explicit schema updates** allowing optional `<thinking>` tags for non-event prompts
- **Mandatory prefill parameter** — no fallback, throw if missing (clean cut)
- **DRY code** — resolve once, thread through all callers

## Affected Prompt Types

| # | Prompt Type | Builder Function | Caller Location |
|---|-------------|------------------|-----------------|
| 1 | Event Extraction | `buildEventExtractionPrompt` | `src/extraction/extract.js` |
| 2 | Graph Extraction | `buildGraphExtractionPrompt` | `src/extraction/extract.js` |
| 3 | Unified Reflection | `buildUnifiedReflectionPrompt` | `src/reflection/reflect.js` |
| 4 | Edge Consolidation | `buildEdgeConsolidationPrompt` | `src/graph/consolidation.js` |
| 5 | Community Summary | `buildCommunitySummaryPrompt` | `src/communities/communities.js` |
| 6 | Global Synthesis | `buildGlobalSynthesisPrompt` | `src/communities/communities.js` |

## Schema Updates Required

### Non-Event Schema Rule Changes

All non-event schemas must update **Rule 5** (or equivalent) from:

```
5. Do NOT include ANY text outside the JSON object. No markdown, no explanation.
```

To:

```
5. You MAY use <thinking> tags for reasoning before providing the JSON.
   The JSON object must still be valid and parseable.
```

### Schemas to Update

1. **GRAPH_SCHEMA** (`src/prompts/index.js`)
2. **CONSOLIDATION_SCHEMA** (`src/prompts/index.js`)
3. **COMMUNITY_SUMMARY_SCHEMA** (`src/prompts/index.js`)
4. **GLOBAL_SYNTHESIS_SCHEMA** (`src/prompts/index.js`)
5. **REFLECTION_UNIFIED_SCHEMA** (`src/prompts/index.js`)

### Examples to Update

Corresponding example files in `src/prompts/examples/` must show think-then-JSON pattern:

- `graph.js` — graph extraction examples
- `reflections.js` — reflection examples
- `communities.js` — community summary examples
- `global-synthesis.js` — global synthesis examples
- `insights.js` — insight examples (if referenced)
- `questions.js` — question examples (if referenced)

## Implementation Details

### 1. Prompt Builders (`src/prompts/index.js`)

All 5 non-event builders must:
- Accept `prefill` as **required** parameter (no default)
- Pass to `buildMessages()` as `assistantPrefill`
- Throw descriptive error if `prefill` is undefined/null

**Pattern for each builder:**
```javascript
function buildXxxPrompt(..., prefill) {
  if (!prefill) {
    throw new Error('buildXxxPrompt: prefill is required');
  }
  // ...
  return buildMessages({
    systemPrompt: resolvedSystem,
    userPrompt: userPrompt,
    assistantPrefill: prefill  // Was hardcoded '{'
  });
}
```

**Builders to modify:**
- `buildGraphExtractionPrompt(preamble, outputLanguage, prefill)`
- `buildUnifiedReflectionPrompt(preamble, outputLanguage, prefill)`
- `buildEdgeConsolidationPrompt(preamble, outputLanguage, prefill)`
- `buildCommunitySummaryPrompt(communityNodes, prefill)`
- `buildGlobalSynthesisPrompt(regionalSummaries, prefill)`

### 2. Callers — Resolve and Thread

Each caller must:
1. Import `resolveExtractionPrefill`
2. Resolve prefill from settings
3. Pass to prompt builder

**extract.js** (already has it — verify threading):
```javascript
const prefill = resolveExtractionPrefill(settings);
// Pass to both event and graph extraction
```

**reflect.js** (add):
```javascript
import { resolveExtractionPrefill } from './settings.js';

function buildReflectionPrompt(eventSummaries, characterName, settings) {
  const prefill = resolveExtractionPrefill(settings);
  // ... pass to buildUnifiedReflectionPrompt
}
```

**consolidation.js** (in `src/graph/`):
```javascript
import { resolveExtractionPrefill } from '../extraction/settings.js';

function consolidateEdges(...) {
  const settings = getExtensionSettings();
  const prefill = resolveExtractionPrefill(settings);
  // ... pass to buildEdgeConsolidationPrompt
}
```

**communities.js**:
```javascript
import { resolveExtractionPrefill } from '../extraction/settings.js';

// In updateCommunitySummaries and generateGlobalWorldState:
const prefill = resolveExtractionPrefill(settings);
// ... pass to buildCommunitySummaryPrompt and buildGlobalSynthesisPrompt
```

### 3. Error Handling Strategy

**Strict validation at boundaries:**
- Prompt builders throw if prefill missing
- Callers must resolve and pass prefill
- No silent fallbacks — fail fast, fail loud

**Benefits:**
- Catches integration errors immediately
- Prevents partial/misconfigured deployments
- Clear stack traces for debugging

## Response Parsing

The existing pipeline already handles think tags correctly:

1. `callLLM()` → `parseReasoningFromString()` strips think content
2. `parseStructuredResponse()` → `stripThinkingTags()` secondary pass
3. JSON repair handles edge cases

**No changes required** to response parsing — schema relaxation is sufficient.

## Testing Strategy

### Unit Tests to Update

**tests/unit/prompts.test.js**:
- Verify all 6 builders throw when prefill missing
- Verify prefill is passed correctly to `buildMessages()`
- Verify schemas include think-tag allowance

**New test cases:**
```javascript
// Each builder
expect(() => buildGraphExtractionPrompt(p, lang, undefined)).toThrow('prefill is required');
expect(() => buildGraphExtractionPrompt(p, lang, '')).toThrow('prefill is required');

// With valid prefill
const messages = buildGraphExtractionPrompt(p, lang, '<thinking>');
expect(messages[messages.length - 1].content).toBe('<thinking>');
```

### Integration Tests

Verify end-to-end flow:
- Event extraction with `<thinking>` prefill works
- Graph extraction with `<thinking>` prefill works
- All prompt types handle both `'{'` and `<thinking>` prefills

## Migration Path

**No breaking change for users:**
- Existing settings continue to work
- Default prefill remains `'{'` (in settings resolution)
- Only internal API changes (strict prefill parameter)

## Files to Modify

| File | Changes |
|------|---------|
| `src/prompts/index.js` | Update 5 schema constants, modify 5 builder functions |
| `src/prompts/examples/graph.js` | Add think-then-JSON examples |
| `src/prompts/examples/reflections.js` | Add think-then-JSON examples |
| `src/prompts/examples/communities.js` | Add think-then-JSON examples |
| `src/prompts/examples/global-synthesis.js` | Add think-then-JSON examples |
| `src/prompts/examples/insights.js` | Add think-then-JSON examples (if used) |
| `src/prompts/examples/questions.js` | Add think-then-JSON examples (if used) |
| `src/extraction/extract.js` | Verify prefill threading to graph extraction |
| `src/reflection/reflect.js` | Import resolver, resolve and pass prefill |
| `src/graph/consolidation.js` | Import resolver, resolve and pass prefill |
| `src/communities/communities.js` | Import resolver, resolve and pass prefill to both prompts |
| `tests/unit/prompts.test.js` | Update tests for new parameter requirements |

## Success Criteria

- [ ] All 6 prompt types use user-selected prefill
- [ ] All 5 non-event schemas allow optional `<thinking>` tags
- [ ] All prompt builders throw if prefill is missing
- [ ] All example files show think-then-JSON pattern
- [ ] Unit tests pass with strict prefill validation
- [ ] No regression in extraction/retrieval pipeline
