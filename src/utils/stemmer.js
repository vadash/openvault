import { cdnImport } from './cdn.js';

// @ts-check

// @ts-expect-error - No types available for CDN import
const { default: snowball } = await cdnImport('snowball-stemmers');
const ruStemmer = snowball.newStemmer('russian');
const enStemmer = snowball.newStemmer('english');

const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const LATIN_RE = /\p{Script=Latin}/u;

/**
 * Stem a word using the appropriate language stemmer based on script detection.
 * Cyrillic → Russian, Latin → English, other → unchanged.
 *
 * Includes an over-stem guard for Cyrillic: if Snowball's multi-pass stripping
 * removes more than 3 chars (e.g. елена → ел), falls back to removing just the
 * final character — structurally correct for Russian nominative -а/-я endings.
 * @param {string} word - Word to stem
 * @returns {string} Stemmed word
 */
export function stemWord(word) {
    if (CYRILLIC_RE.test(word)) {
        const stem = ruStemmer.stem(word);
        // Over-stem guard: stem must be ≥3 chars AND within 3 chars of input length.
        // If violated, Snowball stripped too aggressively — strip only the final char.
        if (stem.length < Math.max(3, word.length - 3)) {
            const minimal = word.slice(0, -1);
            return minimal.length > 2 ? minimal : word;
        }
        return stem;
    }
    if (LATIN_RE.test(word)) return enStemmer.stem(word);
    return word;
}

/**
 * Stem a multi-word name into a Set of stems.
 * No stopword filtering — entity names should not be filtered.
 * @param {string} name - Entity name (e.g. "King Aldric")
 * @returns {Set<string>} Set of stems (e.g. {"king", "aldric"})
 */
export function stemName(name) {
    if (!name) return new Set();
    const words = name.toLowerCase().match(/[\p{L}0-9]+/gu) || [];
    return new Set(
        words
            .filter((w) => w.length > 2)
            .map(stemWord)
            .filter((w) => w.length > 2)
    );
}
