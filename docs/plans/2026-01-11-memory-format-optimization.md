# Memory Format Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce scene_memory token usage by ~50% through format optimizations while preserving information density.

**Architecture:** Six targeted changes to `src/retrieval/formatting.js` and `src/prompts.js`: remove per-memory emotional annotations, add consolidated emotional trajectory, remove causality hints, invert Secret→Known tags, terser summary prompts, simplify header.

**Tech Stack:** JavaScript (ES Modules), Vitest

---

## Task 1: Remove Per-Memory Emotional Annotations

**Files:**
- Modify: `src/retrieval/formatting.js:47-74` (getEmotionalAnnotation function)
- Modify: `src/retrieval/formatting.js:195-199` (old bucket render)
- Modify: `src/retrieval/formatting.js:218-222` (mid bucket render)
- Modify: `src/retrieval/formatting.js:252-256` (recent bucket render)
- Modify: `tests/formatting.test.js:302-370` (emotional annotation tests)

**Step 1: Write failing tests for no emotional annotations**

In `tests/formatting.test.js`, update the emotional annotations describe block:

```javascript
describe('emotional annotations (removed)', () => {
    it('does NOT add emotional annotation even for importance >= 4', () => {
        const memories = [
            {
                id: '1',
                summary: 'Major event',
                message_ids: [4980],
                sequence: 498000,
                importance: 4,
                emotional_impact: { 'Alice': 'guilt', 'Bob': 'shock' }
            },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).not.toContain('💔 Emotional:');
        expect(result).toContain('[★★★★] Major event');
    });

    it('does NOT add emotional annotation for importance 5', () => {
        const memories = [
            {
                id: '1',
                summary: 'Critical event',
                message_ids: [4980],
                sequence: 498000,
                importance: 5,
                emotional_impact: ['fear']
            },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).not.toContain('💔 Emotional:');
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/formatting.test.js`
Expected: FAIL - tests expect no emotional annotations but current code adds them

**Step 3: Remove getEmotionalAnnotation function and all calls**

In `src/retrieval/formatting.js`:

Remove the `getEmotionalAnnotation` function entirely (lines 47-74).

Remove the constant:
```javascript
// DELETE THIS LINE:
const EMOTIONAL_IMPORTANCE_MIN = 4;
```

In the old bucket render loop (~line 195), remove:
```javascript
            // DELETE THESE LINES:
            // Add emotional annotation for high-importance memories
            const emotionalAnnotation = getEmotionalAnnotation(memory);
            if (emotionalAnnotation) {
                lines.push(emotionalAnnotation);
            }
```

In the mid bucket render loop (~line 218), remove:
```javascript
            // DELETE THESE LINES:
            // Add emotional annotation for high-importance memories
            const emotionalAnnotation = getEmotionalAnnotation(memory);
            if (emotionalAnnotation) {
                lines.push(emotionalAnnotation);
            }
```

In the recent bucket render loop (~line 252), remove:
```javascript
            // DELETE THESE LINES:
            // Add emotional annotation for high-importance memories
            const emotionalAnnotation = getEmotionalAnnotation(memory);
            if (emotionalAnnotation) {
                lines.push(emotionalAnnotation);
            }
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/formatting.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "refactor: remove per-memory emotional annotations"
```

---

## Task 2: Remove Causality Hints

**Files:**
- Modify: `src/retrieval/formatting.js:34-45` (getCausalityHint function)
- Modify: `src/retrieval/formatting.js:186-193` (old bucket causality)
- Modify: `src/retrieval/formatting.js:210-216` (mid bucket causality)
- Modify: `src/retrieval/formatting.js:244-250` (recent bucket causality)
- Modify: `tests/formatting.test.js:264-300` (causality hint tests)

**Step 1: Write failing tests for no causality hints**

In `tests/formatting.test.js`, update the causality hints describe block:

```javascript
describe('causality hints (removed)', () => {
    it('does NOT add "IMMEDIATELY AFTER" for gaps < 5 messages', () => {
        const memories = [
            { id: '1', summary: 'Event A', message_ids: [4980], sequence: 498000, importance: 3 },
            { id: '2', summary: 'Event B', message_ids: [4983], sequence: 498300, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).not.toContain('⤷');
        expect(result).not.toContain('IMMEDIATELY AFTER');
    });

    it('does NOT add "Shortly after" for gaps 5-14 messages', () => {
        const memories = [
            { id: '1', summary: 'Event A', message_ids: [4980], sequence: 498000, importance: 3 },
            { id: '2', summary: 'Event B', message_ids: [4990], sequence: 499000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).not.toContain('⤷');
        expect(result).not.toContain('Shortly after');
    });

    it('no causality hints in any bucket', () => {
        const memories = [
            { id: '1', summary: 'Old A', message_ids: [100], sequence: 100000, importance: 3 },
            { id: '2', summary: 'Old B', message_ids: [103], sequence: 103000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).not.toContain('⤷');
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/formatting.test.js`
Expected: FAIL - tests expect no causality hints but current code adds them

