import { describe, expect, it } from 'vitest';
import { formatExamples } from '../../src/prompts/examples/format.js';

describe('formatExamples', () => {
    it('wraps each example in numbered XML tags', () => {
        const examples = [{ input: 'Hello world', output: '{"events": []}' }];
        const result = formatExamples(examples);
        expect(result).toContain('<example_1>');
        expect(result).toContain('</example_1>');
    });

    it('wraps input in <input> tags', () => {
        const examples = [{ input: 'Some narrative text', output: '{"events": []}' }];
        const result = formatExamples(examples);
        expect(result).toContain('<input>\nSome narrative text\n</input>');
    });

    it('wraps output in <ideal_output> tags', () => {
        const examples = [{ input: 'text', output: '{"events": []}' }];
        const result = formatExamples(examples);
        expect(result).toContain('<ideal_output>');
        expect(result).toContain('</ideal_output>');
    });

    it('includes <think> block when thinking field is present', () => {
        const examples = [{ input: 'text', thinking: 'Step 1: analysis', output: '{"events": []}' }];
        const result = formatExamples(examples);
        expect(result).toContain('<think>\nStep 1: analysis\n</think>');
        expect(result).toContain('{"events": []}');
    });

    it('omits <think> block when thinking field is absent', () => {
        const examples = [{ input: 'text', output: '{"entities": []}' }];
        const result = formatExamples(examples);
        expect(result).not.toContain('<think>');
    });

    it('numbers multiple examples sequentially', () => {
        const examples = [
            { input: 'first', output: '1' },
            { input: 'second', output: '2' },
            { input: 'third', output: '3' },
        ];
        const result = formatExamples(examples);
        expect(result).toContain('<example_1>');
        expect(result).toContain('<example_2>');
        expect(result).toContain('<example_3>');
    });

    it('separates examples with double newline', () => {
        const examples = [
            { input: 'a', output: '1' },
            { input: 'b', output: '2' },
        ];
        const result = formatExamples(examples);
        expect(result).toContain('</example_1>\n\n<example_2>');
    });

    it('returns empty string for empty array', () => {
        expect(formatExamples([])).toBe('');
    });
});
