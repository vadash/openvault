# Design: Bulletproof `safeParseJSON` Refactor

**Date:** 2026-03-24
**Status:** Implemented
**Scope:** `src/utils/text.js`, `src/extraction/structured.js`

---

## Problem Statement

The current `safeParseJSON` implementation has critical vulnerabilities:

1. **No Input Validation** — crashes on `null`, `undefined`, numbers, or objects
2. **Destructive Pipeline** — mutates input before trying native parse
3. **Fragile Block Extraction** — "last block" vulnerable to trailing hallucinations
4. **Domain Coupling** — hardcoded `{ events: [] }` wrapper breaks reusability
5. **Regex Dangers** — catastrophic backtracking risk, collateral damage to valid content
6. **Fights jsonrepair** — naive bracket padding sabotages library's native truncation recovery

---

## Solution: Progressive Fallback Waterfall

Replace the destructive linear pipeline with a "Happy Path First" approach.

### API Signature (Zod-Style)

```javascript
function safeParseJSON(input, options = {})
// Returns: { success: boolean, data?: any, error?: Error, errorContext?: {...} }
```

**Options:**
- `minimumBlockSize?: number` — threshold for "substantial" blocks (default: 50)
- `onError?: (context) => void` — optional error callback for logging

**Return Object:**
```javascript
{ success: true, data: parsedObject }
// or
{ success: false, error: Error, errorContext: { tier, originalLength, sanitizedString } }
```

---

## Architecture

### The 5-Tier Waterfall

```
Input
  │
  ├─► Tier 0: Input Validation
  │     ├─ null/undefined → return failure
  │     ├─ already object → return success
  │     └─ empty string → return failure
  │
  ├─► Tier 1: Native Parse
  │     └─ JSON.parse(input) → success or continue
  │
  ├─► Tier 2: JsonRepair Only
  │     └─ jsonrepair(input) → JSON.parse → success or continue
  │
  ├─► Tier 3: Normalize + Extract
  │     ├─ normalizeText(input)
  │     ├─ extractJsonBlocks → last substantial
  │     └─ jsonrepair(block) → JSON.parse → success or continue
  │
  ├─► Tier 4: Aggressive Scrub
  │     ├─ scrubConcatenation(block)
  │     └─ jsonrepair → JSON.parse → success or continue
  │
  └─► Tier 5: Fatal Failure
        └─ return { success: false, error, errorContext }
```

---

## Components

### 1. `safeParseJSON(input, options?)` — Main Entry Point

**Purpose:** Progressive fallback parser returning Zod-style result objects.

