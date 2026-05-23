import { describe, expect, it } from 'vitest';
import { buildGlobalWorldStatePrompt } from '../../../src/prompts/index.js';
import { SYSTEM_PREAMBLE_CN } from '../../../src/prompts/shared/preambles.js';

const PREAMBLE = SYSTEM_PREAMBLE_CN;
const PREFILL = '<thinking>\n';

/**
 * Assert system message has role+examples but NOT schema/rules/language_rules.
 */
function assertSystemPrompt(content) {
    expect(content).toContain('<role>');
    expect(content).not.toContain('<output_schema>');
    expect(content).not.toContain('<task_rules>');
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

describe('Prompt Topology — World State', () => {
    it('buildGlobalWorldStatePrompt: returns 3 messages with correct topology', () => {
        const entities = [
            { name: 'Alice', type: 'PERSON', description: 'Character in the story', mentions: 5 },
            { name: 'The Tavern', type: 'PLACE', description: 'Where characters meet', mentions: 3 },
        ];
        const edges = [{ source: 'Alice', target: 'The Tavern', description: 'Visits frequently', weight: 0.8 }];

        const msgs = buildGlobalWorldStatePrompt(entities, edges, PREAMBLE, 'auto', PREFILL);

        expect(msgs).toHaveLength(3);
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
        expect(msgs[2].role).toBe('assistant');
        expect(msgs[2].content).toBe(PREFILL);
    });

    it('buildGlobalWorldStatePrompt: includes entities and edges in user prompt', () => {
        const entities = [{ name: 'Alice', type: 'PERSON', description: 'Main character', mentions: 5 }];
        const edges = [{ source: 'Alice', target: 'Bob', description: 'Friend', weight: 0.9 }];

        const msgs = buildGlobalWorldStatePrompt(entities, edges, PREAMBLE, 'auto', PREFILL);

        expect(msgs[1].content).toContain('<world_entities>');
        expect(msgs[1].content).toContain('Alice (PERSON)');
        expect(msgs[1].content).toContain('<world_relationships>');
        expect(msgs[1].content).toContain('Alice → Bob');
    });

    it('buildGlobalWorldStatePrompt: defaults to auto language', () => {
        const msgs = buildGlobalWorldStatePrompt([], [], PREAMBLE);

        expect(msgs).toHaveLength(3);
        assertSystemPrompt(msgs[0].content);
        assertUserPrompt(msgs[1].content);
    });
});
