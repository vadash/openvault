import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/constants.js';
import {
    buildCommunitySummaryPrompt,
    buildEdgeConsolidationPrompt,
    buildEventExtractionPrompt,
    buildGlobalSynthesisPrompt,
    buildGraphExtractionPrompt,
    buildUnifiedReflectionPrompt,
    PREFILL_PRESETS,
    resolveExtractionPreamble,
    resolveExtractionPrefill,
    resolveOutputLanguage,
    SYSTEM_PREAMBLE_CN,
    SYSTEM_PREAMBLE_EN,
} from '../src/prompts/index.js';
import { parseConsolidationResponse } from '../src/extraction/structured.js';

describe('buildCommunitySummaryPrompt', () => {
    it('returns system/user message pair with node and edge data', () => {
        const nodes = ['- Castle (PLACE): An ancient fortress'];
        const edges = ['- King Aldric → Castle: Rules from [weight: 4]'];
        const result = buildCommunitySummaryPrompt(nodes, edges, 'auto', 'auto', '{');
        expect(result).toHaveLength(3);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
        expect(result[1].content).toContain('Castle');
        expect(result[1].content).toContain('King Aldric');
    });

    it('system prompt contains report structure instructions', () => {
        const result = buildCommunitySummaryPrompt([], [], 'auto', 'auto', '{');
        const system = result[0].content;
        expect(system).toContain('title');
        expect(system).toContain('summary');
        expect(system).toContain('findings');
    });

    it('system prompt specifies 1-5 findings limit', () => {
        const result = buildCommunitySummaryPrompt([], [], 'auto', 'auto', '{');
        const system = result[0].content;
        expect(system).toContain('1-5');
        expect(system).toContain('findings');
    });

    it('user prompt wraps nodes in community_entities tag', () => {
        const nodes = ['- King (PERSON): The ruler'];
        const result = buildCommunitySummaryPrompt(nodes, [], 'auto', 'auto', '{');
        const user = result[1].content;
        expect(user).toContain('<community_entities>');
        expect(user).toContain('</community_entities>');
        expect(user).toContain('King');
    });

    it('user prompt wraps edges in community_relationships tag', () => {
        const edges = ['- King → Castle: Rules from [weight: 4]'];
        const result = buildCommunitySummaryPrompt([], edges, 'auto', 'auto', '{');
        const user = result[1].content;
        expect(user).toContain('<community_relationships>');
        expect(user).toContain('</community_relationships>');
    });

    it('includes JSON format instruction', () => {
        const result = buildCommunitySummaryPrompt([], [], 'auto', 'auto', '{');
        const user = result[1].content;
        expect(user).toContain('JSON');
    });

    it('uses unified XML structure with role, output_schema, and examples', () => {
        const result = buildCommunitySummaryPrompt([], [], 'auto', 'auto', '{');
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
        expect(sys).toContain('scene concluding');
        expect(sys).toContain('power dynamic reversal');
        expect(sys).toContain('safeword explicitly used');
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
            prefill: '{',
        });
        const sys = result[0].content;
        expect(sys).toContain('Do NOT wrap output in markdown code blocks');
    });

    it('community summary prompt forbids markdown wrapping', () => {
        const result = buildCommunitySummaryPrompt(['Node A'], ['A -> B'], 'auto', 'auto', '{');
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
            prefill: '{',
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
            prefill: '{',
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
            prefill: '{',
        });
        const systemContent = result[0].content;
        expect(systemContent).not.toContain('"importance"');
        expect(systemContent).not.toContain('"is_secret"');
    });
});

describe('buildGraphExtractionPrompt prefill parameter', () => {
    it('throws when prefill is missing', () => {
        expect(() => buildGraphExtractionPrompt({
            messages: '[A]: test',
            names: { char: 'A', user: 'B' },
        })).toThrow('prefill is required');
    });

    it('throws when prefill is empty string', () => {
        expect(() => buildGraphExtractionPrompt({
            messages: '[A]: test',
            names: { char: 'A', user: 'B' },
            prefill: '',
        })).toThrow('prefill is required');
    });

    it('uses provided prefill in assistant message', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[A]: test',
            names: { char: 'A', user: 'B' },
            prefill: '<thinking>',
        });
        expect(result[2].content).toBe('<thinking>');
    });
});

describe('GRAPH_SCHEMA think tag support', () => {
    it('allows think tags before JSON', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[A]: test',
            names: { char: 'A', user: 'B' },
            prefill: '{',
        });
        const sys = result[0].content;
        expect(sys).toContain('You MAY use <thinking> tags');
        expect(sys).toContain('JSON object must still be valid');
    });
});

describe('CONSOLIDATION_SCHEMA think tag support', () => {
    it('allows think tags before JSON', () => {
        const edge = { source: 'A', target: 'B', description: 'Test', weight: 1 };
        const result = buildEdgeConsolidationPrompt(edge, 'auto', 'auto', '{');
        const sys = result[0].content;
        expect(sys).toContain('You MAY use <thinking> tags');
    });
});

