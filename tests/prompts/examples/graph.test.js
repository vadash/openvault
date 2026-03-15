import { describe, expect, it } from 'vitest';
import { getExamples } from '../../../src/prompts/graph/examples/index.js';

const GRAPH_EXAMPLES = getExamples('auto');

describe('GRAPH_EXAMPLES', () => {
    it('exports exactly 8 examples', () => {
        expect(GRAPH_EXAMPLES).toHaveLength(8);
    });

    it('each example has required fields: label, input, output, thinking', () => {
        for (const ex of GRAPH_EXAMPLES) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(ex).toHaveProperty('thinking');
            expect(typeof ex.input).toBe('string');
            expect(typeof ex.output).toBe('string');
            expect(typeof ex.thinking).toBe('string');
            expect(ex.thinking.length).toBeGreaterThan(10);
        }
    });

    it('has 4 English and 4 Russian examples', () => {
        const enExamples = GRAPH_EXAMPLES.filter((ex) => ex.label.includes('EN'));
        const ruExamples = GRAPH_EXAMPLES.filter((ex) => ex.label.includes('RU'));
        expect(enExamples).toHaveLength(4);
        expect(ruExamples).toHaveLength(4);
    });

    it('Russian examples have Russian text in output', () => {
        const ruExamples = GRAPH_EXAMPLES.filter((ex) => ex.label.includes('RU'));
        const cyrillicRe = /[\u0400-\u04FF]/;
        for (const ex of ruExamples) {
            expect(cyrillicRe.test(ex.output), `RU example "${ex.label}" should have Cyrillic in output`).toBe(true);
        }
    });

    it('all outputs contain both entities and relationships keys', () => {
        for (const ex of GRAPH_EXAMPLES) {
            const parsed = JSON.parse(ex.output);
            expect(parsed).toHaveProperty('entities');
            expect(parsed).toHaveProperty('relationships');
        }
    });

    it('Russian entity names use nominative case', () => {
        const ruExamples = GRAPH_EXAMPLES.filter((ex) => ex.label.includes('RU'));
        for (const ex of ruExamples) {
            const parsed = JSON.parse(ex.output);
            for (const entity of parsed.entities) {
                expect(entity.name).not.toMatch(/ником$/);
                expect(entity.name).not.toMatch(/нику$/);
            }
        }
    });

    it('outputs do NOT contain <thinking> tags (handled by thinking property)', () => {
        for (const ex of GRAPH_EXAMPLES) {
            expect(ex.output).not.toContain('<thinking>');
            expect(ex.output).not.toContain('</thinking>');
        }
    });

    it('all thinking blocks follow rigid Step N format', () => {
        for (const ex of GRAPH_EXAMPLES) {
            expect(ex.thinking, `"${ex.label}" must start with Step 1:`).toMatch(/^Step 1:/);
            expect(ex.thinking, `"${ex.label}" must have Step 2:`).toContain('Step 2:');
        }
    });
});
