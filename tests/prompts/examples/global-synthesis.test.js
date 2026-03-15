import { getExamples } from '../../../src/prompts/communities/examples/index.js';

const GLOBAL_SYNTHESIS_EXAMPLES = getExamples('GLOBAL_SYNTHESIS', 'auto');

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

describe('GLOBAL_SYNTHESIS_EXAMPLES', () => {
    it('should have at least 4 examples (2 EN + 2 RU)', () => {
        expect(GLOBAL_SYNTHESIS_EXAMPLES.length).toBeGreaterThanOrEqual(4);
    });

    it('should have bilingual examples', () => {
        const hasEn = GLOBAL_SYNTHESIS_EXAMPLES.some((e) => e.label.includes('EN'));
        const hasRu = GLOBAL_SYNTHESIS_EXAMPLES.some((e) => e.label.includes('RU'));
        expect(hasEn).toBe(true);
        expect(hasRu).toBe(true);
    });

    it('should have required input/output fields', () => {
        GLOBAL_SYNTHESIS_EXAMPLES.forEach((example) => {
            expect(example.input).toBeDefined();
            expect(example.output).toBeDefined();
            expect(example.label).toBeDefined();
        });
    });

    it('all examples have non-empty thinking field', () => {
        for (const ex of GLOBAL_SYNTHESIS_EXAMPLES) {
            expect(ex).toHaveProperty('thinking');
            expect(typeof ex.thinking).toBe('string');
            expect(ex.thinking.length).toBeGreaterThan(10);
        }
    });

    it('all outputs have global_summary after thinking tags', () => {
        for (const ex of GLOBAL_SYNTHESIS_EXAMPLES) {
            const parsed = JSON.parse(extractJson(ex.output));
            expect(parsed).toHaveProperty('global_summary');
        }
    });
});
