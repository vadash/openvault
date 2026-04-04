import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../../src/prompts/events/examples/en.js';

describe('events/examples/en', () => {
    it('should have 7 examples', () => {
        expect(EXAMPLES).toHaveLength(7);
    });

    it('should include conversational commitment example', () => {
        const commitmentExample = EXAMPLES.find((e) => e.label.includes('Conversational commitment'));
        expect(commitmentExample).toBeDefined();
        expect(commitmentExample.input).toContain('Tuesday');
        expect(commitmentExample.input).toContain('Marcus');
        expect(commitmentExample.input).toContain('Yolanda');
    });

    it('should show durability evaluation in thinking process', () => {
        const commitmentExample = EXAMPLES.find((e) => e.label.includes('Conversational commitment'));
        expect(commitmentExample.thinking).toContain('transient');
        expect(commitmentExample.thinking).toContain('durable');
    });

    it('should extract schedule change and promise as importance 3', () => {
        const commitmentExample = EXAMPLES.find((e) => e.label.includes('Conversational commitment'));
        expect(commitmentExample.output).toContain('importance": 3');
        expect(commitmentExample.output).toContain('Tuesday shift rotation');
        expect(commitmentExample.output).toContain('calendar-logged');
    });
});
