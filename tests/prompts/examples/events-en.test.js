import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../../src/prompts/events/examples/en.js';

describe('events/examples/en', () => {
    it('should have 7 examples', () => {
        expect(EXAMPLES).toHaveLength(7);
    });

    it('should include conversational commitment example', () => {
        const commitmentExample = EXAMPLES.find((e) => e.label.includes('Conversational commitment'));
        expect(commitmentExample).toBeDefined();
        expect(commitmentExample.input).toContain("I can't do Tuesdays anymore");
        expect(commitmentExample.input).toContain('Alice');
        expect(commitmentExample.input).toContain('Bob');
    });

    it('should show durability evaluation in thinking process', () => {
        const commitmentExample = EXAMPLES.find((e) => e.label.includes('Conversational commitment'));
        expect(commitmentExample.thinking).toContain('momentary (skip)');
        expect(commitmentExample.thinking).toContain('durable');
    });

    it('should extract schedule change and promise as importance 3', () => {
        const commitmentExample = EXAMPLES.find((e) => e.label.includes('Conversational commitment'));
        expect(commitmentExample.output).toContain('importance": 3');
        expect(commitmentExample.output).toContain('move their meetups to Wednesdays');
        expect(commitmentExample.output).toContain('promised to text');
    });
});
