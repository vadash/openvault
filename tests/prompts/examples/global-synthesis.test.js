import { GLOBAL_SYNTHESIS_EXAMPLES } from '../../../src/prompts/examples/global-synthesis.js';

describe('GLOBAL_SYNTHESIS_EXAMPLES', () => {
    it('should have at least 4 examples (2 EN + 2 RU)', () => {
        expect(GLOBAL_SYNTHESIS_EXAMPLES.length).toBeGreaterThanOrEqual(4);
    });

    it('should have bilingual examples', () => {
        const hasEn = GLOBAL_SYNTHESIS_EXAMPLES.some(e => e.label.includes('EN'));
        const hasRu = GLOBAL_SYNTHESIS_EXAMPLES.some(e => e.label.includes('RU'));
        expect(hasEn).toBe(true);
        expect(hasRu).toBe(true);
    });

    it('should have required input/output fields', () => {
        GLOBAL_SYNTHESIS_EXAMPLES.forEach(example => {
            expect(example.input).toBeDefined();
            expect(example.output).toBeDefined();
            expect(example.label).toBeDefined();
        });
    });
});
