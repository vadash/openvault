# OpenVault Extraction Pipeline Improvements

**Date:** 2025-04-10
**Status:** Approved
**Scope:** Prompt refinements and performance optimizations for graph extraction, entity filtering, JSON reliability, and main thread blocking

---

## Overview

Based on analysis of 200k token RP logs, four distinct problem areas have been identified in the OpenVault extraction pipeline. This design document specifies minimal, targeted fixes for each.

**Solution Summary:**
- Problems 1-3: Prompt-only fixes (zero code changes)
- Problem 4: Code fix with `yieldToMain()` wrapping

---

## Problem 1: Dangling Graph Edges (Missing Nodes)

### Current Behavior
The LLM occasionally hallucinates relationships where `source` or `target` reference entities never defined in the `entities` array. The current code silently skips these edges:

```
[graph] Edge skipped: Vova (vova) -> Humiliation Play (humiliation play) — missing node
```

### Root Cause
The extraction prompt has no constraint enforcing that relationship endpoints must exist in the entities list. The LLM is expected to maintain this consistency naturally.

### Solution: Prompt Validation Rule

**File:** `src/prompts/graph/rules.js`
**Location:** Within `GRAPH_RULES`, in the `<thinking_process>` section

Add Step 4 to the thinking process:

```javascript
export const GRAPH_RULES = `Extract named entities...

<thinking_process>
Step 1: Entity scan — List every named entity...
Step 2: Type validation — Verify each entity type...
Step 3: Relationship map — For each entity pair with a stated or implied connection...
Step 4: VALIDATION — Verify every 'source' and 'target' in your relationships array
  exactly matches a 'name' defined in your entities array. If a relationship references
  an entity not in your list, either add that entity or remove the relationship.
</thinking_process>`;
```

### Trade-offs
- **Pros:** Zero code change, leverages LLM's ability to self-correct
- **Cons:** Relies on model compliance; edge may still be dropped if model ignores instruction

---

## Problem 2: Entity Bloat from Transient Props

### Current Behavior
Despite existing filtering rules, the LLM extracts transient objects (food, cleaning supplies, temporary clothing) as permanent `OBJECT` entities. These bloat the graph and consume storage.

**Examples from logs:**
- `Пицца` (pizza)
- `Стиральная машина` (washing machine)
- `Розовый таз` (pink basin)
- `Лубрикант` (lube)

### Root Cause
The `OBJECT` type definition is too permissive: "Highly significant unique items, weapons, or plot devices."

### Solution: Negative Constraints

**File:** `src/prompts/graph/rules.js`
**Location:** In the `OBJECT` type definition within `ENTITY_TYPES`

Add explicit PROHIBITED list:

```javascript
- ${ENTITY_TYPES.OBJECT}: Highly significant unique items, weapons, or plot devices.
  PROHIBITED: Do not extract food, meals, cleaning supplies, mundane furniture,
  temporary clothing states, consumables, or scene props unless they are permanent,
  story-defining artifacts (e.g., "The One Ring", "Cursed Sword").
  Do NOT extract fluids, temporary body states, or transient physical descriptions.
```

### Trade-offs
- **Pros:** Reduces false positives without code complexity
- **Cons:** May occasionally miss edge cases where a mundane item becomes significant later

---

## Problem 3: Reflection JSON Parse Failures

### Current Behavior
Occasionally the LLM outputs plain text without JSON fences during Phase 2 (Reflections), causing:

```
JSON parse failed at all tiers: No JSON blocks found
[OpenVault] Reflection error for Vova
```

### Root Cause
Mid-tier models sometimes "forget" the JSON format constraint when processing psychologically intense content. The existing `EXECUTION_TRIGGER` relies on recency bias but doesn't explicitly sequence the output steps.

### Solution: Step-Explicit EXECUTION_TRIGGER

**File:** `src/prompts/shared/formatters.js`
**Location:** `EXECUTION_TRIGGER` constant (line ~14)

Replace with step-explicit version:

```javascript
export const EXECUTION_TRIGGER = `OUTPUT FORMAT:
Step 1: Write your reasoning in plain text inside <think/> tags.
Step 2: You MUST close the reasoning block with exactly </think>.
Step 3: Output ONLY a single raw JSON object immediately after the closing tag.
CRITICAL: Do NOT put the JSON inside the think tags. The JSON must follow AFTER </think>.`;
```