**Step 3: Remove getCausalityHint function and all calls**

In `src/retrieval/formatting.js`:

Remove the `getCausalityHint` function entirely (lines 34-45).

Remove the constants:
```javascript
// DELETE THESE LINES:
const IMMEDIATE_GAP = 5;  // "⤷ IMMEDIATELY AFTER"
const CLOSE_GAP = 15;     // "⤷ Shortly after"
```

In the old bucket render loop, remove:
```javascript
            // DELETE THESE LINES:
            // Add causality hint for small gaps (no separator was added)
            if (i > 0 && gap < GAP_SMALL) {
                const hint = getCausalityHint(gap);
                if (hint) {
                    lines.push(hint);
                }
            }
```

In the mid bucket render loop, remove:
```javascript
            // DELETE THESE LINES:
            // Add causality hint for close memories
            if (i > 0) {
                const prevMemory = filteredBuckets.mid[i - 1];
                const gap = getMemoryPosition(memory) - getMemoryPosition(prevMemory);
                const hint = getCausalityHint(gap);
                if (hint) {
                    lines.push(hint);
                }
            }
```

In the recent bucket render loop, remove:
```javascript
            // DELETE THESE LINES:
            // Add causality hint for close memories
            if (i > 0) {
                const prevMemory = filteredBuckets.recent[i - 1];
                const gap = getMemoryPosition(memory) - getMemoryPosition(prevMemory);
                const hint = getCausalityHint(gap);
                if (hint) {
                    lines.push(hint);
                }
            }
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/formatting.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "refactor: remove causality hints from memory format"
```

---

## Task 3: Invert [Secret] → [Known] Tag Logic

**Files:**
- Modify: `src/retrieval/formatting.js:160-165` (formatMemory helper)
- Modify: `tests/formatting.test.js` (secret memory tests)

**Step 1: Write failing tests for [Known] tag logic**

In `tests/formatting.test.js`, add a new describe block after the existing secret test:

```javascript
describe('[Known] tag (inverted from [Secret])', () => {
    it('no tag for secret memories (default private)', () => {
        const memories = [
            { id: '1', summary: 'Private event', message_ids: [450], sequence: 450000, importance: 3, is_secret: true },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).toContain('[★★★] Private event');
        expect(result).not.toContain('[Secret]');
        expect(result).not.toContain('[Known]');
    });

    it('no tag for non-secret with 2 or fewer witnesses (default private)', () => {
        const memories = [
            { id: '1', summary: 'Semi-private event', message_ids: [450], sequence: 450000, importance: 3, is_secret: false, witnesses: ['Alice', 'Bob'] },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).toContain('[★★★] Semi-private event');
        expect(result).not.toContain('[Known]');
    });

    it('adds [Known] tag for non-secret with more than 2 witnesses', () => {
        const memories = [
            { id: '1', summary: 'Public event', message_ids: [450], sequence: 450000, importance: 3, is_secret: false, witnesses: ['Alice', 'Bob', 'Charlie'] },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).toContain('[★★★] [Known] Public event');
    });

    it('no tag when witnesses array is empty', () => {
        const memories = [
            { id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3, is_secret: false, witnesses: [] },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).not.toContain('[Known]');
    });

    it('no tag when witnesses field is missing', () => {
        const memories = [
            { id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3, is_secret: false },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).not.toContain('[Known]');
    });
});
```

Also update the existing test that checks for [Secret]:

```javascript
// Find and UPDATE this test:
it('does NOT mark secret memories with [Secret] prefix (inverted logic)', () => {
    const memories = [
        { id: '1', summary: 'Secret info', message_ids: [450], sequence: 450000, importance: 3, is_secret: true },
    ];
    const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

    expect(result).toContain('[★★★] Secret info');
    expect(result).not.toContain('[Secret]');
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/formatting.test.js`
Expected: FAIL - tests expect [Known] logic but current code uses [Secret]

**Step 3: Update formatMemory helper**

In `src/retrieval/formatting.js`, find the `formatMemory` helper function (around line 160) and update it:

