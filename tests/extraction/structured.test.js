import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getExtractionJsonSchema,
    parseExtractionResponse,
    parseEvent,
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
});

describe('parseExtractionResponse', () => {
    it('parses valid JSON response', () => {
        const json = JSON.stringify({
            events: [
                { summary: 'Test event', importance: 3, characters_involved: ['Alice'] }
            ],
            reasoning: null,
        });

        const result = parseExtractionResponse(json);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Test event');
    });

    it('strips markdown code blocks', () => {
        const content = '```json\n{"events": [{"summary": "Test", "importance": 3, "characters_involved": []}], "reasoning": null}\n```';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Test');
    });

    it('strips markdown without json language tag', () => {
        const content = '```\n{"events": [{"summary": "Test", "importance": 3, "characters_involved": []}], "reasoning": null}\n```';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
    });

    it('throws on invalid JSON', () => {
        expect(() => parseExtractionResponse('not json')).toThrow('JSON parse failed');
    });

    it('throws on schema validation failure', () => {
        const invalid = JSON.stringify({
            events: [
                { importance: 3, characters_involved: [] } // missing summary
            ]
        });
        expect(() => parseExtractionResponse(invalid)).toThrow('Schema validation failed');
    });

    it('applies defaults from schema', () => {
        const minimal = JSON.stringify({
            events: [
                { summary: 'Test' }
            ]
        });
        const result = parseExtractionResponse(minimal);
        expect(result.events[0].importance).toBe(3);
        expect(result.events[0].witnesses).toEqual([]);
        expect(result.events[0].location).toBe(null);
    });

    it('strips <reasoning> tags before parsing', () => {
        const content = '<reasoning>Let me analyze this conversation...</reasoning>\n{"events": [{"summary": "Test", "importance": 3, "characters_involved": []}], "reasoning": null}';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Test');
    });

    it('strips <thinking> tags before parsing', () => {
        const content = '<thinking>Analysis here</thinking>\n{"events": [{"summary": "Event", "importance": 3, "characters_involved": []}], "reasoning": null}';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Event');
    });

    it('handles both reasoning tags and markdown', () => {
        const content = '<reasoning>Thinking...</reasoning>\n```json\n{"events": [{"summary": "Test", "importance": 3, "characters_involved": []}], "reasoning": null}\n```';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Test');
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
        const content = '<reasoning>Analyzing event...</reasoning>\n{"summary": "Event", "importance": 4, "characters_involved": ["Alice"]}';
        const result = parseEvent(content);
        expect(result.summary).toBe('Event');
        expect(result.importance).toBe(4);
    });
});
