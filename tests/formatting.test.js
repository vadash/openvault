/**
 * Tests for src/retrieval/formatting.js
 */
import { describe, it, expect } from 'vitest';
import {
    getRelationshipContext,
    formatContextForInjection,
} from '../src/retrieval/formatting.js';
import { RELATIONSHIPS_KEY } from '../src/constants.js';

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

    describe('formatContextForInjection', () => {
        it('formats basic header with character name', () => {
            const result = formatContextForInjection([], [], null, 'Alice', 1000, 50);
            expect(result).toContain("[Alice's Memory & State]");
            expect(result).toContain('(Current message: #50)');
            expect(result).toContain("[End Alice's Memory]");
        });

        it('includes emotional state when not neutral', () => {
            const result = formatContextForInjection([], [], { emotion: 'happy' }, 'Alice', 1000);
            expect(result).toContain('Emotional state: happy');
        });

        it('excludes emotional state when neutral', () => {
            const result = formatContextForInjection([], [], { emotion: 'neutral' }, 'Alice', 1000);
            expect(result).not.toContain('Emotional state:');
        });

        it('includes message range for emotional state', () => {
            const result = formatContextForInjection(
                [], [],
                { emotion: 'sad', fromMessages: { min: 10, max: 15 } },
                'Alice', 1000
            );
            expect(result).toContain('Emotional state: sad (as of msgs #10-15)');
        });

        it('formats single message for emotional state', () => {
            const result = formatContextForInjection(
                [], [],
                { emotion: 'angry', fromMessages: { min: 5, max: 5 } },
                'Alice', 1000
            );
            expect(result).toContain('Emotional state: angry (as of msg #5)');
        });

        it('handles string emotional info (legacy format)', () => {
            const result = formatContextForInjection([], [], 'excited', 'Alice', 1000);
            expect(result).toContain('Emotional state: excited');
        });

        it('formats relationships section', () => {
            const relationships = [
                { character: 'Bob', trust: 8, tension: 2, type: 'friend' },
                { character: 'Charlie', trust: 3, tension: 7, type: 'rival' },
            ];

            const result = formatContextForInjection([], relationships, null, 'Alice', 1000);

            expect(result).toContain('Relationships with present characters:');
            expect(result).toContain('- Bob: friend (high trust)');
            expect(result).toContain('- Charlie: rival (low trust, high tension)');
        });

        it('describes trust levels correctly', () => {
            const lowTrust = [{ character: 'A', trust: 2, tension: 0, type: 'x' }];
            const midTrust = [{ character: 'B', trust: 5, tension: 0, type: 'y' }];
            const highTrust = [{ character: 'C', trust: 9, tension: 0, type: 'z' }];

            expect(formatContextForInjection([], lowTrust, null, 'X', 1000)).toContain('low trust');
            expect(formatContextForInjection([], midTrust, null, 'X', 1000)).toContain('moderate trust');
            expect(formatContextForInjection([], highTrust, null, 'X', 1000)).toContain('high trust');
        });

        it('describes tension levels correctly', () => {
            const noTension = [{ character: 'A', trust: 5, tension: 2, type: 'x' }];
            const someTension = [{ character: 'B', trust: 5, tension: 5, type: 'y' }];
            const highTension = [{ character: 'C', trust: 5, tension: 8, type: 'z' }];

            expect(formatContextForInjection([], noTension, null, 'X', 1000)).not.toContain('tension');
            expect(formatContextForInjection([], someTension, null, 'X', 1000)).toContain('some tension');
            expect(formatContextForInjection([], highTension, null, 'X', 1000)).toContain('high tension');
        });

        it('formats memories in chronological order', () => {
            const memories = [
                { id: '1', summary: 'Third event', sequence: 300, importance: 3 },
                { id: '2', summary: 'First event', sequence: 100, importance: 3 },
                { id: '3', summary: 'Second event', sequence: 200, importance: 3 },
            ];

            const result = formatContextForInjection(memories, [], null, 'Alice', 10000);

            const firstIndex = result.indexOf('First event');
            const secondIndex = result.indexOf('Second event');
            const thirdIndex = result.indexOf('Third event');

            expect(firstIndex).toBeLessThan(secondIndex);
            expect(secondIndex).toBeLessThan(thirdIndex);
        });

        it('includes importance stars', () => {
            const memories = [
                { id: '1', summary: 'Minor', importance: 1 },
                { id: '2', summary: 'Critical', importance: 5 },
            ];

            const result = formatContextForInjection(memories, [], null, 'Alice', 10000);

            expect(result).toContain('[\u2605] Minor');
            expect(result).toContain('[\u2605\u2605\u2605\u2605\u2605] Critical');
        });

        it('includes message IDs for memories', () => {
            const memories = [
                { id: '1', summary: 'Single msg', message_ids: [5], importance: 3 },
                { id: '2', summary: 'Multi msg', message_ids: [10, 11, 12], importance: 3 },
            ];

            const result = formatContextForInjection(memories, [], null, 'Alice', 10000);

            expect(result).toContain('(msg #5)');
            expect(result).toContain('(msgs #10-12)');
        });

        it('marks secret memories', () => {
            const memories = [
                { id: '1', summary: 'Secret info', is_secret: true, importance: 3 },
            ];

            const result = formatContextForInjection(memories, [], null, 'Alice', 10000);
            expect(result).toContain('[Secret]');
        });

        it('truncates memories to fit token budget', () => {
            const memories = [];
            for (let i = 0; i < 100; i++) {
                memories.push({
                    id: `${i}`,
                    summary: 'A'.repeat(100), // Each memory ~25 tokens
                    sequence: i,
                    importance: 3,
                    message_ids: [i],
                });
            }

            // Small budget - should only fit a few memories
            const result = formatContextForInjection(memories, [], null, 'Alice', 200);

            // Count how many memories made it in
            const memoryCount = (result.match(/\d+\. \(msg/g) || []).length;
            expect(memoryCount).toBeLessThan(100);
            expect(memoryCount).toBeGreaterThan(0);
        });

        it('handles empty memories array', () => {
            const result = formatContextForInjection([], [], null, 'Alice', 1000);
            expect(result).not.toContain('Relevant memories');
        });

        it('handles null memories', () => {
            const result = formatContextForInjection(null, [], null, 'Alice', 1000);
            expect(result).toContain("[Alice's Memory & State]");
        });

        it('defaults relationship type to acquaintance', () => {
            const relationships = [{ character: 'Bob', trust: 5, tension: 0 }];
            const result = formatContextForInjection([], relationships, null, 'Alice', 1000);
            expect(result).toContain('Bob: acquaintance');
        });
    });
});
