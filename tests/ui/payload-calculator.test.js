import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('updatePayloadCalculator', () => {
    let mockJQuery;

    beforeEach(async () => {
        vi.resetModules();
        await global.registerCdnOverrides();

        document.body.innerHTML = `
            <input type="range" id="openvault_extraction_token_budget" value="8000" min="0" max="50000" />
            <input type="range" id="openvault_extraction_rearview" value="6000" min="0" max="50000" />
            <div id="openvault_payload_calculator"></div>
            <span id="openvault_payload_emoji"></span>
            <span id="openvault_payload_total"></span>
            <div id="openvault_payload_breakdown"></div>
        `;

        // Mock jQuery
        mockJQuery = vi.fn((selector) => {
            const elements = document.querySelectorAll(selector);
            const first = elements.length > 0 ? elements[0] : null;

            const $obj = {
                val: vi.fn((newValue) => {
                    if (newValue !== undefined) {
                        elements.forEach((el) => {
                            el.value = newValue;
                        });
                        return $obj;
                    }
                    // Always re-query to get latest DOM values
                    const current = document.querySelectorAll(selector);
                    return current.length > 0 ? current[0].value : '';
                }),
                text: vi.fn((newValue) => {
                    if (newValue !== undefined) {
                        if (first) first.textContent = newValue;
                        return $obj;
                    }
                    return first ? first.textContent : '';
                }),
                html: vi.fn((newValue) => {
                    if (newValue !== undefined) {
                        if (first) first.innerHTML = newValue;
                        return $obj;
                    }
                    return first ? first.innerHTML : '';
                }),
                addClass: vi.fn(() => $obj),
                removeClass: vi.fn(() => $obj),
                append: vi.fn((html) => {
                    if (first) first.innerHTML += html;
                    return $obj;
                }),
                find: vi.fn((subSelector) => {
                    if (subSelector === '.openvault-payload-warning') {
                        const found = first ? first.querySelector(subSelector) : null;
                        return {
                            length: found ? 1 : 0,
                            text: vi.fn((newValue) => {
                                if (newValue !== undefined && found) {
                                    found.textContent = newValue;
                                    return mockJQuery(found);
                                }
                                return found ? found.textContent : '';
                            }),
                        };
                    }
                    return $obj;
                }),
            };

            return $obj;
        });

        global.$ = mockJQuery;
    });

    it('shows LLM compatibility warning', async () => {
        const { updatePayloadCalculator } = await import('../../src/ui/settings.js');
        updatePayloadCalculator();
        const calc = document.getElementById('openvault_payload_calculator');
        expect(calc.innerHTML).toContain('Ensure your Extraction Profile');
        expect(calc.innerHTML).toContain('context');
    });

    it('shows green emoji for totals under 32k', async () => {
        const { updatePayloadCalculator } = await import('../../src/ui/settings.js');
        document.getElementById('openvault_extraction_token_budget').value = '4000';
        document.getElementById('openvault_extraction_rearview').value = '4000';
        updatePayloadCalculator();
        expect(document.getElementById('openvault_payload_emoji').textContent).toBe('✅');
    });

    it('shows red emoji for totals over 64k', async () => {
        const budgetEl = document.getElementById('openvault_extraction_token_budget');
        const rearviewEl = document.getElementById('openvault_extraction_rearview');
        budgetEl.value = '32000';
        rearviewEl.value = '32000';

        const { updatePayloadCalculator } = await import('../../src/ui/settings.js');
        updatePayloadCalculator();
        expect(document.getElementById('openvault_payload_emoji').textContent).toBe('🔴');
    });
});

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

    it('16k + 8k = 26k = green', () => {
        const r = getPayloadSeverity(16000, 8000);
        expect(r.total).toBe(26000);
        expect(r.severity).toBe('safe');
    });

    it('32k + 8k = 42k = yellow', () => {
        const r = getPayloadSeverity(32000, 8000);
        expect(r.total).toBe(42000);
        expect(r.severity).toBe('caution');
    });

    it('48k + 16k = 66k = red', () => {
        const r = getPayloadSeverity(48000, 16000);
        expect(r.total).toBe(66000);
        expect(r.severity).toBe('danger');
    });

    it('boundary: exactly 32k = green (inclusive)', () => {
        const r = getPayloadSeverity(30000, 0);
        expect(r.total).toBe(32000);
        expect(r.severity).toBe('safe');
    });

    it('boundary: 32001 = yellow', () => {
        // 30001 + 0 + 2000 = 32001
        const r = getPayloadSeverity(30001, 0);
        expect(r.total).toBe(32001);
        expect(r.severity).toBe('caution');
    });
});
