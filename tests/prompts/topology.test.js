import { describe, expect, it } from 'vitest';
import { buildCommunitySummaryPrompt, buildGlobalSynthesisPrompt } from '../../src/prompts/communities/builder.js';
import { buildEventExtractionPrompt } from '../../src/prompts/events/builder.js';
import { buildEdgeConsolidationPrompt, buildGraphExtractionPrompt } from '../../src/prompts/graph/builder.js';
import { buildUnifiedReflectionPrompt } from '../../src/prompts/reflection/builder.js';
import { SYSTEM_PREAMBLE_CN } from '../../src/prompts/shared/preambles.js';

const PREAMBLE = SYSTEM_PREAMBLE_CN;
const PREFILL = '<thinking>\n';

/**
 * Assert system message has role+examples but NOT schema/rules/language_rules.
 */
function assertSystemPrompt(content) {
    expect(content).toContain('<role>');
    expect(content).not.toContain('<output_schema>');
    expect(content).not.toContain('<task_rules>');
    // language_rules only in user prompt now
    const afterPreamble = content.slice(content.indexOf('</system_config>'));
    expect(afterPreamble).not.toContain('<language_rules>');
}

/**
 * Assert user message has constraints block at end.
 */
function assertUserPrompt(content) {
    expect(content).toContain('<language_rules>');
    expect(content).toContain('<output_schema>');
    expect(content).toContain('OUTPUT FORMAT:');
}

describe('Prompt Topology — Recency Bias Layout', () => {
    it('events: schema and rules in user prompt, not system', () => {
        const msgs = buildEventExtractionPrompt({
            messages: 'Test message',
            names: { char: 'Alice', user: 'Bob' },
            context: {},
            preamble: PREAMBLE,
            prefill: PREFILL,
        });
        expect(msgs).toHaveLength(3);
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
        expect(msgs[2].role).toBe('assistant');
    });

    it('graph: schema and rules in user prompt', () => {
        const msgs = buildGraphExtractionPrompt({
            messages: 'Test message',
            names: { char: 'Alice', user: 'Bob' },
            extractedEvents: [],
            context: {},
            preamble: PREAMBLE,
            prefill: PREFILL,
        });
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
    });

    it('edge consolidation: schema and rules in user prompt', () => {
        const msgs = buildEdgeConsolidationPrompt(
            { source: 'A', target: 'B', weight: 5, description: 'seg1 | seg2' },
            PREAMBLE,
            'auto',
            PREFILL
        );
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
    });

    it('reflection: schema and rules in user prompt', () => {
        const msgs = buildUnifiedReflectionPrompt(
            'Alice',
            [{ id: '1', type: 'event', summary: 'Test', importance: 3 }],
            PREAMBLE,
            'auto',
            PREFILL
        );
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
    });

    it('community: schema and rules in user prompt', () => {
        const msgs = buildCommunitySummaryPrompt(
            ['Alice (PERSON): Test'],
            ['Alice → Bob: friends'],
            PREAMBLE,
            'auto',
            PREFILL
        );
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
    });

    it('global synthesis: schema and rules in user prompt', () => {
        const msgs = buildGlobalSynthesisPrompt(
            [{ title: 'Test', summary: 'Sum', findings: ['f1'] }],
            PREAMBLE,
            'auto',
            PREFILL
        );
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
    });

    it('user prompts contain task-specific rules in <task_rules> tags', () => {
        const msgs = buildEventExtractionPrompt({
            messages: 'Test',
            names: { char: 'A', user: 'B' },
            preamble: PREAMBLE,
            prefill: PREFILL,
        });
        expect(msgs[1].content).toContain('<task_rules>');
        expect(msgs[1].content).toContain('</task_rules>');
    });

    it('system prompts still contain <examples> for domains with examples', () => {
        const msgs = buildEventExtractionPrompt({
            messages: 'Test',
            names: { char: 'A', user: 'B' },
            preamble: PREAMBLE,
            prefill: PREFILL,
        });
        expect(msgs[0].content).toContain('<examples>');
    });
});
