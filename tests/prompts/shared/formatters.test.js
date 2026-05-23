// @ts-check
import { describe, expect, it } from 'vitest';
import { EXECUTION_TRIGGER } from '../../../src/prompts/shared/formatters.js';

describe('EXECUTION_TRIGGER', () => {
    it('should contain step-explicit output format', () => {
        expect(EXECUTION_TRIGGER).toContain('OUTPUT FORMAT SEQUENCE:');
        expect(EXECUTION_TRIGGER).toContain('[Write concise draft notes here');
        expect(EXECUTION_TRIGGER).toContain('2. {');
    });

    it('should reference think tags', () => {
        // Check for the instructional text about think tags
        expect(EXECUTION_TRIGGER).toContain('tags');
    });

    it('should reference closing delimiter', () => {
        expect(EXECUTION_TRIGGER).toContain('closing');
    });

    it('should warn about JSON placement', () => {
        expect(EXECUTION_TRIGGER).toContain('Never put the JSON inside');
    });
});
