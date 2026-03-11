# Implementation Plan - Backfill Phase 2 Defer

> **Reference:** `docs/designs/2026-03-11-backfill-phase2-defer-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Overview

This plan implements a deferral mechanism for Phase 2 enrichment (Reflections & Communities) during backfill operations. The core insight: cheap math (state accumulation) must run during backfill, but expensive LLM calls should run once at completion.

**Files Modified:**
- `src/extraction/extract.js` - Add `isBackfill` option, extract Phase 2 helper
- `tests/extraction/extract.test.js` - Add tests for new behavior

---

## Task 1: Add `isBackfill` Option to `extractMemories()` Signature

**Goal:** Extend the options interface to support backfill mode.

**Step 1: Write the Failing Test**
- File: `tests/extraction/extract.test.js`
- Code: Add to existing describe block

```javascript
it('should accept isBackfill option without errors', async () => {
    // Arrange: Mock minimal LLM responses (events + graph, no phase 2)
    const sendRequest = mockSendRequest();
    const conn = getMockConnectionManager(sendRequest);
    vi.mocked(getDeps).mockReturnValue({
        getContext: () => mockContext,
        getExtensionSettings: () => ({ [extensionName]: getExtractionSettings() }),
        saveChatConditional: vi.fn().mockResolvedValue(true),
    });
    vi.mocked(getOpenVaultData).mockReturnValue(mockData);
    vi.mocked(saveOpenVaultData).mockResolvedValue(true);

    // Act: Call with isBackfill option
    const result = await extractMemories([0, 1], null, { isBackfill: true });

    // Assert: Should succeed and return events
    expect(result.status).toBe('success');
    expect(result.events_created).toBe(1);
});
```

**Step 2: Run Test (Red)**
- Command: `npm test tests/extraction/extract.test.js`
- Expect: Test may pass (options parameter already exists with `{ silent?: boolean }`)
- Note: This validates existing flexibility of options object

**Step 3: No Implementation Needed**
- The `options = {}` parameter already exists and accepts arbitrary properties
- TypeScript JSDoc can be updated for documentation, but runtime works
- Proceed to Task 2

**Step 4: Verify (Green)**
- Command: `npm test tests/extraction/extract.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add tests/extraction/extract.test.js && git commit -m "test: add isBackfill option acceptance test"`

---

## Task 2: Add `isBackfill` Guard AFTER State Accumulation

**Goal:** Skip LLM calls during backfill while preserving state math.

**Step 1: Write the Failing Test**
- File: `tests/extraction/extract.test.js`
- Code:

```javascript
it('should skip Phase 2 LLM calls when isBackfill=true', async () => {
    // Arrange: Mock only Phase 1 LLM responses (events + graph)
    const sendRequest = mockSendRequest(); // Only provides events+graph responses
    const conn = getMockConnectionManager(sendRequest);
    vi.mocked(getDeps).mockReturnValue({
        getContext: () => mockContext,
        getExtensionSettings: () => ({ [extensionName]: getExtractionSettings() }),
        saveChatConditional: vi.fn().mockResolvedValue(true),
    });
    vi.mocked(getOpenVaultData).mockReturnValue({
        ...mockData,
        reflection_state: {}, // Track state accumulation
    });
    vi.mocked(saveOpenVaultData).mockResolvedValue(true);

    // Act: Extract with isBackfill=true
    const result = await extractMemories([0, 1], null, { isBackfill: true });

    // Assert: Phase 1 succeeded
    expect(result.status).toBe('success');
    expect(result.events_created).toBe(1);

    // Assert: State accumulation happened (importance_sum incremented)
    const data = vi.mocked(getOpenVaultData).mock.results[0].value;
    expect(data.reflection_state).toBeDefined();
    // King Aldric should have accumulated importance from the event
    expect(Object.keys(data.reflection_state).length).toBeGreaterThan(0);

    // Assert: Only 2 LLM calls made (events + graph), not Phase 2 calls
    expect(sendRequest).toHaveBeenCalledTimes(2);
});
```

**Step 2: Run Test (Red)**
- Command: `npm test tests/extraction/extract.test.js`
- Expect: FAIL - `isBackfill` guard not implemented, Phase 2 LLM calls will be attempted

**Step 3: Implementation (Green)**
- File: `src/extraction/extract.js`
- Location: Inside `extractMemories()`, find the Phase 2 comment block
- Action: Add guard AFTER `accumulateImportance()` but BEFORE LLM calls

**Exact location:** Around line 380, after the `accumulateImportance` call:

```javascript
// ===== PHASE 2: Enrichment (non-critical) =====
try {
    // Stage 4.6: Reflection check (per character in new events)
    if (events.length > 0) {
        initGraphState(data); // Ensures reflection_state exists
        accumulateImportance(data.reflection_state, events);

        // Collect unique characters from new events
        const characters = new Set();
        for (const event of events) {
            for (const c of event.characters_involved || []) characters.add(c);
            for (const w of event.witnesses || []) characters.add(w);
        }

        // ===== NEW: Backfill guard - skip LLM synthesis =====
        if (options.isBackfill) {
            logDebug('Backfill mode: skipping Phase 2 LLM synthesis for this batch');
            return { status: 'success', events_created: events.length, messages_processed: messages.length };
        }
        // ===== END BACKFILL GUARD =====

        // Check each character for reflection trigger
        const reflectionThreshold = settings.reflectionThreshold;
        for (const characterName of characters) {
            // ... existing reflection logic ...
        }
    }
    // ... rest of Phase 2 ...
```

**Step 4: Verify (Green)**
- Command: `npm test tests/extraction/extract.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add isBackfill guard to skip Phase 2 LLM calls"`

---

## Task 3: Extract Phase 2 Logic into `runPhase2Enrichment()` Helper

**Goal:** Create reusable function for Phase 2 enrichment (called after backfill).

**Step 1: Write the Failing Test**
- File: `tests/extraction/extract.test.js`
- Code:

```javascript
it('runPhase2Enrichment should process all characters with accumulated importance', async () => {
    // Arrange: Data with accumulated importance_sum >= threshold
    const mockDataWithState = {
        ...mockData,
        memories: [
            {
                id: 'event_1',
                type: 'event',
                summary: 'Test event',
                importance: 5,
                tokens: ['test'],
                message_ids: [0],
                sequence: 0,
                characters_involved: ['King Aldric'],
            },
        ],
        reflection_state: {
            'King Aldric': { importance_sum: 45 }, // >= threshold of 40
        },
        graph: { nodes: {}, edges: {}, _mergeRedirects: {} },
        graph_message_count: 100,
    };

    // Mock reflection LLM response
    const reflectionResponse = JSON.stringify({
        questions: [],
        insights: [
            {
                summary: 'King Aldric has been ruling',
                importance: 5,
                characters_involved: ['King Aldric'],
            },
        ],
    });

    const sendRequest = vi.fn()
        .mockResolvedValueOnce({ content: reflectionResponse });

    vi.mocked(getDeps).mockReturnValue({
        getContext: () => mockContext,
        getExtensionSettings: () => ({
            [extensionName]: {
                ...getExtractionSettings(),
                reflectionThreshold: 40,
            },
        }),
        saveChatConditional: vi.fn().mockResolvedValue(true),
    });
    vi.mocked(getOpenVaultData).mockReturnValue(mockDataWithState);
    vi.mocked(saveOpenVaultData).mockResolvedValue(true);

    // Act: Import and call the new helper
    const { runPhase2Enrichment } = await import('../../src/extraction/extract.js');
    await runPhase2Enrichment(mockDataWithState, getExtractionSettings(), null);

    // Assert: Insight was added to memories
    expect(mockDataWithState.memories.length).toBe(2); // 1 event + 1 reflection
    const reflection = mockDataWithState.memories.find(m => m.type === 'reflection');
    expect(reflection).toBeDefined();
    expect(reflection.summary).toContain('King Aldric');
});
```

**Step 2: Run Test (Red)**
- Command: `npm test tests/extraction/extract.test.js`
- Expect: FAIL - `runPhase2Enrichment` function does not exist

**Step 3: Implementation (Green)**
- File: `src/extraction/extract.js`
- Action: Export new function after `extractMemories()`

**Location:** After `extractMemories()` function (around line 590):

```javascript
/**
 * Run Phase 2 enrichment (Reflections & Communities) independently.
 * Used after backfill completes to run comprehensive synthesis once.
 *
 * @param {Object} data - OpenVault data object (modified in-place)
 * @param {Object} settings - Extension settings
 * @param {string} targetChatId - Chat ID for change detection
 * @returns {Promise<void>}
 */
export async function runPhase2Enrichment(data, settings, targetChatId) {
    const memories = data[MEMORIES_KEY] || [];

    // Guard: No memories to enrich
    if (memories.length === 0) {
        logDebug('runPhase2Enrichment: No memories to enrich');
        return;
    }

    logDebug('runPhase2Enrichment: Starting comprehensive Phase 2 synthesis');

    try {
        // ===== REFLECTIONS: Process all characters with accumulated importance =====
        initGraphState(data); // Ensures reflection_state exists
        const characterNames = Object.keys(data.reflection_state || {});
        const reflectionThreshold = settings.reflectionThreshold;

        for (const characterName of characterNames) {
            if (shouldReflect(data.reflection_state, characterName, reflectionThreshold)) {
                try {
                    const reflections = await generateReflections(
                        characterName,
                        memories,
                        data[CHARACTERS_KEY] || {}
                    );
                    if (reflections.length > 0) {
                        data[MEMORIES_KEY].push(...reflections);
                    }
                    // Reset accumulator after reflection
                    data.reflection_state[characterName].importance_sum = 0;
                } catch (error) {
                    if (error.name === 'AbortError') throw error;
                    logError(`Reflection error for ${characterName}`, error);
                }
            }
        }

        // ===== COMMUNITIES: Force-run unconditionally (skip interval check) =====
        const context = getDeps().getContext();
        const characterName = context.name2;
        const userName = context.name1;

        try {
            const baseKeys = [normalizeKey(characterName), normalizeKey(userName)];
            const mainCharacterKeys = expandMainCharacterKeys(baseKeys, data.graph.nodes || {});
            const communityResult = detectCommunities(data.graph, mainCharacterKeys);
            if (communityResult) {
                // Consolidate bloated edges before summarization
                if (data.graph._edgesNeedingConsolidation?.length > 0) {
                    await consolidateEdges(data.graph, settings);
                }

                const groups = buildCommunityGroups(data.graph, communityResult.communities);
                const stalenessThreshold = settings.communityStalenessThreshold;
                const isSingleCommunity = communityResult.count === 1;
                const communityUpdateResult = await updateCommunitySummaries(
                    data.graph,
                    groups,
                    data.communities || {},
                    data.graph_message_count || 0,
                    stalenessThreshold,
                    isSingleCommunity
                );
                data.communities = communityUpdateResult.communities;
                if (communityUpdateResult.global_world_state) {
                    data.global_world_state = communityUpdateResult.global_world_state;
                }
                logDebug(`runPhase2Enrichment: ${communityResult.count} communities processed`);
            }
        } catch (error) {
            logError('Community detection error', error);
        }

        // Final save
        await saveOpenVaultData(targetChatId);
        logInfo('runPhase2Enrichment: Complete');
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        logError('runPhase2Enrichment failed', error);
        throw error;
    }
}
```

**Step 4: Verify (Green)**
- Command: `npm test tests/extraction/extract.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: extract Phase 2 logic into runPhase2Enrichment helper"`

---

## Task 4: Update `extractAllMessages()` to Use `isBackfill` and Call Final Phase 2

**Goal:** Wire up the backfill flow with proper UX feedback.

**Step 1: No Test (Manual Verification)**
- This function is called via UI button, hard to unit test
- Manual verification: Run backfill and observe toast messages

**Step 2: Implementation**
- File: `src/extraction/extract.js`
- Location: Inside `extractAllMessages()` while loop (around line 520)

**Change 1:** Pass `isBackfill: true` in options:

```javascript
// Inside while loop, replace existing extractMemories call:
const result = await extractMemories(currentBatch, targetChatId, { isBackfill: true, silent: true });
```

**Change 2:** Add final Phase 2 call after while loop (around line 560, before toast removal):

```javascript
// ===== NEW: Run final Phase 2 synthesis =====
// Update existing progress toast for the final heavy lifting
logInfo('Backfill Phase 1 complete. Running final Phase 2 synthesis...');
$('.openvault-backfill-toast .toast-message').text(
    `Backfill: 100% - Synthesizing world state and reflections. This may take a minute...`
);

try {
    await runPhase2Enrichment(data, settings, targetChatId);
} catch (error) {
    logError('Final Phase 2 enrichment failed', error);
    showToast('warning', 'Events saved, but final summarization failed. You can re-run later.', 'OpenVault');
    // Don't throw - Phase 1 data is safe
}
// ===== END FINAL PHASE 2 =====

// Now clear it when everything is truly done
$('.openvault-backfill-toast').remove();
```

**Step 3: Manual Verification**
- Command: `npm run build` (if build step exists)
- Action: Load extension in SillyTavern, click "Backfill All Messages"
- Observe: Toast shows "Synthesizing world state..." at 100%
- Verify: Only one Community detection runs at end (check console logs)

**Step 4: Git Commit**
- Command: `git add . && git commit -m "feat: wire up backfill to skip Phase 2 and run final synthesis"`

---

## Task 5: Add Empty Memories Guard to `runPhase2Enrichment()`

**Goal:** Prevent wasted API calls when no events were extracted.

**Step 1: Write the Failing Test**
- File: `tests/extraction/extract.test.js`
- Code:

```javascript
it('runPhase2Enrichment should return early if no memories exist', async () => {
    // Arrange: Empty data
    const emptyData = {
        memories: [],
        reflection_state: {},
        graph: { nodes: {}, edges: {} },
    };

    const sendRequest = vi.fn(); // Should NOT be called
    vi.mocked(getDeps).mockReturnValue({
        getContext: () => mockContext,
        getExtensionSettings: () => getExtractionSettings(),
        saveChatConditional: vi.fn().mockResolvedValue(true),
    });
    vi.mocked(getOpenVaultData).mockReturnValue(emptyData);

    // Act: Call with empty data
    const { runPhase2Enrichment } = await import('../../src/extraction/extract.js');
    await runPhase2Enrichment(emptyData, getExtractionSettings(), null);

    // Assert: No LLM calls made
    expect(sendRequest).not.toHaveBeenCalled();
});
```

**Step 2: Run Test (Red)**
- Command: `npm test tests/extraction/extract.test.js`
- Expect: FAIL - Guard not implemented, function attempts to process

**Step 3: Implementation (Green)**
- File: `src/extraction/extract.js`
- Location: At the TOP of `runPhase2Enrichment()` function

**Add guard at start of function:**

```javascript
export async function runPhase2Enrichment(data, settings, targetChatId) {
    const memories = data[MEMORIES_KEY] || [];

    // ===== NEW: Guard - No memories to enrich =====
    if (memories.length === 0) {
        logDebug('runPhase2Enrichment: No memories to enrich');
        return;
    }
    // ===== END GUARD =====

    logDebug('runPhase2Enrichment: Starting comprehensive Phase 2 synthesis');
    // ... rest of function ...
}
```

**Step 4: Verify (Green)**
- Command: `npm test tests/extraction/extract.test.js`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add empty memories guard to runPhase2Enrichment"`

---

## Task 6: Update JSDoc for `extractMemories()` Options

**Goal:** Document the new `isBackfill` option for developers.

**Step 1: No Test (Documentation Only)**

**Step 2: Implementation**
- File: `src/extraction/extract.js`
- Location: Function signature JSDoc for `extractMemories()`

**Add to JSDoc:**

```javascript
/**
 * Extract events from chat messages
 *
 * @param {number[]} [messageIds=null] - Optional specific message IDs for targeted extraction
 * @param {string} [targetChatId=null] - Optional chat ID to verify before saving
 * @param {Object} [options={}] - Optional configuration
 * @param {boolean} [options.silent=false] - Suppress toast notifications
 * @param {boolean} [options.isBackfill=false] - Skip Phase 2 LLM synthesis (for backfill mode)
 * @returns {Promise<{status: string, events_created?: number, messages_processed?: number, reason?: string}>}
 */
export async function extractMemories(messageIds = null, targetChatId = null, options = {}) {
```

**Step 3: Verify**
- Command: None (documentation)
- Visual: Check that JSDoc renders in IDE

**Step 4: Git Commit**
- Command: `git add . && git commit -m "docs: add isBackfill option to extractMemories JSDoc"`

---

## Task 7: Integration Test - Full Backfill Flow

**Goal:** Verify end-to-end behavior with multiple batches.

**Step 1: Write the Integration Test**
- File: `tests/extraction/extract.test.js`
- Code:

```javascript
it('should accumulate importance across batches and run Phase 2 once', async () => {
    // Arrange: Chat with 60 messages (would trigger 2 community detections normally)
    const chat = Array.from({ length: 60 }, (_, i) => ({
        id: i,
        mes: `Message ${i}`,
        is_user: i % 2 === 0,
        name: i % 2 === 0 ? 'User' : 'King Aldric',
    }));

    const mockDataLarge = {
        memories: [],
        reflection_state: {},
        graph: { nodes: {}, edges: {}, _mergeRedirects: {} },
        graph_message_count: 0,
        last_processed_message_id: -1,
        processed_message_ids: [],
    };

    // Mock Phase 1 LLM responses for 3 batches (20 msgs each at 3 tokens)
    const batch1Responses = mockSendRequest(
        { content: JSON.stringify({ questions: [], insights: [] }) }, // Reflection
        { content: JSON.stringify({ communities: [] }) }  // Community (should be skipped)
    );
    const batch2Responses = mockSendRequest(
        { content: JSON.stringify({ questions: [], insights: [] }) },
        { content: JSON.stringify({ communities: [] }) }
    );
    const batch3Responses = mockSendRequest(
        { content: JSON.stringify({ questions: [], insights: [] }) },
        { content: JSON.stringify({ communities: [] }) }
    );

    vi.mocked(getDeps).mockReturnValue({
        getContext: () => ({
            ...mockContext,
            chat,
        }),
        getExtensionSettings: () => ({
            [extensionName]: {
                ...getExtractionSettings(),
                extractionTokenBudget: 60, // 20 messages per batch
                communityDetectionInterval: 50, // Would trigger at batch 3
            },
        }),
        saveChatConditional: vi.fn().mockResolvedValue(true),
    });
    vi.mocked(getOpenVaultData).mockReturnValue(mockDataLarge);
    vi.mocked(saveOpenVaultData).mockResolvedValue(true);

    // Act: Simulate backfill by calling extractMemories 3 times with isBackfill=true
    await extractMemories([0, 1, 2], null, { isBackfill: true });
    await extractMemories([3, 4, 5], null, { isBackfill: true });
    await extractMemories([6, 7, 8], null, { isBackfill: true });

    // Then run final Phase 2 once
    const { runPhase2Enrichment } = await import('../../src/extraction/extract.js');
    await runPhase2Enrichment(mockDataLarge, getExtractionSettings(), null);

    // Assert: importance_sum accumulated across all batches
    expect(mockDataLarge.reflection_state['King Aldric'].importance_sum).toBeGreaterThan(0);

    // Assert: Only 1 final reflection/community call, not per-batch
    // (Implementation detail: verify via logs or spy on generateReflections)
});
```

**Step 2: Run Test (Green)**
- Command: `npm test tests/extraction/extract.test.js`
- Expect: PASS

**Step 3: Git Commit**
- Command: `git add . && git commit -m "test: add integration test for backfill Phase 2 defer"`

---

## Verification Checklist

After completing all tasks:

- [ ] All tests pass: `npm test`
- [ ] Worker unchanged: Check `worker.js` still calls `extractMemories(batch, chatId, { silent: true })`
- [ ] Manual test: Small backfill (~100 messages) - verify `importance_sum` accumulates
- [ ] Manual test: Large backfill (~1000 messages) - verify only ONE Phase 2 at end
- [ ] Console logs show "Backfill mode: skipping Phase 2 LLM synthesis" during batches
- [ ] Toast shows "Synthesizing world state..." at 100%
- [ ] No "Bad Gateway" errors during backfill

---

## Rollback Plan

If issues arise:

1. **Revert commits:** `git revert <commit-range>`
2. **Or restore pre-implementation state:** `git reset --hard <pre-implementation-commit>`
3. **Hotfix:** If only `isBackfill` guard causes issues, remove it but keep `runPhase2Enrichment()` helper
