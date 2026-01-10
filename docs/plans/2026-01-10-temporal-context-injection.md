# Temporal Context Injection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace flat memory list with narrative timeline buckets (Old/Mid/Recent) to improve LLM causality understanding.

**Architecture:** Add `getMemoryPosition` and `assignMemoriesToBuckets` helpers, then refactor `formatContextForInjection` to render three temporal buckets instead of a flat list. Emotional state and relationships move into the RECENT bucket.

**Tech Stack:** JavaScript (ES Modules), Vitest for testing.

---

## Task 1: Add getMemoryPosition Helper

**Files:**
- Modify: `src/retrieval/formatting.js` (add function after imports)
- Test: `tests/formatting.test.js`

**Step 1: Write the failing test**

Add this test block after the existing `getRelationshipContext` describe block in `tests/formatting.test.js`:

```javascript
describe('getMemoryPosition', () => {
    it('returns midpoint of message_ids array', () => {
        const memory = { message_ids: [100, 110, 120] };
        expect(getMemoryPosition(memory)).toBe(110);
    });

    it('returns single message_id when only one', () => {
        const memory = { message_ids: [50] };
        expect(getMemoryPosition(memory)).toBe(50);
    });

    it('falls back to sequence/1000 when no message_ids', () => {
        const memory = { sequence: 5000 };
        expect(getMemoryPosition(memory)).toBe(5);
    });

    it('returns 0 when no position data available', () => {
        const memory = {};
        expect(getMemoryPosition(memory)).toBe(0);
    });

    it('handles empty message_ids array', () => {
        const memory = { message_ids: [], sequence: 3000 };
        expect(getMemoryPosition(memory)).toBe(3);
    });
});
```

Also update the import at the top of `tests/formatting.test.js`:

```javascript
import {
    getRelationshipContext,
    formatContextForInjection,
    getMemoryPosition,
} from '../src/retrieval/formatting.js';
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=verbose 2>&1 | grep -A 2 "getMemoryPosition"`
Expected: FAIL with "getMemoryPosition is not a function" or similar

**Step 3: Write minimal implementation**

Add this function in `src/retrieval/formatting.js` after the imports, before `getRelationshipContext`:

```javascript
/**
 * Get the effective position of a memory in the chat timeline
 * @param {Object} memory - Memory object
 * @returns {number} Position as message number
 */
export function getMemoryPosition(memory) {
    const msgIds = memory.message_ids || [];
    if (msgIds.length > 0) {
        const sum = msgIds.reduce((a, b) => a + b, 0);
        return Math.round(sum / msgIds.length);
    }
    if (memory.sequence) {
        return Math.floor(memory.sequence / 1000);
    }
    return 0;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --reporter=verbose 2>&1 | grep -E "(getMemoryPosition|PASS|FAIL)"`
Expected: All getMemoryPosition tests PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "feat: add getMemoryPosition helper for timeline bucketing"
```

---

## Task 2: Add assignMemoriesToBuckets Helper

**Files:**
- Modify: `src/retrieval/formatting.js` (add function after getMemoryPosition)
- Test: `tests/formatting.test.js`

**Step 1: Write the failing test**

Add this describe block after `getMemoryPosition` tests:

```javascript
describe('assignMemoriesToBuckets', () => {
    it('assigns memories to correct buckets based on position', () => {
        const memories = [
            { id: '1', message_ids: [50] },   // position 50, old (0-40%)
            { id: '2', message_ids: [250] },  // position 250, mid (40-80%)
            { id: '3', message_ids: [450] },  // position 450, recent (80-100%)
        ];
        const result = assignMemoriesToBuckets(memories, 500);

        expect(result.old).toHaveLength(1);
        expect(result.old[0].id).toBe('1');
        expect(result.mid).toHaveLength(1);
        expect(result.mid[0].id).toBe('2');
        expect(result.recent).toHaveLength(1);
        expect(result.recent[0].id).toBe('3');
    });

    it('handles boundary cases correctly', () => {
        const memories = [
            { id: '1', message_ids: [200] },  // exactly at 40% boundary
            { id: '2', message_ids: [400] },  // exactly at 80% boundary
        ];
        const result = assignMemoriesToBuckets(memories, 500);

        // 200 >= 200 (midThreshold) so it's mid
        expect(result.mid.some(m => m.id === '1')).toBe(true);
        // 400 >= 400 (recentThreshold) so it's recent
        expect(result.recent.some(m => m.id === '2')).toBe(true);
    });

    it('returns empty buckets when no memories', () => {
        const result = assignMemoriesToBuckets([], 500);
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
        const result = assignMemoriesToBuckets(memories, 500);

        // All should be in 'old' bucket, sorted by sequence
        expect(result.old[0].id).toBe('2'); // sequence 10000
        expect(result.old[1].id).toBe('3'); // sequence 20000
        expect(result.old[2].id).toBe('1'); // sequence 30000
    });

    it('handles null memories array', () => {
        const result = assignMemoriesToBuckets(null, 500);
        expect(result.old).toEqual([]);
        expect(result.mid).toEqual([]);
        expect(result.recent).toEqual([]);
    });
});
```

Update import:

```javascript
import {
    getRelationshipContext,
    formatContextForInjection,
    getMemoryPosition,
    assignMemoriesToBuckets,
} from '../src/retrieval/formatting.js';
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --reporter=verbose 2>&1 | grep -A 2 "assignMemoriesToBuckets"`
Expected: FAIL with "assignMemoriesToBuckets is not a function"

**Step 3: Write minimal implementation**

Add this function after `getMemoryPosition`:

```javascript
/**
 * Assign memories to temporal buckets based on chat position
 * @param {Object[]} memories - Array of memory objects
 * @param {number} chatLength - Current chat length
 * @returns {Object} Object with old, mid, recent arrays
 */
