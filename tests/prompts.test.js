import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/constants.js';
import { parseConsolidationResponse } from '../src/extraction/structured.js';
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
        const user = result[1].content;
        expect(user).toContain('title');
        expect(user).toContain('summary');
        expect(user).toContain('findings');
    });

    it('user prompt specifies 1-5 findings limit', () => {
        const result = buildCommunitySummaryPrompt([], [], 'auto', 'auto', '{');
        const user = result[1].content;
        expect(user).toContain('1-5');
        expect(user).toContain('findings');
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
        const user = result[1].content;
        expect(sys).toContain('<role>');
        expect(user).toContain('<output_schema>');
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
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
    });

    it('does NOT include entities or relationships in output_schema', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
            context: {},
        });
        const userContent = result[1].content;
        const outputSchemaMatch = userContent.match(/<output_schema>([\s\S]*?)<\/output_schema>/);
        expect(outputSchemaMatch).not.toBeNull();
        const outputSchema = outputSchemaMatch[1];
        expect(outputSchema).not.toContain('"entities"');
        expect(outputSchema).not.toContain('"relationships"');
    });

    it('event schema contains anti-tool-call rule', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
        });
        const user = result[1].content;
        expect(user).toContain('No tool calls');
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
        const user = result[1].content;
        expect(user).toContain('scene concluding');
        expect(user).toContain('power dynamic reversal');
        expect(user).toContain('safeword explicitly used');
    });

    it('does not mandate minimum importance of 4 for routine intimate acts', () => {
        const result = buildEventExtractionPrompt(baseArgs);
        const user = result[1].content;
        // Old: "MANDATORY MINIMUM of 4 for: any first sexual act"
        expect(user).not.toContain('MANDATORY MINIMUM');
    });

    it('instructs raw JSON output without markdown', () => {
        const result = buildEventExtractionPrompt(baseArgs);
        const user = result[1].content;
        expect(user).toContain('raw JSON');
    });
});

describe('all prompts use raw JSON instruction', () => {
    it('graph extraction prompt forbids markdown wrapping', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[TestUser]: Hello',
            names: { char: 'TestChar', user: 'TestUser' },
            prefill: '{',
        });
        const user = result[1].content;
        expect(user).toContain('no markdown');
    });

    it('community summary prompt forbids markdown wrapping', () => {
        const result = buildCommunitySummaryPrompt(['Node A'], ['A -> B'], 'auto', 'auto', '{');
        const user = result[1].content;
        expect(user).toContain('no markdown');
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
    it('returns only 2 messages when prefill is empty', () => {
        const result = buildGraphExtractionPrompt({
            messages: '[A]: test',
            names: { char: 'A', user: 'B' },
            prefill: '',
        });
        expect(result).toHaveLength(2);
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
        const user = result[1].content;
        expect(user).toContain('reasoning');
        expect(user).toContain('OUTPUT FORMAT');
    });
});

describe('CONSOLIDATION_SCHEMA think tag support', () => {
    it('allows think tags before JSON', () => {
        const edge = { source: 'A', target: 'B', description: 'Test', weight: 1 };
        const result = buildEdgeConsolidationPrompt(edge, 'auto', 'auto', '{');
        const user = result[1].content;
        expect(user).toContain('reasoning');
    });
});

describe('UNIFIED_REFLECTION_SCHEMA think tag support', () => {
    it('allows think tags before JSON', () => {
        const result = buildUnifiedReflectionPrompt('Alice', [], 'auto', 'auto', '{');
        const user = result[1].content;
        expect(user).toContain('reasoning');
    });
});

describe('buildUnifiedReflectionPrompt prefill parameter', () => {
    it('returns only 2 messages when prefill is empty', () => {
        const result = buildUnifiedReflectionPrompt('Alice', [], 'auto', 'auto', '');
        expect(result).toHaveLength(2);
    });

    it('uses provided prefill in assistant message', () => {
        const result = buildUnifiedReflectionPrompt('Alice', [], 'auto', 'auto', '<thinking>');
        expect(result[2].content).toBe('<thinking>');
    });
});