**Behavior:**
- Tier 0: Validate input type, early exit on null/undefined/empty
- Tier 1: Try native `JSON.parse` first (zero cost if LLM output is valid)
- Tier 2: Pass raw input to `jsonrepair` (leverage library's AST-based repair)
- Tier 3: Normalize text, extract last substantial block, repair
- Tier 4: Apply aggressive regex fixes as last resort
- Tier 5: Return failure with rich context

**Dependencies:** `normalizeText`, `extractJsonBlocks`, `scrubConcatenation`, `jsonrepair`

---

### 2. `normalizeText(text)` — Text Sanitization

**Purpose:** Fix invisible characters and typographical anomalies that break JSON.parse.

**Handles:**
- Strip unescaped control characters (`\x00-\x1F`), preserving `\n`, `\r`, `\t`
- Replace smart/curly quotes (`""''`) with standard quotes
- Strip Unicode line/paragraph separators (`\u2028`, `\u2029`)

**Signature:**
```javascript
function normalizeText(text: string): string
```

**Pure function** — no external dependencies.

---

### 3. `extractJsonBlocks(text, options?)` — Block Finder

**Purpose:** Find all balanced JSON blocks for selection.

**Signature:**
```javascript
function extractJsonBlocks(text, options = {})
// Returns: Array<{ start: number, end: number, text: string, isObject: boolean }>
```

**Algorithm:**
1. Check for markdown code fences (```` ```json ```` or ```` ``` ````)
   - If fenced content found, return it directly
2. If no fences, scan for balanced `{...}` and `[...]` blocks
3. Correctly handle:
   - Strings (both `"` and `'`)
   - Escape sequences (including `\\`)
   - Backtick template literals
   - Comments (C-style `//` and `/* */`)

**Selection Strategy ("Last Substantial Block"):**
1. Filter out blocks < `minimumBlockSize` (default: 50 chars)
2. If filtering removes all blocks, fall back to the largest block
3. Otherwise, return the **last** remaining block

**Rationale:**
- LLMs output reasoning → payload
- `stripThinkingTags()` runs before extraction, removing reasoning blocks
- Trailing tiny blocks (`{"status":"done"}`) are filtered out
- Last substantial honors LLM generation order while rejecting garbage

---

### 4. `scrubConcatenation(text)` — Last-Resort Regex

**Purpose:** Fix string concatenation hallucinations (`"text" + "more"`).

**Constraints:**
- Only runs at Tier 4 (desperation)
- Strictly matches `"text"\s*+\s*"text"` patterns
- Avoids catastrophic backtracking via bounded quantifiers
- Does NOT match variable interpolations (`"text" + var`)

**Signature:**
```javascript
function scrubConcatenation(text: string): string
```

**Patterns Fixed:**
```javascript
// Mid-string concatenation
"text" + "more" → "textmore"
"text" +\n"more" → "textmore"

// Dangling plus before punctuation
"text" + , → "text" ,

// Trailing dangling plus
"text" + → "text"
```

---

## Domain Decoupling

### Remove from `safeParseJSON`

```javascript
// DELETE THIS from text.js
if (Array.isArray(parsed)) {
  return { events: parsed, entities: [], relationships: [], reasoning: null };
}
```

### Add to Domain Parsers

```javascript
// In src/extraction/structured.js - parseEventExtractionResponse

const result = safeParseJSON(content);
if (!result.success) {
  throw new Error(`JSON parse failed: ${result.error.message}`);
}

let parsed = result.data;

// Domain-specific array recovery
if (Array.isArray(parsed)) {
  logWarn('LLM returned bare array, wrapping in events object');
  parsed = { events: parsed };
}

// Continue with Zod validation...
```

**Result:** `safeParseJSON` becomes a pure utility usable by any SillyTavern extension.

---

## Testing Strategy

### Unit Tests (`tests/utils/text.test.js`)

| Category | Test Cases |
|----------|------------|
| **Input Validation** | null, undefined, number, boolean, object, array, empty string, whitespace-only |
| **Tier 1 (Native)** | Valid JSON object, valid JSON array, passes unchanged |
| **Tier 2 (Repair)** | Trailing commas, unquoted keys, single quotes |
| **Tier 3 (Normalize)** | Smart quotes `""''`, control chars `\x00-\x1F`, Unicode separators `\u2028\u2029` |
| **Tier 3 (Extract)** | Single fenced block, multiple unfenced blocks → last substantial, tiny trailing block filtered |
| **Tier 4 (Scrub)** | String concatenation `+`, multi-line concatenation, CRLF |
| **Block Extraction** | Nested brackets, brackets inside strings, escaped quotes, escaped backslashes |
| **Edge Cases** | Massive inputs (10kb+), deeply nested structures, malformed at every tier |

### Integration Tests

- Existing `structured.test.js` tests must pass unchanged
- Verify `parseEventExtractionResponse` handles bare arrays correctly
- Verify `parseGraphExtractionResponse` handles bare arrays correctly

---

## Migration Path

### Step 1: Add Helper Functions

Add to `src/utils/text.js`:
- `normalizeText(text)`
- `extractJsonBlocks(text, options)`
- `scrubConcatenation(text)`

### Step 2: Replace safeParseJSON

Replace the existing implementation with the 5-tier waterfall.

### Step 3: Update Domain Parsers

Modify `src/extraction/structured.js`:
- `parseEventExtractionResponse` — handle bare arrays
- `parseGraphExtractionResponse` — handle bare arrays
- Keep existing `parseStructuredResponse` pattern

### Step 4: Delete Legacy Code

- Remove `extractBalancedJSON` function
- Remove hardcoded array wrapper from old `safeParseJSON`

### Step 5: Update Tests

- Add comprehensive unit tests for new helpers
- Verify all existing tests pass
- Update test descriptions to reflect new behavior

---

## File Changes Summary

| File | Action |
|------|--------|
| `src/utils/text.js` | Add `normalizeText`, `extractJsonBlocks`, `scrubConcatenation`; replace `safeParseJSON`; delete `extractBalancedJSON` |
| `src/extraction/structured.js` | Update `parseEventExtractionResponse`, `parseGraphExtractionResponse` to handle bare arrays |
| `tests/utils/text.test.js` | Add new test cases for helpers and waterfall tiers |
| `tests/extraction/structured.test.js` | Verify array recovery still works |

---

## Success Criteria

1. `safeParseJSON({ valid: true })` returns `{ success: true, data: { valid: true } }`
2. `safeParseJSON('{"valid": true}')` returns `{ success: true, data: { valid: true } }`
3. `safeParseJSON(null)` returns `{ success: false, error: ... }`
4. `safeParseJSON('{"events": []}{"status":"done"}')` returns events, not status
5. `safeParseJSON('{"a": "hello" + "world"}')` repairs to `{ a: "helloworld" }`
6. All existing extraction tests pass without modification
7. Utility has zero dependencies on SillyTavern globals