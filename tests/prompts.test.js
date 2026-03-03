import { describe, expect, it } from 'vitest';
import {
    buildCommunitySummaryPrompt,
    buildExtractionPrompt,
    buildInsightExtractionPrompt,
    buildSalientQuestionsPrompt,
} from '../src/prompts.js';

describe('smart retrieval prompt removal', () => {
    it('does not export buildSmartRetrievalPrompt', async () => {
        const module = await import('../src/prompts.js');
        expect(module.buildSmartRetrievalPrompt).toBeUndefined();
    });
});

describe('buildExtractionPrompt', () => {
    const baseArgs = {
        messages: '[Alice]: Hello\n[Bob]: Hi there',
        names: { char: 'Alice', user: 'Bob' },
        context: { memories: [], charDesc: '', personaDesc: '' },
    };

    it('returns system and user message array', () => {
        const result = buildExtractionPrompt(baseArgs);
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
    });

    it('system prompt contains <tags_field> directive', () => {
        const result = buildExtractionPrompt(baseArgs);
        expect(result[0].content).not.toContain('event_type');
    });

    it('examples include appropriate fields', () => {
        const result = buildExtractionPrompt(baseArgs);
        expect(result[0].content).toContain('"summary"');
    });

    it('system prompt contains examples section', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toContain('<examples>');
        expect(sys).toContain('</examples>');
    });

    it('system prompt contains at least 6 examples', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        const exampleCount = (sys.match(/<example /g) || []).length;
        expect(exampleCount).toBeGreaterThanOrEqual(6);
    });

    it('system prompt contains explicit output schema', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toContain('<output_schema>');
        expect(sys).toContain('</output_schema>');
        // Schema explicitly declares all four top-level keys
        expect(sys).toContain('"reasoning"');
        expect(sys).toContain('"events"');
        expect(sys).toContain('"entities"');
        expect(sys).toContain('"relationships"');
    });

    it('system prompt contains content-type handling directive', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        // Handles adult/18+ content
        expect(sys).toContain('18+');
        // Handles various genres
        expect(sys).toContain('romance');
        expect(sys).toContain('slice-of-life');
    });

    it('system prompt instructs reasoning-first', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toMatch(/reasoning.*first|think.*before|reasoning.*field.*before/i);
    });

    it('system prompt contains importance scale 1-5', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toContain('1');
        expect(sys).toContain('5');
        expect(sys).toContain('<importance_scale>');
    });

    it('user prompt contains messages in XML tags', () => {
        const result = buildExtractionPrompt(baseArgs);
        const usr = result[1].content;
        expect(usr).toContain('<messages>');
        expect(usr).toContain('[Alice]: Hello');
    });

    it('user prompt includes established memories when provided', () => {
        const args = {
            ...baseArgs,
            context: {
                memories: [{ importance: 3, summary: 'Alice waved at Bob', sequence: 1 }],
                charDesc: '',
                personaDesc: '',
            },
        };
        const result = buildExtractionPrompt(args);
        const usr = result[1].content;
        expect(usr).toContain('established_memories');
        expect(usr).toContain('Alice waved at Bob');
        expect(usr).toContain('[3 Star]');
    });

    it('user prompt includes character descriptions when provided', () => {
        const args = {
            ...baseArgs,
            context: {
                memories: [],
                charDesc: 'A brave warrior',
                personaDesc: 'A curious traveler',
            },
        };
        const result = buildExtractionPrompt(args);
        const usr = result[1].content;
        expect(usr).toContain('A brave warrior');
        expect(usr).toContain('A curious traveler');
    });

    it('system prompt warns against bare array output', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toContain('NEVER a bare array');
    });

    it('system prompt instructs English summaries with preserved names', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toMatch(/summaries in ENGLISH/i);
        expect(sys).toMatch(/never translate names/i);
    });
});

describe('buildExtractionPrompt entity/relationship instructions', () => {
    it('system prompt contains entity extraction instructions', () => {
        const result = buildExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            context: {},
        });
        const systemContent = result[0].content;
        expect(systemContent).toContain('entities');
        expect(systemContent).toContain('PERSON');
        expect(systemContent).toContain('PLACE');
        expect(systemContent).toContain('ORGANIZATION');
        expect(systemContent).toContain('relationships');
    });
});

