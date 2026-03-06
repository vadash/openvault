import { describe, expect, it } from 'vitest';
import { stemName, stemWord } from '../../src/utils/stemmer.js';

describe('stemWord', () => {
    it('stems English words', () => {
        expect(stemWord('running')).toBe('run');
        expect(stemWord('castles')).toBe('castl');
    });

    it('stems Russian words — inflected forms produce same stem', () => {
        expect(stemWord('елену')).toBe(stemWord('елена'));
        expect(stemWord('москвы')).toBe(stemWord('москва'));
    });

    it('over-stem guard: елена does not collapse to ел', () => {
        const stem = stemWord('елена');
        // Without guard: Snowball returns 'ел' (2 chars). With guard: 'елен' (4 chars).
        expect(stem).toBe('елен');
        expect(stem.length).toBeGreaterThanOrEqual(3);
    });

    it('over-stem guard: longer forms stem normally', () => {
        // еленой (instrumental, 6 chars) → елен (4 chars), diff=2, within tolerance
        expect(stemWord('еленой')).toBe('елен');
        // елену (accusative, 5 chars) → елен (4 chars), diff=1, within tolerance
        expect(stemWord('елену')).toBe('елен');
    });

    it('does not trigger guard for masculine names (no over-stem)', () => {
        // Masculine names like иван, алдрик have minimal stripping
        const stem = stemWord('иванов');
        expect(stem.length).toBeGreaterThanOrEqual(3);
    });

    it('passes through non-Latin/Cyrillic unchanged', () => {
        expect(stemWord('東京')).toBe('東京');
    });
});

describe('stemName', () => {
    it('stems multi-word names into a Set', () => {
        const stems = stemName('King Aldric');
        expect(stems).toBeInstanceOf(Set);
        expect(stems.has('king')).toBe(true);
        expect(stems.has('aldric')).toBe(true);
    });

    it('handles Russian names with inflections', () => {
        const nominative = stemName('Елена');
        const accusative = stemName('Елену');
        // Both should produce the same stem set
        expect([...nominative]).toEqual([...accusative]);
    });

    it('filters stems shorter than 3 chars', () => {
        const stems = stemName('Jo Bo');
        expect(stems.size).toBe(0);
    });

    it('returns empty set for null/empty', () => {
        expect(stemName(null).size).toBe(0);
        expect(stemName('').size).toBe(0);
    });

    it('does NOT filter stopwords — entity names are sacred', () => {
        // "The Castle" should keep "castl" stem even though "the" is a stopword
        const stems = stemName('The Castle');
        expect(stems.has('castl')).toBe(true);
        // "the" stems to "the" (3 chars), might be included — that's fine
    });
});
