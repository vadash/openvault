import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
    _testStripMarkdown,
    GlobalSynthesisSchema,
    getEventExtractionJsonSchema,
    getGraphExtractionJsonSchema,
    parseCommunitySummaryResponse,
    parseConsolidationResponse,
    parseEvent,
    parseEventExtractionResponse,
    parseGlobalSynthesisResponse,
    parseGraphExtractionResponse,
    parseStructuredResponse,
    parseUnifiedReflectionResponse,
} from '../../src/extraction/structured.js';

// --- Lazy Exit Tests (Empty Output After Thinking Tags) ---
describe('parseEventExtractionResponse - lazy exits', () => {
    it.each([
        ['<think>analysis here</think>', 'think tag only'],
        ['<thinking>analysis here</thinking>', 'thinking tag only'],
        ['<reasoning>analysis here</reasoning>', 'reasoning tag only'],
        ['   ', 'whitespace only'],
        ['\t\n  ', 'mixed whitespace'],
    ])('returns empty events for %s (%s)', (input, _label) => {
        const result = parseEventExtractionResponse(input);
        expect(result).toEqual({ events: [] });
    });
});

describe('parseGraphExtractionResponse - lazy exits', () => {
    it.each([
        ['<think>analysis here</think>', 'think tag only'],
        ['<thinking>analysis here</thinking>', 'thinking tag only'],
        ['<reasoning>analysis here</reasoning>', 'reasoning tag only'],
        ['   ', 'whitespace only'],
        ['\t\n  ', 'mixed whitespace'],
    ])('returns empty entities/relationships for %s (%s)', (input, _label) => {
        const result = parseGraphExtractionResponse(input);
        expect(result).toEqual({ entities: [], relationships: [] });
    });
});

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

    it('recovers when LLM returns single-element array instead of object', () => {
        const json = JSON.stringify([
            {
                title: 'The Royal Court',
                summary: 'King Aldric rules from the Castle...',
                findings: ['The King fears betrayal', 'The Guard is loyal'],
            },
        ]);
        const result = parseCommunitySummaryResponse(json);
        expect(result.title).toBe('The Royal Court');
        expect(result.findings).toHaveLength(2);
    });

    it('recovers when LLM returns multi-element array (uses first)', () => {
        const json = JSON.stringify([
            {
                title: 'First Community',
                summary: 'The main group of characters',
                findings: ['Finding one'],
            },
            {
                title: 'Second Community',
                summary: 'Should be ignored',
                findings: ['Ignored'],
            },
        ]);
        const result = parseCommunitySummaryResponse(json);
        expect(result.title).toBe('First Community');
    });

    it('throws on empty array from LLM', () => {
        const json = '[]';
        expect(() => parseCommunitySummaryResponse(json)).toThrow('LLM returned empty array');
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

    it('accepts event summary with 20-29 characters (concise non-English)', () => {
        const json = JSON.stringify({
            events: [
                {
                    summary: 'Саша дала Вове пощечину', // 23 chars — valid concise Russian event
                    importance: 3,
                    characters_involved: ['Саша', 'Вова'],
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
        expect(result.events[0].summary).toBe('Саша дала Вове пощечину');
    });

    it('rejects event summary under 20 characters', () => {
        const json = JSON.stringify({
            events: [
                {
                    summary: 'Too short event', // 15 chars — should fail
                    importance: 3,
                    characters_involved: [],
                    witnesses: [],
                    location: null,
                    is_secret: false,
                    emotional_impact: {},
                    relationship_impact: {},
                },
            ],
        });
        const result = parseEventExtractionResponse(json);
        expect(result.events).toHaveLength(0); // per-event salvage discards invalid
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

describe('UnifiedReflectionSchema', () => {
    it('parses unified reflection response with question and insight', () => {
        const raw = JSON.stringify({
            reflections: [
                {
                    question: 'Why is Alice hiding the truth?',
                    insight: 'Alice is protecting Bob from painful knowledge',
                    evidence_ids: ['ev_001', 'ev_005'],
                },
            ],
        });
        const result = parseUnifiedReflectionResponse(raw);
        expect(result.reflections).toHaveLength(1);
        expect(result.reflections[0].question).toBe('Why is Alice hiding the truth?');
        expect(result.reflections[0].insight).toBe('Alice is protecting Bob from painful knowledge');
        expect(result.reflections[0].evidence_ids).toEqual(['ev_001', 'ev_005']);
    });

    it('accepts 1-3 reflections (not strictly 3)', () => {
        const raw = JSON.stringify({
            reflections: [{ question: 'Q1', insight: 'I1', evidence_ids: ['ev_001'] }],
        });
        const result = parseUnifiedReflectionResponse(raw);
        expect(result.reflections).toHaveLength(1);
    });
});

describe('Global Synthesis Schema', () => {
    it('should validate correct global synthesis response', () => {
        const input = '{"global_summary": "The story has evolved from initial meeting to deep conflict..."}';
        const result = parseGlobalSynthesisResponse(input);
        expect(result).toEqual({ global_summary: 'The story has evolved from initial meeting to deep conflict...' });
    });

    it('should enforce min length constraint', () => {
        const tooShort = { global_summary: 'Too short' };
        const result1 = GlobalSynthesisSchema.safeParse(tooShort);
        expect(result1.success).toBe(false);

        // Valid length
        const valid = { global_summary: 'A'.repeat(100) };
        const result2 = GlobalSynthesisSchema.safeParse(valid);
        expect(result2.success).toBe(true);
    });

    it('recovers bare string as global_summary', () => {
        const bare = JSON.stringify(
            'The story has evolved from initial meeting to deep conflict across multiple chapters'
        );
        const result = parseGlobalSynthesisResponse(bare);
        expect(result).toEqual({
            global_summary: 'The story has evolved from initial meeting to deep conflict across multiple chapters',
        });
    });

    it('recovers bare string in single-element array as global_summary', () => {
        const wrapped = JSON.stringify([
            'The story has evolved from initial meeting to deep conflict across many chapters',
        ]);
        const result = parseGlobalSynthesisResponse(wrapped);
        expect(result.global_summary).toBe(
            'The story has evolved from initial meeting to deep conflict across many chapters'
        );
    });
});

describe('parseConsolidationResponse', () => {
    it('parses valid edge consolidation response', () => {
        const json = JSON.stringify({ consolidated_description: 'Alice and Bob have a deep bond built on trust' });
        const result = parseConsolidationResponse(json);
        expect(result.consolidated_description).toBe('Alice and Bob have a deep bond built on trust');
    });

    it('recovers bare string as consolidated_description', () => {
        const bare = JSON.stringify('Alice and Bob share mutual trust after years of friendship');
        const result = parseConsolidationResponse(bare);
        expect(result).toEqual({
            consolidated_description: 'Alice and Bob share mutual trust after years of friendship',
        });
    });

    it('recovers bare string inside single-element array', () => {
        const wrapped = JSON.stringify(['Alice and Bob reconciled after a long period of tension and distrust']);
        const result = parseConsolidationResponse(wrapped);
        expect(result.consolidated_description).toBe(
            'Alice and Bob reconciled after a long period of tension and distrust'
        );
    });

    it('throws on empty string', () => {
        const empty = JSON.stringify('');
        expect(() => parseConsolidationResponse(empty)).toThrow();
    });
});

describe('parseStructuredResponse - tool call unwrapping', () => {
    const testSchema = z.object({
        events: z.array(z.string()),
    });

    it('unwraps object with "name" and "arguments" keys', () => {
        const json = JSON.stringify({ name: 'extract', arguments: { events: [] } });
        const result = parseStructuredResponse(json, testSchema);
        expect(result).toEqual({ events: [] });
    });

    it('unwraps object with "tool" and "arguments" keys', () => {
        const json = JSON.stringify({ tool: 'extract', arguments: { events: ['a', 'b'] } });
        const result = parseStructuredResponse(json, testSchema);
        expect(result).toEqual({ events: ['a', 'b'] });
    });

    it('unwraps object with "function" and "arguments" keys', () => {
        const json = JSON.stringify({ function: 'x', arguments: { events: [] } });
        const result = parseStructuredResponse(json, testSchema);
        expect(result).toEqual({ events: [] });
    });

    it('unwraps and re-parses when arguments is a JSON string', () => {
        const json = JSON.stringify({ tool: 'extract', arguments: '{"events": ["event1", "event2"]}' });
        const result = parseStructuredResponse(json, testSchema);
        expect(result).toEqual({ events: ['event1', 'event2'] });
    });

    it('passes through normal objects without tool keys', () => {
        const json = JSON.stringify({ events: ['normal'] });
        const result = parseStructuredResponse(json, testSchema);
        expect(result).toEqual({ events: ['normal'] });
    });

    it('does not unwrap arrays (even if they have tool-like structure)', () => {
        const json = JSON.stringify([{ events: ['array-item'] }]);
        // Should trigger array unwrapping, not tool unwrapping
        const result = parseStructuredResponse(json, testSchema);
        expect(result).toEqual({ events: ['array-item'] });
    });
});
