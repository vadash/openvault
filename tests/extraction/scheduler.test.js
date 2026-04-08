import { describe, expect, it } from 'vitest';

describe('trimTailTurns — system messages', () => {
    it('finds Bot→User boundary with system message in between', async () => {
        const { trimTailTurns } = await import('../../src/extraction/scheduler.js');

        // U(0) B(1) SYS(2) U(3) B(4) SYS(5) U(6)
        const chat = [
            { mes: 'u0', is_user: true, is_system: false },
            { mes: 'b1', is_user: false, is_system: false },
            { mes: 'sys', is_user: false, is_system: true },
            { mes: 'u3', is_user: true, is_system: false },
            { mes: 'b4', is_user: false, is_system: false },
            { mes: 'sys2', is_user: false, is_system: true },
            { mes: 'u6', is_user: true, is_system: false },
        ];

        // Trim 1 turn from tail — should find B(4)→U(6) boundary past SYS(5)
        const result = trimTailTurns(chat, [0, 1, 2, 3, 4, 5, 6], 1);
        expect(result.length).toBeLessThan(7);
        expect(result.length).toBeGreaterThan(0);
    });

    it('trims correctly when system message blocks boundary detection', async () => {
        const { trimTailTurns } = await import('../../src/extraction/scheduler.js');

        // U(0) B(1) SYS(2) U(3) U(4) B(5)
        const chat = [
            { mes: 'u0', is_user: true, is_system: false },
            { mes: 'b1', is_user: false, is_system: false },
            { mes: 'sys', is_user: false, is_system: true },
            { mes: 'u3', is_user: true, is_system: false },
            { mes: 'u4', is_user: true, is_system: false },
            { mes: 'b5', is_user: false, is_system: false },
        ];

        // Without fix, B(1)→SYS(2) would fail boundary detection
        // With fix, B(1)→U(3) should be found past SYS(2)
        // However, B(5) is still found first (end of chat is a valid boundary)
        // So we trim from B(5), removing U(3) U(4) B(5) and leaving [0, 1]
        const result = trimTailTurns(chat, [0, 1, 3, 4, 5], 1);
        expect(result).toEqual([0, 1]);
    });
});
