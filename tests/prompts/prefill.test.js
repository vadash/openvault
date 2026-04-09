import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/constants.js';
import {
    buildCommunitySummaryPrompt,
    buildEdgeConsolidationPrompt,
    buildEventExtractionPrompt,
    buildGlobalSynthesisPrompt,
    buildGraphExtractionPrompt,
    buildUnifiedReflectionPrompt,
    PREFILL_PRESETS,
    SYSTEM_PREAMBLE_CN,
    SYSTEM_PREAMBLE_EN,
} from '../../src/prompts/index.js';

describe('prefill parameter', () => {
    it.each([
        [
            'buildGraphExtractionPrompt',
            (prefill) =>
                buildGraphExtractionPrompt({
                    messages: '[A]: test',
                    names: { char: 'A', user: 'B' },
                    prefill,
                }),
        ],
        [
            'buildUnifiedReflectionPrompt',
            (prefill) => buildUnifiedReflectionPrompt('Alice', [], 'auto', 'auto', prefill),
        ],
        [
            'buildCommunitySummaryPrompt',
            (prefill) => buildCommunitySummaryPrompt(['- Node'], ['- Edge'], 'auto', 'auto', prefill),
        ],
        [
            'buildGlobalSynthesisPrompt',
            (prefill) => buildGlobalSynthesisPrompt([{ title: 'C1', summary: 'S1' }], 'auto', 'auto', prefill),
        ],
        [
            'buildEdgeConsolidationPrompt',
            (prefill) =>
                buildEdgeConsolidationPrompt(
                    { source: 'A', target: 'B', description: 'Test', weight: 1 },
                    'auto',
                    'auto',
                    prefill
                ),
        ],
    ])('%s returns 2 messages when prefill is empty', (_, buildPrompt) => {
        expect(buildPrompt('')).toHaveLength(2);
    });

    it.each([
        [
            'buildGraphExtractionPrompt',
            (prefill) =>
                buildGraphExtractionPrompt({
                    messages: '[A]: test',
                    names: { char: 'A', user: 'B' },
                    prefill,
                }),
        ],
        [
            'buildUnifiedReflectionPrompt',
            (prefill) => buildUnifiedReflectionPrompt('Alice', [], 'auto', 'auto', prefill),
        ],
        [
            'buildCommunitySummaryPrompt',
            (prefill) => buildCommunitySummaryPrompt(['- Node'], ['- Edge'], 'auto', 'auto', prefill),
        ],
        [
            'buildGlobalSynthesisPrompt',
            (prefill) => buildGlobalSynthesisPrompt([{ title: 'C1', summary: 'S1' }], 'auto', 'auto', prefill),
        ],
        [
            'buildEdgeConsolidationPrompt',
            (prefill) =>
                buildEdgeConsolidationPrompt(
                    { source: 'A', target: 'B', description: 'Test', weight: 1 },
                    'auto',
                    'auto',
                    prefill
                ),
        ],
    ])('%s uses provided prefill in assistant message', (_, buildPrompt) => {
        expect(buildPrompt('<thinking>')[2].content).toBe('<thinking>');
    });
});
describe('think tag support', () => {
    it.each([
        [
            'GRAPH_SCHEMA',
            () =>
                buildGraphExtractionPrompt({
                    messages: '[A]: test',
                    names: { char: 'A', user: 'B' },
                    prefill: '{',
                }),
        ],
        [
            'CONSOLIDATION_SCHEMA',
            () =>
                buildEdgeConsolidationPrompt(
                    { source: 'A', target: 'B', description: 'Test', weight: 1 },
                    'auto',
                    'auto',
                    '{'
                ),
        ],
        ['UNIFIED_REFLECTION_SCHEMA', () => buildUnifiedReflectionPrompt('Alice', [], 'auto', 'auto', '{')],
        ['COMMUNITY_SCHEMA', () => buildCommunitySummaryPrompt(['- Node'], ['- Edge'], 'auto', 'auto', '{')],
        [
            'GLOBAL_SYNTHESIS_SCHEMA',
            () => buildGlobalSynthesisPrompt([{ title: 'C1', summary: 'S1' }], 'auto', 'auto', '{'),
        ],
    ])('%s allows think tags before JSON', (_, buildPrompt) => {
        const result = buildPrompt();
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
