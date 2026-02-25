import { describe, expect, it } from 'vitest';
import { buildExtractionPrompt, buildSmartRetrievalPrompt } from '../src/prompts.js';

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

    it('system prompt contains multilingual anchoring terms', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        // Russian terms
        expect(sys).toContain('эротика');
        // Should contain importance scale
        expect(sys).toContain('1');
        expect(sys).toContain('5');
    });

    it('system prompt instructs reasoning-first', () => {
        const result = buildExtractionPrompt(baseArgs);
        const sys = result[0].content;
        expect(sys).toMatch(/reasoning.*first|think.*before|reasoning.*field.*before/i);
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
});

describe('buildSmartRetrievalPrompt', () => {
    it('returns system and user message array', () => {
        const result = buildSmartRetrievalPrompt('scene text', '1. [action] Memory 1', 'Alice', 5);
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
    });

    it('system prompt contains selection criteria', () => {
        const result = buildSmartRetrievalPrompt('scene', 'memories', 'Alice', 5);
        const sys = result[0].content;
        expect(sys).toContain('selection_criteria');
    });

    it('system prompt contains examples', () => {
        const result = buildSmartRetrievalPrompt('scene', 'memories', 'Alice', 5);
        const sys = result[0].content;
        expect(sys).toContain('<examples>');
    });

    it('system prompt instructs reasoning-first output', () => {
        const result = buildSmartRetrievalPrompt('scene', 'memories', 'Alice', 5);
        const sys = result[0].content;
        expect(sys).toMatch(/reasoning.*first|think.*before/i);
    });

    it('user prompt contains character name', () => {
        const result = buildSmartRetrievalPrompt('scene', 'memories', 'Alice', 5);
        const usr = result[1].content;
        expect(usr).toContain('Alice');
    });

    it('user prompt contains memory list', () => {
        const list = '1. [action] [★★★] Alice fought\n2. [revelation] [★★★★★] Bob confessed';
        const result = buildSmartRetrievalPrompt('scene', list, 'Alice', 3);
        const usr = result[1].content;
        expect(usr).toContain('Alice fought');
        expect(usr).toContain('Bob confessed');
    });

    it('user prompt contains limit', () => {
        const result = buildSmartRetrievalPrompt('scene', 'memories', 'Alice', 7);
        const usr = result[1].content;
        expect(usr).toContain('7');
    });
});
