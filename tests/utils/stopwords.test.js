import { describe, expect, it, vi } from 'vitest';
import { getAllStopwords, removeStopwords } from '../../src/utils/stopwords.js';

describe('getAllStopwords', () => {
    it('returns a Set containing English stopwords', async () => {
        const stopwords = await getAllStopwords();
        expect(stopwords).toBeInstanceOf(Set);
        expect(stopwords.has('the')).toBe(true);
        expect(stopwords.has('a')).toBe(true);
        expect(stopwords.has('an')).toBe(true);
    });

    it('returns a Set containing Russian stopwords', async () => {
        const stopwords = await getAllStopwords();
        expect(stopwords).toBeInstanceOf(Set);
        expect(stopwords.has('и')).toBe(true); // 'and'
        expect(stopwords.has('в')).toBe(true); // 'in'
        expect(stopwords.has('на')).toBe(true); // 'on'
    });

    it('returns lowercase stopwords for case-insensitive matching', async () => {
        const stopwords = await getAllStopwords();
        expect(stopwords.has('THE')).toBe(false);
        expect(stopwords.has('the')).toBe(true);
    });
});

describe('removeStopwords', () => {
    it('removes English stopwords from a word list', async () => {
        const words = ['the', 'quick', 'brown', 'fox'];
        const filtered = await removeStopwords(words);
        expect(filtered).toEqual(['quick', 'brown', 'fox']);
    });

    it('removes Russian stopwords from a word list', async () => {
        const words = ['и', 'быстрый', 'коричневый', 'лис'];
        const filtered = await removeStopwords(words);
        expect(filtered).toEqual(['быстрый', 'коричневый', 'лис']);
    });

    it('handles mixed script stopwords', async () => {
        const words = ['the', 'быстрый', 'и', 'fox', 'лис'];
        const filtered = await removeStopwords(words);
        expect(filtered).toEqual(['быстрый', 'fox', 'лис']);
    });

    it('returns empty array when all words are stopwords', async () => {
        const words = ['the', 'and', 'a', 'an'];
        const filtered = await removeStopwords(words);
        expect(filtered).toEqual([]);
    });

    it('returns unchanged array when no stopwords present', async () => {
        const words = ['elephant', 'giraffe', 'zebra'];
        const filtered = await removeStopwords(words);
        expect(filtered).toEqual(['elephant', 'giraffe', 'zebra']);
    });
});

describe('stopwords — CDN unavailable fallback', () => {
    it('getAllStopwords returns empty Set when CDN fails', async () => {
        // Mock cdnImport to throw for stopword
        vi.doMock('../../src/utils/cdn.js', async () => {
            const actual = await vi.importActual('../../src/utils/cdn.js');
            return {
                ...actual,
                cdnImport: async (spec) => {
                    if (spec === 'stopword') {
                        throw new Error('CDN unavailable');
                    }
                    return actual.cdnImport(spec);
                },
            };
        });

        // Reset modules to pick up the mock
        vi.resetModules();
        await global.registerCdnOverrides();
        const { getAllStopwords: noCdnGetAll } = await import('../../src/utils/stopwords.js');

        // Fallback: returns empty Set
        const stopwords = await noCdnGetAll();
        expect(stopwords).toBeInstanceOf(Set);
        expect(stopwords.size).toBe(0);

        // Clean up: restore original
        vi.doUnmock('../../src/utils/cdn.js');
        vi.resetModules();
        await global.registerCdnOverrides();
    });

    it('removeStopwords returns words unchanged when CDN fails', async () => {
        // Mock cdnImport to throw for stopword
        vi.doMock('../../src/utils/cdn.js', async () => {
            const actual = await vi.importActual('../../src/utils/cdn.js');
            return {
                ...actual,
                cdnImport: async (spec) => {
                    if (spec === 'stopword') {
                        throw new Error('CDN unavailable');
                    }
                    return actual.cdnImport(spec);
                },
            };
        });

        // Reset modules to pick up the mock
        vi.resetModules();
        await global.registerCdnOverrides();
        const { removeStopwords: noCdnRemove } = await import('../../src/utils/stopwords.js');

        // Fallback: returns words unchanged (identity function)
        const words = ['the', 'quick', 'brown', 'fox'];
        const filtered = await noCdnRemove(words);
        expect(filtered).toEqual(words);

        // Clean up: restore original
        vi.doUnmock('../../src/utils/cdn.js');
        vi.resetModules();
        await global.registerCdnOverrides();
    });
});