describe('COMMUNITY_SCHEMA think tag support', () => {
    it('allows think tags before JSON', () => {
        const result = buildCommunitySummaryPrompt(['- Node'], ['- Edge'], 'auto', 'auto', '{');
        const user = result[1].content;
        expect(user).toContain('reasoning');
    });
});

describe('buildCommunitySummaryPrompt prefill parameter', () => {
    it('returns only 2 messages when prefill is empty', () => {
        const result = buildCommunitySummaryPrompt(['- Node'], ['- Edge'], 'auto', 'auto', '');
        expect(result).toHaveLength(2);
    });

    it('uses provided prefill in assistant message', () => {
        const result = buildCommunitySummaryPrompt(['- Node'], ['- Edge'], 'auto', 'auto', '<thinking>');
        expect(result[2].content).toBe('<thinking>');
    });
});

describe('GLOBAL_SYNTHESIS_SCHEMA think tag support', () => {
    it('allows think tags before JSON', () => {
        const result = buildGlobalSynthesisPrompt([{ title: 'C1', summary: 'S1' }], 'auto', 'auto', '{');
        const user = result[1].content;
        expect(user).toContain('reasoning');
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

    it('event extraction does NOT prefill assistant when prefill is empty', () => {
        const result = buildEventExtractionPrompt({
            messages: '[A]: test',
            names: { char: 'A', user: 'B' },
            context: {},
        });
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
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

    it('exports PREFILL_PRESETS with all 6 keys', () => {
        const keys = Object.keys(PREFILL_PRESETS);
        expect(keys).toContain('cn_compliance');
        expect(keys).toContain('en_compliance');
        expect(keys).toContain('step_by_step');
        expect(keys).toContain('pure_think');
        expect(keys).toContain('json_only');
        expect(keys).toContain('none');
        expect(keys).toHaveLength(6);
    });

    it('each preset has label and value', () => {
        for (const [_key, preset] of Object.entries(PREFILL_PRESETS)) {
            expect(preset).toHaveProperty('label');
            expect(preset).toHaveProperty('value');
            expect(typeof preset.label).toBe('string');
            expect(typeof preset.value).toBe('string');
        }
    });

    it('pure_think preset has <think> value', () => {
        expect(PREFILL_PRESETS.pure_think.value).toBe('<think>\n');
    });

    it('cn_compliance preset has Chinese forensic framing', () => {
        expect(PREFILL_PRESETS.cn_compliance.value).toContain('系统日志');
        expect(PREFILL_PRESETS.cn_compliance.value).toContain('<think>');
        expect(PREFILL_PRESETS.cn_compliance.label).toBe('CN Compliance Lock (Best for Kimi/Qwen)');
    });

    it('none preset has empty string value', () => {
        expect(PREFILL_PRESETS.none.value).toBe('');
    });

    it('CN preamble contains anti-tool-call directive', () => {
        expect(SYSTEM_PREAMBLE_CN).toContain('禁止使用 tool calls');
    });

    it('EN preamble contains anti-tool-call directive', () => {
        expect(SYSTEM_PREAMBLE_EN).toContain('DO NOT use tool calls or function calls');
    });
});

describe('defaultSettings preamble/prefill keys', () => {
    it('has preambleLanguage defaulting to cn', () => {
        expect(defaultSettings.preambleLanguage).toBe('cn');
    });

    it('has extractionPrefill defaulting to cn_compliance', () => {
        expect(defaultSettings.extractionPrefill).toBe('cn_compliance');
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

    it('does NOT include assistant message when prefill is empty', () => {
        const result = buildEventExtractionPrompt({
            messages: '[Alice]: Hello',
            names: { char: 'Alice', user: 'Bob' },
        });
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
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

    it('returns correct value for pure_think key', () => {
        expect(resolveExtractionPrefill({ extractionPrefill: 'pure_think' })).toBe('<think>\n');
    });

    it('returns correct value for en_compliance key', () => {
        expect(resolveExtractionPrefill({ extractionPrefill: 'en_compliance' })).toContain('Safety filters bypassed');
    });

    it('returns empty string for none key', () => {
        expect(resolveExtractionPrefill({ extractionPrefill: 'none' })).toBe('');
    });

    it('returns JSON opener for json_only key', () => {
        expect(resolveExtractionPrefill({ extractionPrefill: 'json_only' })).toBe('{\n  "');
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
            expect(result[1].content).toContain('<language_rules>');
            expect(result[1].content).toContain('SAME LANGUAGE');
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
                { id: 'ev_002', summary: 'Alice fought dragon', importance: 5 },
            ],
            'SYSTEM_PREAMBLE_CN',
            'auto',
            '{'
        );
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(3);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
        expect(result[0].content).toContain('<role>');
        expect(result[1].content).toContain('<character>Alice</character>');
        expect(result[1].content).toContain('ev_001');
        expect(result[1].content).toContain('ev_002');
        expect(result[1].content).toContain('CRITICAL ID GROUNDING RULE');
    });
});

describe('buildEdgeConsolidationPrompt', () => {
    it('builds edge consolidation prompt as message array', () => {
        const edge = {
            source: 'alice',
            target: 'bob',
            description: 'Met at tavern | Traded goods | Fought dragon together',
            weight: 3,
        };
        const result = buildEdgeConsolidationPrompt(edge, 'auto', 'auto', '{');
        expect(result).toHaveLength(3);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
        expect(result[2].role).toBe('assistant');
        expect(result[2].content).toBe('{');
        expect(result[0].content).toContain('<role>');
        expect(result[1].content).toContain('alice');
        expect(result[1].content).toContain('bob');
        expect(result[1].content).toContain('Met at tavern');
    });

    it('includes preamble in system message when provided', () => {
        const edge = {
            source: 'alice',
            target: 'bob',
            description: 'Met | Fought',
            weight: 2,
        };
        const result = buildEdgeConsolidationPrompt(edge, SYSTEM_PREAMBLE_EN, 'auto', '{');
        expect(result[0].content).toContain('SYSTEM: Interactive Fiction Archival Database');
    });

    it('includes language rules in user prompt', () => {
        const edge = {
            source: 'alice',
            target: 'bob',
            description: 'Met | Fought',
            weight: 2,
        };
        const result = buildEdgeConsolidationPrompt(edge, 'auto', 'auto', '{');
        expect(result[1].content).toContain('<language_rules>');
    });

    it('parses consolidation response', () => {
        const raw = JSON.stringify({
            consolidated_description:
                'Started as strangers at a tavern, became trading partners, then allies in battle against the dragon',
        });
        const result = parseConsolidationResponse(raw);
        expect(result.consolidated_description).toContain('strangers');
        expect(result.consolidated_description).toContain('allies');
    });
});

describe('buildEdgeConsolidationPrompt prefill parameter', () => {
    it('returns only 2 messages when prefill is empty', () => {
        const edge = { source: 'A', target: 'B', description: 'Test', weight: 1 };
        const result = buildEdgeConsolidationPrompt(edge, 'auto', 'auto', '');
        expect(result).toHaveLength(2);
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
        expect(result[0].content).toContain('<role>');
        expect(result[1].content).toContain('Community A');
        expect(result[1].content).toContain('Community B');
    });

    it('should include language rules in user prompt from assembleUserConstraints', () => {
        const communities = [{ title: 'C1', summary: 'S1', findings: [] }];
        const result = buildGlobalSynthesisPrompt(communities, SYSTEM_PREAMBLE_EN, 'auto', '{');

        expect(result[1].content).toContain('<language_rules>');
    });

    it('should include preamble in system message', () => {
        const communities = [{ title: 'C1', summary: 'S1', findings: [] }];
        const result = buildGlobalSynthesisPrompt(communities, SYSTEM_PREAMBLE_EN, 'auto', '{');

        expect(result[0].content).toContain('SYSTEM: Interactive Fiction Archival Database');
    });
});

describe('buildGlobalSynthesisPrompt prefill parameter', () => {
    it('returns only 2 messages when prefill is empty', () => {
        const result = buildGlobalSynthesisPrompt([{ title: 'C1', summary: 'S1' }], 'auto', 'auto', '');
        expect(result).toHaveLength(2);
    });

    it('uses provided prefill in assistant message', () => {
        const result = buildGlobalSynthesisPrompt([{ title: 'C1', summary: 'S1' }], 'auto', 'auto', '<thinking>');
        expect(result[2].content).toBe('<thinking>');
    });
});

describe('domain module structure', () => {
    it('events/examples returns correct count per language', async () => {
        const { getExamples } = await import('../src/prompts/events/examples/index.js');
        expect(getExamples('en')).toHaveLength(7);
        expect(getExamples('ru')).toHaveLength(7);
        expect(getExamples('auto')).toHaveLength(14);
    });

    it('graph/examples returns correct count per language', async () => {
        const { getExamples } = await import('../src/prompts/graph/examples/index.js');
        expect(getExamples('en')).toHaveLength(4);
        expect(getExamples('ru')).toHaveLength(4);
        expect(getExamples('auto')).toHaveLength(8);
    });

    it('reflection/examples returns correct count per type and language', async () => {
        const { getExamples } = await import('../src/prompts/reflection/examples/index.js');
        expect(getExamples('REFLECTIONS', 'en')).toHaveLength(3);
        expect(getExamples('REFLECTIONS', 'ru')).toHaveLength(3);
        expect(getExamples('REFLECTIONS', 'auto')).toHaveLength(6);
        expect(getExamples('QUESTIONS', 'en')).toHaveLength(3);
        expect(getExamples('INSIGHTS', 'ru')).toHaveLength(3);
    });

    it('communities/examples returns correct count per type and language', async () => {
        const { getExamples } = await import('../src/prompts/communities/examples/index.js');
        expect(getExamples('COMMUNITIES', 'en')).toHaveLength(3);
        expect(getExamples('COMMUNITIES', 'ru')).toHaveLength(3);
        expect(getExamples('COMMUNITIES', 'auto')).toHaveLength(6);
        expect(getExamples('GLOBAL_SYNTHESIS', 'en')).toHaveLength(2);
        expect(getExamples('GLOBAL_SYNTHESIS', 'ru')).toHaveLength(2);
        expect(getExamples('GLOBAL_SYNTHESIS', 'auto')).toHaveLength(4);
    });

    it('all example objects have required fields', async () => {
        const events = await import('../src/prompts/events/examples/index.js');
        const graph = await import('../src/prompts/graph/examples/index.js');
        const reflection = await import('../src/prompts/reflection/examples/index.js');
        const communities = await import('../src/prompts/communities/examples/index.js');

        const allExamples = [
            ...events.getExamples(),
            ...graph.getExamples(),
            ...reflection.getExamples('REFLECTIONS'),
            ...reflection.getExamples('QUESTIONS'),
            ...reflection.getExamples('INSIGHTS'),
            ...communities.getExamples('COMMUNITIES'),
            ...communities.getExamples('GLOBAL_SYNTHESIS'),
        ];

        for (const ex of allExamples) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(typeof ex.label).toBe('string');
            expect(typeof ex.input).toBe('string');
            expect(typeof ex.output).toBe('string');
        }
    });

    it('EN examples only have EN labels, RU examples only have RU labels', async () => {
        const { getExamples } = await import('../src/prompts/events/examples/index.js');
        for (const ex of getExamples('en')) {
            expect(ex.label).toContain('(EN/');
        }
        for (const ex of getExamples('ru')) {
            expect(ex.label).toContain('(RU/');
        }
    });
});
