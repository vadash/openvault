import { cdnImport } from './cdn.js';

// @ts-check

/** @type {{ ru: import('snowball-stemmers').Stemmer, en: import('snowball-stemmers').Stemmer } | null} */
let _stemmers = null;

/**
 * Lazy-load stemmers on first use.
 * @returns {Promise<typeof _stemmers>}
 */
async function getStemmers() {
    if (_stemmers) return _stemmers;
    try {
        // @ts-expect-error - No types available for CDN import
        const { default: snowball } = await cdnImport('snowball-stemmers');
        _stemmers = {
            ru: snowball.newStemmer('russian'),
            en: snowball.newStemmer('english'),
        };
        return _stemmers;
    } catch {
        // CDN unavailable: return null, callers will use fallback
        return null;
    }
}

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
 * @returns {Promise<string>} Stemmed word
 */
export async function stemWord(word) {
    const stemmers = await getStemmers();
    if (!stemmers) {
        // CDN unavailable: return word unchanged
        return word;
    }

    if (CYRILLIC_RE.test(word)) {
        const stem = stemmers.ru.stem(word);
        // Over-stem guard: stem must be ≥3 chars AND within 3 chars of input length.
        // If violated, Snowball stripped too aggressively — strip only the final char.
        if (stem.length < Math.max(3, word.length - 3)) {
            const minimal = word.slice(0, -1);
            return minimal.length > 2 ? minimal : word;
        }
        return stem;
    }
    if (LATIN_RE.test(word)) return stemmers.en.stem(word);
    return word;
}

/**
 * Stem a multi-word name into a Set of stems.
 * No stopword filtering — entity names should not be filtered.
 * @param {string} name - Entity name (e.g. "King Aldric")
 * @returns {Promise<Set<string>>} Set of stems (e.g. {"king", "aldric"})
 */
export async function stemName(name) {
    if (!name) return new Set();
    const words = name.toLowerCase().match(/[\p{L}0-9]+/gu) || [];
    const stems = await Promise.all(words.filter((w) => w.length > 2).map(stemWord));
    return new Set(stems.filter((w) => w.length > 2));
}
