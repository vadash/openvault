// @ts-check
import { describe, expect, it } from 'vitest';
import { GRAPH_RULES } from '../../../src/prompts/graph/rules.js';

describe('GRAPH_RULES', () => {
    it('should contain Step 4 with validation instruction', () => {
        expect(GRAPH_RULES).toContain('Step 4: VALIDATION');
        expect(GRAPH_RULES).toContain("exactly matches a 'name' defined in your entities array");
    });

    it('should contain Step 5 for Output (renamed from Step 4)', () => {
        expect(GRAPH_RULES).toContain('Step 5: Output');
    });

    it('should have validation step before output step', () => {
        const validationIndex = GRAPH_RULES.indexOf('Step 4: VALIDATION');
        const outputIndex = GRAPH_RULES.indexOf('Step 5: Output');
        expect(validationIndex).toBeGreaterThan(-1);
        expect(outputIndex).toBeGreaterThan(-1);
        expect(validationIndex).toBeLessThan(outputIndex);
    });

    describe('OBJECT type definition', () => {
        it('should contain PROHIBITED list for transient objects', () => {
            expect(GRAPH_RULES).toContain('PROHIBITED:');
            expect(GRAPH_RULES).toContain('food, meals, cleaning supplies');
            expect(GRAPH_RULES).toContain('temporary clothing states, consumables');
            expect(GRAPH_RULES).toContain('Do NOT extract fluids');
        });

        it('should allow significant unique items', () => {
            expect(GRAPH_RULES).toContain('The One Ring');
            expect(GRAPH_RULES).toContain('Cursed Sword');
        });
    });
});
