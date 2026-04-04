import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../../../src/prompts/events/examples/ru.js';

describe('events/examples/ru', () => {
    it('should have 7 examples', () => {
        expect(EXAMPLES).toHaveLength(7);
    });

    it('should include conversational commitment example', () => {
        const commitmentExample = EXAMPLES.find((e) => e.label.includes('Conversational commitment'));
        expect(commitmentExample).toBeDefined();
        expect(commitmentExample.input).toContain('средам');
        expect(commitmentExample.input).toContain('Глеб');
    });

    it('should have Russian input/output and English thinking', () => {
        const commitmentExample = EXAMPLES.find((e) => e.label.includes('Conversational commitment'));
        // Thinking should be in English (per language rules)
        expect(commitmentExample.thinking).toContain('Cross-reference');
        expect(commitmentExample.thinking).toContain('durable');
        // Output should contain Russian text
        expect(commitmentExample.output).toContain('ср'); // средам (Wednesdays)
    });

    it('should show durability evaluation in thinking process', () => {
        const commitmentExample = EXAMPLES.find((e) => e.label.includes('Conversational commitment'));
        expect(commitmentExample.thinking).toContain('momentary');
        expect(commitmentExample.thinking).toContain('durable');
    });
});
