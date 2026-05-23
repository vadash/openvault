import { describe, expect, it } from 'vitest';
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
