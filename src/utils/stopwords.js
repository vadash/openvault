/**
 * OpenVault Unified Stopword Module
 *
 * Single source of truth for all stopword filtering.
 * Imports base stopwords from 'stopword' package (EN + RU).
 */

import { cdnImport } from './cdn.js';

/** @type {Set<string> | null} */
let _data = null;

/** @type {((words: string[], stopwords?: string[]) => string[]) | null} */
let _removeFn = null;

/**
 * Lazy-load stopword data on first use.
 * @returns {Promise<{ stopwords: Set<string>, removeFn: (words: string[]) => string[] } | null>}
 */
async function getStopwordData() {
    if (_data !== null && _removeFn !== null) {
        return { stopwords: _data, removeFn: _removeFn };
    }
    try {
        const { eng, rus, removeStopwords } = await cdnImport('stopword');
        // Unified export - lowercase for case-insensitive matching
        _data = new Set([...eng, ...rus].map((w) => w.toLowerCase()));
        // Create a wrapper that uses combined EN+RU stopwords
        _removeFn = (words) => removeStopwords(words, [..._data]);
        return { stopwords: _data, removeFn: _removeFn };
    } catch {
        // CDN unavailable: return null, callers will use fallback
        return null;
    }
}

/**
 * Get all stopwords (EN + RU combined).
 * @returns {Promise<Set<string>>} Set of lowercase stopwords
 */
export async function getAllStopwords() {
    const data = await getStopwordData();
    return data?.stopwords ?? new Set();
}

/**
 * Remove stopwords from a word list using combined EN+RU stopwords.
 * @param {string[]} words - Words to filter
 * @returns {Promise<string[]>} Filtered words without stopwords
 */
export async function removeStopwords(words) {
    const data = await getStopwordData();
    if (!data) {
        // CDN unavailable: return words unchanged (identity function)
        return words;
    }
    return data.removeFn(words);
}
