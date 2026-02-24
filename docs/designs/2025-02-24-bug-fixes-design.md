# Design: Critical Bug Fixes and LLM Optimizations

## 1. Problem Statement

A code review identified several critical bugs and optimization opportunities in the OpenVault SillyTavern extension:

1. **Web Worker cache invalidation bug** - Stale memory data used for scoring when memories are edited
2. **UI state wipe during extraction** - User edits lost when background extraction completes
3. **LLM prompt structure** - Suboptimal use of system vs user message roles
4. **JSON extraction fragility** - Could fail with conversational filler in LLM responses
5. **Message batching by count not tokens** - Context window safety issues

## 2. Goals & Non-Goals

### Must do:
- Fix Web Worker sync logic to detect memory content changes, not just count
- Prevent UI re-render when user is editing memories
- Add regex-based JSON extraction before jsonrepair
- Add token-aware batching to extraction scheduler
- Consider LLM prompt role splitting

### Won't do:
- Full concurrency queue rewrite (existing skip logic is acceptable)
- WebGPU memory disposal on model switch (low priority, complex to implement)
- Memory distance recalculation (current clamping is acceptable)
- Auto-hide coherence fix (group chat edge case is rare)

## 3. Verified Issues

### 3.1 Web Worker Cache Invalidation Bug (CONFIRMED - High Priority)

**Location:** `src/retrieval/scoring.js:163-165`

```javascript
const currentMemoryCount = memories.length;
const needsSync = currentMemoryCount !== lastSyncedMemoryCount;
```

**The Bug:** If a user edits a memory (changes importance, updates summary) or generates a missing embedding, `memories.length` remains unchanged. `needsSync` evaluates to `false`, and the Web Worker scores using stale cached data.

**Proposed Fix:** Track a hash based on memory content:

```javascript
// In scoring.js
let lastSyncedMemoryHash = -1;

function computeMemoryHash(memories) {
    // Fast hash: sum of (length + importance * 10 + hasEmbedding)
    // Good enough for change detection, much cheaper than JSON.stringify
    return memories.reduce((acc, m) =>
        acc + m.summary?.length + (m.importance || 3) * 10 + (m.embedding ? 1 : 0), 0);
}

// In runWorkerScoring:
const currentHash = computeMemoryHash(memories);
const needsSync = currentHash !== lastSyncedMemoryHash;

if (needsSync) {
    lastSyncedMemoryHash = currentHash;
}
```

### 3.2 UI State Wipe Bug (CONFIRMED - High Priority)

**Location:** `src/events.js:148` calls `refreshAllUI()` after extraction, which calls `MemoryList.render()`.

**The Bug:** If user is editing a memory when background extraction completes, `.html()` completely re-renders the list, destroying their in-progress textarea.

**Proposed Fix:** Add edit-mode detection:

```javascript
// In src/ui/components/MemoryList.js - render() method
render() {
    // Check if user is editing - preserve state if so
    if (this.$container.find('.openvault-edit-form').length > 0) {
        log('Skipping render - user is editing memory');
        return;
    }
    // ... existing render logic
}
```

### 3.3 LLM System Prompt (PARTIAL - Medium Priority)

**Location:** `src/llm.js:69-71`

```javascript
const messages = [
    { role: 'user', content: prompt }
];
```

**Analysis:** The prompt is well-structured with `<role>`, `<schema>`, `<instructions>` XML tags. Modern LLMs do handle these better in system role, but:

1. SillyTavern's ConnectionManager may strip/alter system prompts based on instruct mode
2. Current approach works reliably with multiple models
3. The XML structure is clear and effective

**Recommendation:** Defer this change. The current approach is proven to work. Moving to system role requires extensive testing across different LLM providers and instruct modes.

### 3.4 JSON Extraction (VALID - Low-Medium Priority)

**Location:** `src/utils/text.js:86-98`

The current `safeParseJSON` strips thinking tags then passes to `jsonrepair`. It could be more robust by extracting JSON array/object first.

**Proposed Fix:**

```javascript
export function safeParseJSON(input) {
    try {
        let cleanedInput = stripThinkingTags(input);

        // Extract array or object using regex (before jsonrepair)
        const jsonMatch = cleanedInput.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (jsonMatch) {
            cleanedInput = jsonMatch[0];
        }

        const repaired = jsonrepair(cleanedInput);
        // ... rest of function
    }
}
```

