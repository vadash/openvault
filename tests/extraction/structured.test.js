import { describe, expect, it } from 'vitest';
import {
    getEventExtractionJsonSchema,
    getGraphExtractionJsonSchema,
    parseCommunitySummaryResponse,
    parseEvent,
    parseEventExtractionResponse,
    parseGraphExtractionResponse,
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

describe('getEventExtractionJsonSchema', () => {
    it('returns schema with reasoning and events only', () => {
        const schema = getEventExtractionJsonSchema();
        expect(schema.name).toBe('EventExtraction');
        expect(schema.value.properties).toHaveProperty('events');
        expect(schema.value.properties).toHaveProperty('reasoning');
        expect(schema.value.properties).not.toHaveProperty('entities');
        expect(schema.value.properties).not.toHaveProperty('relationships');
    });
});

describe('getGraphExtractionJsonSchema', () => {
    it('returns schema with entities and relationships only', () => {
        const schema = getGraphExtractionJsonSchema();
        expect(schema.name).toBe('GraphExtraction');
        expect(schema.value.properties).toHaveProperty('entities');
        expect(schema.value.properties).toHaveProperty('relationships');
        expect(schema.value.properties).not.toHaveProperty('events');
    });
});

describe('parseEventExtractionResponse', () => {
    it('parses valid event extraction JSON', () => {
        const json = JSON.stringify({
            reasoning: 'test reasoning',
            events: [{
                summary: 'A significant event happened in the story today',
                importance: 3,
                characters_involved: ['Alice'],
                witnesses: [],
                location: null,
                is_secret: false,
                emotional_impact: {},
                relationship_impact: {},
            }],
        });
        const result = parseEventExtractionResponse(json);
        expect(result.events).toHaveLength(1);
        expect(result.reasoning).toBe('test reasoning');
    });
});

describe('parseGraphExtractionResponse', () => {
    it('parses valid graph extraction JSON', () => {
        const json = JSON.stringify({
            entities: [{ name: 'Alice', type: 'PERSON', description: 'A character' }],
            relationships: [{ source: 'Alice', target: 'Bob', description: 'Friends' }],
        });
        const result = parseGraphExtractionResponse(json);
        expect(result.entities).toHaveLength(1);
        expect(result.relationships).toHaveLength(1);
    });
});

describe('legacy extraction API removed', () => {
    it('does not export ExtractionResponseSchema', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.ExtractionResponseSchema).toBeUndefined();
    });

    it('does not export getExtractionJsonSchema', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.getExtractionJsonSchema).toBeUndefined();
    });

    it('does not export parseExtractionResponse', async () => {
        const module = await import('../../src/extraction/structured.js');
        expect(module.parseExtractionResponse).toBeUndefined();
    });
});
