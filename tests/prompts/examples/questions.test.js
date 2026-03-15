import { describe, expect, it } from 'vitest';
import { getExamples } from '../../../src/prompts/reflection/examples/index.js';

const QUESTION_EXAMPLES = getExamples('QUESTIONS', 'auto');

describe('QUESTION_EXAMPLES', () => {
    it('exports exactly 6 examples', () => {
        expect(QUESTION_EXAMPLES).toHaveLength(6);
    });

    it('each example has label, input, output, thinking', () => {
        for (const ex of QUESTION_EXAMPLES) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(ex).toHaveProperty('thinking');
            expect(typeof ex.thinking).toBe('string');
            expect(ex.thinking.length).toBeGreaterThan(10);
        }
    });

    it('has 3 English and 3 Russian examples', () => {
        expect(QUESTION_EXAMPLES.filter((ex) => ex.label.includes('EN'))).toHaveLength(3);
        expect(QUESTION_EXAMPLES.filter((ex) => ex.label.includes('RU'))).toHaveLength(3);
    });

    it('all outputs have exactly 3 questions', () => {
        for (const ex of QUESTION_EXAMPLES) {
            const parsed = JSON.parse(ex.output);
            expect(parsed.questions).toHaveLength(3);
        }
    });

    it('Russian examples have Russian questions', () => {
        const cyrillicRe = /[\u0400-\u04FF]/;
        const ruExamples = QUESTION_EXAMPLES.filter((ex) => ex.label.includes('RU'));
        for (const ex of ruExamples) {
            expect(cyrillicRe.test(ex.output), `RU example "${ex.label}" should have Cyrillic`).toBe(true);
        }
    });

    it('outputs do NOT contain <thinking> tags', () => {
        for (const ex of QUESTION_EXAMPLES) {
            expect(ex.output).not.toContain('<thinking>');
            expect(ex.output).not.toContain('</thinking>');
        }
    });

    it('all thinking blocks follow Step N format', () => {
        for (const ex of QUESTION_EXAMPLES) {
            expect(ex.thinking, `"${ex.label}" must start with Step 1:`).toMatch(/^Step 1:/);
            expect(ex.thinking, `"${ex.label}" must have Step 2:`).toContain('Step 2:');
        }
    });
});
