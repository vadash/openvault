import { describe, expect, it } from 'vitest';
import { getExamples } from '../../../src/prompts/reflection/examples/index.js';

const UNIFIED_REFLECTION_EXAMPLES = getExamples('REFLECTIONS', 'auto');

describe('UNIFIED_REFLECTION_EXAMPLES', () => {
    it('exports exactly 6 examples (3 EN + 3 RU)', () => {
        expect(UNIFIED_REFLECTION_EXAMPLES).toHaveLength(6);
    });

    it('contains 3 English examples', () => {
        const enExamples = UNIFIED_REFLECTION_EXAMPLES.filter((e) => e.label.includes('(EN'));
        expect(enExamples).toHaveLength(3);
    });

    it('contains 3 Russian examples', () => {
        const ruExamples = UNIFIED_REFLECTION_EXAMPLES.filter((e) => e.label.includes('(RU'));
        expect(ruExamples).toHaveLength(3);
    });

    it('each example has input, output, thinking with reflections array', () => {
        for (const example of UNIFIED_REFLECTION_EXAMPLES) {
            expect(example.input).toBeDefined();
            expect(example.output).toBeDefined();
            expect(example).toHaveProperty('thinking');
            expect(typeof example.thinking).toBe('string');
            expect(example.thinking.length).toBeGreaterThan(10);
            const parsed = JSON.parse(example.output);
            expect(Array.isArray(parsed.reflections)).toBe(true);
            expect(parsed.reflections.length).toBeGreaterThan(0);
            expect(parsed.reflections[0]).toHaveProperty('question');
            expect(parsed.reflections[0]).toHaveProperty('insight');
            expect(parsed.reflections[0]).toHaveProperty('evidence_ids');
        }
    });

    it('progresses from SFW to explicit content', () => {
        const labels = UNIFIED_REFLECTION_EXAMPLES.map((e) => e.label);
        const hasSFW = labels.some((l) => l.includes('SFW'));
        const hasModerate = labels.some((l) => l.includes('Moderate'));
        const hasExplicit = labels.some((l) => l.includes('Explicit'));
        expect(hasSFW).toBe(true);
        expect(hasModerate).toBe(true);
        expect(hasExplicit).toBe(true);
    });

    it('outputs do NOT contain <thinking> tags', () => {
        for (const ex of UNIFIED_REFLECTION_EXAMPLES) {
            expect(ex.output).not.toContain('<thinking>');
            expect(ex.output).not.toContain('</thinking>');
        }
    });

    it('all thinking blocks follow Step N format', () => {
        for (const ex of UNIFIED_REFLECTION_EXAMPLES) {
            expect(ex.thinking, `"${ex.label}" must start with Step 1:`).toMatch(/^Step 1:/);
            expect(ex.thinking, `"${ex.label}" must have Step 2:`).toContain('Step 2:');
        }
    });
});
