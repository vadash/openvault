import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getExtractionJsonSchema,
    getRetrievalJsonSchema,
    parseEvent,
    parseExtractionResponse,
    parseRetrievalResponse,
} from '../../src/extraction/structured.js';

describe('getExtractionJsonSchema', () => {
    it('returns ConnectionManager-compatible jsonSchema', () => {
        const schema = getExtractionJsonSchema();

        expect(schema).toMatchObject({
            name: 'MemoryExtraction',
            strict: true,
            value: expect.any(Object),
        });

        expect(schema.value).toHaveProperty('type', 'object');
        expect(schema.value).toHaveProperty('properties');
        expect(schema.value.properties).toHaveProperty('events');
    });

    it('generates valid JSON Schema Draft-04 structure', () => {
        const schema = getExtractionJsonSchema();

        // Check required fields exist in events property
        const eventsProp = schema.value.properties.events;
        expect(eventsProp).toHaveProperty('type', 'array');

        // Check that items schema has properties
        expect(eventsProp.items).toHaveProperty('type', 'object');
        expect(eventsProp.items).toHaveProperty('properties');
    });

    it('has reasoning as first property in schema', () => {
        const schema = getExtractionJsonSchema();
        const propKeys = Object.keys(schema.value.properties);
        expect(propKeys[0]).toBe('reasoning');
        expect(propKeys[1]).toBe('events');
    });
});

describe('parseExtractionResponse', () => {
    it('parses valid JSON response', () => {
        const json = JSON.stringify({
            reasoning: null,
            events: [{ summary: 'Test event', importance: 3, characters_involved: ['Alice'] }],
        });

        const result = parseExtractionResponse(json);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Test event');
    });

    it('strips markdown code blocks', () => {
        const content =
            '```json\n{"reasoning": null, "events": [{"summary": "Test", "importance": 3, "characters_involved": []}]}\n```';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Test');
    });

    it('strips markdown without json language tag', () => {
        const content =
            '```\n{"reasoning": null, "events": [{"summary": "Test", "importance": 3, "characters_involved": []}]}\n```';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
    });

    it('throws on invalid JSON', () => {
        expect(() => parseExtractionResponse('not json')).toThrow('JSON parse failed');
    });

    it('throws on schema validation failure', () => {
        const invalid = JSON.stringify({
            events: [
                { importance: 3, characters_involved: [] }, // missing summary
            ],
        });
        expect(() => parseExtractionResponse(invalid)).toThrow('Schema validation failed');
    });

    it('applies defaults from schema', () => {
        const minimal = JSON.stringify({
            reasoning: null,
            events: [{ summary: 'Test' }],
        });
        const result = parseExtractionResponse(minimal);
        expect(result.events[0].importance).toBe(3);
        expect(result.events[0].witnesses).toEqual([]);
        expect(result.events[0].location).toBe(null);
    });

    it('strips <reasoning> tags before parsing', () => {
        const content =
            '<reasoning>Let me analyze this conversation...</reasoning>\n{"reasoning": null, "events": [{"summary": "Test", "importance": 3, "characters_involved": []}]}';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Test');
    });

    it('strips <thinking> tags before parsing', () => {
        const content =
            '<thinking>Analysis here</thinking>\n{"reasoning": null, "events": [{"summary": "Event", "importance": 3, "characters_involved": []}]}';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Event');
    });

    it('handles both reasoning tags and markdown', () => {
        const content =
            '<reasoning>Thinking...</reasoning>\n```json\n{"reasoning": null, "events": [{"summary": "Test", "importance": 3, "characters_involved": []}]}\n```';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Test');
    });

    it('handles empty events array', () => {
        const content = '{"events": [], "reasoning": "No significant events found"}';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(0);
        expect(result.reasoning).toBe('No significant events found');
    });

    it('rejects legacy array format without events wrapper', () => {
        const content = '[{"summary": "Array event", "importance": 3, "characters_involved": ["Alice"]}]';
        expect(() => parseExtractionResponse(content)).toThrow('Schema validation failed');
    });

    it('parses events from response', () => {
        const json = JSON.stringify({
            reasoning: 'Test reasoning',
            events: [{ summary: 'Alice attacked Bob', importance: 3, characters_involved: ['Alice'] }],
        });
        const result = parseExtractionResponse(json);
        expect(result.events[0].summary).toBe('Alice attacked Bob');
    });
});

describe('parseEvent', () => {
    it('parses single event without wrapper', () => {
        const json = JSON.stringify({
            summary: 'Single event',
            importance: 4,
            characters_involved: ['Bob'],
        });

        const result = parseEvent(json);
        expect(result.summary).toBe('Single event');
    });

    it('strips markdown for single event', () => {
        const content = '```json\n{"summary": "Event", "importance": 3, "characters_involved": []}\n```';
        const result = parseEvent(content);
        expect(result.summary).toBe('Event');
    });

    it('strips reasoning tags for single event', () => {
        const content =
            '<reasoning>Analyzing event...</reasoning>\n{"summary": "Event", "importance": 4, "characters_involved": ["Alice"]}';
        const result = parseEvent(content);
        expect(result.summary).toBe('Event');
        expect(result.importance).toBe(4);
    });
});

describe('getRetrievalJsonSchema', () => {
    it('returns ConnectionManager-compatible jsonSchema', () => {
        const schema = getRetrievalJsonSchema();
        expect(schema).toMatchObject({
            name: 'MemoryRetrieval',
            strict: true,
            value: expect.any(Object),
        });
        expect(schema.value).toHaveProperty('type', 'object');
        expect(schema.value.properties).toHaveProperty('reasoning');
        expect(schema.value.properties).toHaveProperty('selected');
    });

    it('has reasoning as first property', () => {
        const schema = getRetrievalJsonSchema();
        const propKeys = Object.keys(schema.value.properties);
        expect(propKeys[0]).toBe('reasoning');
    });

    it('selected is array of positive integers', () => {
        const schema = getRetrievalJsonSchema();
        const selectedProp = schema.value.properties.selected;
        expect(selectedProp.type).toBe('array');
    });
});

describe('parseRetrievalResponse', () => {
    it('parses valid retrieval response', () => {
        const json = JSON.stringify({ reasoning: 'Chose based on scene', selected: [1, 3, 5] });
        const result = parseRetrievalResponse(json);
        expect(result.selected).toEqual([1, 3, 5]);
        expect(result.reasoning).toBe('Chose based on scene');
    });

    it('handles null reasoning', () => {
        const json = JSON.stringify({ reasoning: null, selected: [2] });
        const result = parseRetrievalResponse(json);
        expect(result.reasoning).toBeNull();
        expect(result.selected).toEqual([2]);
    });

    it('handles empty selected array', () => {
        const json = JSON.stringify({ reasoning: 'Nothing relevant', selected: [] });
        const result = parseRetrievalResponse(json);
        expect(result.selected).toEqual([]);
    });

    it('strips markdown before parsing', () => {
        const content = '```json\n{"reasoning": null, "selected": [1]}\n```';
        const result = parseRetrievalResponse(content);
        expect(result.selected).toEqual([1]);
    });

    it('throws on invalid JSON', () => {
        expect(() => parseRetrievalResponse('not json')).toThrow('JSON parse failed');
    });

    it('throws on missing selected field', () => {
        const json = JSON.stringify({ reasoning: 'test' });
        expect(() => parseRetrievalResponse(json)).toThrow('Schema validation failed');
    });
});