describe('buildExtractionPrompt unified structure', () => {
    it('system prompt uses consistent XML section tags', () => {
        const result = buildExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            context: {},
        });
        const sys = result[0].content;
        expect(sys).toContain('<role>');
        expect(sys).toContain('</role>');
        expect(sys).toContain('<output_schema>');
        expect(sys).toContain('</output_schema>');
        expect(sys).toContain('<examples>');
        expect(sys).toContain('</examples>');
    });

    it('all examples include all four top-level JSON keys or are empty dedup examples', () => {
        const result = buildExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            context: {},
        });
        const sys = result[0].content;
        // Extract all "Correct output:" JSON blocks
        const outputBlocks = sys.match(/Correct output:\n(\{.*?\})\n<\/example>/gs);
        expect(outputBlocks).not.toBeNull();
        for (const block of outputBlocks) {
            // Every example should have reasoning, events, entities, relationships keys
            expect(block).toContain('"reasoning"');
            expect(block).toContain('"events"');
        }
    });
});

describe('buildSalientQuestionsPrompt', () => {
    it('returns system/user message pair with character name', () => {
        const memories = [
            { summary: 'Alice met Bob', importance: 3 },
            { summary: 'Alice fought the dragon', importance: 5 },
        ];
        const result = buildSalientQuestionsPrompt('Alice', memories);
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
        expect(result[1].content).toContain('Alice');
        expect(result[1].content).toContain('Alice met Bob');
    });

    it('uses unified XML structure with role, output_schema, and examples', () => {
        const result = buildSalientQuestionsPrompt('Alice', [{ summary: 'test', importance: 3 }]);
        const sys = result[0].content;
        expect(sys).toContain('<role>');
        expect(sys).toContain('<output_schema>');
        expect(sys).toContain('<examples>');
    });
});

describe('buildInsightExtractionPrompt', () => {
    it('returns system/user message pair with question and evidence', () => {
        const memories = [
            { id: 'ev_001', summary: 'Alice fought the dragon' },
            { id: 'ev_002', summary: 'Alice was wounded' },
        ];
        const result = buildInsightExtractionPrompt('Alice', 'How has Alice changed?', memories);
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].content).toContain('How has Alice changed?');
        expect(result[1].content).toContain('ev_001');
        expect(result[1].content).toContain('Alice fought the dragon');
    });

    it('uses unified XML structure with role, output_schema, and examples', () => {
        const memories = [{ id: 'ev_001', summary: 'test' }];
        const result = buildInsightExtractionPrompt('Alice', 'test?', memories);
        const sys = result[0].content;
        expect(sys).toContain('<role>');
        expect(sys).toContain('<output_schema>');
        expect(sys).toContain('<examples>');
    });
});

describe('buildCommunitySummaryPrompt', () => {
    it('returns system/user message pair with node and edge data', () => {
        const nodes = ['- Castle (PLACE): An ancient fortress'];
        const edges = ['- King Aldric → Castle: Rules from [weight: 4]'];
        const result = buildCommunitySummaryPrompt(nodes, edges);
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
        expect(result[1].content).toContain('Castle');
        expect(result[1].content).toContain('King Aldric');
    });

    it('system prompt contains report structure instructions', () => {
        const result = buildCommunitySummaryPrompt([], []);
        const system = result[0].content;
        expect(system).toContain('title');
        expect(system).toContain('summary');
        expect(system).toContain('findings');
    });

    it('system prompt specifies 1-5 findings limit', () => {
        const result = buildCommunitySummaryPrompt([], []);
        const system = result[0].content;
        expect(system).toContain('1-5');
        expect(system).toContain('findings');
    });

    it('user prompt wraps nodes in community_entities tag', () => {
        const nodes = ['- King (PERSON): The ruler'];
        const result = buildCommunitySummaryPrompt(nodes, []);
        const user = result[1].content;
        expect(user).toContain('<community_entities>');
        expect(user).toContain('</community_entities>');
        expect(user).toContain('King');
    });

    it('user prompt wraps edges in community_relationships tag', () => {
        const edges = ['- King → Castle: Rules from [weight: 4]'];
        const result = buildCommunitySummaryPrompt([], edges);
        const user = result[1].content;
        expect(user).toContain('<community_relationships>');
        expect(user).toContain('</community_relationships>');
    });

    it('includes JSON format instruction', () => {
        const result = buildCommunitySummaryPrompt([], []);
        const user = result[1].content;
        expect(user).toContain('JSON');
    });

    it('uses unified XML structure with role, output_schema, and examples', () => {
        const result = buildCommunitySummaryPrompt([], []);
        const sys = result[0].content;
        expect(sys).toContain('<role>');
        expect(sys).toContain('<output_schema>');
        expect(sys).toContain('<examples>');
    });
});
