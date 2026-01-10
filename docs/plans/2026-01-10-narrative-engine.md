# Narrative Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace percentage-based timeline buckets with fixed windows, add gap separators, causality hints, and emotional annotations.

**Architecture:** Modify `formatContextForInjection` and `assignMemoriesToBuckets` in `src/retrieval/formatting.js`. Add constants for thresholds. Tests in `tests/formatting.test.js`.

**Tech Stack:** ES Modules, Vitest

---

## Task 1: Add Constants

**Files:**
- Modify: `src/retrieval/formatting.js:1-10`

**Step 1: Write failing test for constants export**

```javascript
// In tests/formatting.test.js, add at top of imports:
import {
    getRelationshipContext,
    formatContextForInjection,
    getMemoryPosition,
    assignMemoriesToBuckets,
    CURRENT_SCENE_SIZE,
    LEADING_UP_SIZE,
} from '../src/retrieval/formatting.js';

// Add new describe block after imports:
describe('constants', () => {
    it('exports CURRENT_SCENE_SIZE as 50', () => {
        expect(CURRENT_SCENE_SIZE).toBe(50);
    });

    it('exports LEADING_UP_SIZE as 500', () => {
        expect(LEADING_UP_SIZE).toBe(500);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "CURRENT_SCENE_SIZE is not exported"

**Step 3: Add constants to formatting.js**

Add after the imports section (around line 8):

```javascript
// Narrative engine constants
export const CURRENT_SCENE_SIZE = 50;   // "Current Scene" = last 50 messages
export const LEADING_UP_SIZE = 500;     // "Leading Up" = messages 51-500 ago

// Gap thresholds (for separators in "Story So Far")
const GAP_SMALL = 15;    // No separator
const GAP_MEDIUM = 100;  // "..."
const GAP_LARGE = 500;   // "...Later..." / "...Much later..."

// Causality thresholds
const IMMEDIATE_GAP = 5;  // "⤷ IMMEDIATELY AFTER"
const CLOSE_GAP = 15;     // "⤷ Shortly after"

