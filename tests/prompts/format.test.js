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

    describe('language filtering', () => {
        const mixedExamples = [
            { input: 'English text', output: '{"events": []}', label: 'Discovery (EN/SFW)' },
            { input: 'Русский текст', output: '{"events": []}', label: 'Emotional conversation (RU/SFW)' },
            { input: 'More English', output: '{"events": []}', label: 'Combat (EN/Moderate)' },
            { input: 'Ещё русский', output: '{"events": []}', label: 'Romantic tension (RU/Moderate)' },
        ];

        it('includes all examples when language is auto', () => {
            const result = formatExamples(mixedExamples, 'auto');
            expect(result).toContain('<example_1>');
            expect(result).toContain('<example_4>');
            expect(result).toContain('English text');
            expect(result).toContain('Русский текст');
        });

        it('filters to EN examples only when language is en', () => {
            const result = formatExamples(mixedExamples, 'en');
            expect(result).toContain('English text');
            expect(result).toContain('More English');
            expect(result).not.toContain('Русский текст');
            expect(result).not.toContain('Ещё русский');
        });

        it('filters to RU examples only when language is ru', () => {
            const result = formatExamples(mixedExamples, 'ru');
            expect(result).toContain('Русский текст');
            expect(result).toContain('Ещё русский');
            expect(result).not.toContain('English text');
            expect(result).not.toContain('More English');
        });

        it('renumbers filtered examples sequentially', () => {
            const result = formatExamples(mixedExamples, 'en');
            expect(result).toContain('<example_1>');
            expect(result).toContain('<example_2>');
            expect(result).not.toContain('<example_3>');
        });

        it('defaults to auto when language param is omitted', () => {
            const resultDefault = formatExamples(mixedExamples);
            const resultAuto = formatExamples(mixedExamples, 'auto');
            expect(resultDefault).toBe(resultAuto);
        });

        it('returns empty string when no examples match the language', () => {
            const enOnly = [{ input: 'text', output: '{}', label: 'Test (EN/SFW)' }];
            expect(formatExamples(enOnly, 'ru')).toBe('');
        });

        it('includes examples without labels in auto mode', () => {
            const noLabel = [{ input: 'text', output: '{}' }];
            const result = formatExamples(noLabel, 'auto');
            expect(result).toContain('<example_1>');
        });

        it('excludes examples without labels in forced mode', () => {
            const noLabel = [{ input: 'text', output: '{}' }];
            expect(formatExamples(noLabel, 'en')).toBe('');
        });
    });
});
