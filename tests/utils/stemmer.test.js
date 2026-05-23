import { describe, expect, it } from 'vitest';
import { stemName, stemWord } from '../../src/utils/stemmer.js';

describe('stemWord', () => {
    it('stems English words', async () => {
        expect(await stemWord('running')).toBe('run');
        expect(await stemWord('castles')).toBe('castl');
    });

    it('stems Russian words — inflected forms produce same stem', async () => {
        expect(await stemWord('елену')).toBe(await stemWord('елена'));
        expect(await stemWord('москвы')).toBe(await stemWord('москва'));
    });

    it('over-stem guard: елена does not collapse to ел', async () => {
        const stem = await stemWord('елена');
        // Without guard: Snowball returns 'ел' (2 chars). With guard: 'елен' (4 chars).
        expect(stem).toBe('елен');
        expect(stem.length).toBeGreaterThanOrEqual(3);
    });

    it('over-stem guard: longer forms stem normally', async () => {
        // еленой (instrumental, 6 chars) → елен (4 chars), diff=2, within tolerance
        expect(await stemWord('еленой')).toBe('елен');
        // елену (accusative, 5 chars) → елен (4 chars), diff=1, within tolerance
        expect(await stemWord('елену')).toBe('елен');
    });

    it('does not trigger guard for masculine names (no over-stem)', async () => {
        // Masculine names like иван, алдрик have minimal stripping
        const stem = await stemWord('иванов');
        expect(stem.length).toBeGreaterThanOrEqual(3);
    });

    it('passes through non-Latin/Cyrillic unchanged', async () => {
        expect(await stemWord('東京')).toBe('東京');
    });
});

describe('stemName', () => {
    it('stems multi-word names into a Set', async () => {
        const stems = await stemName('King Aldric');
        expect(stems).toBeInstanceOf(Set);
        expect(stems.has('king')).toBe(true);
        expect(stems.has('aldric')).toBe(true);
    });

    it('handles Russian names with inflections', async () => {
        const nominative = await stemName('Елена');
        const accusative = await stemName('Елену');
        // Both should produce the same stem set
        expect([...nominative]).toEqual([...accusative]);
    });

    it('filters stems shorter than 3 chars', async () => {
        const stems = await stemName('Jo Bo');
        expect(stems.size).toBe(0);
    });

    it('returns empty set for null/empty', async () => {
        expect((await stemName(null)).size).toBe(0);
        expect((await stemName('')).size).toBe(0);
    });

    it('does NOT filter stopwords — entity names are sacred', async () => {
        // "The Castle" should keep "castl" stem even though "the" is a stopword
        const stems = await stemName('The Castle');
        expect(stems.has('castl')).toBe(true);
        // "the" stems to "the" (3 chars), might be included — that's fine
    });
});