describe('UNIFIED_REFLECTION_SCHEMA think tag support', () => {
    it('allows think tags before JSON', () => {
        const result = buildUnifiedReflectionPrompt('Alice', [], 'auto', 'auto', '{');
        const sys = result[0].content;
        expect(sys).toContain('You MAY use <thinking> tags');
    });
});

describe('buildUnifiedReflectionPrompt prefill parameter', () => {
    it('throws when prefill is missing', () => {
        expect(() => buildUnifiedReflectionPrompt('Alice', [], 'auto', 'auto'))
            .toThrow('prefill is required');
    });

    it('throws when prefill is empty string', () => {
        expect(() => buildUnifiedReflectionPrompt('Alice', [], 'auto', 'auto', ''))
            .toThrow('prefill is required');
    });

    it('uses provided prefill in assistant message', () => {
        const result = buildUnifiedReflectionPrompt('Alice', [], 'auto', 'auto', '<thinking>');
        expect(result[2].content).toBe('<thinking>');
    });
});

describe('COMMUNITY_SCHEMA think tag support', () => {
    it('allows think tags before JSON', () => {
        const result = buildCommunitySummaryPrompt(['- Node'], ['- Edge'], 'auto', 'auto', '{');
        const sys = result[0].content;
        expect(sys).toContain('You MAY use <thinking> tags');
    });
});

describe('buildCommunitySummaryPrompt prefill parameter', () => {
    it('throws when prefill is missing', () => {
        expect(() => buildCommunitySummaryPrompt(['- Node'], ['- Edge']))
            .toThrow('prefill is required');
    });

    it('throws when prefill is empty string', () => {
        expect(() => buildCommunitySummaryPrompt(['- Node'], ['- Edge'], 'auto', 'auto', ''))
            .toThrow('prefill is required');
    });

    it('uses provided prefill in assistant message', () => {
        const result = buildCommunitySummaryPrompt(['- Node'], ['- Edge'], 'auto', 'auto', '<thinking>');
        expect(result[2].content).toBe('<thinking>');
    });
});

