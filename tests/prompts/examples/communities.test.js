import { describe, expect, it } from 'vitest';
import { getExamples } from '../../../src/prompts/communities/examples/index.js';

const COMMUNITY_EXAMPLES = getExamples('COMMUNITIES', 'auto');

/**
 * Extract JSON from output that may contain <thinking> tags.
 * If the output has <thinking>...</thinking>, extract the JSON after it.
 * Otherwise, return the original output.
 */
function extractJson(output) {
    const thinkingEnd = output.indexOf('</thinking>');
    if (thinkingEnd !== -1) {
        return output.slice(thinkingEnd + '</thinking>'.length).trim();
    }
    return output;
}

describe('COMMUNITY_EXAMPLES', () => {
    it('exports exactly 6 examples', () => {
        expect(COMMUNITY_EXAMPLES).toHaveLength(6);
    });

    it('each example has label, input, output, and thinking', () => {
        for (const ex of COMMUNITY_EXAMPLES) {
            expect(ex).toHaveProperty('label');
            expect(ex).toHaveProperty('input');
            expect(ex).toHaveProperty('output');
            expect(ex).toHaveProperty('thinking');
            expect(typeof ex.thinking).toBe('string');
            expect(ex.thinking.length).toBeGreaterThan(10);
        }
    });

    it('has 3 English and 3 Russian examples', () => {
        expect(COMMUNITY_EXAMPLES.filter((ex) => ex.label.includes('EN'))).toHaveLength(3);
        expect(COMMUNITY_EXAMPLES.filter((ex) => ex.label.includes('RU'))).toHaveLength(3);
    });

    it('all outputs have title, summary, and 1-5 findings', () => {
        for (const ex of COMMUNITY_EXAMPLES) {
            const parsed = JSON.parse(extractJson(ex.output));
            expect(parsed).toHaveProperty('title');
            expect(parsed).toHaveProperty('summary');
            expect(parsed).toHaveProperty('findings');
            expect(parsed.findings.length).toBeGreaterThanOrEqual(1);
            expect(parsed.findings.length).toBeLessThanOrEqual(5);
        }
    });

    it('Russian examples have Russian summary and findings', () => {
        const cyrillicRe = /[\u0400-\u04FF]/;
        const ruExamples = COMMUNITY_EXAMPLES.filter((ex) => ex.label.includes('RU'));
        for (const ex of ruExamples) {
            const parsed = JSON.parse(extractJson(ex.output));
            expect(cyrillicRe.test(parsed.summary), `Summary in "${ex.label}" should be Russian`).toBe(true);
            expect(cyrillicRe.test(parsed.findings[0]), `Finding in "${ex.label}" should be Russian`).toBe(true);
        }
    });

    it('all examples have non-empty thinking field', () => {
        for (const ex of COMMUNITY_EXAMPLES) {
            expect(typeof ex.thinking).toBe('string');
            expect(ex.thinking.length).toBeGreaterThan(10);
        }
    });

    it('all thinking fields follow rigid Step N format', () => {
        for (const ex of COMMUNITY_EXAMPLES) {
            expect(ex.thinking, `"${ex.label}" must start with Step 1:`).toMatch(/^Step 1:/);
            expect(ex.thinking, `"${ex.label}" must have Step 2:`).toContain('Step 2:');
        }
    });
});
