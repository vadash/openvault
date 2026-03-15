import { describe, expect, it } from 'vitest';
import { COMMUNITY_SCHEMA, GLOBAL_SYNTHESIS_SCHEMA } from '../../src/prompts/communities/schema.js';
import { EVENT_SCHEMA } from '../../src/prompts/events/schema.js';
import { EDGE_CONSOLIDATION_SCHEMA, GRAPH_SCHEMA } from '../../src/prompts/graph/schema.js';
import { INSIGHTS_SCHEMA, QUESTIONS_SCHEMA, UNIFIED_REFLECTION_SCHEMA } from '../../src/prompts/reflection/schema.js';

const ALL_SCHEMAS = {
    EVENT_SCHEMA,
    GRAPH_SCHEMA,
    EDGE_CONSOLIDATION_SCHEMA,
    UNIFIED_REFLECTION_SCHEMA,
    QUESTIONS_SCHEMA,
    INSIGHTS_SCHEMA,
    COMMUNITY_SCHEMA,
    GLOBAL_SYNTHESIS_SCHEMA,
};

describe('Schema anti-hallucination directives', () => {
    it('all schemas contain anti-concatenation rule mentioning "+"', () => {
        for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
            expect(schema, `${name} must have anti-concatenation rule`).toContain('string concatenation');
            expect(schema, `${name} must mention "+"`).toContain('"+"');
        }
    });

    it('no schema contains negative <tool_call> constraint (moved to EXECUTION_TRIGGER)', () => {
        for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
            expect(schema, `${name} should not mention tool_call`).not.toContain('<tool_call>');
        }
    });

    it('all schemas require JSON object at top level', () => {
        for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
            expect(schema, `${name} must require JSON object`).toContain('JSON object');
        }
    });

    it('all schemas prohibit markdown code blocks', () => {
        for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
            expect(schema, `${name} must prohibit code blocks`).toContain('markdown code blocks');
        }
    });

    it('no schema contains redundant thinking-tag instructions (moved to EXECUTION_TRIGGER)', () => {
        for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
            expect(schema, `${name} should not instruct about thinking tags`).not.toContain(
                'You MUST respond with your analysis FIRST'
            );
        }
    });
});
