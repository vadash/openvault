import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/constants.js';
import {
    buildCommunitySummaryPrompt,
    buildEventExtractionPrompt,
    buildGraphExtractionPrompt,
    buildInsightExtractionPrompt,
    buildSalientQuestionsPrompt,
    buildUnifiedReflectionPrompt,
    PREFILL_PRESETS,
    resolveExtractionPreamble,
    resolveExtractionPrefill,
    resolveOutputLanguage,
    SYSTEM_PREAMBLE_CN,
    SYSTEM_PREAMBLE_EN,
} from '../src/prompts/index.js';

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

    it('does NOT include entities or relationships in output_schema', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            context: {},
        });
        const systemContent = result[0].content;
        const outputSchemaMatch = systemContent.match(/<output_schema>([\s\S]*?)<\/output_schema>/);
        expect(outputSchemaMatch).not.toBeNull();
        const outputSchema = outputSchemaMatch[1];
        expect(outputSchema).not.toContain('"entities"');
        expect(outputSchema).not.toContain('"relationships"');
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

    it('exports PREFILL_PRESETS with all 9 keys', () => {
        const keys = Object.keys(PREFILL_PRESETS);
        expect(keys).toContain('think_tag');
        expect(keys).toContain('think_closed');
        expect(keys).toContain('think_stop');
        expect(keys).toContain('pipeline');
        expect(keys).toContain('compliance');
        expect(keys).toContain('cold_start');
        expect(keys).toContain('standard');
        expect(keys).toContain('json_opener');
        expect(keys).toContain('none');
        expect(keys).toHaveLength(9);
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

    it('has outputLanguage defaulting to auto', () => {
        expect(defaultSettings.outputLanguage).toBe('auto');
    });
});

describe('buildMessages via buildEventExtractionPrompt', () => {
    it('uses CN preamble by default', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
        });
        expect(result[0].content).toContain('互动小说');
    });

    it('uses EN preamble when passed', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            preamble: SYSTEM_PREAMBLE_EN,
        });
        expect(result[0].content).toContain('Interactive Fiction Archival Database');
        expect(result[0].content).not.toContain('互动小说');
    });

    it('uses custom prefill when passed', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            prefill: '{',
        });
        expect(result).toHaveLength(3);
        expect(result[2].content).toBe('{');
    });

    it('returns 2-message array when prefill is empty string', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            prefill: '',
        });
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
    });

    it('defaults to <think> prefill for event extraction', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
        });
        expect(result).toHaveLength(3);
        expect(result[2].content).toBe('<think>\n');
    });
});

describe('buildMessages via non-event prompts', () => {
    it('graph prompt uses custom preamble but keeps { prefill', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            preamble: SYSTEM_PREAMBLE_EN,
        });
        expect(result[0].content).toContain('Interactive Fiction Archival Database');
        expect(result[2].content).toBe('{');
    });

    it('salient questions prompt uses custom preamble', () => {
        const memories = [{ summary: 'test', importance: 3 }];
        const result = buildSalientQuestionsPrompt('Alice', memories, SYSTEM_PREAMBLE_EN);
        expect(result[0].content).toContain('Interactive Fiction Archival Database');
        expect(result[2].content).toBe('{');
    });

    it('insight extraction prompt uses custom preamble', () => {
        const memories = [{ id: 'ev_001', summary: 'test' }];
        const result = buildInsightExtractionPrompt('Alice', 'question?', memories, SYSTEM_PREAMBLE_EN);
        expect(result[0].content).toContain('Interactive Fiction Archival Database');
    });

    it('community summary prompt uses custom preamble', () => {
        const result = buildCommunitySummaryPrompt(['- Node'], ['- Edge'], SYSTEM_PREAMBLE_EN);
        expect(result[0].content).toContain('Interactive Fiction Archival Database');
    });
});

describe('resolveExtractionPreamble', () => {
    it('returns CN preamble by default', () => {
        expect(resolveExtractionPreamble({})).toBe(SYSTEM_PREAMBLE_CN);
    });

    it('returns CN preamble when preambleLanguage is cn', () => {
        expect(resolveExtractionPreamble({ preambleLanguage: 'cn' })).toBe(SYSTEM_PREAMBLE_CN);
    });

    it('returns EN preamble when preambleLanguage is en', () => {
        expect(resolveExtractionPreamble({ preambleLanguage: 'en' })).toBe(SYSTEM_PREAMBLE_EN);
    });

    it('returns CN preamble for null settings', () => {
        expect(resolveExtractionPreamble(null)).toBe(SYSTEM_PREAMBLE_CN);
    });
});

describe('resolveExtractionPrefill', () => {
    it('returns <think> by default', () => {
        expect(resolveExtractionPrefill({})).toBe('<think>\n');
    });

    it('returns correct value for think_tag key', () => {
        expect(resolveExtractionPrefill({ extractionPrefill: 'think_tag' })).toBe('<think>\n');
    });

    it('returns correct value for pipeline key', () => {
        expect(resolveExtractionPrefill({ extractionPrefill: 'pipeline' })).toContain('Pipeline engaged');
    });

    it('returns empty string for none key', () => {
        expect(resolveExtractionPrefill({ extractionPrefill: 'none' })).toBe('');
    });

    it('returns { for json_opener key', () => {
        expect(resolveExtractionPrefill({ extractionPrefill: 'json_opener' })).toBe('{');
    });

    it('falls back to <think> for unknown key', () => {
        expect(resolveExtractionPrefill({ extractionPrefill: 'nonexistent' })).toBe('<think>\n');
    });

    it('falls back to <think> for null settings', () => {
        expect(resolveExtractionPrefill(null)).toBe('<think>\n');
    });
});