describe('GLOBAL_SYNTHESIS_SCHEMA think tag support', () => {
    it('allows think tags before JSON', () => {
        const result = buildGlobalSynthesisPrompt([{ title: 'C1', summary: 'S1' }], 'auto', 'auto', '{');
        const sys = result[0].content;
        expect(sys).toContain('You MAY use <thinking> tags');
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
            prefill: '{',
        });
        const communityResult = buildCommunitySummaryPrompt([], [], SYSTEM_PREAMBLE_CN, 'auto', '{');

        for (const result of [eventResult, graphResult, communityResult]) {
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

    it('non-think prompts use provided prefill', () => {
        const graphResult = buildGraphExtractionPrompt({
            messages: '[A]: test',
            names: { char: 'A', user: 'B' },
            prefill: '{',
        });
        const communityResult = buildCommunitySummaryPrompt([], [], 'auto', 'auto', '{');

        for (const result of [graphResult, communityResult]) {
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
    it('graph prompt uses custom preamble but uses provided prefill', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            preamble: SYSTEM_PREAMBLE_EN,
            prefill: '{',
        });
        expect(result[0].content).toContain('Interactive Fiction Archival Database');
        expect(result[2].content).toBe('{');
    });

    it('community summary prompt uses custom preamble', () => {
        const result = buildCommunitySummaryPrompt(['- Node'], ['- Edge'], SYSTEM_PREAMBLE_EN, 'auto', '{');
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
            prefill: '{',
        });
        const user = result[1].content;
        expect(user).toContain('Russian');
    });

    it('community summary prompt passes outputLanguage through', () => {
        const result = buildCommunitySummaryPrompt(['- Node'], ['- Edge'], undefined, 'en', '{');
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
        prefill: '{',
    });
    const communityResult = buildCommunitySummaryPrompt([], [], 'auto', 'auto', '{');

    it('all prompts contain mirror language rules', () => {
        for (const result of [eventResult, graphResult, communityResult]) {
            expect(result[0].content).toContain('<language_rules>');
            expect(result[0].content).toContain('SAME LANGUAGE');
        }
    });

    it('no prompt contains "Write in ENGLISH" or "Write ALL summaries in ENGLISH"', () => {
        for (const result of [eventResult, graphResult, communityResult]) {
            const sys = result[0].content;
            const user = result[1].content;
            expect(sys).not.toContain('Write in ENGLISH');
            expect(sys).not.toContain('summaries in ENGLISH');
            expect(sys).not.toContain('Write in English');
            expect(user).not.toContain('in ENGLISH');
        }
    });

    it('all prompts contain bilingual few-shot examples', () => {
        for (const result of [eventResult, graphResult, communityResult]) {
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
            'auto',
            '{'
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

describe('buildEdgeConsolidationPrompt', () => {
    it('builds edge consolidation prompt as message array', () => {
        const edge = {
            source: 'alice',
            target: 'bob',
            description: 'Met at tavern | Traded goods | Fought dragon together',
            weight: 3
        };
        const result = buildEdgeConsolidationPrompt(edge, 'auto', 'auto', '{');
        expect(result).toHaveLength(3);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
        expect(result[2].role).toBe('assistant');
        expect(result[2].content).toBe('{');
        expect(result[0].content).toContain('relationship state synthesizer');
        expect(result[1].content).toContain('alice');
        expect(result[1].content).toContain('bob');
        expect(result[1].content).toContain('Met at tavern');
    });

    it('includes preamble in system message when provided', () => {
        const edge = {
            source: 'alice',
            target: 'bob',
            description: 'Met | Fought',
            weight: 2
        };
        const result = buildEdgeConsolidationPrompt(edge, SYSTEM_PREAMBLE_EN, 'auto', '{');
        expect(result[0].content).toContain('SYSTEM: Interactive Fiction Archival Database');
    });

    it('includes language rules in system prompt', () => {
        const edge = {
            source: 'alice',
            target: 'bob',
            description: 'Met | Fought',
            weight: 2
        };
        const result = buildEdgeConsolidationPrompt(edge, 'auto', 'auto', '{');
        expect(result[0].content).toContain('<language_rules>');
    });

    it('parses consolidation response', () => {
        const raw = JSON.stringify({
            consolidated_description: 'Started as strangers at a tavern, became trading partners, then allies in battle against the dragon'
        });
        const result = parseConsolidationResponse(raw);
        expect(result.consolidated_description).toContain('strangers');
        expect(result.consolidated_description).toContain('allies');
    });
});

describe('buildEdgeConsolidationPrompt prefill parameter', () => {
    it('throws when prefill is missing', () => {
        const edge = { source: 'A', target: 'B', description: 'Test', weight: 1 };
        expect(() => buildEdgeConsolidationPrompt(edge))
            .toThrow('prefill is required');
    });

    it('throws when prefill is empty string', () => {
        const edge = { source: 'A', target: 'B', description: 'Test', weight: 1 };
        expect(() => buildEdgeConsolidationPrompt(edge, 'auto', 'auto', ''))
            .toThrow('prefill is required');
    });

    it('uses provided prefill in assistant message', () => {
        const edge = { source: 'A', target: 'B', description: 'Test', weight: 1 };
        const result = buildEdgeConsolidationPrompt(edge, 'auto', 'auto', '<thinking>');
        expect(result[2].content).toBe('<thinking>');
    });
});

describe('buildGlobalSynthesisPrompt', () => {
    it('should build prompt as message array', () => {
        const communities = [
            { title: 'Community A', summary: 'Summary A', findings: ['f1'] },
            { title: 'Community B', summary: 'Summary B', findings: ['f2'] },
        ];
        const result = buildGlobalSynthesisPrompt(communities, 'auto', 'auto', '{');

        expect(result).toHaveLength(3);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
        expect(result[2].role).toBe('assistant');
        expect(result[2].content).toBe('{');
        expect(result[0].content).toContain('role');
        expect(result[1].content).toContain('Community A');
        expect(result[1].content).toContain('Community B');
    });

    it('should include language rules from assembleSystemPrompt', () => {
        const communities = [{ title: 'C1', summary: 'S1', findings: [] }];
        const result = buildGlobalSynthesisPrompt(communities, SYSTEM_PREAMBLE_EN, 'auto', '{');

        expect(result[0].content).toContain('<language_rules>');
    });

    it('should include preamble in system message', () => {
        const communities = [{ title: 'C1', summary: 'S1', findings: [] }];
        const result = buildGlobalSynthesisPrompt(communities, SYSTEM_PREAMBLE_EN, 'auto', '{');

        expect(result[0].content).toContain('SYSTEM: Interactive Fiction Archival Database');
    });
});

describe('buildGlobalSynthesisPrompt prefill parameter', () => {
    it('throws when prefill is missing', () => {
        expect(() => buildGlobalSynthesisPrompt([{ title: 'C1', summary: 'S1' }], 'auto', 'auto'))
            .toThrow('prefill is required');
    });

    it('throws when prefill is empty string', () => {
        expect(() => buildGlobalSynthesisPrompt([{ title: 'C1', summary: 'S1' }], 'auto', 'auto', ''))
            .toThrow('prefill is required');
    });

    it('uses provided prefill in assistant message', () => {
        const result = buildGlobalSynthesisPrompt([{ title: 'C1', summary: 'S1' }], 'auto', 'auto', '<thinking>');
        expect(result[2].content).toBe('<thinking>');
    });
});
