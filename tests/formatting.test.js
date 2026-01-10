/**
 * Tests for src/retrieval/formatting.js
 */
import { describe, it, expect } from 'vitest';
import {
    getRelationshipContext,
    formatContextForInjection,
    getMemoryPosition,
    assignMemoriesToBuckets,
    CURRENT_SCENE_SIZE,
    LEADING_UP_SIZE,
} from '../src/retrieval/formatting.js';
import { RELATIONSHIPS_KEY } from '../src/constants.js';

describe('constants', () => {
    it('exports CURRENT_SCENE_SIZE as 50', () => {
        expect(CURRENT_SCENE_SIZE).toBe(50);
    });

    it('exports LEADING_UP_SIZE as 500', () => {
        expect(LEADING_UP_SIZE).toBe(500);
    });
});

describe('formatting', () => {
    describe('getRelationshipContext', () => {
        it('returns empty array when no relationships exist', () => {
            const data = { [RELATIONSHIPS_KEY]: {} };
            const result = getRelationshipContext(data, 'Alice', ['Bob', 'Charlie']);
            expect(result).toEqual([]);
        });

        it('returns relationships involving POV and active characters', () => {
            const data = {
                [RELATIONSHIPS_KEY]: {
                    'Alice<->Bob': {
                        character_a: 'Alice',
                        character_b: 'Bob',
                        trust_level: 7,
                        tension_level: 2,
                        relationship_type: 'friend',
                    }
                }
            };

            const result = getRelationshipContext(data, 'Alice', ['Bob', 'Charlie']);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                character: 'Bob',
                trust: 7,
                tension: 2,
                type: 'friend',
            });
        });

        it('excludes relationships not involving POV character', () => {
            const data = {
                [RELATIONSHIPS_KEY]: {
                    'Bob<->Charlie': {
                        character_a: 'Bob',
                        character_b: 'Charlie',
                        trust_level: 5,
                        tension_level: 0,
                        relationship_type: 'acquaintance',
                    }
                }
            };

            const result = getRelationshipContext(data, 'Alice', ['Bob', 'Charlie']);
            expect(result).toEqual([]);
        });

        it('excludes relationships with non-active characters', () => {
            const data = {
                [RELATIONSHIPS_KEY]: {
                    'Alice<->Dave': {
                        character_a: 'Alice',
                        character_b: 'Dave',
                        trust_level: 5,
                        tension_level: 0,
                        relationship_type: 'friend',
                    }
                }
            };

            const result = getRelationshipContext(data, 'Alice', ['Bob']); // Dave not active
            expect(result).toEqual([]);
        });

        it('handles POV as character_b', () => {
            const data = {
                [RELATIONSHIPS_KEY]: {
                    'Bob<->Alice': {
                        character_a: 'Bob',
                        character_b: 'Alice',
                        trust_level: 8,
                        tension_level: 1,
                        relationship_type: 'colleague',
                    }
                }
            };

            const result = getRelationshipContext(data, 'Alice', ['Bob']);

            expect(result).toHaveLength(1);
            expect(result[0].character).toBe('Bob');
        });

        it('deduplicates relationships by character', () => {
            const data = {
                [RELATIONSHIPS_KEY]: {
                    'Alice<->Bob': {
                        character_a: 'Alice',
                        character_b: 'Bob',
                        trust_level: 5,
                        tension_level: 0,
                        relationship_type: 'friend',
                    },
                    'Bob<->Alice': {
                        character_a: 'Bob',
                        character_b: 'Alice',
                        trust_level: 6,
                        tension_level: 1,
                        relationship_type: 'friend',
                    }
                }
            };

            const result = getRelationshipContext(data, 'Alice', ['Bob']);
            expect(result).toHaveLength(1);
        });

        it('handles missing RELATIONSHIPS_KEY', () => {
            const data = {};
            const result = getRelationshipContext(data, 'Alice', ['Bob']);
            expect(result).toEqual([]);
        });
    });

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
});
