import { describe, expect, it } from 'vitest';
import { PAYLOAD_CALC } from '../../src/constants.js';

/**
 * Test the pure calculation logic that updatePayloadCalculator() uses.
 * We can't test DOM manipulation in vitest, but we can test the threshold logic.
 */
function getPayloadSeverity(budget, rearview) {
    const total = budget + rearview + PAYLOAD_CALC.OVERHEAD;
    if (total <= PAYLOAD_CALC.THRESHOLD_GREEN) return { total, severity: 'safe', emoji: '✅' };
    if (total <= PAYLOAD_CALC.THRESHOLD_YELLOW) return { total, severity: 'caution', emoji: '⚠️' };
    if (total <= PAYLOAD_CALC.THRESHOLD_ORANGE) return { total, severity: 'warning', emoji: '🟠' };
    return { total, severity: 'danger', emoji: '🔴' };
}

describe('Payload severity calculation', () => {
    it('defaults (12k + 8k) = 22k = green', () => {
        const r = getPayloadSeverity(12000, 8000);
        expect(r.total).toBe(22000);
        expect(r.severity).toBe('safe');
        expect(r.emoji).toBe('✅');
    });

    it('48k + 16k = 66k = red', () => {
        const r = getPayloadSeverity(48000, 16000);
        expect(r.total).toBe(66000);
        expect(r.severity).toBe('danger');
    });
});
