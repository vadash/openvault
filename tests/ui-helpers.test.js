/**
 * Tests for src/ui/helpers.js
 */
import { describe, expect, it } from 'vitest';
import {
    buildCharacterStateData,
    buildProfileOptions,
    calculateExtractionStats,
    extractCharactersSet,
    filterEntities,
    filterMemories,
    formatEmotionSource,
    formatHiddenMessagesText,
    formatMemoryContextCount,
    formatMemoryDate,
    formatMemoryImportance,
    formatWitnesses,
    getBatchProgressInfo,
    getPaginationInfo,
    getStatusText,
    sortMemoriesByDate,
    validateRPM,
} from '../src/ui/helpers.js';

describe('ui/helpers', () => {
    describe('filterMemories', () => {
        const memories = [
            { id: '1', characters_involved: ['Alice', 'Bob'] },
            { id: '2', characters_involved: ['Alice'] },
            { id: '3', characters_involved: ['Charlie'] },
            { id: '4', characters_involved: ['Bob', 'Charlie'] },
        ];

        it('returns all memories when no filters', () => {
            expect(filterMemories(memories, '', '')).toHaveLength(4);
        });

        it('filters by character', () => {
            const result = filterMemories(memories, '', 'Alice');
            expect(result).toHaveLength(2);
            expect(result.every((m) => m.characters_involved.includes('Alice'))).toBe(true);
        });

        it('returns empty array when no matches', () => {
            expect(filterMemories(memories, '', 'Unknown')).toHaveLength(0);
        });

        it('handles empty memories array', () => {
            expect(filterMemories([], '', '')).toHaveLength(0);
        });

        it('filters events only (excludes reflections)', () => {
            const mems = [
                { id: '1', characters_involved: ['Alice'] },
                { id: '2', characters_involved: ['Alice'], type: 'reflection' },
                { id: '3', characters_involved: ['Bob'] },
            ];
            const result = filterMemories(mems, 'event', '');
            expect(result).toHaveLength(2);
            expect(result.every((m) => m.type !== 'reflection')).toBe(true);
        });

        it('filters reflections only', () => {
            const mems = [
                { id: '1', characters_involved: ['Alice'] },
                { id: '2', characters_involved: ['Alice'], type: 'reflection' },
                { id: '3', characters_involved: ['Bob'], type: 'reflection' },
            ];
            const result = filterMemories(mems, 'reflection', '');
            expect(result).toHaveLength(2);
            expect(result.every((m) => m.type === 'reflection')).toBe(true);
        });

        it('combines type and character filter', () => {
            const mems = [
                { id: '1', characters_involved: ['Alice'] },
                { id: '2', characters_involved: ['Alice'], type: 'reflection' },
                { id: '3', characters_involved: ['Bob'], type: 'reflection' },
            ];
            const result = filterMemories(mems, 'reflection', 'Alice');
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('2');
        });

        it('treats unknown type filter as show all', () => {
            const mems = [
                { id: '1', characters_involved: ['Alice'] },
                { id: '2', characters_involved: ['Alice'], type: 'reflection' },
            ];
            const result = filterMemories(mems, 'action', '');
            expect(result).toHaveLength(2);
        });
    });

    describe('filterEntities', () => {
        const mockGraph = {
            nodes: {
                aldric: { name: 'King Aldric', type: 'PERSON', description: 'The aging ruler', mentions: 7 },
                castle: { name: 'Castle', type: 'PLACE', description: 'Ancient fortress', mentions: 3 },
                guard: { name: 'Royal Guard', type: 'ORGANIZATION', description: 'Elite soldiers', mentions: 5 },
                sword: { name: 'Magic Sword', type: 'OBJECT', description: 'Legendary blade', mentions: 2 },
            },
        };

        it('returns all entities when no filters', () => {
            expect(filterEntities(mockGraph, '', '')).toHaveLength(4);
        });

        it('filters by type', () => {
            const result = filterEntities(mockGraph, '', 'PERSON');
            expect(result).toHaveLength(1);
            expect(result[0][1].name).toBe('King Aldric');
            expect(result[0][0]).toBe('aldric');
        });

        it('filters by search query (name)', () => {
            const result = filterEntities(mockGraph, 'castle', '');
            expect(result).toHaveLength(1);
            expect(result[0][1].name).toBe('Castle');
        });

        it('filters by search query (description)', () => {
            const result = filterEntities(mockGraph, 'legendary', '');
            expect(result).toHaveLength(1);
            expect(result[0][1].name).toBe('Magic Sword');
        });

        it('combines type and search filters', () => {
            const result = filterEntities(mockGraph, 'aldric', 'PERSON');
            expect(result).toHaveLength(1);
        });

        it('returns empty for no matches', () => {
            expect(filterEntities(mockGraph, 'nonexistent', '')).toHaveLength(0);
        });

        it('handles empty graph', () => {
            expect(filterEntities({}, '', '')).toHaveLength(0);
        });

        it('handles null/undefined graph', () => {
            expect(filterEntities(null, '', '')).toHaveLength(0);
            expect(filterEntities(undefined, '', '')).toHaveLength(0);
        });

        it('search is case-insensitive', () => {
            const result = filterEntities(mockGraph, 'KING', '');
            expect(result).toHaveLength(1);
        });

        it('sorts by mentions descending', () => {
            const result = filterEntities(mockGraph, '', '');
            expect(result[0][0]).toBe('aldric'); // 7 mentions
            expect(result[1][0]).toBe('guard'); // 5 mentions
            expect(result[2][0]).toBe('castle'); // 3 mentions
            expect(result[3][0]).toBe('sword'); // 2 mentions
        });

        it('searches aliases', () => {
            const graphWithAliases = {
                nodes: {
                    marcus: {
                        name: 'Marcus Hale',
                        type: 'PERSON',
                        description: 'A former soldier',
                        aliases: ['masked figure', 'the stranger'],
                        mentions: 1,
                    },
                    tavern: {
                        name: 'The Tavern',
                        type: 'PLACE',
                        description: 'A drinking establishment',
                        aliases: [],
                        mentions: 2,
                    },
                },
            };
            const result = filterEntities(graphWithAliases, 'masked figure', '');
            expect(result).toHaveLength(1);
            expect(result[0][0]).toBe('marcus');
        });

        it('searches partial alias match', () => {
            const graphWithAliases = {
                nodes: {
                    marcus: {
                        name: 'Marcus Hale',
                        type: 'PERSON',
                        description: 'A former soldier',
                        aliases: ['masked figure', 'the stranger'],
                        mentions: 1,
                    },
                },
            };
            const result = filterEntities(graphWithAliases, 'stranger', '');
            expect(result).toHaveLength(1);
            expect(result[0][0]).toBe('marcus');
        });

        it('handles missing aliases gracefully', () => {
            const graphNoAliases = {
                nodes: {
                    item: { name: 'Item', type: 'OBJECT', description: 'A thing', mentions: 1 },
                },
            };
            expect(filterEntities(graphNoAliases, 'thing', '')).toHaveLength(1);
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
            const memories = [{ characters_involved: ['Zelda', 'Alice', 'Mike'] }];

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

    describe('calculateExtractionStats', () => {
        it('calculates stats correctly', () => {
            const chat = [
                { mes: 'msg0', send_date: '1000000', is_system: false },
                { mes: 'msg1', send_date: '1000001', is_system: false },
                { mes: 'sys', send_date: '1000002', is_system: true },
                { mes: 'msg3', send_date: '1000003', is_system: false },
                { mes: 'msg4', send_date: '1000004', is_system: false },
            ];
            const processedFps = new Set(['1000000', '1000001']);

            const result = calculateExtractionStats(chat, processedFps, 2);

            expect(result.totalMessages).toBe(5);
            expect(result.hiddenMessages).toBe(1);
            expect(result.extractedCount).toBe(2);
            expect(result.unextractedCount).toBe(3);
            expect(result.batchProgress).toBe(1); // 3 % 2 = 1
            expect(result.messagesNeeded).toBe(1); // 2 - 1 = 1
        });

        it('calculates batch progress correctly', () => {
            const chat = Array.from({ length: 20 }, (_, i) => ({
                mes: `msg${i}`,
                send_date: String(1000000 + i),
                is_system: false,
            }));
            const processedFps = new Set(['1000000', '1000001', '1000002']); // Only first 3 extracted

            const result = calculateExtractionStats(chat, processedFps, 5);

            // 20 - 3 = 17 unextracted
            // 17 % 5 = 2 in current batch
            // 5 - 2 = 3 needed
            expect(result.unextractedCount).toBe(17);
            expect(result.batchProgress).toBe(2);
            expect(result.messagesNeeded).toBe(3);
        });

        it('handles empty chat', () => {
            const result = calculateExtractionStats([], new Set(), 10);

            expect(result.totalMessages).toBe(0);
            expect(result.unextractedCount).toBe(0);
            expect(result.batchProgress).toBe(0);
        });

        it('shows ready when full batch waiting', () => {
            const chat = Array.from({ length: 30 }, (_, i) => ({
                mes: `msg${i}`,
                send_date: String(1000000 + i),
                is_system: false,
            }));
            const processedFps = new Set(); // None extracted

            const result = calculateExtractionStats(chat, processedFps, 10);

            // 30 unextracted, 30 % 10 = 0, but unextracted > 0 so ready
            expect(result.unextractedCount).toBe(30);
            expect(result.batchProgress).toBe(0);
            expect(result.messagesNeeded).toBe(0); // Ready!
        });

        it('excludes buffer from extractable messages', () => {
            const chat = Array.from({ length: 20 }, (_, i) => ({
                mes: `msg${i}`,
                send_date: String(1000000 + i),
                is_system: false,
            }));
            const processedFps = new Set(['1000000', '1000001', '1000002', '1000003', '1000004']); // 5 extracted

            const result = calculateExtractionStats(chat, processedFps, 10, 5);

            // 20 total - 5 buffer = 15 extractable
            // 15 extractable - 5 extracted = 10 unextracted
            expect(result.extractableMessages).toBe(15);
            expect(result.unextractedCount).toBe(10);
            expect(result.bufferSize).toBe(5);
        });

        it('handles buffer larger than unextracted messages', () => {
            const chat = Array.from({ length: 10 }, (_, i) => ({
                mes: `msg${i}`,
                send_date: String(1000000 + i),
                is_system: false,
            }));
            const processedFps = new Set(['1000000', '1000001', '1000002', '1000003', '1000004', '1000005', '1000006']); // 7 extracted

            const result = calculateExtractionStats(chat, processedFps, 5, 5);

            // 10 total - 5 buffer = 5 extractable
            // 5 extractable - 7 extracted = -2, clamped to 0
            expect(result.extractableMessages).toBe(5);
            expect(result.unextractedCount).toBe(0);
        });

        it('excludes dead fingerprints from extracted count', () => {
            const chat = [
                { mes: 'Hello', send_date: '1000000', is_system: false },
                { mes: 'Hi', send_date: '1000001', is_system: false },
            ];
            // '9999999' is a dead fingerprint (message no longer exists)
            const processedFps = new Set(['1000000', '9999999']);

            const result = calculateExtractionStats(chat, processedFps, chat.length);

            // extractedCount should be 1 (only chat[0] with send_date '1000000'), not 2
            expect(result.extractedCount).toBe(1);
        });
    });

    describe('getBatchProgressInfo', () => {
        it('returns up to date when all extracted', () => {
            const stats = {
                batchProgress: 0,
                messagesNeeded: 10,
                messageCount: 10,
                unextractedCount: 0,
            };

            const result = getBatchProgressInfo(stats);

            expect(result.label).toBe('Up to date');
            expect(result.percentage).toBe(100);
        });

        it('returns ready when full batch waiting', () => {
            const stats = {
                batchProgress: 0,
                messagesNeeded: 0,
                messageCount: 10,
                unextractedCount: 30,
            };

            const result = getBatchProgressInfo(stats);

            expect(result.label).toBe('Ready!');
            expect(result.percentage).toBe(100);
        });

        it('returns progress when partial batch', () => {
            const stats = {
                batchProgress: 7,
                messagesNeeded: 3,
                messageCount: 10,
                unextractedCount: 7,
            };

            const result = getBatchProgressInfo(stats);

            expect(result.label).toBe('7/10 (+3)');
            expect(result.percentage).toBe(70);
            expect(result.current).toBe(7);
            expect(result.total).toBe(10);
        });

        it('includes buffer label when buffer is set', () => {
            const stats = {
                batchProgress: 5,
                messagesNeeded: 5,
                messageCount: 10,
                unextractedCount: 5,
                bufferSize: 5,
            };

            const result = getBatchProgressInfo(stats);

            expect(result.label).toBe('5/10 (+5) [5 buffered]');
        });

        it('includes buffer label when up to date', () => {
            const stats = {
                batchProgress: 0,
                messagesNeeded: 10,
                messageCount: 10,
                unextractedCount: 0,
                bufferSize: 5,
            };

            const result = getBatchProgressInfo(stats);

            expect(result.label).toBe('Up to date [5 buffered]');
        });

        it('omits buffer label when buffer is 0', () => {
            const stats = {
                batchProgress: 0,
                messagesNeeded: 10,
                messageCount: 10,
                unextractedCount: 0,
                bufferSize: 0,
            };

            const result = getBatchProgressInfo(stats);

            expect(result.label).toBe('Up to date');
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

    describe('formatMemoryImportance', () => {
        it('formats importance 1 as one filled star and four empty', () => {
            expect(formatMemoryImportance(1)).toBe('\u2605\u2606\u2606\u2606\u2606');
        });

        it('formats importance 5 as five filled stars', () => {
            expect(formatMemoryImportance(5)).toBe('\u2605\u2605\u2605\u2605\u2605');
        });

        it('formats importance 3 as three filled and two empty', () => {
            expect(formatMemoryImportance(3)).toBe('\u2605\u2605\u2605\u2606\u2606');
        });

        it('defaults to 3 when undefined', () => {
            expect(formatMemoryImportance(undefined)).toBe('\u2605\u2605\u2605\u2606\u2606');
        });

        it('clamps values below 1 to 1', () => {
            expect(formatMemoryImportance(0)).toBe('\u2605\u2606\u2606\u2606\u2606');
            expect(formatMemoryImportance(-5)).toBe('\u2605\u2606\u2606\u2606\u2606');
        });

        it('clamps values above 5 to 5', () => {
            expect(formatMemoryImportance(10)).toBe('\u2605\u2605\u2605\u2605\u2605');
        });
    });

    describe('formatMemoryDate', () => {
        it('formats valid timestamp as localized date', () => {
            const timestamp = new Date('2024-06-15').getTime();
            const result = formatMemoryDate(timestamp);
            // Result depends on locale, just check it's not 'Unknown'
            expect(result).not.toBe('Unknown');
            expect(result).toContain('2024');
        });

        it('returns Unknown for null timestamp', () => {
            expect(formatMemoryDate(null)).toBe('Unknown');
        });

        it('returns Unknown for undefined timestamp', () => {
            expect(formatMemoryDate(undefined)).toBe('Unknown');
        });

        it('returns Unknown for zero timestamp', () => {
            expect(formatMemoryDate(0)).toBe('Unknown');
        });
    });

    describe('formatWitnesses', () => {
        it('formats array of witnesses as comma-separated string', () => {
            expect(formatWitnesses(['Alice', 'Bob', 'Charlie'])).toBe('Witnesses: Alice, Bob, Charlie');
        });

        it('formats single witness', () => {
            expect(formatWitnesses(['Alice'])).toBe('Witnesses: Alice');
        });

        it('returns empty string for empty array', () => {
            expect(formatWitnesses([])).toBe('');
        });

        it('returns empty string for undefined', () => {
            expect(formatWitnesses(undefined)).toBe('');
        });

        it('returns empty string for null', () => {
            expect(formatWitnesses(null)).toBe('');
        });
    });

    describe('getStatusText', () => {
        it('returns Ready for ready status', () => {
            expect(getStatusText('ready')).toBe('Ready');
        });

        it('returns Extracting... for extracting status', () => {
            expect(getStatusText('extracting')).toBe('Extracting...');
        });

        it('returns Retrieving... for retrieving status', () => {
            expect(getStatusText('retrieving')).toBe('Retrieving...');
        });

        it('returns Error for error status', () => {
            expect(getStatusText('error')).toBe('Error');
        });

        it('returns input as-is for unknown status', () => {
            expect(getStatusText('custom')).toBe('custom');
        });
    });

    describe('formatEmotionSource', () => {
        it('formats same min and max as single message', () => {
            expect(formatEmotionSource({ min: 5, max: 5 })).toBe(' (msg 5)');
        });

        it('formats different min and max as range', () => {
            expect(formatEmotionSource({ min: 10, max: 15 })).toBe(' (msgs 10-15)');
        });

        it('returns empty string for undefined', () => {
            expect(formatEmotionSource(undefined)).toBe('');
        });

        it('returns empty string for null', () => {
            expect(formatEmotionSource(null)).toBe('');
        });
    });

    describe('formatHiddenMessagesText', () => {
        it('formats positive count with parentheses', () => {
            expect(formatHiddenMessagesText(5)).toBe(' (5 hidden)');
        });

        it('returns empty string for zero', () => {
            expect(formatHiddenMessagesText(0)).toBe('');
        });

        it('returns empty string for negative', () => {
            expect(formatHiddenMessagesText(-1)).toBe('');
        });
    });

    describe('formatMemoryContextCount', () => {
        it('returns All for negative values', () => {
            expect(formatMemoryContextCount(-1)).toBe('All');
            expect(formatMemoryContextCount(-10)).toBe('All');
        });

        it('returns string number for positive values', () => {
            expect(formatMemoryContextCount(5)).toBe('5');
            expect(formatMemoryContextCount(100)).toBe('100');
        });

        it('returns 0 for zero', () => {
            expect(formatMemoryContextCount(0)).toBe('0');
        });
    });
});
