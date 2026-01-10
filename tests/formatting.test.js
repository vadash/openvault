/**
 * Tests for src/retrieval/formatting.js
 */
import { describe, it, expect } from 'vitest';
import {
    formatContextForInjection,
    getMemoryPosition,
    assignMemoriesToBuckets,
    CURRENT_SCENE_SIZE,
    LEADING_UP_SIZE,
} from '../src/retrieval/formatting.js';

describe('constants', () => {
    it('exports CURRENT_SCENE_SIZE as 100', () => {
        expect(CURRENT_SCENE_SIZE).toBe(100);
    });

    it('exports LEADING_UP_SIZE as 500', () => {
        expect(LEADING_UP_SIZE).toBe(500);
    });
});

describe('formatting', () => {
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

    describe('assignMemoriesToBuckets', () => {
        it('assigns memories to correct buckets with fixed windows', () => {
            // Chat length 5000: recent > 4900, mid > 4500, old <= 4500
            const memories = [
                { id: '1', message_ids: [100] },    // old (< 4500)
                { id: '2', message_ids: [4600] },   // mid (4500-4900)
                { id: '3', message_ids: [4950] },   // recent (> 4900)
            ];
            const result = assignMemoriesToBuckets(memories, 5000);

            expect(result.old).toHaveLength(1);
            expect(result.old[0].id).toBe('1');
            expect(result.mid).toHaveLength(1);
            expect(result.mid[0].id).toBe('2');
            expect(result.recent).toHaveLength(1);
            expect(result.recent[0].id).toBe('3');
        });

        it('handles boundary at CURRENT_SCENE_SIZE (100)', () => {
            // Chat length 5000: recent threshold = 4900
            const memories = [
                { id: '1', message_ids: [4900] },  // exactly at boundary = recent
                { id: '2', message_ids: [4899] },  // just below = mid
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
            const result = assignMemoriesToBuckets(memories, 80); // < 100

            expect(result.old).toEqual([]);
            expect(result.mid).toEqual([]);
            expect(result.recent).toHaveLength(2);
        });

        it('has no old bucket when chat < LEADING_UP_SIZE', () => {
            // Chat length 200: recent > 100, mid > -300 (clamped to 0)
            const memories = [
                { id: '1', message_ids: [50] },   // mid (0-100)
                { id: '2', message_ids: [150] },  // recent (> 100)
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
            expect(result).not.toContain('## The Story So Far');
            expect(result).not.toContain('## Leading Up To This Moment');
            expect(result).not.toContain('## Current Scene');
        });

        // Timeline bucket tests
        it('renders old bucket with markdown header', () => {
            const memories = [
                { id: '1', summary: 'Old event', message_ids: [50], sequence: 50000, importance: 3 },
            ];
            const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

            expect(result).toContain('## The Story So Far');
            expect(result).toContain('Old event');
        });

        it('renders mid bucket with markdown header', () => {
            const memories = [
                { id: '1', summary: 'Mid event', message_ids: [4600], sequence: 460000, importance: 3 },
            ];
            const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

            expect(result).toContain('## Leading Up To This Moment');
            expect(result).toContain('Mid event');
        });

        it('renders recent bucket with markdown header', () => {
            const memories = [
                { id: '1', summary: 'Recent event', message_ids: [4980], sequence: 498000, importance: 3 },
            ];
            const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

            expect(result).toContain('## Current Scene');
            expect(result).toContain('Recent event');
        });

        it('skips empty buckets', () => {
            const memories = [
                { id: '1', summary: 'Recent only', message_ids: [4980], sequence: 498000, importance: 3 },
            ];
            const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

            expect(result).not.toContain('## The Story So Far');
            expect(result).not.toContain('## Leading Up To This Moment');
            expect(result).toContain('## Current Scene');
        });

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

        // Memory formatting tests (simplified format)
        it('formats memories with stars only (no message numbers)', () => {
            const memories = [
                { id: '1', summary: 'Test event', message_ids: [4980], sequence: 498000, importance: 3 },
            ];
            const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

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

            expect(result).toContain('## Current Scene');
            expect(result).toContain('Emotional state: anxious');

            // Emotional state should appear after RECENT header, before memories
            const recentIndex = result.indexOf('## Current Scene');
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

            expect(result).toContain('## Current Scene');
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

        // Present characters in RECENT bucket
        it('includes present characters in RECENT bucket', () => {
            const memories = [
                { id: '1', summary: 'Recent event', message_ids: [450], sequence: 450000, importance: 3 },
            ];
            const presentCharacters = ['Bob'];
            const result = formatContextForInjection(memories, presentCharacters, null, 'Alice', 10000, 500);

            expect(result).toContain('## Current Scene');
            expect(result).toContain('Present: Bob');

            // Present characters should appear before memories in RECENT
            const presentIndex = result.indexOf('Present:');
            const memoryIndex = result.indexOf('Recent event');
            expect(presentIndex).toBeLessThan(memoryIndex);
        });

        it('formats multiple present characters', () => {
            const memories = [
                { id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 },
            ];
            const presentCharacters = ['Bob', 'Charlie', 'Dave'];
            const result = formatContextForInjection(memories, presentCharacters, null, 'Alice', 10000, 500);

            expect(result).toContain('Present: Bob, Charlie, Dave');
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
            expect(result).toContain('## Current Scene');
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

        // Gap separators tests
        describe('gap separators', () => {
            it('adds "..." separator for gaps 15-99 messages', () => {
                const memories = [
                    { id: '1', summary: 'Event A', message_ids: [100], sequence: 100000, importance: 3 },
                    { id: '2', summary: 'Event B', message_ids: [150], sequence: 150000, importance: 3 }, // gap = 50
                ];
                const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

                expect(result).toContain('Event A');
                expect(result).toMatch(/\.\.\.\n/);
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

                expect(result).not.toMatch(/\.\.\.[^<]/); // Avoid matching </scene_memory>
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

        // Causality hints tests
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

        // Emotional annotations tests
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

                const presentCharacters = ['Goblin'];

                const result = formatContextForInjection(
                    memories,
                    presentCharacters,
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

                // Present characters in recent
                expect(result).toContain('Present: Goblin');
            });
        });
    });
});