```javascript
    // Helper to format a single memory
    const formatMemory = (memory) => {
        const importance = memory.importance || 3;
        const stars = '\u2605'.repeat(importance);

        // Invert: tag [Known] for public events with >2 witnesses, default is private
        const isKnown = !memory.is_secret && (memory.witnesses?.length || 0) > 2;
        const prefix = isKnown ? '[Known] ' : '';

        return `[${stars}] ${prefix}${memory.summary}`;
    };
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/formatting.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "refactor: invert [Secret] to [Known] tag for public events"
```

---

## Task 4: Simplify Header Format

**Files:**
- Modify: `src/retrieval/formatting.js:131` (header line)
- Modify: `tests/formatting.test.js:77-80` (header test)

**Step 1: Write failing test for simplified header**

In `tests/formatting.test.js`, update the header test:

```javascript
it('formats simplified header with chat length', () => {
    const result = formatContextForInjection([], [], null, 'Alice', 1000, 50);
    expect(result).toContain('<scene_memory>');
    expect(result).toContain('(#50 messages)');
    expect(result).not.toContain('Current chat has');
    expect(result).toContain('</scene_memory>');
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/formatting.test.js`
Expected: FAIL - test expects `(#50 messages)` but gets `(Current chat has #50 messages)`

**Step 3: Update header line**

In `src/retrieval/formatting.js`, change line 131:

