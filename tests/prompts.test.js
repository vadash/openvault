import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/constants.js';
import {
    buildCommunitySummaryPrompt,
    buildEventExtractionPrompt,
    buildGraphExtractionPrompt,
    buildInsightExtractionPrompt,
    buildSalientQuestionsPrompt,
    PREFILL_PRESETS,
    SYSTEM_PREAMBLE_CN,
    SYSTEM_PREAMBLE_EN,
} from '../src/prompts.js';

describe('buildSalientQuestionsPrompt', () => {
    it('returns system/user message pair with character name', () => {
        const memories = [
            { summary: 'Alice met Bob', importance: 3 },
            { summary: 'Alice fought the dragon', importance: 5 },
        ];
        const result = buildSalientQuestionsPrompt('Alice', memories);
        expect(result).toHaveLength(3);
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
        expect(result).toHaveLength(3);
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

    it('insight extraction prompt limits insights to 1-3', () => {
        const memories = [{ id: 'ev_1', summary: 'Alice did something' }];
        const result = buildInsightExtractionPrompt('Alice', 'How is Alice?', memories);
        const systemContent = result[0].content;
        expect(systemContent).toContain('1 to 3');
        expect(systemContent).not.toContain('1 to 5');
    });
});

describe('buildCommunitySummaryPrompt', () => {
    it('returns system/user message pair with node and edge data', () => {
        const nodes = ['- Castle (PLACE): An ancient fortress'];
        const edges = ['- King Aldric → Castle: Rules from [weight: 4]'];
        const result = buildCommunitySummaryPrompt(nodes, edges);
        expect(result).toHaveLength(3);
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

describe('buildEventExtractionPrompt', () => {
    it('returns message array with system and user roles', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello world',
            names: { char: 'Alice', user: 'Bob' },
            context: {},
        });
        expect(result).toHaveLength(3);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
    });

    it('does NOT mention entities or relationships in system prompt', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            context: {},
        });
        const systemContent = result[0].content;
        expect(systemContent).not.toContain('"entities"');
        expect(systemContent).not.toContain('"relationships"');
    });
});

describe('buildEventExtractionPrompt output conventions', () => {
    const baseArgs = {
        messages: '[TestUser]: Hello world',
        names: { char: 'TestChar', user: 'TestUser' },
        context: {},
    };

    it('uses <think> tags instead of <reasoning>', () => {
        const result = buildEventExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toContain('<think>');
        expect(sys).not.toMatch(/<reasoning>/);
    });

    it('instructs scene continuation suppression in dedup rules', () => {
        const result = buildEventExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toContain('scene concludes');
        expect(sys).toContain('power dynamic fundamentally reverses');
        expect(sys).toContain('safeword is explicitly used');
    });

    it('does not mandate minimum importance of 4 for routine intimate acts', () => {
        const result = buildEventExtractionPrompt(baseArgs);
        const sys = result[0].content;
        // Old: "MANDATORY MINIMUM of 4 for: any first sexual act"
        expect(sys).not.toContain('MANDATORY MINIMUM');
    });

    it('instructs raw JSON output without markdown', () => {
        const result = buildEventExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toContain('Start your response with {');
    });
});

describe('all prompts use raw JSON instruction', () => {
    it('graph extraction prompt forbids markdown wrapping', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[TestUser]: Hello',
            names: { char: 'TestChar', user: 'TestUser' },
        });
        const sys = result[0].content;
        expect(sys).toContain('Do NOT wrap output in markdown code blocks');
    });

    it('salient questions prompt forbids markdown wrapping', () => {
        const result = buildSalientQuestionsPrompt('TestChar', [{ summary: 'test', importance: 3 }]);
        const sys = result[0].content;
        expect(sys).toContain('Do NOT wrap output in markdown code blocks');
    });

    it('insight extraction prompt forbids markdown wrapping', () => {
        const result = buildInsightExtractionPrompt('TestChar', 'test?', [{ id: 'ev_1', summary: 'test' }]);
        const sys = result[0].content;
        expect(sys).toContain('Do NOT wrap output in markdown code blocks');
    });

    it('community summary prompt forbids markdown wrapping', () => {
        const result = buildCommunitySummaryPrompt(['Node A'], ['A -> B']);
        const sys = result[0].content;
        expect(sys).toContain('Do NOT wrap output in markdown code blocks');
    });
});

