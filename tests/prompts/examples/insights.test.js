import { describe, expect, it } from 'vitest';
import { getExamples } from '../../../src/prompts/reflection/examples/index.js';

const INSIGHT_EXAMPLES = getExamples('INSIGHTS', 'auto');

describe('INSIGHT_EXAMPLES', () => {
    it('exports exactly 6 examples', () => {
        expect(INSIGHT_EXAMPLES).toHaveLength(6);
    });

    it('each example has label, input, output, thinking', () => {
        for (const ex of INSIGHT_EXAMPLES) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(ex).toHaveProperty('thinking');
            expect(typeof ex.thinking).toBe('string');
            expect(ex.thinking.length).toBeGreaterThan(10);
        }
    });

    it('has 3 English and 3 Russian examples', () => {
        expect(INSIGHT_EXAMPLES.filter((ex) => ex.label.includes('EN'))).toHaveLength(3);
        expect(INSIGHT_EXAMPLES.filter((ex) => ex.label.includes('RU'))).toHaveLength(3);
    });

    it('all outputs have 1-3 insights with evidence_ids', () => {
        for (const ex of INSIGHT_EXAMPLES) {
            const parsed = JSON.parse(ex.output);
            expect(parsed.insights.length).toBeGreaterThanOrEqual(1);
            expect(parsed.insights.length).toBeLessThanOrEqual(3);
            for (const insight of parsed.insights) {
                expect(insight).toHaveProperty('insight');
                expect(insight).toHaveProperty('evidence_ids');
                expect(insight.evidence_ids.length).toBeGreaterThan(0);
            }
        }
    });

    it('Russian examples have Russian insight text', () => {
        const cyrillicRe = /[\u0400-\u04FF]/;
        const ruExamples = INSIGHT_EXAMPLES.filter((ex) => ex.label.includes('RU'));
        for (const ex of ruExamples) {
            const parsed = JSON.parse(ex.output);
            for (const ins of parsed.insights) {
                expect(cyrillicRe.test(ins.insight), `Insight in "${ex.label}" should be Russian`).toBe(true);
            }
        }
    });

    it('outputs do NOT contain <thinking> tags', () => {
        for (const ex of INSIGHT_EXAMPLES) {
            expect(ex.output).not.toContain('<thinking>');
            expect(ex.output).not.toContain('</thinking>');
        }
    });

    it('all thinking blocks follow Step N format', () => {
        for (const ex of INSIGHT_EXAMPLES) {
            expect(ex.thinking, `"${ex.label}" must start with Step 1:`).toMatch(/^Step 1:/);
            expect(ex.thinking, `"${ex.label}" must have Step 2:`).toContain('Step 2:');
        }
    });
});
