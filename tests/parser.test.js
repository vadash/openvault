/**
 * Tests for src/extraction/parser.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import {
    parseExtractionResult,
    updateCharacterStatesFromEvents,
} from '../src/extraction/parser.js';
import { CHARACTERS_KEY, extensionName } from '../src/constants.js';

describe('parser', () => {
    let mockConsole;

    beforeEach(() => {
        mockConsole = {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        setDeps({
            console: mockConsole,
            getExtensionSettings: () => ({ [extensionName]: { debugMode: false } }),
            Date: { now: () => 1700000000000 },
        });
    });

    afterEach(() => {
        resetDeps();
    });

    describe('parseExtractionResult', () => {
        const mockMessages = [
            { id: 5, mes: 'Hello' },
            { id: 6, mes: 'World' },
        ];

        it('parses single event from JSON', () => {
            const json = JSON.stringify({
                summary: 'Alice greeted Bob',
                characters_involved: ['Alice', 'Bob'],
                importance: 3,
            });

            const events = parseExtractionResult(json, mockMessages, 'Alice', 'User', 'batch-1');

            expect(events).toHaveLength(1);
            expect(events[0].summary).toBe('Alice greeted Bob');
            expect(events[0].characters_involved).toEqual(['Alice', 'Bob']);
            expect(events[0].message_ids).toEqual([5, 6]);
            expect(events[0].batch_id).toBe('batch-1');
        });

        it('parses array of events', () => {
            const json = JSON.stringify([
                { summary: 'Event 1', importance: 2 },
                { summary: 'Event 2', importance: 4 },
            ]);

            const events = parseExtractionResult(json, mockMessages, 'Alice', 'User');
            expect(events).toHaveLength(2);
            expect(events[0].summary).toBe('Event 1');
            expect(events[1].summary).toBe('Event 2');
        });

        it('extracts JSON from markdown code block', () => {
            const json = '```json\n{"summary": "Test event"}\n```';
            const events = parseExtractionResult(json, mockMessages, 'Alice', 'User');
            expect(events[0].summary).toBe('Test event');
        });

        it('clamps importance to 1-5 range', () => {
            const events1 = parseExtractionResult(
                JSON.stringify({ summary: 'Low', importance: -5 }),
                mockMessages, 'Alice', 'User'
            );
            expect(events1[0].importance).toBe(1);

            const events2 = parseExtractionResult(
                JSON.stringify({ summary: 'High', importance: 100 }),
                mockMessages, 'Alice', 'User'
            );
            expect(events2[0].importance).toBe(5);
        });

        it('defaults importance to 3 when not provided', () => {
            const events = parseExtractionResult(
                JSON.stringify({ summary: 'Test' }),
                mockMessages, 'Alice', 'User'
            );
            expect(events[0].importance).toBe(3);
        });

        it('sets default values for missing fields', () => {
            const events = parseExtractionResult(
                JSON.stringify({ summary: 'Minimal' }),
                mockMessages, 'Alice', 'User'
            );

            expect(events[0].characters_involved).toEqual([]);
            expect(events[0].witnesses).toEqual([]);
            expect(events[0].location).toBe(null);
            expect(events[0].is_secret).toBe(false);
            expect(events[0].emotional_impact).toEqual({});
            expect(events[0].relationship_impact).toEqual({});
        });

        it('uses characters_involved as witnesses fallback', () => {
            const events = parseExtractionResult(
                JSON.stringify({
                    summary: 'Test',
                    characters_involved: ['Alice', 'Bob'],
                    // no witnesses field
                }),
                mockMessages, 'Alice', 'User'
            );

            expect(events[0].witnesses).toEqual(['Alice', 'Bob']);
        });

        it('calculates sequence from message IDs', () => {
            const events = parseExtractionResult(
                JSON.stringify([
                    { summary: 'First' },
                    { summary: 'Second' },
                ]),
                mockMessages, 'Alice', 'User'
            );

            // Min message ID is 5, so sequence = 5 * 1000 + index
            expect(events[0].sequence).toBe(5000);
            expect(events[1].sequence).toBe(5001);
        });

        it('returns empty array on parse error', () => {
            const events = parseExtractionResult(
                'invalid json {{{',
                mockMessages, 'Alice', 'User'
            );
            expect(events).toEqual([]);
        });

        it('generates unique IDs for each event', () => {
            let time = 1000;
            setDeps({
                console: mockConsole,
                getExtensionSettings: () => ({ [extensionName]: { debugMode: false } }),
                Date: { now: () => time++ },
            });

            const events = parseExtractionResult(
                JSON.stringify([{ summary: 'A' }, { summary: 'B' }]),
                mockMessages, 'Alice', 'User'
            );

            expect(events[0].id).toBeDefined();
            expect(events[1].id).toBeDefined();
            expect(events[0].id).not.toBe(events[1].id);
        });

        it('filters out events without summary field', () => {
            const json = JSON.stringify([
                { summary: 'Valid event', importance: 3 },
                { importance: 4 }, // Missing summary
                { summary: '', importance: 2 }, // Empty summary
                { summary: 'Another valid event', importance: 5 },
            ]);

            const events = parseExtractionResult(json, mockMessages, 'Alice', 'User');

            expect(events).toHaveLength(2);
            expect(events[0].summary).toBe('Valid event');
            expect(events[1].summary).toBe('Another valid event');
            expect(mockConsole.warn).toHaveBeenCalledWith(
                '[OpenVault] Filtered 2 events without summaries from LLM output'
            );
        });
    });

    describe('updateCharacterStatesFromEvents', () => {
        it('creates character state for new character', () => {
            const data = { [CHARACTERS_KEY]: {} };
            const events = [{
                id: 'evt-1',
                witnesses: ['Alice'],
                emotional_impact: {},
                message_ids: [1, 2],
            }];

            updateCharacterStatesFromEvents(events, data);

            expect(data[CHARACTERS_KEY]['Alice']).toEqual({
                name: 'Alice',
                current_emotion: 'neutral',
                emotion_intensity: 5,
                known_events: ['evt-1'],
            });
        });

        it('updates emotional state from emotional_impact', () => {
            const data = { [CHARACTERS_KEY]: {} };
            const events = [{
                id: 'evt-1',
                witnesses: ['Alice'],
                emotional_impact: { Alice: 'happy' },
                message_ids: [3, 4],
            }];

            updateCharacterStatesFromEvents(events, data);

            expect(data[CHARACTERS_KEY]['Alice'].current_emotion).toBe('happy');
            expect(data[CHARACTERS_KEY]['Alice'].emotion_from_messages).toEqual({ min: 3, max: 4 });
        });

        it('adds event to witness known_events', () => {
            const data = {
                [CHARACTERS_KEY]: {
                    Bob: {
                        name: 'Bob',
                        current_emotion: 'neutral',
                        emotion_intensity: 5,
                        known_events: ['existing-evt'],
                    }
                }
            };
            const events = [{
                id: 'new-evt',
                witnesses: ['Bob'],
                emotional_impact: {},
                message_ids: [1],
            }];

            updateCharacterStatesFromEvents(events, data);

            expect(data[CHARACTERS_KEY]['Bob'].known_events).toContain('existing-evt');
            expect(data[CHARACTERS_KEY]['Bob'].known_events).toContain('new-evt');
        });

        it('does not duplicate event IDs in known_events', () => {
            const data = {
                [CHARACTERS_KEY]: {
                    Bob: {
                        name: 'Bob',
                        current_emotion: 'neutral',
                        emotion_intensity: 5,
                        known_events: ['evt-1'],
                    }
                }
            };
            const events = [{ id: 'evt-1', witnesses: ['Bob'], emotional_impact: {}, message_ids: [] }];

            updateCharacterStatesFromEvents(events, data);

            expect(data[CHARACTERS_KEY]['Bob'].known_events.filter(e => e === 'evt-1')).toHaveLength(1);
        });

        it('handles multiple characters in single event', () => {
            const data = { [CHARACTERS_KEY]: {} };
            const events = [{
                id: 'evt-1',
                witnesses: ['Alice', 'Bob', 'Charlie'],
                emotional_impact: { Alice: 'sad', Bob: 'angry' },
                message_ids: [1],
            }];

            updateCharacterStatesFromEvents(events, data);

            expect(Object.keys(data[CHARACTERS_KEY])).toHaveLength(3);
            expect(data[CHARACTERS_KEY]['Alice'].current_emotion).toBe('sad');
            expect(data[CHARACTERS_KEY]['Bob'].current_emotion).toBe('angry');
            expect(data[CHARACTERS_KEY]['Charlie'].current_emotion).toBe('neutral');
        });

        it('initializes CHARACTERS_KEY if missing', () => {
            const data = {};
            const events = [{ id: 'evt-1', witnesses: ['Alice'], emotional_impact: {}, message_ids: [] }];

            updateCharacterStatesFromEvents(events, data);

            expect(data[CHARACTERS_KEY]).toBeDefined();
            expect(data[CHARACTERS_KEY]['Alice']).toBeDefined();
        });
    });
});
