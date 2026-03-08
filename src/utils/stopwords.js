/**
 * OpenVault Unified Stopword Module
 *
 * Single source of truth for all stopword filtering.
 * Imports base stopwords from 'stopword' package (EN + RU).
 */

import { eng, rus } from 'https://esm.sh/stopword';

// Unified export - lowercase for case-insensitive matching
export const ALL_STOPWORDS = new Set([...eng, ...rus].map((w) => w.toLowerCase()));

// Re-export utility function from package
export { removeStopwords } from 'https://esm.sh/stopword';
