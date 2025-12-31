/**
 * Tests for src/pov.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import {
    filterMemoriesByPOV,
    getActiveCharacters,
    detectPresentCharactersFromMessages,
    getPOVContext,
} from '../src/pov.js';
import { MEMORIES_KEY, CHARACTERS_KEY, extensionName } from '../src/constants.js';

describe('pov', () => {
    let mockConsole;
    let mockContext;

    beforeEach(() => {
        mockConsole = {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        mockContext = {
            name1: 'User',
            name2: 'Alice',
            groupId: null,
            groups: [],
            characters: [],
            chat: [],
            chatMetadata: {},
        };
        setDeps({
            console: mockConsole,
            getContext: () => mockContext,
            getExtensionSettings: () => ({ [extensionName]: { debugMode: false } }),
        });
    });

    afterEach(() => {
        resetDeps();
    });

    describe('filterMemoriesByPOV', () => {
        it('returns all memories when no POV characters specified', () => {
            const memories = [
                { id: '1', summary: 'Event 1', witnesses: ['Bob'] },
                { id: '2', summary: 'Event 2', witnesses: ['Charlie'] },
            ];
            const result = filterMemoriesByPOV(memories, [], {});
            expect(result).toHaveLength(2);
        });

        it('returns empty array for empty memories', () => {
            const result = filterMemoriesByPOV([], ['Alice'], {});
            expect(result).toEqual([]);
        });

        it('returns empty array for null memories', () => {
            const result = filterMemoriesByPOV(null, ['Alice'], {});
            expect(result).toEqual([]);
        });

        it('includes memories where POV character is witness', () => {
            const memories = [
                { id: '1', summary: 'Alice saw this', witnesses: ['Alice'] },
                { id: '2', summary: 'Bob only', witnesses: ['Bob'] },
            ];
            const result = filterMemoriesByPOV(memories, ['Alice'], { [CHARACTERS_KEY]: {} });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('performs case-insensitive witness matching', () => {
            const memories = [
                { id: '1', witnesses: ['ALICE'] },
                { id: '2', witnesses: ['alice'] },
            ];
            const result = filterMemoriesByPOV(memories, ['Alice'], { [CHARACTERS_KEY]: {} });
            expect(result).toHaveLength(2);
        });

        it('includes non-secret memories where POV character is involved', () => {
            const memories = [
                { id: '1', characters_involved: ['Alice', 'Bob'], is_secret: false, witnesses: [] },
                { id: '2', characters_involved: ['Alice'], is_secret: true, witnesses: [] },
            ];
            const result = filterMemoriesByPOV(memories, ['Alice'], { [CHARACTERS_KEY]: {} });
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
        });

        it('includes memories in POV character known_events', () => {
            const memories = [
                { id: 'known-evt', summary: 'Known event', witnesses: ['Bob'] },
                { id: 'unknown-evt', summary: 'Unknown event', witnesses: ['Charlie'] },
            ];
            const data = {
                [CHARACTERS_KEY]: {
                    Alice: {
                        name: 'Alice',
                        known_events: ['known-evt'],
                    }
                }
            };
            const result = filterMemoriesByPOV(memories, ['Alice'], data);
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('known-evt');
        });

        it('handles multiple POV characters', () => {
            const memories = [
                { id: '1', witnesses: ['Alice'] },
                { id: '2', witnesses: ['Bob'] },
                { id: '3', witnesses: ['Charlie'] },
            ];
            const result = filterMemoriesByPOV(memories, ['Alice', 'Bob'], { [CHARACTERS_KEY]: {} });
            expect(result).toHaveLength(2);
            expect(result.map(m => m.id)).toContain('1');
            expect(result.map(m => m.id)).toContain('2');
        });

        it('combines known_events from multiple POV characters', () => {
            const memories = [
                { id: 'evt-1', witnesses: ['X'] },
                { id: 'evt-2', witnesses: ['Y'] },
            ];
            const data = {
                [CHARACTERS_KEY]: {
                    Alice: { known_events: ['evt-1'] },
                    Bob: { known_events: ['evt-2'] },
                }
            };
            const result = filterMemoriesByPOV(memories, ['Alice', 'Bob'], data);
            expect(result).toHaveLength(2);
        });

        it('handles memories without witnesses array', () => {
            const memories = [
                { id: '1', characters_involved: ['Alice'], is_secret: false },
            ];
            const result = filterMemoriesByPOV(memories, ['Alice'], { [CHARACTERS_KEY]: {} });
            expect(result).toHaveLength(1);
        });
    });

    describe('getActiveCharacters', () => {
        it('returns main character and user in solo chat', () => {
            const result = getActiveCharacters();
            expect(result).toContain('Alice');
            expect(result).toContain('User');
        });

        it('returns main character even without user name', () => {
            mockContext.name1 = null;
            const result = getActiveCharacters();
            expect(result).toContain('Alice');
            expect(result).not.toContain(null);
        });

        it('includes group members in group chat', () => {
            mockContext.groupId = 'group-123';
            mockContext.groups = [{
                id: 'group-123',
                members: ['avatar1.png', 'avatar2.png'],
            }];
            mockContext.characters = [
                { avatar: 'avatar1.png', name: 'Bob' },
                { avatar: 'avatar2.png', name: 'Charlie' },
            ];

            const result = getActiveCharacters();
            expect(result).toContain('Alice'); // main character
            expect(result).toContain('User');
            expect(result).toContain('Bob');
            expect(result).toContain('Charlie');
        });

        it('does not duplicate character names', () => {
            mockContext.groupId = 'group-123';
            mockContext.groups = [{
                id: 'group-123',
                members: ['avatar1.png'],
            }];
            mockContext.characters = [
                { avatar: 'avatar1.png', name: 'Alice' }, // same as name2
            ];

            const result = getActiveCharacters();
            const aliceCount = result.filter(n => n === 'Alice').length;
            expect(aliceCount).toBe(1);
        });

        it('handles group without members', () => {
            mockContext.groupId = 'group-123';
            mockContext.groups = [{
                id: 'group-123',
                // no members
            }];

            const result = getActiveCharacters();
            expect(result).toContain('Alice');
        });
    });

    describe('detectPresentCharactersFromMessages', () => {
        it('returns basic names when no OpenVault data', () => {
            // When context has no chat messages and no existing openvault data,
            // getOpenVaultData will create a new empty structure (not null)
            // So we test the path where there are no recent messages to scan
            mockContext.chat = [];
            mockContext.chatMetadata = {
                openvault: {
                    memories: [],
                    character_states: {},
                }
            };
            const result = detectPresentCharactersFromMessages(2);
            // No messages to scan, no characters detected
            expect(result).toEqual([]);
        });

        it('detects character from message sender', () => {
            mockContext.chat = [
                { name: 'Bob', mes: 'Hello', is_system: false },
            ];
            mockContext.chatMetadata.openvault = {
                [MEMORIES_KEY]: [],
                [CHARACTERS_KEY]: { Bob: { name: 'Bob' } },
            };

            const result = detectPresentCharactersFromMessages(2);
            expect(result).toContain('Bob');
        });

        it('detects character mentioned in message content', () => {
            mockContext.chat = [
                { name: 'Narrator', mes: 'Alice walked into the room where Bob was waiting.', is_system: false },
            ];
            mockContext.chatMetadata.openvault = {
                [MEMORIES_KEY]: [{ characters_involved: ['Alice', 'Bob'] }],
                [CHARACTERS_KEY]: { Alice: { name: 'Alice' }, Bob: { name: 'Bob' } },
            };

            const result = detectPresentCharactersFromMessages(2);
            expect(result).toContain('Alice');
            expect(result).toContain('Bob');
        });

        it('skips system messages', () => {
            mockContext.chat = [
                { name: 'System', mes: 'Charlie joined', is_system: true },
                { name: 'Alice', mes: 'Hi', is_system: false },
            ];
            mockContext.chatMetadata.openvault = {
                [MEMORIES_KEY]: [{ characters_involved: ['Charlie'] }],
                [CHARACTERS_KEY]: { Charlie: { name: 'Charlie' } },
            };

            const result = detectPresentCharactersFromMessages(2);
            expect(result).not.toContain('Charlie');
        });

        it('respects messageCount limit', () => {
            mockContext.chat = [
                { name: 'Alice', mes: 'First message mentions Bob', is_system: false },
                { name: 'Alice', mes: 'Second message', is_system: false },
                { name: 'Alice', mes: 'Third message', is_system: false },
            ];
            mockContext.chatMetadata.openvault = {
                [MEMORIES_KEY]: [{ characters_involved: ['Bob'] }],
                [CHARACTERS_KEY]: { Bob: { name: 'Bob' } },
            };

            // Only scan last 2 messages, Bob is mentioned in first (not included)
            const result = detectPresentCharactersFromMessages(2);
            expect(result).not.toContain('Bob');
        });

        it('preserves original case from character states', () => {
            mockContext.chat = [
                { name: 'narrator', mes: 'ALICE arrived', is_system: false },
            ];
            mockContext.chatMetadata.openvault = {
                [MEMORIES_KEY]: [],
                [CHARACTERS_KEY]: { Alice: { name: 'Alice' } },
            };

            const result = detectPresentCharactersFromMessages(2);
            expect(result).toContain('Alice'); // original case, not 'ALICE' or 'alice'
        });
    });

    describe('getPOVContext', () => {
        it('returns single POV character in group chat', () => {
            mockContext.groupId = 'group-123';
            const result = getPOVContext();

            expect(result.isGroupChat).toBe(true);
            expect(result.povCharacters).toEqual(['Alice']);
        });

        it('detects characters in solo chat (narrator mode)', () => {
            mockContext.groupId = null;
            mockContext.chat = [
                { name: 'Bob', mes: 'Test', is_system: false },
            ];
            mockContext.chatMetadata.openvault = {
                [MEMORIES_KEY]: [],
                [CHARACTERS_KEY]: { Bob: { name: 'Bob' } },
            };

            const result = getPOVContext();

            expect(result.isGroupChat).toBe(false);
            expect(result.povCharacters).toContain('Bob');
        });

        it('falls back to context names when no characters detected', () => {
            mockContext.groupId = null;
            mockContext.chat = [];
            mockContext.chatMetadata.openvault = {
                [MEMORIES_KEY]: [],
                [CHARACTERS_KEY]: {},
            };

            const result = getPOVContext();

            expect(result.povCharacters).toContain('Alice');
            expect(result.povCharacters).toContain('User');
        });
    });
});
