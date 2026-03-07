import { describe, expect, it } from 'vitest';
import { GRAPH_EXAMPLES } from '../../../src/prompts/examples/graph.js';

describe('GRAPH_EXAMPLES', () => {
    it('exports exactly 8 examples', () => {
        expect(GRAPH_EXAMPLES).toHaveLength(8);
    });

    it('each example has required fields: label, input, output (no thinking)', () => {
        for (const ex of GRAPH_EXAMPLES) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(typeof ex.input).toBe('string');
            expect(typeof ex.output).toBe('string');
            // Graph uses { prefill, no thinking
            expect(ex.thinking).toBeUndefined();
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
                // Nominative Russian names should not end in typical oblique case endings
                // This is a heuristic — mainly checks that "Ошейником" doesn't appear as a name
                expect(entity.name).not.toMatch(/ником$/);
                expect(entity.name).not.toMatch(/нику$/);
            }
        }
    });
});