// Annotation threshold
const EMOTIONAL_IMPORTANCE_MIN = 4;
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "feat: add narrative engine constants"
```

---

## Task 2: Update Bucket Assignment to Fixed Windows

**Files:**
- Modify: `src/retrieval/formatting.js:30-60` (assignMemoriesToBuckets function)
- Modify: `tests/formatting.test.js` (assignMemoriesToBuckets tests)

**Step 1: Update existing tests to expect fixed windows**

Replace the `assignMemoriesToBuckets` describe block:

```javascript
describe('assignMemoriesToBuckets', () => {
    it('assigns memories to correct buckets with fixed windows', () => {
        // Chat length 5000: recent > 4950, mid > 4500, old <= 4500
        const memories = [
            { id: '1', message_ids: [100] },    // old (< 4500)
            { id: '2', message_ids: [4600] },   // mid (4500-4950)
            { id: '3', message_ids: [4980] },   // recent (> 4950)
        ];
        const result = assignMemoriesToBuckets(memories, 5000);

        expect(result.old).toHaveLength(1);
        expect(result.old[0].id).toBe('1');
        expect(result.mid).toHaveLength(1);
        expect(result.mid[0].id).toBe('2');
        expect(result.recent).toHaveLength(1);
        expect(result.recent[0].id).toBe('3');
    });

    it('handles boundary at CURRENT_SCENE_SIZE (50)', () => {
        // Chat length 5000: recent threshold = 4950
        const memories = [
            { id: '1', message_ids: [4950] },  // exactly at boundary = recent
            { id: '2', message_ids: [4949] },  // just below = mid
        ];
        const result = assignMemoriesToBuckets(memories, 5000);

        expect(result.recent.some(m => m.id === '1')).toBe(true);
        expect(result.mid.some(m => m.id === '2')).toBe(true);
    });

    it('handles boundary at LEADING_UP_SIZE (500)', () => {
        // Chat length 5000: mid threshold = 4500
        const memories = [
            { id: '1', message_ids: [4500] },  // exactly at boundary = mid
            { id: '2', message_ids: [4499] },  // just below = old
        ];
        const result = assignMemoriesToBuckets(memories, 5000);

        expect(result.mid.some(m => m.id === '1')).toBe(true);
        expect(result.old.some(m => m.id === '2')).toBe(true);
    });

    it('puts everything in recent when chat < CURRENT_SCENE_SIZE', () => {
        const memories = [
            { id: '1', message_ids: [10] },
            { id: '2', message_ids: [30] },
        ];
        const result = assignMemoriesToBuckets(memories, 40); // < 50

        expect(result.old).toEqual([]);
        expect(result.mid).toEqual([]);
        expect(result.recent).toHaveLength(2);
    });

    it('has no old bucket when chat < LEADING_UP_SIZE', () => {
        // Chat length 200: recent > 150, mid > -300 (clamped to 0)
        const memories = [
            { id: '1', message_ids: [50] },   // mid (0-150)
            { id: '2', message_ids: [180] },  // recent (> 150)
        ];
        const result = assignMemoriesToBuckets(memories, 200);

        expect(result.old).toEqual([]);
        expect(result.mid).toHaveLength(1);
        expect(result.recent).toHaveLength(1);
    });

    it('returns empty buckets when no memories', () => {
        const result = assignMemoriesToBuckets([], 5000);
        expect(result.old).toEqual([]);
        expect(result.mid).toEqual([]);
        expect(result.recent).toEqual([]);
    });

    it('puts all memories in recent when chatLength is 0', () => {
        const memories = [
            { id: '1', message_ids: [10] },
            { id: '2', message_ids: [50] },
        ];
        const result = assignMemoriesToBuckets(memories, 0);

        expect(result.old).toEqual([]);
        expect(result.mid).toEqual([]);
        expect(result.recent).toHaveLength(2);
    });

    it('sorts memories chronologically within each bucket', () => {
        const memories = [
            { id: '1', message_ids: [30], sequence: 30000 },
            { id: '2', message_ids: [10], sequence: 10000 },
            { id: '3', message_ids: [20], sequence: 20000 },
        ];
        const result = assignMemoriesToBuckets(memories, 5000);

        // All in 'old' bucket, sorted by sequence
        expect(result.old[0].id).toBe('2');
        expect(result.old[1].id).toBe('3');
        expect(result.old[2].id).toBe('1');
    });

    it('handles null memories array', () => {
        const result = assignMemoriesToBuckets(null, 5000);
        expect(result.old).toEqual([]);
        expect(result.mid).toEqual([]);
        expect(result.recent).toEqual([]);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL (tests expect fixed windows but code uses percentages)

**Step 3: Update assignMemoriesToBuckets to use fixed windows**

Replace the function:

```javascript
export function assignMemoriesToBuckets(memories, chatLength) {
    const result = { old: [], mid: [], recent: [] };

    if (!memories || memories.length === 0) {
        return result;
    }

    // Fixed window thresholds
    const recentThreshold = Math.max(0, chatLength - CURRENT_SCENE_SIZE);
    const midThreshold = Math.max(0, chatLength - LEADING_UP_SIZE);

    for (const memory of memories) {
        const position = getMemoryPosition(memory);

        if (chatLength === 0 || position >= recentThreshold) {
            result.recent.push(memory);
        } else if (position >= midThreshold) {
            result.mid.push(memory);
        } else {
            result.old.push(memory);
        }
    }

    // Sort each bucket chronologically by sequence
    const sortBySequence = (a, b) => (a.sequence || 0) - (b.sequence || 0);
    result.old.sort(sortBySequence);
    result.mid.sort(sortBySequence);
    result.recent.sort(sortBySequence);

    return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "feat: switch to fixed window bucket assignment"
```

---

## Task 3: Update Bucket Headers to Markdown Format

**Files:**
- Modify: `src/retrieval/formatting.js:110-130` (bucket headers in formatContextForInjection)
- Modify: `tests/formatting.test.js` (header assertions)

**Step 1: Update tests to expect new headers**

Find and replace all header assertions in tests:

```javascript
// OLD assertions to find and replace:
// '[ESTABLISHED HISTORY]' -> '## The Story So Far'
// '[PREVIOUSLY]' -> '## Leading Up To This Moment'
// '[RECENT EVENTS]' -> '## Current Scene'
// Remove assertions about 'messages X-Y' in headers

// Update the 'renders OLD bucket with correct header' test:
it('renders old bucket with markdown header', () => {
    const memories = [
        { id: '1', summary: 'Old event', message_ids: [50], sequence: 50000, importance: 3 },
    ];
    const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

    expect(result).toContain('## The Story So Far');
    expect(result).toContain('Old event');
});

// Update 'renders MID bucket with correct header':
it('renders mid bucket with markdown header', () => {
    const memories = [
        { id: '1', summary: 'Mid event', message_ids: [4600], sequence: 460000, importance: 3 },
    ];
    const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

    expect(result).toContain('## Leading Up To This Moment');
    expect(result).toContain('Mid event');
});

// Update 'renders RECENT bucket with correct header':
it('renders recent bucket with markdown header', () => {
    const memories = [
        { id: '1', summary: 'Recent event', message_ids: [4980], sequence: 498000, importance: 3 },
    ];
    const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

    expect(result).toContain('## Current Scene');
    expect(result).toContain('Recent event');
});

// Update 'skips empty buckets':
it('skips empty buckets', () => {
    const memories = [
        { id: '1', summary: 'Recent only', message_ids: [4980], sequence: 498000, importance: 3 },
    ];
    const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

    expect(result).not.toContain('## The Story So Far');
    expect(result).not.toContain('## Leading Up To This Moment');
    expect(result).toContain('## Current Scene');
});

// Update 'renders all three buckets when populated':
it('renders all three buckets when populated', () => {
    const memories = [
        { id: '1', summary: 'Old', message_ids: [50], sequence: 50000, importance: 3 },
        { id: '2', summary: 'Mid', message_ids: [4600], sequence: 460000, importance: 3 },
        { id: '3', summary: 'Recent', message_ids: [4980], sequence: 498000, importance: 3 },
    ];
    const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

    expect(result).toContain('## The Story So Far');
    expect(result).toContain('## Leading Up To This Moment');
    expect(result).toContain('## Current Scene');

    // Verify order
    const oldIndex = result.indexOf('## The Story So Far');
    const midIndex = result.indexOf('## Leading Up To This Moment');
    const recentIndex = result.indexOf('## Current Scene');
    expect(oldIndex).toBeLessThan(midIndex);
    expect(midIndex).toBeLessThan(recentIndex);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL (expecting markdown headers but getting bracket headers)

**Step 3: Update bucket headers in formatContextForInjection**

Replace the bucketHeaders object:

```javascript
const bucketHeaders = {
    old: '## The Story So Far',
    mid: '## Leading Up To This Moment',
    recent: '## Current Scene',
};
```

Also remove the threshold calculations that were used for header message ranges (they're no longer needed):

```javascript
// DELETE these lines:
// const midThreshold = Math.floor(chatLength * 0.40);
// const recentThreshold = Math.floor(chatLength * 0.80);
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "feat: update bucket headers to markdown format"
```

---

## Task 4: Add Gap Separator Logic for Story So Far Bucket

**Files:**
- Modify: `src/retrieval/formatting.js` (add helper + update rendering)
- Modify: `tests/formatting.test.js`

**Step 1: Write failing tests for gap separators**

Add new describe block:

```javascript
describe('gap separators', () => {
    it('adds "..." separator for gaps 15-99 messages', () => {
        const memories = [
            { id: '1', summary: 'Event A', message_ids: [100], sequence: 100000, importance: 3 },
            { id: '2', summary: 'Event B', message_ids: [150], sequence: 150000, importance: 3 }, // gap = 50
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).toContain('Event A');
        expect(result).toContain('...\n');
        expect(result).toContain('Event B');
        // Verify order
        const aIndex = result.indexOf('Event A');
        const sepIndex = result.indexOf('...\n');
        const bIndex = result.indexOf('Event B');
        expect(aIndex).toBeLessThan(sepIndex);
        expect(sepIndex).toBeLessThan(bIndex);
    });

    it('adds "...Later..." separator for gaps 100-499 messages', () => {
        const memories = [
            { id: '1', summary: 'Event A', message_ids: [100], sequence: 100000, importance: 3 },
            { id: '2', summary: 'Event B', message_ids: [350], sequence: 350000, importance: 3 }, // gap = 250
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).toContain('...Later...');
    });

    it('adds "...Much later..." separator for gaps >= 500 messages', () => {
        const memories = [
            { id: '1', summary: 'Event A', message_ids: [100], sequence: 100000, importance: 3 },
            { id: '2', summary: 'Event B', message_ids: [700], sequence: 700000, importance: 3 }, // gap = 600
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).toContain('...Much later...');
    });

    it('no separator for gaps < 15 messages', () => {
        const memories = [
            { id: '1', summary: 'Event A', message_ids: [100], sequence: 100000, importance: 3 },
            { id: '2', summary: 'Event B', message_ids: [110], sequence: 110000, importance: 3 }, // gap = 10
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).not.toContain('...');
        expect(result).not.toContain('Later');
    });

    it('only adds separators in Story So Far bucket', () => {
        // Two memories in "mid" bucket with large gap - should NOT have separator
        const memories = [
            { id: '1', summary: 'Mid A', message_ids: [4550], sequence: 455000, importance: 3 },
            { id: '2', summary: 'Mid B', message_ids: [4900], sequence: 490000, importance: 3 }, // gap = 350
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).not.toContain('...Later...');
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL (no separators implemented yet)

**Step 3: Add gap separator helper and update OLD bucket rendering**

Add helper function after the constants:

```javascript
/**
 * Get gap separator text based on message distance
 * @param {number} gap - Number of messages between memories
 * @returns {string|null} Separator text or null if no separator needed
 */
function getGapSeparator(gap) {
    if (gap >= GAP_LARGE) {
        return '...Much later...';
    } else if (gap >= GAP_MEDIUM) {
        return '...Later...';
    } else if (gap >= GAP_SMALL) {
        return '...';
    }
    return null;
}
```

Update the OLD bucket rendering section to use gaps:

```javascript
// Render OLD bucket (with gap separators)
if (filteredBuckets.old.length > 0) {
    lines.push(bucketHeaders.old);
    for (let i = 0; i < filteredBuckets.old.length; i++) {
        const memory = filteredBuckets.old[i];

        // Add gap separator if not first memory
        if (i > 0) {
            const prevMemory = filteredBuckets.old[i - 1];
            const gap = getMemoryPosition(memory) - getMemoryPosition(prevMemory);
            const separator = getGapSeparator(gap);
            if (separator) {
                lines.push('');
                lines.push(separator);
                lines.push('');
            }
        }

        lines.push(formatMemory(memory));
    }
    lines.push('');
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "feat: add gap separators for Story So Far bucket"
```

---

## Task 5: Add Causality Hints

**Files:**
- Modify: `src/retrieval/formatting.js` (update formatMemory and bucket rendering)
- Modify: `tests/formatting.test.js`

**Step 1: Write failing tests for causality hints**

Add new describe block:

```javascript
describe('causality hints', () => {
    it('adds "IMMEDIATELY AFTER" for gaps < 5 messages', () => {
        const memories = [
            { id: '1', summary: 'Event A', message_ids: [4980], sequence: 498000, importance: 3 },
            { id: '2', summary: 'Event B', message_ids: [4983], sequence: 498300, importance: 3 }, // gap = 3
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).toContain('⤷ IMMEDIATELY AFTER');
    });

    it('adds "Shortly after" for gaps 5-14 messages', () => {
        const memories = [
            { id: '1', summary: 'Event A', message_ids: [4980], sequence: 498000, importance: 3 },
            { id: '2', summary: 'Event B', message_ids: [4990], sequence: 499000, importance: 3 }, // gap = 10
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).toContain('⤷ Shortly after');
    });

    it('no causality hint for gaps >= 15 messages', () => {
        const memories = [
            { id: '1', summary: 'Event A', message_ids: [4960], sequence: 496000, importance: 3 },
            { id: '2', summary: 'Event B', message_ids: [4980], sequence: 498000, importance: 3 }, // gap = 20
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).not.toContain('⤷');
    });

    it('applies causality hints in all buckets', () => {
        // Memories in old bucket with small gap
        const memories = [
            { id: '1', summary: 'Old A', message_ids: [100], sequence: 100000, importance: 3 },
            { id: '2', summary: 'Old B', message_ids: [103], sequence: 103000, importance: 3 }, // gap = 3
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).toContain('⤷ IMMEDIATELY AFTER');
    });

    it('causality hint appears after the memory line', () => {
        const memories = [
            { id: '1', summary: 'Event A', message_ids: [4980], sequence: 498000, importance: 3 },
            { id: '2', summary: 'Event B', message_ids: [4982], sequence: 498200, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        const memoryIndex = result.indexOf('Event B');
        const hintIndex = result.indexOf('⤷ IMMEDIATELY AFTER');
        expect(hintIndex).toBeGreaterThan(memoryIndex);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL (no causality hints implemented)

**Step 3: Add causality hint helper and update rendering**

Add helper function:

```javascript
/**
 * Get causality hint text based on message distance
 * @param {number} gap - Number of messages between memories
 * @returns {string|null} Causality hint or null if gap too large
 */
function getCausalityHint(gap) {
    if (gap < IMMEDIATE_GAP) {
        return '    ⤷ IMMEDIATELY AFTER';
    } else if (gap < CLOSE_GAP) {
        return '    ⤷ Shortly after';
    }
    return null;
}
```

Create a new helper to render a bucket with both gaps and causality:

```javascript
/**
 * Render memories for a bucket with optional gaps and causality hints
 * @param {Object[]} memories - Memories in this bucket
 * @param {boolean} includeGapSeparators - Whether to add gap separators (only for old bucket)
 * @returns {string[]} Array of output lines
 */
function renderBucketMemories(memories, includeGapSeparators = false) {
    const lines = [];

    for (let i = 0; i < memories.length; i++) {
        const memory = memories[i];
        const prevMemory = i > 0 ? memories[i - 1] : null;
        const gap = prevMemory ? getMemoryPosition(memory) - getMemoryPosition(prevMemory) : 0;

        // Gap separator (only in old bucket, only for large gaps)
        if (includeGapSeparators && prevMemory) {
            const separator = getGapSeparator(gap);
            if (separator) {
                lines.push('');
                lines.push(separator);
                lines.push('');
            }
        }

        // Memory line
        lines.push(formatMemory(memory));

        // Causality hint (for small gaps, when no separator was added)
        if (prevMemory && gap < CLOSE_GAP) {
            const hint = getCausalityHint(gap);
            if (hint) {
                lines.push(hint);
            }
        }
    }

    return lines;
}
```

Update bucket rendering sections to use the helper:

```javascript
// Render OLD bucket
if (filteredBuckets.old.length > 0) {
    lines.push(bucketHeaders.old);
    lines.push(...renderBucketMemories(filteredBuckets.old, true)); // with gap separators
    lines.push('');
}

// Render MID bucket
if (filteredBuckets.mid.length > 0) {
    lines.push(bucketHeaders.mid);
    lines.push(...renderBucketMemories(filteredBuckets.mid, false)); // no gap separators
    lines.push('');
}
```

For RECENT bucket, also use the helper but preserve emotional state and relationships:

```javascript
// Render RECENT bucket
const hasFilteredRecentContent = filteredBuckets.recent.length > 0 || emotionalLine || relLines.length > 0;
if (hasFilteredRecentContent) {
    lines.push(bucketHeaders.recent);

    if (emotionalLine) {
        lines.push(emotionalLine);
    }

    if (relLines.length > 0) {
        lines.push(...relLines);
    }

    if ((emotionalLine || relLines.length > 0) && filteredBuckets.recent.length > 0) {
        lines.push('');
    }

    lines.push(...renderBucketMemories(filteredBuckets.recent, false)); // no gap separators
    lines.push('');
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "feat: add causality hints for close memories"
```

---

## Task 6: Add Emotional Annotations for High-Importance Memories

**Files:**
- Modify: `src/retrieval/formatting.js` (update formatMemory or renderBucketMemories)
- Modify: `tests/formatting.test.js`

**Step 1: Write failing tests for emotional annotations**

Add new describe block:

```javascript
describe('emotional annotations', () => {
    it('adds emotional annotation for importance >= 4', () => {
        const memories = [
            {
                id: '1',
                summary: 'Major event',
                message_ids: [4980],
                sequence: 498000,
                importance: 4,
                emotional_impact: ['guilt', 'shock']
            },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).toContain('💔 Emotional: guilt, shock');
    });

    it('no emotional annotation for importance < 4', () => {
        const memories = [
            {
                id: '1',
                summary: 'Minor event',
                message_ids: [4980],
                sequence: 498000,
                importance: 3,
                emotional_impact: ['happy']
            },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).not.toContain('💔 Emotional:');
    });

    it('no emotional annotation when emotional_impact is missing', () => {
        const memories = [
            {
                id: '1',
                summary: 'Major event',
                message_ids: [4980],
                sequence: 498000,
                importance: 5,
                // no emotional_impact field
            },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).not.toContain('💔 Emotional:');
    });

    it('handles string emotional_impact', () => {
        const memories = [
            {
                id: '1',
                summary: 'Major event',
                message_ids: [4980],
                sequence: 498000,
                importance: 4,
                emotional_impact: 'fear'
            },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).toContain('💔 Emotional: fear');
    });

    it('emotional annotation appears after memory and causality hint', () => {
        const memories = [
            { id: '1', summary: 'Event A', message_ids: [4980], sequence: 498000, importance: 3 },
            {
                id: '2',
                summary: 'Event B',
                message_ids: [4982],
                sequence: 498200,
                importance: 4,
                emotional_impact: ['anger']
            },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        const memoryIndex = result.indexOf('Event B');
        const causalityIndex = result.indexOf('⤷ IMMEDIATELY AFTER');
        const emotionIndex = result.indexOf('💔 Emotional: anger');

        expect(causalityIndex).toBeGreaterThan(memoryIndex);
        expect(emotionIndex).toBeGreaterThan(causalityIndex);
    });

    it('handles empty emotional_impact array', () => {
        const memories = [
            {
                id: '1',
                summary: 'Major event',
                message_ids: [4980],
                sequence: 498000,
                importance: 5,
                emotional_impact: []
            },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

        expect(result).not.toContain('💔 Emotional:');
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL (no emotional annotations implemented)

**Step 3: Update renderBucketMemories to include emotional annotations**

Update the renderBucketMemories function:

```javascript
function renderBucketMemories(memories, includeGapSeparators = false) {
    const lines = [];

    for (let i = 0; i < memories.length; i++) {
        const memory = memories[i];
        const prevMemory = i > 0 ? memories[i - 1] : null;
        const gap = prevMemory ? getMemoryPosition(memory) - getMemoryPosition(prevMemory) : 0;

        // Gap separator (only in old bucket, only for large gaps)
        if (includeGapSeparators && prevMemory) {
            const separator = getGapSeparator(gap);
            if (separator) {
                lines.push('');
                lines.push(separator);
                lines.push('');
            }
        }

        // Memory line
        lines.push(formatMemory(memory));

        // Causality hint (for small gaps, when no separator was added)
        if (prevMemory && gap < CLOSE_GAP) {
            const hint = getCausalityHint(gap);
            if (hint) {
                lines.push(hint);
            }
        }

        // Emotional annotation (importance >= 4 only)
        if (memory.importance >= EMOTIONAL_IMPORTANCE_MIN && memory.emotional_impact) {
            const emotions = Array.isArray(memory.emotional_impact)
                ? memory.emotional_impact
                : [memory.emotional_impact];
            if (emotions.length > 0) {
                lines.push(`    💔 Emotional: ${emotions.join(', ')}`);
            }
        }
    }

    return lines;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "feat: add emotional annotations for high-importance memories"
```

---

## Task 7: Fix Remaining Test Assertions

**Files:**
- Modify: `tests/formatting.test.js`

**Step 1: Run all tests to find remaining failures**

Run: `npm test`
Identify any remaining tests that need updates due to:
- Chat length changes (tests using 500 may need 5000)
- Header format changes
- Memory position changes

**Step 2: Update any failing tests**

Common fixes needed:
- Change `chatLength` from 500 to 5000 in tests that check bucket assignment
- Update header assertions from bracket format to markdown
- Update memory positions to match new fixed window thresholds

**Step 3: Run tests to verify all pass**

Run: `npm test`
Expected: All PASS

**Step 4: Commit**

```bash
git add tests/formatting.test.js
git commit -m "test: fix remaining test assertions for narrative engine"
```

---

## Task 8: Final Integration Test

**Files:**
- Modify: `tests/formatting.test.js`

**Step 1: Write integration test for full narrative output**

Add comprehensive integration test:

```javascript
describe('narrative engine integration', () => {
    it('produces expected narrative output for long chat', () => {
        const memories = [
            // Old bucket (position < 4500 in 5000 chat)
            { id: '1', summary: 'Bought a sword', message_ids: [100], sequence: 100000, importance: 2 },
            { id: '2', summary: 'Elder warned of goblins', message_ids: [105], sequence: 105000, importance: 3 },
            { id: '3', summary: 'Met Marcus at tavern', message_ids: [800], sequence: 800000, importance: 2 },
            { id: '4', summary: 'Great battle began', message_ids: [2000], sequence: 2000000, importance: 4, emotional_impact: ['fear', 'determination'] },

            // Mid bucket (4500-4950)
            { id: '5', summary: 'Goblin stole the amulet', message_ids: [4550], sequence: 455000, importance: 4, emotional_impact: ['anger'] },
            { id: '6', summary: 'Tracked goblin into forest', message_ids: [4553], sequence: 455300, importance: 3 },

            // Recent bucket (> 4950)
            { id: '7', summary: 'Goblin camp was burned', message_ids: [4980], sequence: 498000, importance: 5, emotional_impact: ['triumph'] },
            { id: '8', summary: 'Goblin is cornered', message_ids: [4985], sequence: 498500, importance: 4 },
        ];

        const relationships = [
            { character: 'Goblin', trust: 1, tension: 9, type: 'enemy' },
        ];

        const result = formatContextForInjection(
            memories,
            relationships,
            { emotion: 'anxious' },
            'Hero',
            10000,
            5000
        );

        // Structure checks
        expect(result).toContain('## The Story So Far');
        expect(result).toContain('## Leading Up To This Moment');
        expect(result).toContain('## Current Scene');

        // Gap separator in old bucket (105 -> 800 = 695 gap)
        expect(result).toContain('...Much later...');

        // Causality hint (4550 -> 4553 = 3 gap)
        expect(result).toContain('⤷ IMMEDIATELY AFTER');

        // Emotional annotations (importance >= 4)
        expect(result).toContain('💔 Emotional: fear, determination');
        expect(result).toContain('💔 Emotional: anger');
        expect(result).toContain('💔 Emotional: triumph');

        // Emotional state in recent
        expect(result).toContain('Emotional state: anxious');

        // Relationships in recent
        expect(result).toContain('Goblin: enemy (low trust, high tension)');
    });
});
```

**Step 2: Run test**

Run: `npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/formatting.test.js
git commit -m "test: add narrative engine integration test"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add constants | formatting.js, formatting.test.js |
| 2 | Fixed window buckets | formatting.js, formatting.test.js |
| 3 | Markdown headers | formatting.js, formatting.test.js |
| 4 | Gap separators | formatting.js, formatting.test.js |
| 5 | Causality hints | formatting.js, formatting.test.js |
| 6 | Emotional annotations | formatting.js, formatting.test.js |
| 7 | Fix remaining tests | formatting.test.js |
| 8 | Integration test | formatting.test.js |

After all tasks: Merge branch, delete worktree.
