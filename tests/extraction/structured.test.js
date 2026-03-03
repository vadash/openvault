import { describe, expect, it } from 'vitest';
import {
    getExtractionJsonSchema,
    parseEvent,
    parseExtractionResponse,
    parseSalientQuestionsResponse,
    parseInsightExtractionResponse,
} from '../../src/extraction/structured.js';

describe('smart retrieval removal', () => {
    it('does not export RetrievalResponseSchema', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.RetrievalResponseSchema).toBeUndefined();
    });

    it('does not export getRetrievalJsonSchema', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.getRetrievalJsonSchema).toBeUndefined();
    });

    it('does not export parseRetrievalResponse', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.parseRetrievalResponse).toBeUndefined();
    });
});

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

describe('Extended ExtractionResponseSchema', () => {
    it('parses response with entities and relationships', () => {
        const json = JSON.stringify({
            reasoning: null,
            events: [],
            entities: [
                { name: 'Castle', type: 'PLACE', description: 'An ancient fortress' }
            ],
            relationships: [
                { source: 'King Aldric', target: 'Castle', description: 'Rules from the castle' }
            ],
        });
        const result = parseExtractionResponse(json);
        expect(result.entities).toHaveLength(1);
        expect(result.entities[0].name).toBe('Castle');
        expect(result.entities[0].type).toBe('PLACE');
        expect(result.relationships).toHaveLength(1);
        expect(result.relationships[0].source).toBe('King Aldric');
    });

    it('defaults entities and relationships to empty arrays', () => {
        const json = JSON.stringify({
            reasoning: null,
            events: [],
        });
        const result = parseExtractionResponse(json);
        expect(result.entities).toEqual([]);
        expect(result.relationships).toEqual([]);
    });

    it('validates entity type enum', () => {
        const json = JSON.stringify({
            reasoning: null,
            events: [],
            entities: [
                { name: 'Blob', type: 'INVALID_TYPE', description: 'Something' }
            ],
            relationships: [],
        });
        expect(() => parseExtractionResponse(json)).toThrow();
    });

    it('includes entities and relationships in JSON schema output', () => {
        const schema = getExtractionJsonSchema();
        const props = schema.value.properties;
        expect(props).toHaveProperty('entities');
        expect(props).toHaveProperty('relationships');
        expect(props.entities.type).toBe('array');
        expect(props.relationships.type).toBe('array');
    });
});

describe('Reflection Schemas', () => {
    it('parses salient questions response with exactly 3 questions', () => {
        const json = JSON.stringify({
            questions: ['Why is the king paranoid?', 'Who does he trust?', 'What changed?'],
        });
        const result = parseSalientQuestionsResponse(json);
        expect(result.questions).toHaveLength(3);
    });

    it('rejects salient questions with wrong count', () => {
        const json = JSON.stringify({ questions: ['Only one'] });
        expect(() => parseSalientQuestionsResponse(json)).toThrow();
    });

    it('parses insight extraction response', () => {
        const json = JSON.stringify({
            insights: [
                { insight: 'The king fears betrayal', evidence_ids: ['ev_001', 'ev_002'] },
            ],
        });
        const result = parseInsightExtractionResponse(json);
        expect(result.insights).toHaveLength(1);
        expect(result.insights[0].insight).toBe('The king fears betrayal');
        expect(result.insights[0].evidence_ids).toContain('ev_001');
    });
});