export function assignMemoriesToBuckets(memories, chatLength) {
    const result = { old: [], mid: [], recent: [] };

    if (!memories || memories.length === 0) {
        return result;
    }

    // Calculate thresholds (Recent: last 20%, Mid: 40-80%, Old: 0-40%)
    const recentThreshold = chatLength * 0.80;
    const midThreshold = chatLength * 0.40;

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

Run: `npm test -- --reporter=verbose 2>&1 | grep -E "(assignMemoriesToBuckets|PASS|FAIL)"`
Expected: All assignMemoriesToBuckets tests PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "feat: add assignMemoriesToBuckets helper for timeline structure"
```

---

## Task 3: Refactor formatContextForInjection - Timeline Structure

**Files:**
- Modify: `src/retrieval/formatting.js` (rewrite formatContextForInjection)
- Test: `tests/formatting.test.js`

**Step 1: Write new tests for timeline format**

Replace the existing `formatContextForInjection` describe block with these tests:

```javascript
describe('formatContextForInjection', () => {
    // Basic structure tests
    it('formats basic header with chat length', () => {
        const result = formatContextForInjection([], [], null, 'Alice', 1000, 50);
        expect(result).toContain('<scene_memory>');
        expect(result).toContain('(Current chat has #50 messages)');
        expect(result).toContain('</scene_memory>');
    });

    it('does not show memories section when no memories', () => {
        const result = formatContextForInjection([], [], null, 'Alice', 1000, 50);
        expect(result).not.toContain('[ESTABLISHED HISTORY]');
        expect(result).not.toContain('[PREVIOUSLY]');
        expect(result).not.toContain('[RECENT EVENTS]');
    });

    // Timeline bucket tests
    it('renders OLD bucket with correct header', () => {
        const memories = [
            { id: '1', summary: 'Old event', message_ids: [50], sequence: 50000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).toContain('[ESTABLISHED HISTORY]');
        expect(result).toContain('messages 1-200');
        expect(result).toContain('Old event');
    });

    it('renders MID bucket with correct header', () => {
        const memories = [
            { id: '1', summary: 'Mid event', message_ids: [300], sequence: 300000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).toContain('[PREVIOUSLY]');
        expect(result).toContain('messages 200-400');
        expect(result).toContain('Mid event');
    });

    it('renders RECENT bucket with correct header', () => {
        const memories = [
            { id: '1', summary: 'Recent event', message_ids: [450], sequence: 450000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).toContain('[RECENT EVENTS]');
        expect(result).toContain('messages 400-500');
        expect(result).toContain('Recent event');
    });

    it('skips empty buckets', () => {
        const memories = [
            { id: '1', summary: 'Recent only', message_ids: [480], sequence: 480000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).not.toContain('[ESTABLISHED HISTORY]');
        expect(result).not.toContain('[PREVIOUSLY]');
        expect(result).toContain('[RECENT EVENTS]');
    });

    it('renders all three buckets when populated', () => {
        const memories = [
            { id: '1', summary: 'Old', message_ids: [50], sequence: 50000, importance: 3 },
            { id: '2', summary: 'Mid', message_ids: [300], sequence: 300000, importance: 3 },
            { id: '3', summary: 'Recent', message_ids: [450], sequence: 450000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).toContain('[ESTABLISHED HISTORY]');
        expect(result).toContain('[PREVIOUSLY]');
        expect(result).toContain('[RECENT EVENTS]');

        // Verify order: OLD before MID before RECENT
        const oldIndex = result.indexOf('[ESTABLISHED HISTORY]');
        const midIndex = result.indexOf('[PREVIOUSLY]');
        const recentIndex = result.indexOf('[RECENT EVENTS]');
        expect(oldIndex).toBeLessThan(midIndex);
        expect(midIndex).toBeLessThan(recentIndex);
    });

    // Memory formatting tests (simplified format)
    it('formats memories with stars only (no message numbers)', () => {
        const memories = [
            { id: '1', summary: 'Test event', message_ids: [450], sequence: 450000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).toContain('[★★★] Test event');
        expect(result).not.toMatch(/#\d+ \[★/); // No message numbers before stars
    });

    it('includes importance stars correctly', () => {
        const memories = [
            { id: '1', summary: 'Minor', message_ids: [450], sequence: 450000, importance: 1 },
            { id: '2', summary: 'Critical', message_ids: [460], sequence: 460000, importance: 5 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).toContain('[★] Minor');
        expect(result).toContain('[★★★★★] Critical');
    });

    it('marks secret memories with prefix', () => {
        const memories = [
            { id: '1', summary: 'Secret info', message_ids: [450], sequence: 450000, importance: 3, is_secret: true },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        expect(result).toContain('[★★★] [Secret] Secret info');
    });

    // Emotional state in RECENT bucket
    it('includes emotional state in RECENT bucket', () => {
        const memories = [
            { id: '1', summary: 'Recent event', message_ids: [450], sequence: 450000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], { emotion: 'anxious' }, 'Alice', 10000, 500);

        expect(result).toContain('[RECENT EVENTS]');
        expect(result).toContain('Emotional state: anxious');

        // Emotional state should appear after RECENT header, before memories
        const recentIndex = result.indexOf('[RECENT EVENTS]');
        const emotionIndex = result.indexOf('Emotional state:');
        const memoryIndex = result.indexOf('Recent event');
        expect(emotionIndex).toBeGreaterThan(recentIndex);
        expect(emotionIndex).toBeLessThan(memoryIndex);
    });

    it('shows RECENT bucket with emotional state even if no recent memories', () => {
        const memories = [
            { id: '1', summary: 'Old event', message_ids: [50], sequence: 50000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], { emotion: 'happy' }, 'Alice', 10000, 500);

        expect(result).toContain('[RECENT EVENTS]');
        expect(result).toContain('Emotional state: happy');
    });

    it('excludes emotional state when neutral', () => {
        const memories = [
            { id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], { emotion: 'neutral' }, 'Alice', 10000, 500);

        expect(result).not.toContain('Emotional state:');
    });

    it('includes message range for emotional state', () => {
        const memories = [
            { id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 },
        ];
        const result = formatContextForInjection(
            memories, [],
            { emotion: 'sad', fromMessages: { min: 10, max: 15 } },
            'Alice', 10000, 500
        );

        expect(result).toContain('Emotional state: sad (as of msgs #10-15)');
    });

    it('formats single message for emotional state', () => {
        const result = formatContextForInjection(
            [{ id: '1', summary: 'E', message_ids: [450], sequence: 450000, importance: 3 }],
            [],
            { emotion: 'angry', fromMessages: { min: 5, max: 5 } },
            'Alice', 10000, 500
        );

        expect(result).toContain('Emotional state: angry (as of msg #5)');
    });

    it('handles string emotional info (legacy format)', () => {
        const result = formatContextForInjection(
            [{ id: '1', summary: 'E', message_ids: [450], sequence: 450000, importance: 3 }],
            [], 'excited', 'Alice', 10000, 500
        );

        expect(result).toContain('Emotional state: excited');
    });

    // Relationships in RECENT bucket
    it('includes relationships in RECENT bucket', () => {
        const memories = [
            { id: '1', summary: 'Recent event', message_ids: [450], sequence: 450000, importance: 3 },
        ];
        const relationships = [
            { character: 'Bob', trust: 8, tension: 2, type: 'friend' },
        ];
        const result = formatContextForInjection(memories, relationships, null, 'Alice', 10000, 500);

        expect(result).toContain('[RECENT EVENTS]');
        expect(result).toContain('Relationships with present characters:');
        expect(result).toContain('- Bob: friend (high trust)');

        // Relationships should appear before memories in RECENT
        const relIndex = result.indexOf('Relationships');
        const memoryIndex = result.indexOf('Recent event');
        expect(relIndex).toBeLessThan(memoryIndex);
    });

    it('describes trust levels correctly', () => {
        const lowTrust = [{ character: 'A', trust: 2, tension: 0, type: 'x' }];
        const midTrust = [{ character: 'B', trust: 5, tension: 0, type: 'y' }];
        const highTrust = [{ character: 'C', trust: 9, tension: 0, type: 'z' }];

        const mem = [{ id: '1', summary: 'E', message_ids: [450], sequence: 450000, importance: 3 }];
        expect(formatContextForInjection(mem, lowTrust, null, 'X', 10000, 500)).toContain('low trust');
        expect(formatContextForInjection(mem, midTrust, null, 'X', 10000, 500)).toContain('moderate trust');
        expect(formatContextForInjection(mem, highTrust, null, 'X', 10000, 500)).toContain('high trust');
    });

    it('describes tension levels correctly', () => {
        const noTension = [{ character: 'A', trust: 5, tension: 2, type: 'x' }];
        const someTension = [{ character: 'B', trust: 5, tension: 5, type: 'y' }];
        const highTension = [{ character: 'C', trust: 5, tension: 8, type: 'z' }];

        const mem = [{ id: '1', summary: 'E', message_ids: [450], sequence: 450000, importance: 3 }];
        expect(formatContextForInjection(mem, noTension, null, 'X', 10000, 500)).not.toContain('tension');
        expect(formatContextForInjection(mem, someTension, null, 'X', 10000, 500)).toContain('some tension');
        expect(formatContextForInjection(mem, highTension, null, 'X', 10000, 500)).toContain('high tension');
    });

    it('defaults relationship type to acquaintance', () => {
        const relationships = [{ character: 'Bob', trust: 5, tension: 0 }];
        const mem = [{ id: '1', summary: 'E', message_ids: [450], sequence: 450000, importance: 3 }];
        const result = formatContextForInjection(mem, relationships, null, 'Alice', 10000, 500);

        expect(result).toContain('Bob: acquaintance');
    });

    // Token budget tests
    it('truncates memories to fit token budget', () => {
        const memories = [];
        for (let i = 0; i < 100; i++) {
            memories.push({
                id: `${i}`,
                summary: 'A'.repeat(100),
                sequence: 450000 + i,
                importance: 3,
                message_ids: [450 + i],
            });
        }

        const result = formatContextForInjection(memories, [], null, 'Alice', 200, 500);

        // Count memories by counting star patterns
        const memoryCount = (result.match(/\[★+\]/g) || []).length;
        expect(memoryCount).toBeLessThan(100);
        expect(memoryCount).toBeGreaterThan(0);
    });

    // Edge cases
    it('handles empty memories array', () => {
        const result = formatContextForInjection([], [], null, 'Alice', 1000, 50);
        expect(result).toContain('<scene_memory>');
        expect(result).toContain('</scene_memory>');
    });

    it('handles null memories', () => {
        const result = formatContextForInjection(null, [], null, 'Alice', 1000, 50);
        expect(result).toContain('<scene_memory>');
    });

    it('handles chatLength of 0', () => {
        const memories = [
            { id: '1', summary: 'Event', message_ids: [5], sequence: 5000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 0);

        // All memories should be in RECENT when chatLength is 0
        expect(result).toContain('[RECENT EVENTS]');
        expect(result).toContain('Event');
    });

    it('maintains chronological order within buckets', () => {
        const memories = [
            { id: '1', summary: 'Third', message_ids: [30], sequence: 30000, importance: 3 },
            { id: '2', summary: 'First', message_ids: [10], sequence: 10000, importance: 3 },
            { id: '3', summary: 'Second', message_ids: [20], sequence: 20000, importance: 3 },
        ];
        const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

        const firstIndex = result.indexOf('First');
        const secondIndex = result.indexOf('Second');
        const thirdIndex = result.indexOf('Third');

        expect(firstIndex).toBeLessThan(secondIndex);
        expect(secondIndex).toBeLessThan(thirdIndex);
    });
});
```

**Step 2: Run tests to see them fail**

Run: `npm test`
Expected: Multiple failures (format changed)

**Step 3: Rewrite formatContextForInjection**

Replace the entire `formatContextForInjection` function with:

```javascript
/**
 * Format context for injection into prompt using timeline buckets
 * @param {Object[]} memories - Selected memories
 * @param {Object[]} relationships - Relevant relationships
 * @param {Object} emotionalInfo - Emotional state info { emotion, fromMessages }
 * @param {string} characterName - Character name for header
 * @param {number} tokenBudget - Maximum token budget
 * @param {number} chatLength - Current chat length for context
 * @returns {string} Formatted context string
 */
export function formatContextForInjection(memories, relationships, emotionalInfo, characterName, tokenBudget, chatLength = 0) {
    const lines = [
        '<scene_memory>',
        `(Current chat has #${chatLength} messages)`,
        ''
    ];

    // Assign memories to buckets
    const buckets = assignMemoriesToBuckets(memories, chatLength);

    // Calculate bucket boundaries for headers
    const midThreshold = Math.floor(chatLength * 0.40);
    const recentThreshold = Math.floor(chatLength * 0.80);

    // Helper to format emotional state
    const formatEmotionalState = () => {
        const emotion = typeof emotionalInfo === 'string' ? emotionalInfo : emotionalInfo?.emotion;
        const fromMessages = typeof emotionalInfo === 'object' ? emotionalInfo?.fromMessages : null;

        if (!emotion || emotion === 'neutral') return null;

        let emotionLine = `Emotional state: ${emotion}`;
        if (fromMessages) {
            const { min, max } = fromMessages;
            emotionLine += min === max
                ? ` (as of msg #${min})`
                : ` (as of msgs #${min}-${max})`;
        }
        return emotionLine;
    };

    // Helper to format relationships
    const formatRelationships = () => {
        if (!relationships || relationships.length === 0) return [];

        const relLines = ['Relationships with present characters:'];
        for (const rel of relationships) {
            const trustDesc = rel.trust >= 7 ? 'high trust' : rel.trust <= 3 ? 'low trust' : 'moderate trust';
            const tensionDesc = rel.tension >= 7 ? 'high tension' : rel.tension >= 4 ? 'some tension' : '';
            relLines.push(`- ${rel.character}: ${rel.type || 'acquaintance'} (${trustDesc}${tensionDesc ? ', ' + tensionDesc : ''})`);
        }
        return relLines;
    };

    // Helper to format a single memory
    const formatMemory = (memory) => {
        const importance = memory.importance || 3;
        const stars = '\u2605'.repeat(importance);
        const prefix = memory.is_secret ? '[Secret] ' : '';
        return `[${stars}] ${prefix}${memory.summary}`;
    };

    // Calculate token overhead for non-empty bucket headers
    const bucketHeaders = {
        old: `[ESTABLISHED HISTORY] (messages 1-${midThreshold})`,
        mid: `[PREVIOUSLY] (messages ${midThreshold}-${recentThreshold})`,
        recent: `[RECENT EVENTS] (messages ${recentThreshold}-${chatLength})`,
    };

    // Determine which buckets will be rendered
    const emotionalLine = formatEmotionalState();
    const relLines = formatRelationships();
    const hasRecentContent = buckets.recent.length > 0 || emotionalLine || relLines.length > 0;

    // Calculate overhead tokens
    let overheadTokens = estimateTokens(lines.join('\n') + '</scene_memory>');
    if (buckets.old.length > 0) overheadTokens += estimateTokens(bucketHeaders.old);
    if (buckets.mid.length > 0) overheadTokens += estimateTokens(bucketHeaders.mid);
    if (hasRecentContent) {
        overheadTokens += estimateTokens(bucketHeaders.recent);
        if (emotionalLine) overheadTokens += estimateTokens(emotionalLine);
        if (relLines.length > 0) overheadTokens += estimateTokens(relLines.join('\n'));
    }

    const availableForMemories = tokenBudget - overheadTokens;

    // Truncate memories to fit budget (across all buckets)
    const allMemories = [...buckets.old, ...buckets.mid, ...buckets.recent];
    let currentTokens = 0;
    const fittingMemoryIds = new Set();

    for (const memory of allMemories) {
        const memoryTokens = estimateTokens(memory.summary || '') + 5;
        if (currentTokens + memoryTokens <= availableForMemories) {
            fittingMemoryIds.add(memory.id);
            currentTokens += memoryTokens;
        } else {
            break;
        }
    }

    // Filter buckets to only include fitting memories
    const filteredBuckets = {
        old: buckets.old.filter(m => fittingMemoryIds.has(m.id)),
        mid: buckets.mid.filter(m => fittingMemoryIds.has(m.id)),
        recent: buckets.recent.filter(m => fittingMemoryIds.has(m.id)),
    };

    // Render OLD bucket
    if (filteredBuckets.old.length > 0) {
        lines.push(bucketHeaders.old);
        for (const memory of filteredBuckets.old) {
            lines.push(formatMemory(memory));
        }
        lines.push('');
    }

    // Render MID bucket
    if (filteredBuckets.mid.length > 0) {
        lines.push(bucketHeaders.mid);
        for (const memory of filteredBuckets.mid) {
            lines.push(formatMemory(memory));
        }
        lines.push('');
    }

    // Render RECENT bucket (always if has content: memories, emotion, or relationships)
    const hasFilteredRecentContent = filteredBuckets.recent.length > 0 || emotionalLine || relLines.length > 0;
    if (hasFilteredRecentContent) {
        lines.push(bucketHeaders.recent);

        // Emotional state first
        if (emotionalLine) {
            lines.push(emotionalLine);
        }

        // Relationships second
        if (relLines.length > 0) {
            lines.push(...relLines);
        }

        // Add blank line before memories if we have context above
        if ((emotionalLine || relLines.length > 0) && filteredBuckets.recent.length > 0) {
            lines.push('');
        }

        // Recent memories
        for (const memory of filteredBuckets.recent) {
            lines.push(formatMemory(memory));
        }
        lines.push('');
    }

    lines.push('</scene_memory>');

    return lines.join('\n');
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/retrieval/formatting.js tests/formatting.test.js
git commit -m "feat: implement timeline bucket formatting for context injection"
```

---

## Task 4: Final Verification and Cleanup

**Files:**
- Review: `src/retrieval/formatting.js`

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Run linter**

Run: `npm run lint`
Expected: No errors

**Step 3: Manual review of output format**

Create a quick test script to see actual output:

```bash
node -e "
import('./src/retrieval/formatting.js').then(({ formatContextForInjection }) => {
    const memories = [
        { id: '1', summary: 'Bought a sword', message_ids: [50], sequence: 50000, importance: 2 },
        { id: '2', summary: 'Goblin stole amulet', message_ids: [300], sequence: 300000, importance: 4 },
        { id: '3', summary: 'Camp burned down', message_ids: [450], sequence: 450000, importance: 5 },
    ];
    const relationships = [{ character: 'Goblin', trust: 1, tension: 9, type: 'enemy' }];
    const emotion = { emotion: 'anxious', fromMessages: { min: 440, max: 450 } };
    console.log(formatContextForInjection(memories, relationships, emotion, 'Hero', 10000, 500));
});
"
```

Expected output should look like:
```
<scene_memory>
(Current chat has #500 messages)

[ESTABLISHED HISTORY] (messages 1-200)
[★★] Bought a sword

[PREVIOUSLY] (messages 200-400)
[★★★★] Goblin stole amulet

[RECENT EVENTS] (messages 400-500)
Emotional state: anxious (as of msgs #440-450)
Relationships with present characters:
- Goblin: enemy (low trust, high tension)

[★★★★★] Camp burned down

</scene_memory>
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: temporal context injection complete"
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | Add getMemoryPosition helper | 5 min |
| 2 | Add assignMemoriesToBuckets helper | 10 min |
| 3 | Refactor formatContextForInjection | 15 min |
| 4 | Final verification | 5 min |

**Total: ~35 minutes**

All changes confined to:
- `src/retrieval/formatting.js`
- `tests/formatting.test.js`
