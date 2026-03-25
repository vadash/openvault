import { cdnImport } from './cdn.js';

// @ts-check

// @ts-expect-error - No types available for CDN import
const CyrillicToTranslit = (await cdnImport('cyrillic-to-translit-js')).default;
const translit = new CyrillicToTranslit({ preset: 'ru' });

export const CYRILLIC_RE = /\p{Script=Cyrillic}/u;

/**
 * Transliterate a Cyrillic string to Latin characters.
 * Non-Cyrillic characters pass through unchanged.
 * Result is always lowercased for key comparison.
 *
 * @param {string} str - Input string (may contain Cyrillic)
 * @returns {string} Lowercased Latin transliteration
 */
export function transliterateCyrToLat(str) {
    if (!str) return '';
    return translit.transform(str).toLowerCase();
}

/**
 * Compute Levenshtein edit distance between two strings.
 * Standard O(n*m) dynamic programming implementation.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
export function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Use single-row optimization: only need previous row + current row
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    let curr = new Array(b.length + 1);

    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            if (a[i - 1] === b[j - 1]) {
                curr[j] = prev[j - 1];
            } else {
                curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
            }
        }
        [prev, curr] = [curr, prev];
    }
    return prev[b.length];
}

/**
 * Resolve a character name against a list of known canonical names,
 * supporting cross-script matching via transliteration + Levenshtein distance.
 *
 * @param {string} name - Character name to resolve (may be Cyrillic or Latin)
 * @param {string[]} canonicalNames - Known canonical character names
 * @param {number} [maxDistance=2] - Maximum Levenshtein distance for fuzzy matching
 * @returns {string|null} Matching canonical name, or null if no match
 */
export function resolveCharacterName(name, canonicalNames, maxDistance = 2) {
    const lower = name.toLowerCase();

    // Exact case-insensitive match
    for (const canonical of canonicalNames) {
        if (canonical.toLowerCase() === lower) return canonical;
    }

    // Cross-script match via transliteration
    const isCyrillic = CYRILLIC_RE.test(lower);
    if (isCyrillic) {
        const translit = transliterateCyrToLat(lower);
        for (const canonical of canonicalNames) {
            if (!CYRILLIC_RE.test(canonical) && levenshteinDistance(translit, canonical.toLowerCase()) <= maxDistance) {
                return canonical;
            }
        }
    } else {
        for (const canonical of canonicalNames) {
            if (
                CYRILLIC_RE.test(canonical) &&
                levenshteinDistance(transliterateCyrToLat(canonical.toLowerCase()), lower) <= maxDistance
            ) {
                return canonical;
            }
        }
    }

    return null;
}
