/**
 * Tests for src/extraction/parser.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setDeps, resetDeps } from '../src/deps.js';
import {
    parseExtractionResult,
    updateCharacterStatesFromEvents,
    updateRelationshipsFromEvents,
} from '../src/extraction/parser.js';
import { CHARACTERS_KEY, RELATIONSHIPS_KEY, extensionName } from '../src/constants.js';

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

    describe('updateRelationshipsFromEvents', () => {
        it('creates new relationship from impact', () => {
            const data = { [RELATIONSHIPS_KEY]: {} };
            const events = [{
                id: 'evt-1',
                relationship_impact: {
                    'Alice->Bob': 'trust increased',
                },
            }];

            updateRelationshipsFromEvents(events, data);

            const key = 'Alice<->Bob';
            expect(data[RELATIONSHIPS_KEY][key]).toBeDefined();
            expect(data[RELATIONSHIPS_KEY][key].character_a).toBe('Alice');
            expect(data[RELATIONSHIPS_KEY][key].character_b).toBe('Bob');
            expect(data[RELATIONSHIPS_KEY][key].trust_level).toBe(6); // 5 + 1
        });

        it('decreases trust when impact mentions decrease', () => {
            const data = {
                [RELATIONSHIPS_KEY]: {
                    'Alice<->Bob': {
                        character_a: 'Alice',
                        character_b: 'Bob',
                        trust_level: 5,
                        tension_level: 0,
                        relationship_type: 'friend',
                        history: [],
                    }
                }
            };
            const events = [{
                id: 'evt-1',
                relationship_impact: { 'Alice->Bob': 'trust decreased significantly' },
            }];

            updateRelationshipsFromEvents(events, data);

            expect(data[RELATIONSHIPS_KEY]['Alice<->Bob'].trust_level).toBe(4);
        });

        it('increases tension when impact mentions increase', () => {
            const data = { [RELATIONSHIPS_KEY]: {} };
            const events = [{
                id: 'evt-1',
                relationship_impact: { 'Alice->Bob': 'tension increased' },
            }];

            updateRelationshipsFromEvents(events, data);

            expect(data[RELATIONSHIPS_KEY]['Alice<->Bob'].tension_level).toBe(1);
        });

        it('decreases tension when impact mentions decrease', () => {
            const data = {
                [RELATIONSHIPS_KEY]: {
                    'Alice<->Bob': {
                        character_a: 'Alice',
                        character_b: 'Bob',
                        trust_level: 5,
                        tension_level: 5,
                        relationship_type: 'friend',
                        history: [],
                    }
                }
            };
            const events = [{
                id: 'evt-1',
                relationship_impact: { 'Alice->Bob': 'tension decreased' },
            }];

            updateRelationshipsFromEvents(events, data);

            expect(data[RELATIONSHIPS_KEY]['Alice<->Bob'].tension_level).toBe(4);
        });

        it('clamps trust_level to 0-10 range', () => {
            const data = {
                [RELATIONSHIPS_KEY]: {
                    'Alice<->Bob': {
                        character_a: 'Alice',
                        character_b: 'Bob',
                        trust_level: 10,
                        tension_level: 0,
                        relationship_type: 'friend',
                        history: [],
                    }
                }
            };
            const events = [{
                id: 'evt-1',
                relationship_impact: { 'Alice->Bob': 'trust increased' },
            }];

            updateRelationshipsFromEvents(events, data);

            expect(data[RELATIONSHIPS_KEY]['Alice<->Bob'].trust_level).toBe(10); // capped at 10
        });

        it('clamps tension_level to 0-10 range', () => {
            const data = {
                [RELATIONSHIPS_KEY]: {
                    'Alice<->Bob': {
                        character_a: 'Alice',
                        character_b: 'Bob',
                        trust_level: 5,
                        tension_level: 0,
                        relationship_type: 'friend',
                        history: [],
                    }
                }
            };
            const events = [{
                id: 'evt-1',
                relationship_impact: { 'Alice->Bob': 'tension decreased' },
            }];

            updateRelationshipsFromEvents(events, data);

            expect(data[RELATIONSHIPS_KEY]['Alice<->Bob'].tension_level).toBe(0); // capped at 0
        });

        it('adds impact to relationship history', () => {
            const data = { [RELATIONSHIPS_KEY]: {} };
            const events = [{
                id: 'evt-1',
                relationship_impact: { 'Alice->Bob': 'they became closer' },
            }];

            updateRelationshipsFromEvents(events, data);

            expect(data[RELATIONSHIPS_KEY]['Alice<->Bob'].history).toHaveLength(1);
            expect(data[RELATIONSHIPS_KEY]['Alice<->Bob'].history[0]).toEqual({
                event_id: 'evt-1',
                impact: 'they became closer',
                timestamp: expect.any(Number),
                message_id: null,
            });
        });

        it('ignores malformed relationship keys', () => {
            const data = { [RELATIONSHIPS_KEY]: {} };
            const events = [{
                id: 'evt-1',
                relationship_impact: {
                    'invalid key': 'some impact',
                    'Alice->Bob': 'valid impact',
                },
            }];

            updateRelationshipsFromEvents(events, data);

            expect(Object.keys(data[RELATIONSHIPS_KEY])).toHaveLength(1);
            expect(data[RELATIONSHIPS_KEY]['Alice<->Bob']).toBeDefined();
        });

        it('handles events without relationship_impact', () => {
            const data = { [RELATIONSHIPS_KEY]: {} };
            const events = [{ id: 'evt-1', summary: 'No impact' }];

            updateRelationshipsFromEvents(events, data);

            expect(Object.keys(data[RELATIONSHIPS_KEY])).toHaveLength(0);
        });

        it('initializes RELATIONSHIPS_KEY if missing', () => {
            const data = {};
            const events = [{
                id: 'evt-1',
                relationship_impact: { 'Alice->Bob': 'impact' },
            }];

            updateRelationshipsFromEvents(events, data);

            expect(data[RELATIONSHIPS_KEY]).toBeDefined();
        });

        it('handles relationship key with spaces', () => {
            const data = { [RELATIONSHIPS_KEY]: {} };
            const events = [{
                id: 'evt-1',
                relationship_impact: { 'Alice Smith -> Bob Jones': 'trust increased' },
            }];

            updateRelationshipsFromEvents(events, data);

            const key = 'Alice Smith<->Bob Jones';
            expect(data[RELATIONSHIPS_KEY][key]).toBeDefined();
            expect(data[RELATIONSHIPS_KEY][key].character_a).toBe('Alice Smith');
            expect(data[RELATIONSHIPS_KEY][key].character_b).toBe('Bob Jones');
        });
    });
});
