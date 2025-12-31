/**
 * Tests for src/ui/calculations.js
 */
import { describe, it, expect } from 'vitest';
import {
    filterMemories,
    sortMemoriesByDate,
    getPaginationInfo,
    extractCharactersSet,
    buildCharacterStateData,
    buildRelationshipData,
    calculateExtractionStats,
    getBackfillStatusText,
    getNextAutoExtractionText,
    validateRPM,
    buildProfileOptions,
} from '../src/ui/calculations.js';

describe('ui/calculations', () => {
    describe('filterMemories', () => {
        const memories = [
            { id: '1', event_type: 'action', characters_involved: ['Alice', 'Bob'] },
            { id: '2', event_type: 'dialogue', characters_involved: ['Alice'] },
            { id: '3', event_type: 'action', characters_involved: ['Charlie'] },
            { id: '4', event_type: 'emotion', characters_involved: ['Bob', 'Charlie'] },
        ];

        it('returns all memories when no filters', () => {
            expect(filterMemories(memories, '', '')).toHaveLength(4);
        });

        it('filters by event type', () => {
            const result = filterMemories(memories, 'action', '');
            expect(result).toHaveLength(2);
            expect(result.every(m => m.event_type === 'action')).toBe(true);
        });

        it('filters by character', () => {
            const result = filterMemories(memories, '', 'Alice');
            expect(result).toHaveLength(2);
            expect(result.every(m => m.characters_involved.includes('Alice'))).toBe(true);
        });

        it('filters by both type and character', () => {
            const result = filterMemories(memories, 'action', 'Alice');
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('returns empty array when no matches', () => {
            expect(filterMemories(memories, 'unknown', '')).toHaveLength(0);
        });

        it('handles empty memories array', () => {
            expect(filterMemories([], 'action', '')).toHaveLength(0);
        });

        it('handles missing characters_involved', () => {
            const partial = [{ id: '1', event_type: 'action' }];
            expect(filterMemories(partial, '', 'Alice')).toHaveLength(0);
        });
    });

    describe('sortMemoriesByDate', () => {
        it('sorts memories by created_at descending (newest first)', () => {
            const memories = [
                { id: '1', created_at: 1000 },
                { id: '2', created_at: 3000 },
                { id: '3', created_at: 2000 },
            ];

            const result = sortMemoriesByDate(memories);

            expect(result[0].id).toBe('2');
            expect(result[1].id).toBe('3');
            expect(result[2].id).toBe('1');
        });

        it('does not mutate original array', () => {
            const memories = [
                { id: '1', created_at: 1000 },
                { id: '2', created_at: 2000 },
            ];

            sortMemoriesByDate(memories);

            expect(memories[0].id).toBe('1');
        });

        it('handles missing created_at (treats as 0)', () => {
            const memories = [
                { id: '1', created_at: 1000 },
                { id: '2' }, // no created_at
            ];

            const result = sortMemoriesByDate(memories);

            expect(result[0].id).toBe('1');
            expect(result[1].id).toBe('2');
        });

        it('handles empty array', () => {
            expect(sortMemoriesByDate([])).toEqual([]);
        });
    });

    describe('getPaginationInfo', () => {
        it('calculates correct pagination for first page', () => {
            const result = getPaginationInfo(25, 0, 10);

            expect(result.totalPages).toBe(3);
            expect(result.currentPage).toBe(0);
            expect(result.startIdx).toBe(0);
            expect(result.endIdx).toBe(10);
            expect(result.hasPrev).toBe(false);
            expect(result.hasNext).toBe(true);
        });

        it('calculates correct pagination for middle page', () => {
            const result = getPaginationInfo(25, 1, 10);

            expect(result.currentPage).toBe(1);
            expect(result.startIdx).toBe(10);
            expect(result.endIdx).toBe(20);
            expect(result.hasPrev).toBe(true);
            expect(result.hasNext).toBe(true);
        });

        it('calculates correct pagination for last page', () => {
            const result = getPaginationInfo(25, 2, 10);

            expect(result.currentPage).toBe(2);
            expect(result.startIdx).toBe(20);
            expect(result.endIdx).toBe(30);
            expect(result.hasPrev).toBe(true);
            expect(result.hasNext).toBe(false);
        });

        it('clamps page to valid range', () => {
            const result = getPaginationInfo(25, 10, 10);

            expect(result.currentPage).toBe(2); // Max valid page
        });

        it('returns 1 total page for empty items', () => {
            const result = getPaginationInfo(0, 0, 10);

            expect(result.totalPages).toBe(1);
        });

        it('handles single page of items', () => {
            const result = getPaginationInfo(5, 0, 10);

            expect(result.totalPages).toBe(1);
            expect(result.hasPrev).toBe(false);
            expect(result.hasNext).toBe(false);
        });
    });

    describe('extractCharactersSet', () => {
        it('extracts unique characters from memories', () => {
            const memories = [
                { characters_involved: ['Alice', 'Bob'] },
                { characters_involved: ['Bob', 'Charlie'] },
                { characters_involved: ['Alice'] },
            ];

            const result = extractCharactersSet(memories);

            expect(result).toEqual(['Alice', 'Bob', 'Charlie']);
        });

        it('returns sorted array', () => {
            const memories = [
                { characters_involved: ['Zelda', 'Alice', 'Mike'] },
            ];

            const result = extractCharactersSet(memories);

            expect(result).toEqual(['Alice', 'Mike', 'Zelda']);
        });

        it('handles empty memories', () => {
            expect(extractCharactersSet([])).toEqual([]);
        });

        it('handles missing characters_involved', () => {
            const memories = [{ id: '1' }, { characters_involved: ['Alice'] }];
            expect(extractCharactersSet(memories)).toEqual(['Alice']);
        });
    });

    describe('buildCharacterStateData', () => {
        it('builds display data from character state', () => {
            const charData = {
                current_emotion: 'happy',
                emotion_intensity: 8,
                known_events: ['evt1', 'evt2', 'evt3'],
                emotion_from_messages: { min: 5, max: 10 },
            };

            const result = buildCharacterStateData('Alice', charData);

            expect(result.name).toBe('Alice');
            expect(result.emotion).toBe('happy');
            expect(result.intensity).toBe(8);
            expect(result.intensityPercent).toBe(80);
            expect(result.knownCount).toBe(3);
            expect(result.emotionSource).toBe(' (msgs 5-10)');
        });

        it('uses defaults for missing data', () => {
            const result = buildCharacterStateData('Bob', {});

            expect(result.emotion).toBe('neutral');
            expect(result.intensity).toBe(5);
            expect(result.intensityPercent).toBe(50);
            expect(result.knownCount).toBe(0);
            expect(result.emotionSource).toBe('');
        });

        it('formats single message source', () => {
            const charData = {
                emotion_from_messages: { min: 7, max: 7 },
            };

            const result = buildCharacterStateData('Charlie', charData);
            expect(result.emotionSource).toBe(' (msg 7)');
        });
    });

    describe('buildRelationshipData', () => {
        it('builds display data from relationship', () => {
            const relData = {
                character_a: 'Alice',
                character_b: 'Bob',
                relationship_type: 'friend',
                trust_level: 8,
                tension_level: 2,
            };

            const result = buildRelationshipData('Alice<->Bob', relData);

            expect(result.key).toBe('Alice<->Bob');
            expect(result.characterA).toBe('Alice');
            expect(result.characterB).toBe('Bob');
            expect(result.type).toBe('friend');
            expect(result.trust).toBe(8);
            expect(result.trustPercent).toBe(80);
            expect(result.tension).toBe(2);
            expect(result.tensionPercent).toBe(20);
        });

        it('uses defaults for missing data', () => {
            const result = buildRelationshipData('key', {});

            expect(result.characterA).toBe('?');
            expect(result.characterB).toBe('?');
            expect(result.type).toBe('acquaintance');
            expect(result.trust).toBe(5);
            expect(result.tension).toBe(0);
        });
    });

    describe('calculateExtractionStats', () => {
        it('calculates stats correctly', () => {
            const chat = [
                { is_system: false },
                { is_system: false },
                { is_system: true },
                { is_system: false },
                { is_system: false },
            ];
            const extractedIds = new Set([0, 1]);

            const result = calculateExtractionStats(chat, extractedIds, 2);

            expect(result.totalMessages).toBe(5);
            expect(result.hiddenMessages).toBe(1);
            expect(result.extractedCount).toBe(2);
            expect(result.bufferSize).toBe(4); // messageCount * 2
            expect(result.bufferStart).toBe(1); // max(0, 5-4)
        });

        it('counts unprocessed messages before buffer', () => {
            const chat = new Array(20).fill({ is_system: false });
            const extractedIds = new Set([0, 1, 2]); // Only first 3 extracted

            const result = calculateExtractionStats(chat, extractedIds, 5);

            // bufferSize = 10, bufferStart = 10
            // Messages 3-9 are before buffer and not extracted = 7 unprocessed
            expect(result.unprocessedCount).toBe(7);
        });

        it('handles empty chat', () => {
            const result = calculateExtractionStats([], new Set(), 10);

            expect(result.totalMessages).toBe(0);
            expect(result.unprocessedCount).toBe(0);
        });
    });

    describe('getBackfillStatusText', () => {
        it('returns waiting message when not enough messages', () => {
            expect(getBackfillStatusText(5, 20, 0)).toBe('Waiting for more messages');
        });

        it('returns count when unprocessed messages exist', () => {
            expect(getBackfillStatusText(30, 20, 5)).toBe('5 msgs ready');
        });

        it('returns up to date when fully processed', () => {
            expect(getBackfillStatusText(30, 20, 0)).toBe('Up to date');
        });
    });

    describe('getNextAutoExtractionText', () => {
        it('returns need more messages when below buffer size', () => {
            const result = getNextAutoExtractionText({
                totalMessages: 10,
                bufferSize: 20,
                bufferStart: 0,
                extractedCount: 0,
                extractedMessageIds: new Set(),
                messageCount: 10,
            });

            expect(result).toBe('Need 10 more msgs');
        });

        it('returns backfill pending when messages before buffer unextracted', () => {
            const result = getNextAutoExtractionText({
                totalMessages: 30,
                bufferSize: 20,
                bufferStart: 10,
                extractedCount: 5,
                extractedMessageIds: new Set([0, 1, 2, 3, 4]),
                messageCount: 10,
            });

            expect(result).toBe('Backfill pending');
        });

        it('returns ready on next AI msg when at batch boundary', () => {
            const result = getNextAutoExtractionText({
                totalMessages: 30,
                bufferSize: 20,
                bufferStart: 10,
                extractedCount: 10,
                extractedMessageIds: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
                messageCount: 10,
            });

            expect(result).toBe('Ready on next AI msg');
        });

        it('returns countdown when within batch', () => {
            const result = getNextAutoExtractionText({
                totalMessages: 30,
                bufferSize: 20,
                bufferStart: 10,
                extractedCount: 10,
                extractedMessageIds: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
                messageCount: 10,
            });

            expect(result).toMatch(/In \d+ msgs/);
        });
    });

    describe('validateRPM', () => {
        it('returns valid value unchanged', () => {
            expect(validateRPM(50)).toBe(50);
        });

        it('clamps value below 1 to 1', () => {
            expect(validateRPM(0)).toBe(1);
            expect(validateRPM(-10)).toBe(1);
        });

        it('clamps value above 600 to 600', () => {
            expect(validateRPM(1000)).toBe(600);
        });

        it('uses default for invalid input', () => {
            expect(validateRPM('invalid', 30)).toBe(30);
            expect(validateRPM(null, 30)).toBe(30);
            expect(validateRPM(undefined, 30)).toBe(30);
        });

        it('parses string numbers', () => {
            expect(validateRPM('100')).toBe(100);
        });
    });

    describe('buildProfileOptions', () => {
        it('builds options array with selected flag', () => {
            const profiles = [
                { id: 'p1', name: 'Profile 1' },
                { id: 'p2', name: 'Profile 2' },
            ];

            const result = buildProfileOptions(profiles, 'p2');

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ id: 'p1', name: 'Profile 1', selected: false });
            expect(result[1]).toEqual({ id: 'p2', name: 'Profile 2', selected: true });
        });

        it('handles empty profiles', () => {
            expect(buildProfileOptions([], 'p1')).toEqual([]);
        });

        it('handles no selection', () => {
            const profiles = [{ id: 'p1', name: 'Profile 1' }];
            const result = buildProfileOptions(profiles, '');

            expect(result[0].selected).toBe(false);
        });
    });
});
