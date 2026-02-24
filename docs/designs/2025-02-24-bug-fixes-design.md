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

## 9. Deferred Items - Detailed Analysis

### 9.1 Concurrency Queue (VALID - Low Priority)

**Review Claim:** "If the user generates three short messages in rapid succession (or uses the ST swipe feature quickly), events might be dropped."

**Code Analysis:**

Located in `src/events.js:114-118` and `src/state.js`:

```javascript
// Don't extract if already extracting
if (operationState.extractionInProgress) {
    log('Skipping extraction - extraction already in progress');
    return;
}
```

**Assessment:** The skip logic is intentional. However, there IS a valid concern:

1. **Rapid message scenario:** User types 3 messages quickly → AI responds 3 times rapidly
2. **Current behavior:** First response triggers extraction; subsequent responses are skipped
3. **Result:** 2 out of 3 response batches are NOT extracted until next generation cycle

**Proposed Fix - Simple Queue:**

```javascript
// In state.js - add queue
export const extractionQueue = [];
let extractionTimer = null;

export function queueExtraction(batch) {
    extractionQueue.push(batch);
    // Process after delay (debounce rapid messages)
    clearTimeout(extractionTimer);
    extractionTimer = setTimeout(processExtractionQueue, 2000);
}

export async function processExtractionQueue() {
    if (operationState.extractionInProgress || extractionQueue.length === 0) return;

    operationState.extractionInProgress = true;
    const batch = extractionQueue.shift();

    try {
        await extractMemories(batch);
    } finally {
        operationState.extractionInProgress = false;
        // Process next batch if queued
        if (extractionQueue.length > 0) {
            setTimeout(processExtractionQueue, 1000);
        }
    }
}
```

**Priority:** Low - Current skip behavior is acceptable for typical usage patterns.

---

### 9.2 WebGPU Memory Disposal (VALID - Medium Priority)

**Review Claim:** "If a user switches from multilingual-e5 to gemma, or turns off the extension, the previous model stays in memory. WebGPU models (300MB+) staying in VRAM will degrade ST performance."

**Code Analysis:**

Located in `src/embeddings/strategies.js:144-152`:

```javascript
async reset() {
    this.#cachedPipeline = null;
    this.#cachedModelId = null;
    this.#cachedDevice = null;
    this.#loadingPromise = null;
}
```

The `reset()` method exists but is **never called** when settings change!

**Assessment:** This is a real memory leak. When user changes `embeddingSource` setting:
- Old pipeline remains in memory
- New pipeline loads
- Both models occupy VRAM (300-700MB each)

**Proposed Fix:**

```javascript
// In src/ui/settings.js - modify bindSelect for embeddingSource
bindSelect('openvault_embedding_source', 'embeddingSource', async (value) => {
    // Reset old strategy before switching
    const oldSource = getDeps().getExtensionSettings()[extensionName]?.embeddingSource;
    if (oldSource && oldSource !== value) {
        const oldStrategy = getStrategy(oldSource);
        await oldStrategy.reset();
        // Force garbage collection hint
        if (global.gc) global.gc();
    }

    $('#openvault_ollama_settings').toggle(value === 'ollama');
    updateEmbeddingStatusDisplay(getEmbeddingStatus());
});
```

**Priority:** Medium - Real memory leak but only affects users who frequently switch models.

---

### 9.3 Memory Distance Calculation (MINOR - Very Low Priority)

**Review Claim:** "If a user deletes 100 messages from the bottom of their chat... maxMessageId is higher than chatLength, resulting in a negative distance."

**Code Analysis:**

Located in `src/retrieval/math.js:146-152`:

```javascript
const distance = Math.max(0, chatLength - maxMessageId);
```

**Assessment:** The `Math.max(0, ...)` clamping IS intentional. When messages are deleted:
- Old memories have `maxMessageId > chatLength`
- Distance becomes 0 (maximum recency score)
- This effectively treats "orphaned" memories as very recent

**Review's Suggested Fix:** "Drastically penalize or auto-prune orphaned memories."

**Counter-Argument:** The current behavior is reasonable:
- User deleted old messages but kept the memories
- Treating them as recent ensures they're still retrieved
- Auto-deleting user's memories would be unexpected behavior

**Recommendation:** No fix needed. Current behavior preserves user's memories appropriately.

**Priority:** Very Low - Working as designed.

---