### 3.5 Token-Based Batching (VALID - Medium Priority)

**Location:** `src/extraction/scheduler.js`

**Analysis:** The scheduler batches by message count only (`messagesPerExtraction` defaults to 30). This is a valid concern - 30 messages could range from 1,500 to 15,000+ tokens.

**Proposed Fix:** Add token-aware batching:

```javascript
// In scheduler.js
import { estimateTokens } from '../utils/text.js';

export function getNextBatch(chat, data, batchSize, bufferSize = 0, maxTokens = 6000) {
    const extractedIds = getExtractedMessageIds(data);
    const unextractedIds = getUnextractedMessageIds(chat, extractedIds, bufferSize);

    if (unextractedIds.length < batchSize) {
        return null;
    }

    let batch = [];
    let currentTokens = 0;

    for (const id of unextractedIds) {
        if (batch.length >= batchSize) break;

        const msgTokens = estimateTokens(chat[id].mes);
        if (currentTokens + msgTokens > maxTokens && batch.length > 0) {
            break; // Stop before exceeding token limit
        }

        batch.push(id);
        currentTokens += msgTokens;
    }

    return batch.length > 0 ? batch : null;
}
```

## 4. Data Models / Schema

No schema changes required. All fixes are implementation-level.

## 5. Interface / API Design

### Updated Function Signatures

```typescript
// scheduler.js - enhanced getNextBatch
export function getNextBatch(
    chat: Message[],
    data: OpenVaultData,
    batchSize: number,
    bufferSize: number,
    maxTokens?: number  // NEW: optional token cap
): number[] | null

// scoring.js - new hash function
function computeMemoryHash(memories: Memory[]): number
```

## 6. Implementation Priority

1. **High Priority** (Breaking UX):
   - Web Worker hash-based sync detection
   - UI edit-mode preservation

2. **Medium Priority** (Safety/Reliability):
   - Token-aware message batching
   - Regex JSON extraction

3. **Low Priority** (Minor improvements):
   - Consider system/user prompt split after extensive testing

## 7. Risks & Edge Cases

### Web Worker Hash
- **Risk:** Hash collisions (different content producing same hash)
- **Mitigation:** Hash is only for cache invalidation; worst case is redundant sync (not stale data)
- **Edge case:** Rapid edits could cause race conditions (acceptable - next sync corrects)

### UI Edit Preservation
- **Risk:** Memory updates during edit won't show until user exits edit mode
- **Mitigation:** This is acceptable behavior; user's current edit takes priority
- **Edge case:** Multiple edits across pages (only affects current page being viewed)

### Token-Aware Batching
- **Risk:** Small token limit could result in tiny batches
- **Mitigation:** Set sensible default (6000 tokens) and ensure minimum batch size
- **Edge case:** Single message exceeding token limit (would be excluded, user can manually extract)

## 8. Testing Strategy

1. **Web Worker Hash:**
   - Edit memory importance → verify re-scoring uses updated values
   - Generate embedding for memory → verify re-scoring includes it

2. **UI Preservation:**
   - Start edit during extraction → verify textarea persists
   - Cancel edit after extraction → verify list updates correctly

3. **Token Batching:**
   - Test with very long messages → verify batch stops before token limit
   - Test with short messages → verify normal batch size used

## 9. Deferred Items

The following items from the review were considered but deferred:

1. **Concurrency Queue** - Current skip logic is acceptable; event dropping is rare in practice
2. **WebGPU Memory Disposal** - Low priority; requires settings change listener and cleanup logic
3. **Memory Distance Calculation** - Current clamping at 0 is acceptable for deleted messages
4. **Auto-hide Coherence** - Group chat edge case; current rounding works for typical 1:1 chats
5. **Cyrillic Regex** - Already supports Unicode; Latin/Cyrillic is documented scope

## 10. Summary

This design document addresses the verified critical bugs with minimal, targeted fixes. The high-priority issues (worker cache and UI wipe) directly impact user experience and should be addressed first. Medium-priority improvements (token batching, JSON extraction) enhance reliability without significant risk.
