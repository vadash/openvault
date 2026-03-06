import { describe, expect, it } from 'vitest';
import {
    _testStripMarkdown,
    getEventExtractionJsonSchema,
    getGraphExtractionJsonSchema,
    parseCommunitySummaryResponse,
    parseEvent,
    parseEventExtractionResponse,
    parseGraphExtractionResponse,
    parseInsightExtractionResponse,
    parseSalientQuestionsResponse,
} from '../../src/extraction/structured.js';

describe('stripMarkdown edge cases', () => {
    it('strips unclosed opening fence', () => {
        const content = '```json\n{"events": []}';
        const result = _testStripMarkdown(content);
        expect(result).toBe('{"events": []}');
    });

    it('strips orphan closing fence', () => {
        const content = '{"events": []}\n```';
        const result = _testStripMarkdown(content);
        expect(result).toBe('{"events": []}');
    });

    it('strips opening fence without json label', () => {
        const content = '```\n{"events": []}';
        const result = _testStripMarkdown(content);
        expect(result).toBe('{"events": []}');
    });

    it('still strips complete fences', () => {
        const content = '```json\n{"events": []}\n```';
        const result = _testStripMarkdown(content);
        expect(result).toBe('{"events": []}');
    });

    it('passes through content without fences', () => {
        const content = '{"events": []}';
        const result = _testStripMarkdown(content);
        expect(result).toBe('{"events": []}');
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
        const content =
            '```json\n{"summary": "Bob found an ancient map in the dusty library", "importance": 3, "characters_involved": []}\n```';
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
    it('returns schema with events only', () => {
        const schema = getEventExtractionJsonSchema();
        expect(schema.name).toBe('EventExtraction');
        expect(schema.value.properties).toHaveProperty('events');
        expect(schema.value.properties).not.toHaveProperty('reasoning');
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
            events: [
                {
                    summary: 'A significant event happened in the story today',
                    importance: 3,
                    characters_involved: ['Alice'],
                    witnesses: [],
                    location: null,
                    is_secret: false,
                    emotional_impact: {},
                    relationship_impact: {},
                },
            ],
        });
        const result = parseEventExtractionResponse(json);
        expect(result.events).toHaveLength(1);
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
