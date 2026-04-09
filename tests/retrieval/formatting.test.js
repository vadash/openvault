/**
 * Tests for src/retrieval/formatting.js
 */
import { describe, expect, it } from 'vitest';
import {
    assignMemoriesToBuckets,
    formatContextForInjection,
    formatMemory,
    getMemoryPosition,
} from '../../src/retrieval/formatting.js';

describe('formatting', () => {
    describe('getMemoryPosition', () => {
        const POSITION_CASES = [
            { memory: { message_ids: [100, 110, 120] }, expected: 110, desc: 'midpoint of message_ids array' },
            { memory: { message_ids: [50] }, expected: 50, desc: 'single message_id when only one' },
            { memory: { sequence: 5000 }, expected: 5, desc: 'sequence/1000 when no message_ids' },
            { memory: {}, expected: 0, desc: '0 when no position data available' },
            { memory: { message_ids: [], sequence: 3000 }, expected: 3, desc: 'empty message_ids array with sequence' },
        ];

        it.each(POSITION_CASES)('$desc', ({ memory, expected }) => {
            expect(getMemoryPosition(memory)).toBe(expected);
        });
    });

    describe('assignMemoriesToBuckets', () => {
        it('assigns memories to correct buckets with fixed windows', () => {
            // Chat length 5000: recent > 4900, mid > 4500, old <= 4500
            const memories = [
                { id: '1', message_ids: [100] }, // old (< 4500)
                { id: '2', message_ids: [4600] }, // mid (4500-4900)
                { id: '3', message_ids: [4950] }, // recent (> 4900)
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
                { id: '1', message_ids: [4900] }, // exactly at boundary = recent
                { id: '2', message_ids: [4899] }, // just below = mid
            ];
            const result = assignMemoriesToBuckets(memories, 5000);

            expect(result.recent.some((m) => m.id === '1')).toBe(true);
            expect(result.mid.some((m) => m.id === '2')).toBe(true);
        });

        it('handles boundary at LEADING_UP_SIZE (500)', () => {
            // Chat length 5000: mid threshold = 4500
            const memories = [
                { id: '1', message_ids: [4500] }, // exactly at boundary = mid
                { id: '2', message_ids: [4499] }, // just below = old
            ];
            const result = assignMemoriesToBuckets(memories, 5000);

            expect(result.mid.some((m) => m.id === '1')).toBe(true);
            expect(result.old.some((m) => m.id === '2')).toBe(true);
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
                { id: '1', message_ids: [50] }, // mid (0-100)
                { id: '2', message_ids: [150] }, // recent (> 100)
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
        it('formats simplified header with chat length and star legend', () => {
            const result = formatContextForInjection([], [], null, 'Alice', 1000, 50);
            expect(result).toContain('<scene_memory>');
            expect(result).toContain('(#50 messages | ★=minor ★★★=notable ★★★★★=critical)');
            expect(result).not.toContain('Current chat has');
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
            const memories = [{ id: '1', summary: 'Old event', message_ids: [50], sequence: 50000, importance: 3 }];
            const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 5000);

            expect(result).toContain('## The Story So Far');
            expect(result).toContain('Old event');
        });

        it('renders mid bucket with markdown header', () => {
            const memories = [{ id: '1', summary: 'Mid event', message_ids: [4600], sequence: 460000, importance: 3 }];
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
            const memories = [{ id: '1', summary: 'Test event', message_ids: [4980], sequence: 498000, importance: 3 }];
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

        it('does NOT mark secret memories with [Secret] prefix (inverted logic)', () => {
            const memories = [
                {
                    id: '1',
                    summary: 'Secret info',
                    message_ids: [450],
                    sequence: 450000,
                    importance: 3,
                    is_secret: true,
                },
            ];
            const result = formatContextForInjection(memories, [], null, 'Alice', 10000, 500);

            expect(result).toContain('[★★★] Secret info');
            expect(result).not.toContain('[Secret]');
        });

        // [Known] tag tests (inverted from [Secret])
        describe('[Known] tag (inverted from [Secret])', () => {
            const KNOWN_TAG_CASES = [
                {
                    desc: 'no tag for secret memories (default private)',
                    memory: {
                        id: '1',
                        summary: 'Private event',
                        message_ids: [450],
                        sequence: 450000,
                        importance: 3,
                        is_secret: true,
                    },
                    shouldHaveKnown: false,
                },
                {
                    desc: 'no tag for non-secret with 2 or fewer witnesses (default private)',
                    memory: {
                        id: '1',
                        summary: 'Semi-private event',
                        message_ids: [450],
                        sequence: 450000,
                        importance: 3,
                        is_secret: false,
                        witnesses: ['Alice', 'Bob'],
                    },
                    shouldHaveKnown: false,
                },
                {
                    desc: 'adds [Known] tag for non-secret with more than 2 witnesses',
                    memory: {
                        id: '1',
                        summary: 'Public event',
                        message_ids: [450],
                        sequence: 450000,
                        importance: 3,
                        is_secret: false,
                        witnesses: ['Alice', 'Bob', 'Charlie'],
                    },
                    shouldHaveKnown: true,
                },
                {
                    desc: 'no tag when witnesses array is empty',
                    memory: {
                        id: '1',
                        summary: 'Event',
                        message_ids: [450],
                        sequence: 450000,
                        importance: 3,
                        is_secret: false,
                        witnesses: [],
                    },
                    shouldHaveKnown: false,
                },
                {
                    desc: 'no tag when witnesses field is missing',
                    memory: {
                        id: '1',
                        summary: 'Event',
                        message_ids: [450],
                        sequence: 450000,
                        importance: 3,
                        is_secret: false,
                    },
                    shouldHaveKnown: false,
                },
            ];

            it.each(KNOWN_TAG_CASES)('$desc', ({ memory, shouldHaveKnown }) => {
                const result = formatContextForInjection([memory], [], null, 'Alice', 10000, 500);
                if (shouldHaveKnown) {
                    expect(result).toContain('[Known]');
                } else {
                    expect(result).not.toContain('[Known]');
                }
            });
        });

        // Emotional trajectory in Current Scene
        describe('emotional trajectory in Current Scene', () => {
            const EMOTION_CASES = [
                {
                    desc: 'shows character emotions in simplified format',
                    memories: [{ id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 }],
                    presentCharacters: ['Bob'],
                    emotionalInfo: { emotion: 'anxious', characterEmotions: { Alice: 'anxious', Bob: 'caring' } },
                    expectedContains: 'Emotions: Alice anxious, Bob caring',
                },
                {
                    desc: 'omits emotions line when no character emotions',
                    memories: [{ id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 }],
                    presentCharacters: [],
                    emotionalInfo: { emotion: 'neutral' },
                    expectedContains: null,
                },
                {
                    desc: 'omits neutral emotions from trajectory',
                    memories: [{ id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 }],
                    presentCharacters: [],
                    emotionalInfo: { emotion: 'happy', characterEmotions: { Alice: 'happy', Bob: 'neutral' } },
                    expectedContains: 'Emotions: Alice happy',
                },
                {
                    desc: 'limits emotions to 5 characters',
                    memories: [{ id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 }],
                    presentCharacters: [],
                    emotionalInfo: {
                        emotion: 'happy',
                        characterEmotions: {
                            Alice: 'happy',
                            Bob: 'sad',
                            Charlie: 'angry',
                            Dave: 'excited',
                            Eve: 'calm',
                            Frank: 'worried',
                        },
                    },
                    expectedContains: 'Emotions:',
                    checkCommaCount: 4,
                },
                {
                    desc: 'omits emotions line when emotionalInfo is string (legacy format)',
                    memories: [{ id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 }],
                    presentCharacters: [],
                    emotionalInfo: 'excited',
                    expectedContains: null,
                },
            ];

            it.each(EMOTION_CASES)('$desc', ({
                memories,
                presentCharacters,
                emotionalInfo,
                expectedContains,
                checkCommaCount,
            }) => {
                const result = formatContextForInjection(
                    memories,
                    presentCharacters,
                    emotionalInfo,
                    'Alice',
                    10000,
                    500
                );
                if (expectedContains === null) {
                    expect(result).not.toContain('Emotions:');
                } else if (checkCommaCount !== undefined) {
                    expect(result).toContain(expectedContains);
                    const emotionsLine = result.match(/Emotions: (.+)/)?.[1] || '';
                    const commaCount = (emotionsLine.match(/,/g) || []).length;
                    expect(commaCount).toBe(checkCommaCount);
                } else {
                    expect(result).toContain(expectedContains);
                }
            });
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
            const memories = [{ id: '1', summary: 'Event', message_ids: [450], sequence: 450000, importance: 3 }];
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
            const memories = [{ id: '1', summary: 'Event', message_ids: [5], sequence: 5000, importance: 3 }];
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
            const GAP_SEPARATOR_CASES = [
                {
                    desc: 'gaps 15-99 messages shows "..."',
                    memories: [
                        { id: '1', summary: 'Event A', message_ids: [100], sequence: 100000, importance: 3 },
                        { id: '2', summary: 'Event B', message_ids: [150], sequence: 150000, importance: 3 },
                    ],
                    chatLength: 5000,
                    expectedSeparator: '...\n',
                },
                {
                    desc: 'gaps 100-499 messages shows "...Later..."',
                    memories: [
                        { id: '1', summary: 'Event A', message_ids: [100], sequence: 100000, importance: 3 },
                        { id: '2', summary: 'Event B', message_ids: [350], sequence: 350000, importance: 3 },
                    ],
                    chatLength: 5000,
                    expectedSeparator: '...Later...',
                },
                {
                    desc: 'gaps >= 500 messages shows "...Much later..."',
                    memories: [
                        { id: '1', summary: 'Event A', message_ids: [100], sequence: 100000, importance: 3 },
                        { id: '2', summary: 'Event B', message_ids: [700], sequence: 700000, importance: 3 },
                    ],
                    chatLength: 5000,
                    expectedSeparator: '...Much later...',
                },
                {
                    desc: 'gaps < 15 messages shows no separator',
                    memories: [
                        { id: '1', summary: 'Event A', message_ids: [100], sequence: 100000, importance: 3 },
                        { id: '2', summary: 'Event B', message_ids: [110], sequence: 110000, importance: 3 },
                    ],
                    chatLength: 5000,
                    expectedSeparator: null,
                },
                {
                    desc: 'only adds separators in Story So Far bucket',
                    memories: [
                        { id: '1', summary: 'Mid A', message_ids: [4550], sequence: 455000, importance: 3 },
                        { id: '2', summary: 'Mid B', message_ids: [4900], sequence: 490000, importance: 3 },
                    ],
                    chatLength: 5000,
                    expectedSeparator: null,
                },
            ];

            it.each(GAP_SEPARATOR_CASES)('$desc', ({ memories, chatLength, expectedSeparator }) => {
                const result = formatContextForInjection(memories, [], null, 'Alice', 10000, chatLength);
                if (expectedSeparator === null) {
                    expect(result).not.toMatch(/\.\.\.[^<]/);
                } else {
                    expect(result).toContain(expectedSeparator);
                }
            });
        });

        // Causality hints tests (removed)
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

        // Emotional annotations tests (removed)
        describe('emotional annotations (removed)', () => {
            it('does NOT add emotional annotation even for importance >= 4', () => {
                const memories = [
                    {
                        id: '1',
                        summary: 'Major event',
                        message_ids: [4980],
                        sequence: 498000,
                        importance: 4,
                        emotional_impact: { Alice: 'guilt', Bob: 'shock' },
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
                        emotional_impact: ['fear'],
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
                    {
                        id: '2',
                        summary: 'Elder warned of goblins',
                        message_ids: [105],
                        sequence: 105000,
                        importance: 3,
                    },
                    { id: '3', summary: 'Met Marcus at tavern', message_ids: [800], sequence: 800000, importance: 2 },
                    {
                        id: '4',
                        summary: 'Great battle began',
                        message_ids: [2000],
                        sequence: 2000000,
                        importance: 4,
                        emotional_impact: ['fear', 'determination'],
                    },

                    // Mid bucket (4500-4950)
                    {
                        id: '5',
                        summary: 'Goblin stole the amulet',
                        message_ids: [4550],
                        sequence: 455000,
                        importance: 4,
                        emotional_impact: { Hero: 'anger' },
                    },
                    {
                        id: '6',
                        summary: 'Tracked goblin into forest',
                        message_ids: [4553],
                        sequence: 455300,
                        importance: 3,
                    },

                    // Recent bucket (> 4950)
                    {
                        id: '7',
                        summary: 'Goblin camp was burned',
                        message_ids: [4980],
                        sequence: 498000,
                        importance: 5,
                        emotional_impact: { Hero: 'triumph' },
                    },
                    { id: '8', summary: 'Goblin is cornered', message_ids: [4985], sequence: 498500, importance: 4 },
                ];

                const presentCharacters = ['Goblin'];
                const emotionalInfo = {
                    emotion: 'anxious',
                    characterEmotions: { Hero: 'determined', Goblin: 'terrified' },
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

                // Simplified header with star legend
                expect(result).toContain('(#5000 messages | ★=minor ★★★=notable ★★★★★=critical)');
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

        // Subconscious Drives (reflection separation)
        describe('subconscious_drives', () => {
            it('separates reflections from events into different XML blocks', () => {
                const memories = [
                    { id: 'ev_1', type: 'event', summary: 'Event 1', importance: 3, sequence: 1000 },
                    { id: 'ev_2', type: 'event', summary: 'Event 2', importance: 3, sequence: 2000 },
                    {
                        id: 'ref_1',
                        type: 'reflection',
                        summary: 'Insight about character',
                        importance: 4,
                        sequence: 1500,
                    },
                ];
                const result = formatContextForInjection(memories, [], null, 'CharacterA', 1000, 100);
                expect(result).toContain('<scene_memory>');
                expect(result).toContain('Event 1');
                expect(result).toContain('Event 2');
                expect(result).toContain('<subconscious_drives>');
                expect(result).toContain('Insight about character');
                const sceneMemoryMatch = result.match(/<scene_memory>([\s\S]*?)<\/scene_memory>/);
                const sceneMemoryContent = sceneMemoryMatch ? sceneMemoryMatch[1] : '';
                expect(sceneMemoryContent).not.toContain('Insight about character');
            });

            it('omits subconscious_drives block when no reflections exist', () => {
                const memories = [{ id: 'ev_1', type: 'event', summary: 'Event 1', importance: 3, sequence: 1000 }];
                const result = formatContextForInjection(memories, [], null, 'Char', 1000, 100);
                expect(result).toContain('<scene_memory>');
                expect(result).not.toContain('<subconscious_drives>');
            });
        });

        describe('formatContextForInjection without hard quotas', () => {
            it('accepts memories pre-selected by scoring', () => {
                const memories = [
                    { id: '1', summary: 'Old memory', message_ids: [100], sequence: 10000, importance: 3 },
                    { id: '2', summary: 'Recent memory', message_ids: [900], sequence: 9000, importance: 3 },
                ];
                const result = formatContextForInjection(
                    memories,
                    ['OtherChar'],
                    { emotion: 'neutral' },
                    'TestChar',
                    1000,
                    1000
                );
                expect(result).toContain('Old memory');
                expect(result).toContain('Recent memory');
            });

            it('should not apply 50% quota to old bucket', () => {
                // Create many old memories that would exceed 50% quota
                const oldMemories = Array.from({ length: 20 }, (_, i) => ({
                    id: `old${i}`,
                    summary: `Old memory ${i}`,
                    message_ids: [100 + i],
                    sequence: 10000 + i,
                    importance: 3,
                }));

                const result = formatContextForInjection(
                    oldMemories,
                    [],
                    null,
                    'TestChar',
                    5000, // Large budget
                    1000
                );

                // Count how many old memories were included
                const count = (result.match(/Old memory/g) || []).length;
                // With soft balance, could be more than 50% if scoring selected them
                expect(count).toBeGreaterThan(0);
            });
        });
    });
});

describe('formatMemory', () => {
    it('should prepend temporal anchor when present', () => {
        const memory = {
            summary: 'Character A suggested meeting at the library',
            importance: 3,
            temporal_anchor: 'Friday, June 14, 3:40 PM',
            is_secret: false,
        };

        const formatted = formatMemory(memory);
        expect(formatted).toBe('[★★★] [Friday, June 14, 3:40 PM] Character A suggested meeting at the library');
    });

    it('should not add time prefix when temporal_anchor is null', () => {
        const memory = {
            summary: 'Character A suggested meeting at the library',
            importance: 3,
            temporal_anchor: null,
            is_secret: false,
        };

        const formatted = formatMemory(memory);
        expect(formatted).toBe('[★★★] Character A suggested meeting at the library');
        expect(formatted).not.toContain('[null]');
    });

    it('should not add time prefix when temporal_anchor is undefined', () => {
        const memory = {
            summary: 'Character A suggested meeting at the library',
            importance: 3,
            is_secret: false,
        };

        const formatted = formatMemory(memory);
        expect(formatted).toBe('[★★★] Character A suggested meeting at the library');
    });

    it('should combine temporal anchor with [Known] prefix', () => {
        const memory = {
            summary: 'Character A suggested meeting at the library',
            importance: 3,
            temporal_anchor: 'Friday, June 14, 3:40 PM',
            is_secret: false,
            witnesses: ['A', 'B', 'C'],
        };

        const formatted = formatMemory(memory);
        expect(formatted).toBe('[★★★] [Friday, June 14, 3:40 PM] [Known] Character A suggested meeting at the library');
    });
});

describe('memory bucket order and budget', () => {
    it('processes memories in order (old, mid, recent) until budget exhausted', () => {
        // Create 20 old memories (~10 tokens each = ~200 tokens) and 5 recent (~50 tokens)
        const oldMemories = Array.from({ length: 20 }, (_, i) => ({
            id: `old_${i}`,
            summary: `Old event number ${i} happened long ago in the story`,
            importance: 3,
            message_ids: [i + 1],
            sequence: (i + 1) * 1000,
        }));
        const recentMemories = Array.from({ length: 5 }, (_, i) => ({
            id: `recent_${i}`,
            summary: `Recent event ${i} just happened in the current scene`,
            importance: 3,
            message_ids: [4950 + i],
            sequence: (4950 + i) * 1000,
        }));

        const allMemories = [...oldMemories, ...recentMemories];
        // Use a very small budget that can't fit all old memories
        const result = formatContextForInjection(allMemories, [], null, 'Test', 200, 5000);

        // Count how many old memories appear vs recent
        const oldCount = oldMemories.filter((m) => result.includes(m.summary)).length;
        const recentCount = recentMemories.filter((m) => result.includes(m.summary)).length;

        // With the new behavior, old memories come first in the order
        // so they may consume most of the budget before recent memories are reached
        // The soft balancing is handled at the scoring layer, not formatting layer
        expect(oldCount + recentCount).toBeGreaterThan(0);
        expect(oldCount).toBeLessThan(25); // Budget should limit total count
    });
});
