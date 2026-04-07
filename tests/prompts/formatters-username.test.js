// @ts-check
/* global describe, expect, it */
import { describe, expect, it } from 'vitest';

describe('formatCharacters - userName fallback', () => {
    it('uses "User" when userName is empty string', async () => {
        const { formatCharacters } = await import('../../src/prompts/shared/formatters.js');
        const result = formatCharacters('Alice', '', 'A brave knight', 'A curious soul');
        expect(result).toContain('name="User"');
        expect(result).not.toContain('name=""');
    });

    it('uses "User" when userName is undefined', async () => {
        const { formatCharacters } = await import('../../src/prompts/shared/formatters.js');
        const result = formatCharacters('Alice', undefined, '', '');
        expect(result).toContain('name="User"');
        expect(result).not.toContain('name="undefined"');
    });

    it('uses actual userName when provided', async () => {
        const { formatCharacters } = await import('../../src/prompts/shared/formatters.js');
        const result = formatCharacters('Alice', 'Vova', '', '');
        expect(result).toContain('name="Vova"');
        expect(result).not.toContain('name="User"');
    });
});

describe('buildEventExtractionPrompt - userName fallback', () => {
    it('does not inject literal "undefined" in user prompt', async () => {
        const { buildEventExtractionPrompt } = await import('../../src/prompts/events/builder.js');
        const result = buildEventExtractionPrompt({
            messages: 'Hello world',
            names: { char: 'Alice', user: undefined },
            context: {},
        });
        const userMsg = result.find((m) => m.role === 'user');
        expect(userMsg.content).not.toContain('undefined');
        expect(userMsg.content).toContain('User');
    });

    it('uses actual userName when provided', async () => {
        const { buildEventExtractionPrompt } = await import('../../src/prompts/events/builder.js');
        const result = buildEventExtractionPrompt({
            messages: 'Hello world',
            names: { char: 'Alice', user: 'Vova' },
            context: {},
        });
        const userMsg = result.find((m) => m.role === 'user');
        expect(userMsg.content).toContain('Vova');
    });
});

describe('buildGraphExtractionPrompt - userName fallback', () => {
    it('does not inject literal "undefined" in user prompt', async () => {
        const { buildGraphExtractionPrompt } = await import('../../src/prompts/graph/builder.js');
        const result = buildGraphExtractionPrompt({
            messages: 'Hello world',
            names: { char: 'Alice', user: undefined },
            context: {},
        });
        const userMsg = result.find((m) => m.role === 'user');
        expect(userMsg.content).not.toContain('undefined');
        expect(userMsg.content).toContain('User');
    });
});