describe('resolveOutputLanguage', () => {
    it('returns auto by default', () => {
        expect(resolveOutputLanguage({})).toBe('auto');
    });

    it('returns ru when outputLanguage is ru', () => {
        expect(resolveOutputLanguage({ outputLanguage: 'ru' })).toBe('ru');
    });

    it('returns en when outputLanguage is en', () => {
        expect(resolveOutputLanguage({ outputLanguage: 'en' })).toBe('en');
    });

    it('returns auto for unknown language', () => {
        expect(resolveOutputLanguage({ outputLanguage: 'fr' })).toBe('auto');
    });

    it('returns auto for null settings', () => {
        expect(resolveOutputLanguage(null)).toBe('auto');
    });

    it('returns auto for undefined outputLanguage', () => {
        expect(resolveOutputLanguage({ preambleLanguage: 'en' })).toBe('auto');
    });
});

describe('output language in builders', () => {
    it('event prompt uses forced Russian instruction when outputLanguage is ru', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello world',
            names: { char: 'Alice', user: 'Bob' },
            outputLanguage: 'ru',
        });
        const user = result[1].content;
        expect(user).toContain('Write ALL output string values');
        expect(user).toContain('Russian');
    });

    it('event prompt uses forced English instruction when outputLanguage is en', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Алиса]: Привет мир всем здесь кто любит',
            names: { char: 'Алиса', user: 'Боб' },
            outputLanguage: 'en',
        });
        const user = result[1].content;
        expect(user).toContain('Write ALL output string values');
        expect(user).toContain('English');
        // Should NOT contain the heuristic reminder
        expect(user).not.toContain('is NOT in English');
    });

    it('event prompt uses heuristic reminder when outputLanguage is auto with non-Latin text', () => {
        const russianText = '[Алиса]: Привет мир всем здесь кто любит разговоры';
        const result = buildEventExtractionPrompt({
            messages: russianText,
            names: { char: 'Алиса', user: 'Боб' },
            outputLanguage: 'auto',
        });
        const user = result[1].content;
        expect(user).toContain('is NOT in English');
    });

    it('graph prompt passes outputLanguage through', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            outputLanguage: 'ru',
        });
        const user = result[1].content;
        expect(user).toContain('Russian');
    });

    it('salient questions prompt passes outputLanguage through', () => {
        const memories = [{ summary: 'Alice did something', importance: 3 }];
        const result = buildSalientQuestionsPrompt('Alice', memories, undefined, 'en');
        const user = result[1].content;
        expect(user).toContain('English');
    });

    it('insight extraction prompt passes outputLanguage through', () => {
        const memories = [{ id: 'ev_1', summary: 'Alice was brave' }];
        const result = buildInsightExtractionPrompt('Alice', 'How?', memories, undefined, 'ru');
        const user = result[1].content;
        expect(user).toContain('Russian');
    });

    it('community summary prompt passes outputLanguage through', () => {
        const result = buildCommunitySummaryPrompt(['- Node'], ['- Edge'], undefined, 'en');
        const user = result[1].content;
        expect(user).toContain('English');
    });

    it('all builders default to auto (preserving existing behavior)', () => {
        const eventResult = buildEventExtractionPrompt({
            messages: '[Alice]: Hello world',
            names: { char: 'Alice', user: 'Bob' },
        });
        // English text with auto should NOT have forced instruction
        expect(eventResult[1].content).not.toContain('Write ALL output string values');
    });
});

describe('multilingual prompt compliance', () => {
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

    it('all prompts contain mirror language rules', () => {
        for (const result of [eventResult, graphResult, salientResult, insightResult, communityResult]) {
            expect(result[0].content).toContain('<language_rules>');
            expect(result[0].content).toContain('SAME LANGUAGE');
        }
    });

    it('no prompt contains "Write in ENGLISH" or "Write ALL summaries in ENGLISH"', () => {
        for (const result of [eventResult, graphResult, salientResult, insightResult, communityResult]) {
            const sys = result[0].content;
            const user = result[1].content;
            expect(sys).not.toContain('Write in ENGLISH');
            expect(sys).not.toContain('summaries in ENGLISH');
            expect(sys).not.toContain('Write all questions in English');
            expect(sys).not.toContain('Write all insights in English');
            expect(sys).not.toContain('Write in English');
            expect(user).not.toContain('in ENGLISH');
        }
    });

    it('all prompts contain bilingual few-shot examples', () => {
        for (const result of [eventResult, graphResult, salientResult, insightResult, communityResult]) {
            const sys = result[0].content;
            // Bilingual examples must contain Cyrillic text
            expect(sys).toMatch(/[\u0400-\u04FF]/);
            // Must use numbered example format
            expect(sys).toContain('<example_1>');
        }
    });

    it('event prompt contains think blocks in examples', () => {
        expect(eventResult[0].content).toContain('<think>');
        expect(eventResult[0].content).toContain('</think>');
    });

    it('graph prompt contains nominative normalization rule', () => {
        expect(graphResult[0].content).toContain('Nominative');
        expect(graphResult[0].content).toContain('ошейник');
    });
});

describe('buildUnifiedReflectionPrompt', () => {
    it('builds unified reflection prompt with character and memories', () => {
        const result = buildUnifiedReflectionPrompt(
            'Alice',
            [
                { id: 'ev_001', summary: 'Alice met Bob', importance: 3 },
                { id: 'ev_002', summary: 'Alice fought dragon', importance: 5 }
            ],
            'SYSTEM_PREAMBLE_CN',
            'auto'
        );
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(3);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
        expect(result[0].content).toContain('expert psychological analyst');
        expect(result[1].content).toContain('<character>Alice</character>');
        expect(result[1].content).toContain('ev_001');
        expect(result[1].content).toContain('ev_002');
        expect(result[0].content).toContain('CRITICAL ID GROUNDING RULE');
    });
});
