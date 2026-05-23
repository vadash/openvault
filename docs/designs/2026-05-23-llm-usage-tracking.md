# LLM Usage Tracking for Backfill and Emergency Cut

**Date**: 2026-05-23
**Status**: Approved

## Summary

After "Backfill" or "Emergency Cut" operations complete, output a short usage summary to the debug log showing: LLM call count, model(s) used, and token statistics (input/output/cached if available).

## Problem

Currently, OpenVault's `callLLM()` discards usage metadata returned by the API. Users have no visibility into the cost of backfill and emergency cut operations.

## Solution

Create a session-scoped usage tracker module that accumulates stats across multiple LLM calls. Modify `callLLM()` to capture usage data and pass it to an optional tracker. Caller (backfill/emergency cut handler) logs the summary at operation completion.

## Architecture

### 1. Usage Tracker Module (`src/utils/usage-tracker.js`)

Factory function returns a fresh tracker instance with accumulation state:

```javascript
// State shape (internal)
{
  calls: 0,
  models: [],           // unique models, deduped on record
  promptTokens: 0,
  completionTokens: 0,
  cacheReadTokens: 0,   // optional, may remain 0
  cacheWriteTokens: 0,  // optional, may remain 0
}
```

**Exports:**
- `createUsageTracker()` — Returns new tracker instance

**Instance methods:**
- `tracker.record(usage)` — Add one call's usage data
- `tracker.getSummary()` — Return formatted string for logging

**`record(usage)` input shape:**
```javascript
{
  model?: string,
  promptTokens?: number,
  completionTokens?: number,
  cacheReadTokens?: number,
  cacheWriteTokens?: number,
}
```

All fields optional; tracker handles missing data gracefully (accumulates 0 for missing numeric fields, adds `"unknown"` to models if no model provided).

**`getSummary()` output format:**

Single model:
```
5 LLM calls | model: claude-3-5-sonnet | tokens: 15.2K input, 4.1K output, 2.3K cached
```

Multiple models (sorted alphabetically):
```
5 LLM calls | models: claude-3-5-sonnet, gpt-4o | tokens: 15.2K input, 4.1K output, N/A cached
```

Missing token fields show as `N/A`. Token counts formatted with `K` suffix for thousands (e.g., `15.2K`), no suffix for values < 1000.

### 2. Modifications to `callLLM()` (`src/llm.js`)

**Change request options:**
```javascript
// Before (line ~138-144)
deps.connectionManager.sendRequest(targetProfileId, messages, maxTokens, {
    includePreset: true,
    includeInstruct: true,
    stream: false,
}, jsonSchema ? { jsonSchema } : {});

// After
deps.connectionManager.sendRequest(targetProfileId, messages, maxTokens, {
    includePreset: true,
    includeInstruct: true,
    stream: false,
    extractData: false,  // Get full response with usage
}, jsonSchema ? { jsonSchema } : {});
```

**Parse response for both content and usage:**
```javascript
// OpenAI-compatible response structure:
// { choices: [{ message: { content: "..." } }], usage: { prompt_tokens, completion_tokens, ... }, model: "..." }

const content = result?.choices?.[0]?.message?.content || '';

const usage = {
    model: result?.model,
    promptTokens: result?.usage?.prompt_tokens,
    completionTokens: result?.usage?.completion_tokens,
    cacheReadTokens: result?.usage?.cache_read_input_tokens,      // Anthropic/OpenRouter
    cacheWriteTokens: result?.usage?.cache_creation_input_tokens, // Anthropic/OpenRouter
};

options.tracker?.record(usage);
```

**Type update (`LLMCallOptions`):**
```typescript
export type LLMCallOptions = {
    structured?: boolean;
    signal?: AbortSignal;
    profileId?: string;
    backupProfileId?: string;
    tracker?: UsageTracker;  // NEW
};
```

### 3. Integration Points

#### Backfill (`src/ui/settings.js`)

`handleExtractAll()` (line ~359-404):
1. Create tracker: `const tracker = createUsageTracker();`
2. Pass tracker to `extractAllMessages()` call
3. After completion callback fires, log: `logDebug(tracker.getSummary());`

#### Emergency Cut (`src/ui/settings.js`)

`handleEmergencyCutClick()` (line ~121-159):
1. Create tracker before modal
2. Pass tracker to `executeEmergencyCut()`
3. Log summary after extraction completes (before hiding history)

#### Extraction Pipeline (`src/extraction/extract.js`)

Functions that call `callLLM()`:
- `extractAllMessages()` — Accept optional `tracker`, pass through
- `fetchEventsFromLLM()` — Accept `tracker`, pass to `callLLM()`
- `fetchGraphFromLLM()` — Accept `tracker`, pass to `callLLM()`

These functions already accept an `AbortSignal`; tracker follows same pattern as optional parameter.

### 4. Token Formatting Helper

Tracker needs a `formatTokens(n)` helper for readable output:
```javascript
function formatTokens(n) {
    if (n === undefined || n === null) return 'N/A';
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
}
```

## Data Flow

```
[UI Handler]
    ↓ createUsageTracker()
[Extraction Pipeline]
    ↓ passes tracker through
[callLLM()]
    ↓ extractData: false → full response
    ↓ parse usage → tracker.record(usage)
[UI Handler completion]
    ↓ tracker.getSummary()
[Log] "5 LLM calls | model: ... | tokens: ..."
```

## Error Handling

- If `extractData: false` request fails or returns malformed response, `callLLM()` still returns content (falls back to existing behavior)
- Missing usage fields accumulate as 0; summary shows `N/A`
- Tracker.record() never throws; silently handles missing/invalid data

## Testing Strategy

1. **Unit tests for tracker module:**
   - `record()` with full usage data
   - `record()` with partial/missing fields
   - `record()` with no model → "unknown" in models list
   - `getSummary()` formatting: single model, multiple models, missing fields
   - Token formatting edge cases: 0, <1000, >=1000, undefined

2. **Integration test (mocked LLM):**
   - Mock `connectionManager.sendRequest` to return response with usage
   - Verify tracker accumulates correctly across multiple calls
   - Verify summary logged at operation end

## Files Changed

| File | Change |
|------|--------|
| `src/utils/usage-tracker.js` | New module |
| `src/llm.js` | Add tracker option, parse usage from response |
| `src/ui/settings.js` | Create tracker, pass to extraction, log summary |
| `src/extraction/extract.js` | Accept tracker param, pass to callLLM |
| `src/types.d.ts` | Add `UsageTracker` type (regenerated from Zod) |

## Out of Scope

- Cost estimation (USD): Would require per-model pricing tables, not trivial
- Persisting usage to `chatMetadata`: Session-only tracking is sufficient for current need
- Streaming mode usage: Most APIs don't return usage in stream; skip for now