describe('buildGraphExtractionPrompt', () => {
    it('returns message array with system and user roles', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[Alice]: Hello world',
            names: { char: 'Alice', user: 'Bob' },
            extractedEvents: ['Alice greeted Bob warmly'],
            context: {},
        });
        expect(result).toHaveLength(3);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
    });

    it('includes extracted events in user prompt', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            extractedEvents: ['Alice greeted Bob warmly'],
            context: {},
        });
        const userContent = result[1].content;
        expect(userContent).toContain('Alice greeted Bob warmly');
    });

    it('does NOT mention events schema in system prompt', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            extractedEvents: [],
            context: {},
        });
        const systemContent = result[0].content;
        expect(systemContent).not.toContain('"importance"');
        expect(systemContent).not.toContain('"is_secret"');
    });
});

describe('CN preamble and assistant prefill', () => {
    it('all prompts include CN system preamble in system message', () => {
        const eventResult = buildEventExtractionPrompt({
            messages: '[A]: test',
            names: { char: 'A', user: 'B' },
            context: {},
        });
        const graphResult = buildGraphExtractionPrompt({
            messages: '[A]: test',
            names: { char: 'A', user: 'B' },
        });
        const salientResult = buildSalientQuestionsPrompt('A', [{ summary: 'test', importance: 3 }]);
        const insightResult = buildInsightExtractionPrompt('A', 'q?', [{ id: '1', summary: 't' }]);
        const communityResult = buildCommunitySummaryPrompt([], []);

        for (const result of [eventResult, graphResult, salientResult, insightResult, communityResult]) {
            expect(result[0].content).toContain('<system_config>');
            expect(result[0].content).toContain('</system_config>');
        }
    });

    it('event extraction prefills assistant with think tag', () => {
        const result = buildEventExtractionPrompt({
            messages: '[A]: test',
            names: { char: 'A', user: 'B' },
            context: {},
        });
        expect(result[2].role).toBe('assistant');
        expect(result[2].content).toBe('<think>\n');
    });

    it('non-think prompts prefill assistant with JSON opener', () => {
        const graphResult = buildGraphExtractionPrompt({
            messages: '[A]: test',
            names: { char: 'A', user: 'B' },
        });
        const salientResult = buildSalientQuestionsPrompt('A', [{ summary: 'test', importance: 3 }]);
        const insightResult = buildInsightExtractionPrompt('A', 'q?', [{ id: '1', summary: 't' }]);
        const communityResult = buildCommunitySummaryPrompt([], []);

        for (const result of [graphResult, salientResult, insightResult, communityResult]) {
            expect(result[2].role).toBe('assistant');
            expect(result[2].content).toBe('{');
        }
    });
});

describe('preamble and prefill exports', () => {
    it('exports SYSTEM_PREAMBLE_CN as a non-empty string', () => {
        expect(typeof SYSTEM_PREAMBLE_CN).toBe('string');
        expect(SYSTEM_PREAMBLE_CN.length).toBeGreaterThan(0);
        expect(SYSTEM_PREAMBLE_CN).toContain('<system_config>');
    });

    it('exports SYSTEM_PREAMBLE_EN as a non-empty string', () => {
        expect(typeof SYSTEM_PREAMBLE_EN).toBe('string');
        expect(SYSTEM_PREAMBLE_EN.length).toBeGreaterThan(0);
        expect(SYSTEM_PREAMBLE_EN).toContain('<system_config>');
        expect(SYSTEM_PREAMBLE_EN).toContain('EXTRACT');
    });

    it('exports PREFILL_PRESETS with all 7 keys', () => {
        const keys = Object.keys(PREFILL_PRESETS);
        expect(keys).toContain('think_tag');
        expect(keys).toContain('pipeline');
        expect(keys).toContain('compliance');
        expect(keys).toContain('cold_start');
        expect(keys).toContain('standard');
        expect(keys).toContain('json_opener');
        expect(keys).toContain('none');
        expect(keys).toHaveLength(7);
    });

    it('each preset has label and value', () => {
        for (const [_key, preset] of Object.entries(PREFILL_PRESETS)) {
            expect(preset).toHaveProperty('label');
            expect(preset).toHaveProperty('value');
            expect(typeof preset.label).toBe('string');
            expect(typeof preset.value).toBe('string');
        }
    });

    it('think_tag preset has <think> value', () => {
        expect(PREFILL_PRESETS.think_tag.value).toBe('<think>\n');
    });

    it('none preset has empty string value', () => {
        expect(PREFILL_PRESETS.none.value).toBe('');
    });
});

describe('defaultSettings preamble/prefill keys', () => {
    it('has preambleLanguage defaulting to cn', () => {
        expect(defaultSettings.preambleLanguage).toBe('cn');
    });

    it('has extractionPrefill defaulting to think_tag', () => {
        expect(defaultSettings.extractionPrefill).toBe('think_tag');
    });
});
