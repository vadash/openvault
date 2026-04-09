import { describe, expect, it } from 'vitest';
import {
    assembleSystemPrompt,
    assembleUserConstraints,
    EXECUTION_TRIGGER,
} from '../../src/prompts/shared/formatters.js';

describe('assembleSystemPrompt (new topology)', () => {
    it('includes role in <role> tags', () => {
        const result = assembleSystemPrompt({ role: 'Test role', examples: [] });
        expect(result).toContain('<role>\nTest role\n</role>');
    });

    it('includes examples section when examples are provided', () => {
        const examples = [{ input: 'test', output: '{}' }];
        const result = assembleSystemPrompt({ role: 'Role', examples });
        expect(result).toContain('<examples>');
        expect(result).toContain('</examples>');
    });

    it('omits examples section for empty array', () => {
        const result = assembleSystemPrompt({ role: 'Role', examples: [] });
        expect(result).not.toContain('<examples>');
    });

    it('does NOT include schema, rules, or language_rules', () => {
        const result = assembleSystemPrompt({ role: 'Role', examples: [] });
        expect(result).not.toContain('<output_schema>');
        expect(result).not.toContain('<task_rules>');
        expect(result).not.toContain('<language_rules>');
    });
});

describe('assembleUserConstraints', () => {
    it('includes language_rules block', () => {
        const result = assembleUserConstraints({ schema: 'S' });
        expect(result).toContain('<language_rules>');
        expect(result).toContain('</language_rules>');
    });

    it('includes schema in <output_schema> tags', () => {
        const result = assembleUserConstraints({ schema: 'Test schema text' });
        expect(result).toContain('<output_schema>\nTest schema text\n</output_schema>');
    });

    it('includes task rules when provided', () => {
        const result = assembleUserConstraints({ schema: 'S', rules: 'My rules' });
        expect(result).toContain('<task_rules>\nMy rules\n</task_rules>');
    });

    it('omits task rules when not provided', () => {
        const result = assembleUserConstraints({ schema: 'S' });
        expect(result).not.toContain('<task_rules>');
    });

    it('includes dynamic language instruction when provided', () => {
        const result = assembleUserConstraints({
            schema: 'S',
            languageInstruction: 'WRITE IN RUSSIAN',
        });
        expect(result).toContain('WRITE IN RUSSIAN');
    });

    it('includes EXECUTION_TRIGGER at the end', () => {
        const result = assembleUserConstraints({ schema: 'S' });
        expect(result).toContain('OUTPUT FORMAT:');
        expect(result).toContain('No tool calls');
    });

    it('orders sections: language_rules → lang instruction → rules → schema → trigger', () => {
        const result = assembleUserConstraints({
            schema: 'SCHEMA_TEXT',
            rules: 'RULES_TEXT',
            languageInstruction: 'LANG_INST_TEXT',
        });
        const langIdx = result.indexOf('<language_rules>');
        const instIdx = result.indexOf('LANG_INST_TEXT');
        const rulesIdx = result.indexOf('<task_rules>');
        const schemaIdx = result.indexOf('<output_schema>');
        const triggerIdx = result.indexOf('OUTPUT FORMAT:');
        expect(langIdx).toBeLessThan(instIdx);
        expect(instIdx).toBeLessThan(rulesIdx);
        expect(rulesIdx).toBeLessThan(schemaIdx);
        expect(schemaIdx).toBeLessThan(triggerIdx);
    });
});

describe('EXECUTION_TRIGGER', () => {
    it('is a non-empty string starting with OUTPUT FORMAT:', () => {
        expect(typeof EXECUTION_TRIGGER).toBe('string');
        expect(EXECUTION_TRIGGER).toMatch(/^OUTPUT FORMAT:/);
    });

    it('uses positive framing (no "Do NOT")', () => {
        expect(EXECUTION_TRIGGER).not.toContain('Do NOT');
        expect(EXECUTION_TRIGGER).not.toContain('Do not');
    });
});

describe('formatCharacters - userName fallback', () => {
    it('uses "User" when userName is empty string', async () => {
        const { formatCharacters } = await import('../../src/prompts/shared/formatters.js');
        const result = formatCharacters('Alice', '', 'A brave knight', 'A curious soul');
        expect(result).toContain('name="User"');
        expect(result).not.toContain('name=""');
    });

    it('uses "User" when userName is undefined', async () => {
        const { formatCharacters } = await import('../../src/prompts/shared/formatters.js');
        const result = formatCharacters('Alice', undefined, '', '');
        expect(result).toContain('name="User"');
        expect(result).not.toContain('name="undefined"');
    });

    it('uses actual userName when provided', async () => {
        const { formatCharacters } = await import('../../src/prompts/shared/formatters.js');
        const result = formatCharacters('Alice', 'Vova', '', '');
        expect(result).toContain('name="Vova"');
        expect(result).not.toContain('name="User"');
    });
});

describe('buildEventExtractionPrompt - userName fallback', () => {
    it('does not inject literal "undefined" in user prompt', async () => {
        const { buildEventExtractionPrompt } = await import('../../src/prompts/events/builder.js');
        const result = buildEventExtractionPrompt({
            messages: 'Hello world',
            names: { char: 'Alice', user: undefined },
            context: {},
        });
        const userMsg = result.find((m) => m.role === 'user');
        expect(userMsg.content).not.toContain('undefined');
        expect(userMsg.content).toContain('User');
    });

    it('uses actual userName when provided', async () => {
        const { buildEventExtractionPrompt } = await import('../../src/prompts/events/builder.js');
        const result = buildEventExtractionPrompt({
            messages: 'Hello world',
            names: { char: 'Alice', user: 'Vova' },
            context: {},
        });
        const userMsg = result.find((m) => m.role === 'user');
        expect(userMsg.content).toContain('Vova');
    });
});

describe('buildGraphExtractionPrompt - userName fallback', () => {
    it('does not inject literal "undefined" in user prompt', async () => {
        const { buildGraphExtractionPrompt } = await import('../../src/prompts/graph/builder.js');
        const result = buildGraphExtractionPrompt({
            messages: 'Hello world',
            names: { char: 'Alice', user: undefined },
            context: {},
        });
        const userMsg = result.find((m) => m.role === 'user');
        expect(userMsg.content).not.toContain('undefined');
        expect(userMsg.content).toContain('User');
    });
});