```javascript
// FROM:
`(Current chat has #${chatLength} messages)`,

// TO:
`(#${chatLength} messages)`,
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/formatting.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "refactor: simplify header to (#N messages)"
```

---

## Task 5: Add Consolidated Emotional Trajectory to Current Scene

**Files:**
- Modify: `src/retrieval/formatting.js` (add formatEmotionalTrajectory function)
- Modify: `tests/formatting.test.js` (add trajectory tests)

**Step 1: Write failing tests for emotional trajectory**

In `tests/formatting.test.js`, add a new describe block:

```javascript
describe('emotional trajectory in Current Scene', () => {
    it('shows character emotions in simplified format', () => {
        const memories = [
            { id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 },
        ];
        const presentCharacters = ['Bob'];
        const emotionalInfo = {
            emotion: 'anxious',
            characterEmotions: { 'Alice': 'anxious', 'Bob': 'caring' }
        };
        const result = formatContextForInjection(memories, presentCharacters, emotionalInfo, 'Alice', 10000, 500);

        expect(result).toContain('## Current Scene');
        expect(result).toContain('Emotions: Alice anxious, Bob caring');
    });

    it('omits emotions line when no character emotions', () => {
        const memories = [
            { id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 },
        ];
        const emotionalInfo = { emotion: 'neutral' };
        const result = formatContextForInjection(memories, [], emotionalInfo, 'Alice', 10000, 500);

        expect(result).not.toContain('Emotions:');
    });

    it('omits neutral emotions from trajectory', () => {
        const memories = [
            { id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 },
        ];
        const emotionalInfo = {
            emotion: 'happy',
            characterEmotions: { 'Alice': 'happy', 'Bob': 'neutral' }
        };
        const result = formatContextForInjection(memories, [], emotionalInfo, 'Alice', 10000, 500);

        expect(result).toContain('Emotions: Alice happy');
        expect(result).not.toContain('Bob');
    });

    it('limits emotions to 5 characters', () => {
        const memories = [
            { id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 },
        ];
        const emotionalInfo = {
            emotion: 'happy',
            characterEmotions: {
                'Alice': 'happy', 'Bob': 'sad', 'Charlie': 'angry',
                'Dave': 'excited', 'Eve': 'calm', 'Frank': 'worried'
            }
        };
        const result = formatContextForInjection(memories, [], emotionalInfo, 'Alice', 10000, 500);

        // Should have exactly 5 characters, not 6
        const emotionsLine = result.match(/Emotions: (.+)/)?.[1] || '';
        const commaCount = (emotionsLine.match(/,/g) || []).length;
        expect(commaCount).toBe(4); // 5 items = 4 commas
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/formatting.test.js`
Expected: FAIL - characterEmotions format not yet supported

**Step 3: Add formatEmotionalTrajectory helper and update rendering**

In `src/retrieval/formatting.js`, add a new helper function after `getGapSeparator`:

```javascript
/**
 * Format emotional trajectory for Current Scene
 * @param {Object} emotionalInfo - Emotional info with characterEmotions
 * @param {number} limit - Max characters to show (default 5)
 * @returns {string|null} Formatted emotions line or null
 */
function formatEmotionalTrajectory(emotionalInfo, limit = 5) {
    if (!emotionalInfo || typeof emotionalInfo !== 'object') return null;

    const characterEmotions = emotionalInfo.characterEmotions;
    if (!characterEmotions || typeof characterEmotions !== 'object') return null;

    const lines = [];
    for (const [name, emotion] of Object.entries(characterEmotions)) {
        if (emotion && emotion !== 'neutral') {
            lines.push(`${name} ${emotion}`);
        }
    }

    if (lines.length === 0) return null;
    return `Emotions: ${lines.slice(0, limit).join(', ')}`;
}
```

In the `formatContextForInjection` function, update the RECENT bucket section to include the trajectory. Find the section that renders emotional state and add the trajectory after Present:

```javascript
    // Render RECENT bucket (always if has content: memories, emotion, or present characters)
    const emotionsLine = formatEmotionalTrajectory(emotionalInfo);
    const hasFilteredRecentContent = filteredBuckets.recent.length > 0 || emotionalLine || presentLine || emotionsLine;
    if (hasFilteredRecentContent) {
        lines.push(bucketHeaders.recent);

        // Present characters first
        if (presentLine) {
            lines.push(presentLine);
        }

        // Character emotions second
        if (emotionsLine) {
            lines.push(emotionsLine);
        }

        // Add blank line before memories if we have context above
        if ((presentLine || emotionsLine) && filteredBuckets.recent.length > 0) {
            lines.push('');
        }

        // Recent memories
        for (let i = 0; i < filteredBuckets.recent.length; i++) {
            const memory = filteredBuckets.recent[i];
            lines.push(formatMemory(memory));
        }
        lines.push('');
    }
```

Also remove the old `formatEmotionalState` helper and its usage since we're replacing per-POV emotional state with character trajectory. Update the `hasFilteredRecentContent` check to remove `emotionalLine` reference.

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/formatting.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "feat: add consolidated emotional trajectory to Current Scene"
```

---

## Task 6: Update Extraction Prompts for Terser Summaries

**Files:**
- Modify: `src/prompts.js:49-51` (output_format summary spec)
- Modify: `src/prompts.js` (update examples)

**Step 1: Document current prompt text (no automated test)**

This is a prompt change. Manual verification will be done after implementation.

Current summary spec in `_extractionSchema()`:
```
"summary": "12-32 words, past tense, English, factual with context"
```

**Step 2: Update summary specification**

In `src/prompts.js`, find the `<output_format>` section in `_extractionSchema()` and update the summary line:

```javascript
// FROM:
"summary": "12-32 words, past tense, English, factual with context",

// TO:
"summary": "8-18 words, past tense, English, factual. NO meta-commentary (avoid 'establishing', 'showing', 'demonstrating').",
```

**Step 3: Update examples to be terser**

In `src/prompts.js`, update the example summaries in `_extractionExamples()`:

```javascript
// Example: revelation_confession - keep as-is (already terse)
"summary": "Elena confessed to killing her brother to prevent Empire betrayal.",

// Example: action_combat - make terser
// FROM: "Marcus attacked the assassin with his sword to protect Elena."
// TO:
"summary": "Marcus attacked assassin with sword to protect Elena.",

// Example: relationship_change - make terser
// FROM: "Sarah and Tom formed an uneasy alliance despite their rivalry."
// TO:
"summary": "Sarah and Tom formed uneasy alliance despite rivalry.",

// Example: action_intimacy - make terser
// FROM: "Liam caressed Anya's cheek and requested a kiss, which she eagerly accepted."
// TO:
"summary": "Liam caressed Anya's cheek, requested kiss; she accepted eagerly.",

// Example: new_element_extract - make terser
// FROM: "Derek introduced pet roleplay by collaring Sasha, who accepted the submissive role and addressed him as Master for the first time."
// TO:
"summary": "Derek collared Sasha, initiating pet roleplay; she called him Master.",
```

**Step 4: Add negative example for meta-commentary**

In `src/prompts.js`, add a new example in `_extractionExamples()` after the existing examples:

```javascript
<example type="avoid_meta_commentary">
<input>[Derek]: *pulls out the leather collar* You're going to wear this from now on.
[Sasha]: *kneels submissively* Yes, Master. *accepts the collar*</input>
<wrong_output>[
  {
    "summary": "Derek established dominance by presenting a collar to Sasha, establishing their D/s dynamic."
  }
]</wrong_output>
<correct_output>[
  {
    "summary": "Derek gave Sasha a leather collar; she knelt and accepted it."
  }
]</correct_output>
<note>Avoid meta-commentary words like "established", "establishing", "showing", "demonstrating". Just state what happened.</note>
</example>
```

**Step 5: Run tests to verify nothing broke**

Run: `npm test`
Expected: PASS (prompt changes don't have unit tests)

**Step 6: Commit**

```bash
git add src/prompts.js
git commit -m "feat: update extraction prompts for terser summaries"
```

---

## Task 7: Update Narrative Engine Integration Test

**Files:**
- Modify: `tests/formatting.test.js` (narrative engine integration test)

**Step 1: Update the integration test expectations**

In `tests/formatting.test.js`, find the `narrative engine integration` describe block and update it to match the new format:

```javascript
describe('narrative engine integration', () => {
    it('produces expected narrative output for long chat', () => {
        const memories = [
            // Old bucket (position < 4500 in 5000 chat)
            { id: '1', summary: 'Bought a sword', message_ids: [100], sequence: 100000, importance: 2 },
            { id: '2', summary: 'Elder warned of goblins', message_ids: [105], sequence: 105000, importance: 3 },
            { id: '3', summary: 'Met Marcus at tavern', message_ids: [800], sequence: 800000, importance: 2 },
            { id: '4', summary: 'Great battle began', message_ids: [2000], sequence: 2000000, importance: 4, emotional_impact: { 'Hero': 'fear' } },

            // Mid bucket (4500-4900)
            { id: '5', summary: 'Goblin stole the amulet', message_ids: [4550], sequence: 455000, importance: 4, emotional_impact: { 'Hero': 'anger' } },
            { id: '6', summary: 'Tracked goblin into forest', message_ids: [4553], sequence: 455300, importance: 3 },

            // Recent bucket (> 4900)
            { id: '7', summary: 'Goblin camp was burned', message_ids: [4980], sequence: 498000, importance: 5, emotional_impact: { 'Hero': 'triumph' } },
            { id: '8', summary: 'Goblin is cornered', message_ids: [4985], sequence: 498500, importance: 4 },
        ];

        const presentCharacters = ['Goblin'];
        const emotionalInfo = {
            emotion: 'anxious',
            characterEmotions: { 'Hero': 'determined', 'Goblin': 'terrified' }
        };

        const result = formatContextForInjection(
            memories,
            presentCharacters,
            emotionalInfo,
            'Hero',
            10000,
            5000
        );

        // Structure checks
        expect(result).toContain('## The Story So Far');
        expect(result).toContain('## Leading Up To This Moment');
        expect(result).toContain('## Current Scene');

        // Simplified header
        expect(result).toContain('(#5000 messages)');
        expect(result).not.toContain('Current chat has');

        // Gap separator in old bucket (105 -> 800 = 695 gap)
        expect(result).toContain('...Much later...');

        // NO causality hints (removed)
        expect(result).not.toContain('⤷');

        // NO per-memory emotional annotations (removed)
        expect(result).not.toContain('💔 Emotional:');

        // Character emotions in Current Scene
        expect(result).toContain('Emotions: Hero determined, Goblin terrified');

        // Present characters in recent
        expect(result).toContain('Present: Goblin');

        // Memories should NOT have [Secret] tags (inverted)
        expect(result).not.toContain('[Secret]');
    });
});
```

**Step 2: Run tests to verify they pass**

Run: `npm test -- tests/formatting.test.js`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/formatting.test.js
git commit -m "test: update integration test for optimized format"
```

---

## Task 8: Clean Up Unused Code and Final Verification

**Files:**
- Modify: `src/retrieval/formatting.js` (remove dead code)

**Step 1: Review and remove any remaining dead code**

Check `src/retrieval/formatting.js` for:
- Unused imports
- Unused constants
- Unused helper functions
- Dead code paths

Remove any found.

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 3: Run linter**

Run: `npm run lint`
Expected: No errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: clean up dead code from memory format optimization"
```

---

## Summary

| Task | Description | Estimated Time |
|------|-------------|----------------|
| 1 | Remove per-memory emotional annotations | 5 min |
| 2 | Remove causality hints | 5 min |
| 3 | Invert [Secret] → [Known] tag logic | 5 min |
| 4 | Simplify header format | 3 min |
| 5 | Add consolidated emotional trajectory | 10 min |
| 6 | Update extraction prompts for terser summaries | 10 min |
| 7 | Update integration test | 5 min |
| 8 | Clean up and final verification | 5 min |

**Total estimated time: ~50 minutes**

**Token savings estimate: ~50%**

