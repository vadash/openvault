import { describe, expect, it } from 'vitest';
import {
    getExtractionJsonSchema,
    parseCommunitySummaryResponse,
    parseEvent,
    parseExtractionResponse,
    parseInsightExtractionResponse,
    parseSalientQuestionsResponse,
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
            events: [{ summary: 'Alice and Bob had a conversation about the kingdom', importance: 3, characters_involved: ['Alice'] }],
        });

        const result = parseExtractionResponse(json);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Alice and Bob had a conversation about the kingdom');
    });

    it('strips markdown code blocks', () => {
        const content =
            '```json\n{"reasoning": null, "events": [{"summary": "Alice encountered a mysterious stranger in the forest", "importance": 3, "characters_involved": []}]}\n```';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Alice encountered a mysterious stranger in the forest');
    });

    it('strips markdown without json language tag', () => {
        const content =
            '```\n{"reasoning": null, "events": [{"summary": "Bob discovered a hidden passage beneath the castle", "importance": 3, "characters_involved": []}]}\n```';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
    });

    it('throws on invalid JSON that jsonrepair cannot fix', () => {
        // Unmatched braces that jsonrepair can't repair
        expect(() => parseExtractionResponse('{{}')).toThrow('JSON parse failed');
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
            events: [{ summary: 'Alice walked through the garden and admired the flowers' }],
        });
        const result = parseExtractionResponse(minimal);
        expect(result.events[0].importance).toBe(3);
        expect(result.events[0].witnesses).toEqual([]);
        expect(result.events[0].location).toBe(null);
    });

    it('strips <reasoning> tags before parsing', () => {
        const content =
            '<reasoning>Let me analyze this conversation...</reasoning>\n{"reasoning": null, "events": [{"summary": "The King made an important announcement to the council", "importance": 3, "characters_involved": []}]}';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('The King made an important announcement to the council');
    });

    it('strips <thinking> tags before parsing', () => {
        const content =
            '<thinking>Analysis here</thinking>\n{"reasoning": null, "events": [{"summary": "Alice and Bob discussed their plans for the journey ahead", "importance": 3, "characters_involved": []}]}';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('Alice and Bob discussed their plans for the journey ahead');
    });

    it('handles both reasoning tags and markdown', () => {
        const content =
            '<reasoning>Thinking...</reasoning>\n```json\n{"reasoning": null, "events": [{"summary": "The royal guard patrolled the castle walls throughout the night", "importance": 3, "characters_involved": []}]}\n```';
        const result = parseExtractionResponse(content);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].summary).toBe('The royal guard patrolled the castle walls throughout the night');
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
            events: [{ summary: 'Alice confronted Bob about his secret meeting with the enemy', importance: 3, characters_involved: ['Alice'] }],
        });
        const result = parseExtractionResponse(json);
        expect(result.events[0].summary).toBe('Alice confronted Bob about his secret meeting with the enemy');
    });
});

describe('parseEvent', () => {
    it('parses single event without wrapper', () => {
        const json = JSON.stringify({
            summary: 'Alice discovered a hidden door behind the bookshelf',
            importance: 4,
            characters_involved: ['Bob'],
        });

        const result = parseEvent(json);
        expect(result.summary).toBe('Alice discovered a hidden door behind the bookshelf');
    });

    it('strips markdown for single event', () => {
        const content = '```json\n{"summary": "Bob found an ancient map in the dusty library", "importance": 3, "characters_involved": []}\n```';
        const result = parseEvent(content);
        expect(result.summary).toBe('Bob found an ancient map in the dusty library');
    });

    it('strips reasoning tags for single event', () => {
        const content =
            '<reasoning>Analyzing event...</reasoning>\n{"summary": "Alice climbed the tower to watch the sunset over the kingdom", "importance": 4, "characters_involved": ["Alice"]}';
        const result = parseEvent(content);
        expect(result.summary).toBe('Alice climbed the tower to watch the sunset over the kingdom');
        expect(result.importance).toBe(4);
    });
});

describe('Extended ExtractionResponseSchema', () => {
    it('parses response with entities and relationships', () => {
        const json = JSON.stringify({
            reasoning: null,
            events: [],
            entities: [{ name: 'Castle', type: 'PLACE', description: 'An ancient fortress' }],
            relationships: [{ source: 'King Aldric', target: 'Castle', description: 'Rules from the castle' }],
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
            entities: [{ name: 'Blob', type: 'INVALID_TYPE', description: 'Something' }],
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
            insights: [{ insight: 'The king fears betrayal', evidence_ids: ['ev_001', 'ev_002'] }],
        });
        const result = parseInsightExtractionResponse(json);
        expect(result.insights).toHaveLength(1);
        expect(result.insights[0].insight).toBe('The king fears betrayal');
        expect(result.insights[0].evidence_ids).toContain('ev_001');
    });
});

describe('CommunitySummarySchema', () => {
    it('parses a valid community summary', () => {
        const json = JSON.stringify({
            title: 'The Royal Court',
            summary: 'King Aldric rules from the Castle...',
            findings: ['The King fears betrayal', 'The Guard is loyal'],
        });
        const result = parseCommunitySummaryResponse(json);
        expect(result.title).toBe('The Royal Court');
        expect(result.summary).toBe('King Aldric rules from the Castle...');
        expect(result.findings).toHaveLength(2);
    });

    it('requires at least 1 finding', () => {
        const json = JSON.stringify({
            title: 'Empty',
            summary: 'Nothing',
            findings: [],
        });
        expect(() => parseCommunitySummaryResponse(json)).toThrow();
    });

    it('requires at most 5 findings', () => {
        const json = JSON.stringify({
            title: 'Too Many',
            summary: 'Too many findings',
            findings: ['a', 'b', 'c', 'd', 'e', 'f'],
        });
        expect(() => parseCommunitySummaryResponse(json)).toThrow();
    });

    it('requires non-empty title', () => {
        const json = JSON.stringify({
            title: '',
            summary: 'Something',
            findings: ['a'],
        });
        expect(() => parseCommunitySummaryResponse(json)).toThrow();
    });

    it('strips markdown and reasoning tags', () => {
        const content =
            '<reasoning>Analyzing...</reasoning>\n```json\n{"title": "Test", "summary": "A test community", "findings": ["fact1"]}\n```';
        const result = parseCommunitySummaryResponse(content);
        expect(result.title).toBe('Test');
        expect(result.findings).toHaveLength(1);
    });
});
