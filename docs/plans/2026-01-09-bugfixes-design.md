# Bugfix Design: Extraction & Retrieval Issues

**Date:** 2026-01-09
**Branch:** fix/extraction-retrieval-bugs

## Summary

Four bugs identified and verified:

| Bug | Severity | File | Status |
|-----|----------|------|--------|
| A. Race condition in batch extraction | Medium | `src/extraction/batch.js` | Confirmed |
| B. Inefficient worker data transfer | Medium | `src/retrieval/scoring.js` | Confirmed |
| C. WebGPU detection fallback | Low | `src/embeddings/strategies.js` | Partially valid |
| D. Hardcoded thinking tag regex | Low | `src/utils/text.js` | Confirmed |

## Bug A: Race Condition in Batch Extraction

### Problem

`getBackfillMessageIds` returns array indices computed once at backfill start. During async batch processing with rate-limit delays, message deletions shift indices, causing wrong messages to be extracted.

### Fix

Re-fetch chat and recompute unextracted IDs at the start of each batch iteration.

### Changes

**File:** `src/extraction/batch.js`

- Move `getBackfillMessageIds` call inside the for loop
- Take first N messages from fresh list each iteration
- Track actual batches processed vs initial estimate
- Stop early if no more messages available

## Bug B: Inefficient Worker Data Transfer

### Problem

`runWorkerScoring` posts entire `memories` array (with embeddings) via `postMessage` on every retrieval call. Structured Clone Algorithm clones this data, causing CPU overhead.

### Fix

Worker caches memories. Main thread only sends full array when memory count changes.

### Changes

**File:** `src/retrieval/scoring.js`

- Track `lastSyncedCount` to detect when sync needed
- Only include `memories` in postMessage when count changed
- Send `null` for memories when using cached version

**File:** `src/retrieval/worker.js`

- Add `cachedMemories` variable
- Update cache when new memories received
- Use cached memories for scoring

## Bug C: WebGPU Detection Fallback

### Problem

`navigator.gpu` accessed without optional chaining. In edge environments where `navigator` is undefined, this throws before try-catch can handle it.

### Fix

Use `globalThis.navigator?.gpu` as the single check.

### Changes

**File:** `src/embeddings/strategies.js`

- Replace multiple fallback checks with single `globalThis.navigator?.gpu`

## Bug D: Hardcoded Thinking Tag Regex

### Problem

`stripThinkingTags` only handles `<think>`, `<thinking>`, `<reasoning>`. Misses variations like `<thought>`, `[THOUGHT]`, and other local model artifacts.

### Fix

Expand regex patterns to cover common variations.

### Changes

**File:** `src/utils/text.js`

Add patterns for:
- `<thought>` (singular)
- `<reflection>`
- `[THINK]`, `[THOUGHT]`, `[REASONING]` (bracket style)
- `*thinks:*` and `(thinking:)` (inline markers)
