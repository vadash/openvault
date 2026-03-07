import { describe, expect, it } from 'vitest';
import { MIRROR_LANGUAGE_RULES } from '../../src/prompts/rules.js';

describe('MIRROR_LANGUAGE_RULES', () => {
    it('is a non-empty string', () => {
        expect(typeof MIRROR_LANGUAGE_RULES).toBe('string');
        expect(MIRROR_LANGUAGE_RULES.length).toBeGreaterThan(100);
    });

    it('contains all 7 language rules', () => {
        // Rule 1: Mirror source language
        expect(MIRROR_LANGUAGE_RULES).toContain('SAME LANGUAGE');
        // Rule 2: JSON keys in English
        expect(MIRROR_LANGUAGE_RULES).toContain('JSON keys MUST remain in English');
        // Rule 3: No mixing
        expect(MIRROR_LANGUAGE_RULES).toContain('Do NOT mix languages');
        // Rule 4: Preserve character names (case-insensitive check)
        expect(MIRROR_LANGUAGE_RULES.toLowerCase()).toContain('transliterate or translate');
        // Rule 5: Match narrative prose
        expect(MIRROR_LANGUAGE_RULES).toContain('narrative prose');
        // Rule 6: Ignore instruction language
        expect(MIRROR_LANGUAGE_RULES).toContain('<messages>');
        // Rule 7: Think in English
        expect(MIRROR_LANGUAGE_RULES).toContain('thinking>');
        expect(MIRROR_LANGUAGE_RULES).toContain('English');
    });

    it('does NOT contain "Write in ENGLISH" or "Write ALL summaries in ENGLISH"', () => {
        expect(MIRROR_LANGUAGE_RULES).not.toContain('Write in ENGLISH');
        // More specific check - should not forbid English output entirely
        expect(MIRROR_LANGUAGE_RULES).not.toContain('summaries in ENGLISH');
        expect(MIRROR_LANGUAGE_RULES).not.toContain('questions in English');
        expect(MIRROR_LANGUAGE_RULES).not.toContain('insights in English');
    });
});
