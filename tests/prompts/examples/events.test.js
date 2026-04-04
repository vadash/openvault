import { describe, expect, it } from 'vitest';
import { getExamples } from '../../../src/prompts/events/examples/index.js';

const EVENT_EXAMPLES = getExamples('auto');

describe('EVENT_EXAMPLES', () => {
    it('exports exactly 14 examples', () => {
        expect(EVENT_EXAMPLES).toHaveLength(14);
    });

    it('each example has required fields: label, input, output', () => {
        for (const ex of EVENT_EXAMPLES) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(typeof ex.label).toBe('string');
            expect(typeof ex.input).toBe('string');
            expect(typeof ex.output).toBe('string');
            expect(ex.input.length).toBeGreaterThan(20);
            expect(ex.output.length).toBeGreaterThan(5);
        }
    });

    it('each example has a thinking field (events use <thinking> prefill)', () => {
        for (const ex of EVENT_EXAMPLES) {
            expect(ex).toHaveProperty('thinking');
            expect(typeof ex.thinking).toBe('string');
            expect(ex.thinking.length).toBeGreaterThan(10);
        }
    });

    it('has 7 English and 7 Russian examples', () => {
        const enExamples = EVENT_EXAMPLES.filter((ex) => ex.label.includes('EN'));
        const ruExamples = EVENT_EXAMPLES.filter((ex) => ex.label.includes('RU'));
        expect(enExamples).toHaveLength(7);
        expect(ruExamples).toHaveLength(7);
    });

    it('Russian examples have Russian text in output', () => {
        const ruExamples = EVENT_EXAMPLES.filter((ex) => ex.label.includes('RU'));
        const cyrillicRe = /[\u0400-\u04FF]/;
        for (const ex of ruExamples) {
            // Skip dedup examples that output empty events array
            if (ex.output.includes('"events": []') || ex.output.includes('"events":[]')) continue;
            expect(cyrillicRe.test(ex.output), `RU example "${ex.label}" should have Cyrillic in output`).toBe(true);
        }
    });

    it('all thinking blocks are in English (Language Rule 7)', () => {
        const cyrillicRe = /[\u0400-\u04FF]/;
        for (const ex of EVENT_EXAMPLES) {
            expect(cyrillicRe.test(ex.thinking), `Thinking in "${ex.label}" must be English-only`).toBe(false);
        }
    });

    it('includes dedup edge cases with importance 2 (progression within established scene)', () => {
        const dedupExamples = EVENT_EXAMPLES.filter(
            (ex) => ex.label.includes('Dedup') && ex.output.includes('"importance": 2')
        );
        expect(dedupExamples.length).toBeGreaterThanOrEqual(1);
    });

    it('JSON in output fields is valid', () => {
        for (const ex of EVENT_EXAMPLES) {
            expect(() => JSON.parse(ex.output), `Output in "${ex.label}" must be valid JSON`).not.toThrow();
        }
    });

    it('all thinking blocks follow rigid Step N: LABEL format', () => {
        for (const ex of EVENT_EXAMPLES) {
            expect(ex.thinking, `"${ex.label}" must start with Step 1:`).toMatch(/^Step 1:/);
            expect(ex.thinking, `"${ex.label}" must have Step 2:`).toContain('Step 2:');
        }
    });
});
