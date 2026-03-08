import { describe, expect, it } from 'vitest';
import { PAYLOAD_CALC } from '../src/constants.js';

describe('PAYLOAD_CALC', () => {
    it('exports all required fields', () => {
        expect(PAYLOAD_CALC.LLM_OUTPUT_TOKENS).toBe(8000);
        expect(PAYLOAD_CALC.PROMPT_ESTIMATE).toBe(2000);
        expect(PAYLOAD_CALC.SAFETY_BUFFER).toBe(2000);
        expect(PAYLOAD_CALC.OVERHEAD).toBe(12000);
        expect(PAYLOAD_CALC.THRESHOLD_GREEN).toBe(32000);
        expect(PAYLOAD_CALC.THRESHOLD_YELLOW).toBe(48000);
        expect(PAYLOAD_CALC.THRESHOLD_ORANGE).toBe(64000);
    });
});
