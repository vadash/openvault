# LLM Usage Tracking Implementation Plan

**Goal:** Output LLM usage stats (call count, models, tokens) after Backfill and Emergency Cut operations complete.
**Testing Conventions:** Unit tests for pure logic (zero mocking). Integration tests via `setupTestContext()`. Tests mirror `src/` structure under `tests/`. Use `it.each()` for same-pattern-different-input tests.

---

### Task 1: Usage Tracker Module

**Objective:** Create the `createUsageTracker()` factory with `record()` and `getSummary()` methods. Pure accumulation logic, no external dependencies.

**Files to modify/create:**
- Create: `src/utils/usage-tracker.js` (Purpose: Accumulate LLM usage stats across session)
- Create: `tests/utils/usage-tracker.test.js` (Purpose: Unit tests for tracker)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `tests/utils/tokens.test.js` and `tests/utils/text.test.js` to understand existing utility test patterns.
2. **Write Failing Tests:** In `tests/utils/usage-tracker.test.js`, write tests covering:
   - `record()` with full usage data (model, promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens)
   - `record()` with partial/missing fields (undefined tokens, no model)
   - Multiple calls accumulate correctly (sum tokens, dedupe models alphabetically)
   - `getSummary()` formatting: single model, multiple models, N/A for missing cache
   - Token formatting helper: 0, <1000, >=1000, undefined/null → "N/A"
   - Use `it.each()` for token formatting edge cases with `[desc, input, expected]` tuples
3. **Implement Minimal Code:** In `src/utils/usage-tracker.js`, implement:
   - Factory function returning tracker object with internal state `{ calls, models, promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens }`
   - `record(usage)` method: accumulate tokens (default 0), dedupe models (add "unknown" if no model)
   - `getSummary()` method: format string per design spec
   - Internal `formatTokens(n)` helper
4. **Verify:** Run `npm test tests/utils/usage-tracker.test.js` and ensure all tests pass.
5. **Commit:** Commit with message: `feat(usage-tracker): session-scoped LLM usage accumulation module`

---

### Task 2: Modify callLLM to Capture Usage

**Objective:** Change `callLLM()` to request full API response (`extractData: false`), parse usage from it, and pass to optional tracker.

**Files to modify/create:**
- Modify: `src/llm.js` (Purpose: Add tracker option, parse usage from response)
- Modify: `tests/llm/llm.test.js` (Purpose: Add tests for tracker integration)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/llm.js` lines 130-170 (the `executeRequest` helper) and `tests/llm/llm.test.js` to understand existing callLLM test patterns.
2. **Write Failing Tests:** In `tests/llm/llm.test.js`, add new `describe('callLLM usage tracking')` block with tests:
   - Tracker receives usage when API returns full response with usage fields
   - Tracker receives "unknown" model when response lacks model field
   - Tracker receives N/A tokens when response lacks usage field
   - Tracker not called when no tracker passed (existing behavior preserved)
   - Mock `sendRequest` to return `{ choices: [...], usage: {...}, model: "test-model" }`
   - Import `createUsageTracker` from `src/utils/usage-tracker.js`
3. **Implement Minimal Code:** In `src/llm.js`:
   - Import `createUsageTracker` type via JSDoc `@typedef` (not Zod - tracker is function-based)
   - Add `tracker?: UsageTracker` to `LLMCallOptions` in JSDoc
   - In `executeRequest()`: set `extractData: false` in request options
   - After response: parse `content` from `result.choices[0].message.content`
   - Parse `usage` object from `result.usage` and `result.model`
   - Call `options.tracker?.record(usage)` before returning content
   - Preserve existing fallback behavior if response malformed
4. **Verify:** Run `npm test tests/llm/llm.test.js` and ensure all tests pass including existing ones.
5. **Commit:** Commit with message: `feat(llm): capture usage stats from API response`

---

### Task 3: Integrate Tracker into Extraction Pipeline

**Objective:** Pass tracker through extraction functions that call `callLLM()` - `extractAllMessages`, `fetchEventsFromLLM`, `fetchGraphFromLLM`.

**Files to modify/create:**
- Modify: `src/extraction/extract.js` (Purpose: Accept tracker param, pass to callLLM calls)
- Modify: `tests/extraction/extract.test.js` (Purpose: Verify tracker passed through)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/extraction/extract.js` - find `extractAllMessages`, `fetchEventsFromLLM`, `fetchGraphFromLLM` function signatures and their `callLLM()` calls.
2. **Write Failing Tests:** In `tests/extraction/extract.test.js`, add minimal integration test:
   - Create tracker, mock `sendRequest` to return response with usage
   - Call `extractAllMessages` with tracker option
   - Verify tracker accumulated calls after extraction completes
   - Keep to 1-2 tests per the Integration Bouncer Rule
3. **Implement Minimal Code:** In `src/extraction/extract.js`:
   - Add `tracker?: UsageTracker` param to `extractAllMessages` options object
   - Add `tracker` param to `fetchEventsFromLLM` and `fetchGraphFromLLM`
   - Pass `tracker` to each `callLLM()` call via options object
   - Import tracker type via JSDoc `@typedef` from `../utils/usage-tracker.js`
4. **Verify:** Run `npm test tests/extraction/extract.test.js` - ensure existing tests still pass.
5. **Commit:** Commit with message: `feat(extraction): pass usage tracker through extraction pipeline`

---

### Task 4: Integrate Tracker into UI Handlers

**Objective:** Create tracker in `handleExtractAll` and `handleEmergencyCutClick`, pass to extraction, log summary on completion.

**Files to modify/create:**
- Modify: `src/ui/settings.js` (Purpose: Create tracker, log summary after backfill/emergency cut)
- Modify: `tests/ui/settings-helpers.test.js` (Purpose: Verify tracker creation and logging)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/ui/settings.js` lines 359-404 (`handleExtractAll`) and lines 121-159 (`handleEmergencyCutClick`). Note the completion callback locations.
2. **Write Failing Tests:** In `tests/ui/settings-helpers.test.js` or create new test block:
   - Mock `extractAllMessages` and verify tracker passed
   - Verify `logDebug` called with summary string on completion
   - Same pattern for `executeEmergencyCut`
3. **Implement Minimal Code:** In `src/ui/settings.js`:
   - Import `createUsageTracker` from `../utils/usage-tracker.js`
   - In `handleExtractAll`: create tracker before calling `extractAllMessages`, pass via options
   - In `onFinish` callback: call `logDebug(tracker.getSummary())`
   - In `handleEmergencyCutClick`: create tracker before modal, pass to `executeEmergencyCut`
   - In `onComplete` callback: call `logDebug(tracker.getSummary())`
4. **Verify:** Run `npm test tests/ui/` - ensure all UI tests pass.
5. **Commit:** Commit with message: `feat(ui): log usage summary after backfill and emergency cut`