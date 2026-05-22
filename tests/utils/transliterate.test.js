import { describe, expect, it } from 'vitest';
import { levenshteinDistance, resolveCharacterName, transliterateCyrToLat } from '../../src/utils/transliterate.js';

describe('transliterateCyrToLat', () => {
    it('transliterates Сузи to suzi', async () => {
        expect(await transliterateCyrToLat('Сузи')).toBe('suzi');
    });

    it('transliterates Вова to vova', async () => {
        expect(await transliterateCyrToLat('Вова')).toBe('vova');
    });

    it('transliterates Мина to mina', async () => {
        expect(await transliterateCyrToLat('Мина')).toBe('mina');
    });

    it('passes through Latin text unchanged (lowercased)', async () => {
        expect(await transliterateCyrToLat('Suzy')).toBe('suzy');
    });

    it('handles empty string', async () => {
        expect(await transliterateCyrToLat('')).toBe('');
    });

    it('falls back to lowercase when CDN unavailable', async () => {
        // Mock cdnImport to throw for cyrillic-to-translit-js
        vi.doMock('../../src/utils/cdn.js', async () => {
            const actual = await vi.importActual('../../src/utils/cdn.js');
            return {
                ...actual,
                cdnImport: async (spec) => {
                    if (spec === 'cyrillic-to-translit-js') {
                        throw new Error('CDN unavailable');
                    }
                    return actual.cdnImport(spec);
                },
            };
        });

        // Reset modules to pick up the mock
        vi.resetModules();
        await global.registerCdnOverrides();
        const { transliterateCyrToLat: noCdnTranslit } = await import('../../src/utils/transliterate.js');

        // Fallback: returns lowercase only (no translit)
        expect(await noCdnTranslit('Привет')).toBe('привет');

        // Clean up: restore original
        vi.doUnmock('../../src/utils/cdn.js');
        vi.resetModules();
        await global.registerCdnOverrides();
    });
});

describe('levenshteinDistance', () => {
    it('returns 0 for identical strings', () => {
        expect(levenshteinDistance('suzy', 'suzy')).toBe(0);
    });

    it('returns string length for empty comparison', () => {
        expect(levenshteinDistance('abc', '')).toBe(3);
        expect(levenshteinDistance('', 'abc')).toBe(3);
    });

    it('returns 1 for single char difference (suzi vs suzy)', () => {
        expect(levenshteinDistance('suzi', 'suzy')).toBe(1);
    });

    it('returns 2 for two char differences', () => {
        // "vova" vs "vava" = 1 (o->a), "mina" vs "mona" = 1 (i->o)
        expect(levenshteinDistance('ab', 'cd')).toBe(2);
    });

    it('handles insertion/deletion', () => {
        expect(levenshteinDistance('cat', 'cats')).toBe(1);
        expect(levenshteinDistance('cats', 'cat')).toBe(1);
    });
});

describe('resolveCharacterName', () => {
    it('returns exact match (case-insensitive)', async () => {
        expect(await resolveCharacterName('Mina', ['Mina', 'Suzy'])).toBe('Mina');
        expect(await resolveCharacterName('mina', ['Mina', 'Suzy'])).toBe('Mina');
    });

    it('resolves Cyrillic name to Latin canonical via transliteration', async () => {
        expect(await resolveCharacterName('Мина', ['Mina', 'Suzy'])).toBe('Mina');
    });

    it('resolves Latin name to Cyrillic canonical via transliteration', async () => {
        expect(await resolveCharacterName('Mina', ['Мина', 'Suzy'])).toBe('Мина');
    });

    it('handles transliteration with Levenshtein distance (Сузи→suzi vs suzy)', async () => {
        expect(await resolveCharacterName('Сузи', ['Suzy', 'Vova'])).toBe('Suzy');
    });

    it('returns null when no match found', async () => {
        expect(await resolveCharacterName('Unknown', ['Mina', 'Suzy'])).toBeNull();
    });

    it('returns null for cross-script with distance > 2', async () => {
        expect(await resolveCharacterName('Александр', ['Bob'])).toBeNull();
    });

    it('returns null for empty canonical list', async () => {
        expect(await resolveCharacterName('Mina', [])).toBeNull();
    });

    it('trims trailing whitespace before matching', async () => {
        expect(await resolveCharacterName('Alice ', ['Alice', 'Bob'])).toBe('Alice');
        expect(await resolveCharacterName('Alice  ', ['Alice', 'Bob'])).toBe('Alice');
    });

    it('trims leading whitespace before matching', async () => {
        expect(await resolveCharacterName(' Alice', ['Alice', 'Bob'])).toBe('Alice');
    });

    it('trims both leading and trailing whitespace', async () => {
        expect(await resolveCharacterName('  Alice  ', ['Alice', 'Bob'])).toBe('Alice');
    });

    it('collapses internal whitespace before matching', async () => {
        expect(await resolveCharacterName('King  Aldric', ['King Aldric', 'Bob'])).toBe('King Aldric');
    });

    it('trims whitespace in cross-script Cyrillic names', async () => {
        expect(await resolveCharacterName(' Мина ', ['Мина', 'Suzy'])).toBe('Мина');
    });

    it('trims whitespace in transliteration lookup', async () => {
        expect(await resolveCharacterName('Сузи ', ['Suzy', 'Vova'])).toBe('Suzy');
    });
});