### Why No Code Change

The existing codebase already handles missing closing tags correctly:
1. `stripThinkingTags()` without a closing tag → leaves string unchanged
2. `safeParseJSON()` → `extractJsonBlocks()` finds JSON blocks via brace matching
3. `jsonrepair` handles minor formatting issues

### Trade-offs
- **Pros:** Clearer instruction for mid-tier models; no code complexity
- **Cons:** Relies on model following multi-step instructions

---

## Problem 4: Main Thread Blocking on Chat Save

### Current Behavior
Chat saves take 2-5 seconds, causing UI stuttering:

```
[Chat save] 2507.30ms
[Chat save] 2279.40ms
```

### Root Cause
The entire `chatMetadata.openvault` object (memories, graph, embeddings) is serialized synchronously without yielding the main thread.

### Solution: Cooperative Save Strategy (DRY)

**File:** `src/store/chat-data.js`
**Function:** `saveOpenVaultData()` (lines ~70-91)

Add `yieldToMain()` calls **inside** the function to automatically protect all call sites:

```javascript
// In src/store/chat-data.js
export async function saveOpenVaultData(expectedChatId = null) {
    // ... validation logic ...

    try {
        await yieldToMain(); // ADD: Yield before ST's heavy synchronous save
        await getDeps().saveChatConditional();
        await yieldToMain(); // ADD: Yield after the thread-blocking operation
        // ... logging and return ...
    } catch (error) {
        // ... existing error handling ...
    }
}
```

**Import:** Ensure `yieldToMain` is imported from `src/utils/st-helpers.js`:

```javascript
import { yieldToMain } from '../utils/st-helpers.js';
```

**Note:** Since all domain code calls this centralized repository method to persist data, modifying the function internally automatically protects all call sites (including those in `extract.js` and `communities.js`) without needing to touch them.

### Trade-offs
- **Pros:** Immediate UI relief; minimal code change; DRY (single point of modification)
- **Cons:** Adds async overhead; doesn't reduce actual serialization time

---

## Implementation Checklist

- [ ] **Problem 1:** Add validation step to `GRAPH_RULES` in `src/prompts/graph/rules.js`
- [ ] **Problem 2:** Add PROHIBITED list to `OBJECT` type in `src/prompts/graph/rules.js`
- [ ] **Problem 3:** Update `EXECUTION_TRIGGER` in `src/prompts/shared/formatters.js`
- [ ] **Problem 4:** Add `yieldToMain` import and calls **inside** `saveOpenVaultData()` in `src/store/chat-data.js`
- [ ] Run `npm run check` to verify no regressions
- [ ] Commit with message: `design: implement extraction pipeline improvements`

---

## Success Metrics

| Problem | Metric | Target |
|---------|--------|--------|
| 1. Dangling Edges | Edge skip rate in logs | Reduction of 50%+ |
| 2. Entity Bloat | OBJECT entities per batch | Reduction of 30%+ |
| 3. JSON Failures | Reflection parse failures | Near zero |
| 4. Thread Blocking | `[Chat save]` duration | Still >1000ms but less UI stutter |

---

## Notes

- All prompt changes are backward-compatible and don't require schema migrations
- The `yieldToMain()` polyfill uses `scheduler.yield()` when available, falling back to `setTimeout(resolve, 0)`
- These fixes are intentionally minimal to avoid architectural churn

---

## Review Feedback Applied

**Date:** 2025-04-10

### Problem 4 DRY Correction
**Original:** Proposed wrapping every `saveOpenVaultData()` call site with `yieldToMain()`.

**Correction:** Modified design to add `yieldToMain()` **inside** `saveOpenVaultData()` only. Since all domain code calls this centralized repository method, modifying the function internally automatically protects all call sites without code duplication.

**Rationale:** Avoids redundant async overhead and follows DRY principle.

### Problem 3 Code Removal
**Original:** Proposed `validateThinkTagBalance()` code layer for tag balancing.

**Correction:** Removed code proposal entirely. The existing `extractJsonBlocks` + `jsonrepair` waterfall already handles missing closing tags correctly. Prompt-only fix is sufficient.

**Rationale:** Prevented fatal flaw where auto-added `</think>` would cause `stripThinkingTags()` to delete valid JSON.
