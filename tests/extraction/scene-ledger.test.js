// @ts-check
/**
 * Tests for Scene Ledger temporal stamping integration
 */

import { beforeEach, describe, expect, it } from 'vitest';

describe('Scene Ledger temporal stamping', () => {
    beforeEach(async () => {
        await registerCdnOverrides();
    });

    describe('resolveLedgerForBatch', () => {
        /**
         * Helper to build mock chat with fingerprints at specific indices.
         * @param {number} count - Number of messages
         * @returns {Array<{fingerprint: string}>}
         */
        function buildMockChat(count) {
            return Array.from({ length: count }, (_, i) => ({ fingerprint: `fp-${i}` }));
        }

        /**
         * Helper to build ledger entries.
         * @param {Array<{fpIndex: number, location: string, time: string}>} entries
         * @returns {Array<{fp: string, location: string, time: string}>}
         */
        function buildLedger(entries) {
            return entries.map((e) => ({ fp: `fp-${e.fpIndex}`, location: e.location, time: e.time }));
        }

        it.each([
            [
                'empty ledger returns single batch with null context',
                buildMockChat(10),
                [],
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                [{ startIdx: 0, endIdx: 9, location: null, time: null }],
            ],
            [
                'ledger entries outside batch range returns single batch with null context',
                buildMockChat(10),
                buildLedger([{ fpIndex: 20, location: 'Outside', time: 'Future' }]),
                [0, 1, 2, 3, 4],
                [{ startIdx: 0, endIdx: 4, location: null, time: null }],
            ],
            [
                'single ledger entry covering entire batch',
                buildMockChat(10),
                buildLedger([{ fpIndex: 0, location: 'Living Room', time: 'Morning' }]),
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                [{ startIdx: 0, endIdx: 9, location: 'Living Room', time: 'Morning' }],
            ],
            [
                'ledger entry at position 5 covers messages 5-9',
                buildMockChat(10),
                buildLedger([{ fpIndex: 5, location: 'Kitchen', time: 'Afternoon' }]),
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                [
                    { startIdx: 0, endIdx: 4, location: null, time: null },
                    { startIdx: 5, endIdx: 9, location: 'Kitchen', time: 'Afternoon' },
                ],
            ],
            [
                'ledger at positions 5 and 10 splits batch into three sub-batches',
                buildMockChat(15),
                buildLedger([
                    { fpIndex: 5, location: 'Living Room', time: 'Morning' },
                    { fpIndex: 10, location: 'Garden', time: 'Afternoon' },
                ]),
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
                [
                    { startIdx: 0, endIdx: 4, location: null, time: null },
                    { startIdx: 5, endIdx: 9, location: 'Living Room', time: 'Morning' },
                    { startIdx: 10, endIdx: 14, location: 'Garden', time: 'Afternoon' },
                ],
            ],
            [
                'backward scan: message at index 8 gets context from ledger at 5 (not 10)',
                buildMockChat(15),
                buildLedger([
                    { fpIndex: 5, location: 'Kitchen', time: 'Morning' },
                    { fpIndex: 10, location: 'Garden', time: 'Afternoon' },
                ]),
                [5, 6, 7, 8],
                [{ startIdx: 5, endIdx: 8, location: 'Kitchen', time: 'Morning' }],
            ],
            [
                'partial batch: ledger at 3 covers messages 3-7 in partial batch',
                buildMockChat(10),
                buildLedger([{ fpIndex: 3, location: 'Office', time: 'Day' }]),
                [3, 4, 5, 6, 7],
                [{ startIdx: 3, endIdx: 7, location: 'Office', time: 'Day' }],
            ],
            [
                'multiple ledger entries: backward scan finds most recent scene at or before message',
                buildMockChat(20),
                buildLedger([
                    { fpIndex: 3, location: 'Bedroom', time: 'Night' },
                    { fpIndex: 7, location: 'Kitchen', time: 'Morning' },
                    { fpIndex: 12, location: 'Garden', time: 'Afternoon' },
                    { fpIndex: 18, location: 'Office', time: 'Evening' },
                ]),
                [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
                [
                    // Scene transitions: Bedroom starts at 3, Kitchen at 7, Garden at 12, Office at 18
                    // For each message, find the most recent scene established at or before its position
                    { startIdx: 5, endIdx: 6, location: 'Bedroom', time: 'Night' }, // 5-6: after Bedroom(3), before Kitchen(7)
                    { startIdx: 7, endIdx: 11, location: 'Kitchen', time: 'Morning' }, // 7-11: Kitchen established at 7, before Garden(12)
                    { startIdx: 12, endIdx: 17, location: 'Garden', time: 'Afternoon' }, // 12-17: Garden at 12, before Office(18)
                ],
            ],
        ])('$desc', async (_desc, chat, ledger, batchIndices, expected) => {
            const { resolveLedgerForBatch } = await import('../../src/extraction/scene-state.js');

            // Convert indices to fingerprints for the batch
            const batchFps = batchIndices.map((i) => chat[i].fingerprint);

            const result = resolveLedgerForBatch(ledger, chat, batchFps);

            // Normalize endIdx values (some implementations may use exclusive bounds)
            // We expect inclusive bounds per the spec
            expect(result.length).toBe(expected.length);
            for (let i = 0; i < expected.length; i++) {
                expect(result[i].startIdx).toBe(expected[i].startIdx);
                expect(result[i].endIdx).toBe(expected[i].endIdx);
                expect(result[i].location).toBe(expected[i].location);
                expect(result[i].time).toBe(expected[i].time);
            }
        });

        it('returns empty array when batch has no messages', async () => {
            const { resolveLedgerForBatch } = await import('../../src/extraction/scene-state.js');
            const chat = buildMockChat(10);
            const ledger = buildLedger([{ fpIndex: 5, location: 'Kitchen', time: 'Morning' }]);

            const result = resolveLedgerForBatch(ledger, chat, []);
            expect(result).toEqual([]);
        });

        it('handles ledger entries in any order (sorts by position internally)', async () => {
            const { resolveLedgerForBatch } = await import('../../src/extraction/scene-state.js');
            const chat = buildMockChat(15);
            // Ledger entries in reverse order
            const ledger = buildLedger([
                { fpIndex: 10, location: 'Garden', time: 'Afternoon' },
                { fpIndex: 5, location: 'Living Room', time: 'Morning' },
            ]);

            const batchFps = chat.slice(0, 15).map((m) => m.fingerprint);
            const result = resolveLedgerForBatch(ledger, chat, batchFps);

            expect(result).toEqual([
                { startIdx: 0, endIdx: 4, location: null, time: null },
                { startIdx: 5, endIdx: 9, location: 'Living Room', time: 'Morning' },
                { startIdx: 10, endIdx: 14, location: 'Garden', time: 'Afternoon' },
            ]);
        });

        it('handles message fingerprints not in chat gracefully', async () => {
            const { resolveLedgerForBatch } = await import('../../src/extraction/scene-state.js');
            const chat = buildMockChat(5);
            const ledger = buildLedger([
                { fpIndex: 2, location: 'Office', time: 'Day' },
                { fpIndex: 99, location: 'Unknown', time: 'Future' }, // fp-99 not in chat
            ]);

            const batchFps = chat.map((m) => m.fingerprint);
            const result = resolveLedgerForBatch(ledger, chat, batchFps);

            // fp-99 is ignored (not in chat), fp-2 applies from index 2
            expect(result).toEqual([
                { startIdx: 0, endIdx: 1, location: null, time: null },
                { startIdx: 2, endIdx: 4, location: 'Office', time: 'Day' },
            ]);
        });
    });
});