### 9.4 Auto-Hide Coherence (VALID - Low Priority)

**Review Claim:** "You round down to even numbers to hide User-AI pairs. This assumes a strict 1:1 alternating chat. Group chats or swipe-regenerates often break this paradigm."

**Code Analysis:**

Located in `src/auto-hide.js:42-51`:

```javascript
// Round down to nearest even number (for pairs)
const pairsToHide = Math.floor(toHideCount / 2);
const messagesToHide = pairsToHide * 2;

// Hide the oldest messages, but ONLY if they've been extracted
for (let i = 0; i < messagesToHide && i < visibleMessages.length; i++) {
    const msgIdx = visibleMessages[i].idx;
    // ...
}
```

**Assessment:** The code correctly checks `is_user` flag for extraction tracking. However, the pairing assumption has an edge case:

**Group Chat Scenario:**
```
[User] Hello
[AI1] Hi there!
[AI2] Hello too
```
Rounding to pairs might hide 2 messages, leaving an orphaned AI response.

**Proposed Fix:**

```javascript
// Instead of counting pairs, verify actual user-AI alternation
// Hide messages in groups that maintain alternation
let messagesToHide = 0;
let lastWasUser = null;

for (let i = 0; i < visibleMessages.length && messagesToHide < toHideCount; i++) {
    const msg = visibleMessages[i];
    const isUser = chat[msg.idx].is_user;

    // Maintain alternation: only hide if this continues the pattern
    if (lastWasUser === null || lastWasUser !== isUser) {
        messagesToHide++;
        lastWasUser = isUser;
    } else {
        // Pattern broken, stop hiding
        break;
    }
}
```

**Priority:** Low - Edge case affects few users; current behavior is acceptable for typical 1:1 roleplay.

---

### 9.5 LLM System Prompt Split (WARRANTS FURTHER INVESTIGATION)

**Review Claim:** "Modern LLMs are heavily optimized to follow formatting rules when they are placed in the system role."

**Code Analysis:**

Located in `src/llm.js:69-71` and `src/prompts.js`:

```javascript
// llm.js
const messages = [{ role: 'user', content: prompt }];

// prompts.js structure
<role>...</role>
<messages>...</messages>
<context>...</context>
<schema>...</schema>
<examples>...</examples>
<instructions>...</instructions>
```

**Deeper Analysis:**

The current approach sends role/schema/instructions as USER content. The review suggests:

```javascript
const messages = [
    { role: 'system', content: systemPrompt },  // <role>, <schema>, <instructions>
    { role: 'user', content: userPrompt }        // <messages>, <context>, <examples>
];
```

**Why This Matters:**

1. **Claude 3.5+/GPT-4:** System prompts are more strongly enforced
2. **O1/Reasoning Models:** Don't count system tokens toward output token limits
3. **Llama 3/Gemma:** Better instruction following with system role

**SillyTavern Complication:**

ConnectionManager's `includeInstruct` setting may inject instruct templates into both system and user messages. This could conflict with our XML-tagged approach.

**Proposed Investigation:**

```javascript
// Experimental: try split prompt approach
export async function callLLMWithSystemRole(prompt, config) {
    const parts = splitPromptIntoSystemAndUser(prompt);
    const messages = [
        { role: 'system', content: parts.system },
        { role: 'user', content: parts.user }
    ];
    // ... rest of call
}

function splitPromptIntoSystemAndUser(fullPrompt) {
    // Extract <role>, <schema>, <instructions> for system
    // Keep <messages>, <context>, <examples> for user
    // ...
}
```

**Priority:** Medium - Could improve reliability but requires A/B testing across providers.

---

## 10. Updated Implementation Priority

### Phase 1 - Critical (UX Breaking)
1. Web Worker hash-based sync detection
2. UI edit-mode preservation

### Phase 2 - Reliability
3. Token-aware message batching
4. Regex JSON extraction
5. WebGPU memory disposal on model switch

### Phase 3 - Optimization
6. Concurrency queue for rapid messages
7. LLM system/user prompt split (requires extensive testing)

### Deferred - Working as Designed
8. Memory distance calculation (clamping is intentional)
9. Auto-hide pairing (edge case, rare impact)

## 11. Summary

This design document addresses 9 verified issues from the code review. Two are critical UX bugs, four are valid improvements, two are edge cases, and one requires further investigation. The recommended approach is phased implementation starting with high-impact, low-risk fixes.
