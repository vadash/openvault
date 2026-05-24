// @ts-check
/**
 * Tests for Scene State extraction module
 */

import { beforeEach, describe, expect, it } from 'vitest';

describe('Scene State extraction helpers', () => {
    beforeEach(async () => {
        await registerCdnOverrides();
    });

    describe('pruneStateMap', () => {
        it.each([
            [
                'map with 15 entries returns last 10',
                Object.fromEntries(
                    Array.from({ length: 15 }, (_, i) => [`fp-${i}`, { location: `loc-${i}`, time: `t-${i}` }])
                ),
                10,
                10,
            ],
            [
                'map with 5 entries returns all 5',
                Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`fp-${i}`, { location: `loc-${i}` }])),
                10,
                5,
            ],
            ['empty map returns empty', {}, 10, 0],
            [
                'map with 15 entries, max 5 returns last 5',
                Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`fp-${i}`, { location: `loc-${i}` }])),
                5,
                5,
            ],
        ])('$desc', async (_desc, input, maxEntries, expectedCount) => {
            const { pruneStateMap } = await import('../../src/extraction/scene-state.js');
            const result = pruneStateMap(input, maxEntries);
            expect(Object.keys(result).length).toBe(expectedCount);
            // Verify it returns the *last* entries (highest keys numerically/lexically)
            if (expectedCount > 0 && input && Object.keys(input).length > maxEntries) {
                const inputKeys = Object.keys(input).sort();
                const resultKeys = Object.keys(result).sort();
                expect(resultKeys).toEqual(inputKeys.slice(-maxEntries));
            }
        });
    });

    describe('diffLedger', () => {
        it.each([
            [
                'unchanged state returns null',
                { location: 'Living Room', time: 'Evening' },
                { location: 'Living Room', time: 'Evening' },
                'fp-123',
                null,
            ],
            [
                'changed location returns ledger entry',
                { location: 'Living Room', time: 'Evening' },
                { location: 'Kitchen', time: 'Evening' },
                'fp-456',
                { fp: 'fp-456', location: 'Kitchen', time: 'Evening' },
            ],
            [
                'changed time returns ledger entry',
                { location: 'Living Room', time: 'Evening' },
                { location: 'Living Room', time: 'Morning' },
                'fp-789',
                { fp: 'fp-789', location: 'Living Room', time: 'Morning' },
            ],
            [
                'both changed returns ledger entry',
                { location: 'Living Room', time: 'Evening' },
                { location: 'Garden', time: 'Afternoon' },
                'fp-111',
                { fp: 'fp-111', location: 'Garden', time: 'Afternoon' },
            ],
            [
                'prev state null returns ledger entry',
                null,
                { location: 'Bedroom', time: 'Night' },
                'fp-222',
                { fp: 'fp-222', location: 'Bedroom', time: 'Night' },
            ],
        ])('$desc', async (_desc, prevState, newState, lastFp, expected) => {
            const { diffLedger } = await import('../../src/extraction/scene-state.js');
            const result = diffLedger(prevState, newState, lastFp);
            expect(result).toEqual(expected);
        });
    });

    describe('getSceneExtractionWindow', () => {
        it.each([
            [
                'empty map returns all messages (cold start)',
                [
                    { send_date: 'fp-1', is_system: false, mes: 'First message' },
                    { send_date: 'fp-2', is_system: false, mes: 'Second message' },
                    { send_date: 'fp-3', is_system: false, mes: 'Third message' },
                ],
                {},
                true,
                ['fp-1', 'fp-2', 'fp-3'],
            ],
            [
                'map with last extraction returns messages after source_fp',
                [
                    { send_date: 'fp-1', is_system: false, mes: 'Message 1' },
                    { send_date: 'fp-2', is_system: false, mes: 'Message 2' },
                    { send_date: 'fp-3', is_system: false, mes: 'Message 3' },
                    { send_date: 'fp-4', is_system: false, mes: 'Message 4' },
                ],
                { 'fp-2': { location: 'Kitchen', time: 'Morning', source_fp: 'fp-2' } },
                true,
                ['fp-3', 'fp-4'],
            ],
            [
                'skips system messages when skipSystem=true',
                [
                    { send_date: 'fp-1', is_system: false, mes: 'User message' },
                    { send_date: 'fp-sys', is_system: true, mes: 'System note' },
                    { send_date: 'fp-2', is_system: false, mes: 'Bot response' },
                ],
                {},
                true,
                ['fp-1', 'fp-2'],
            ],
            [
                'includes system messages when skipSystem=false',
                [
                    { send_date: 'fp-1', is_system: false, mes: 'User message' },
                    { send_date: 'fp-sys', is_system: true, mes: 'System note' },
                    { send_date: 'fp-2', is_system: false, mes: 'Bot response' },
                ],
                {},
                false,
                ['fp-1', 'fp-sys', 'fp-2'],
            ],
        ])('$desc', async (_desc, chat, sceneStates, skipSystem, expectedFps) => {
            const { getSceneExtractionWindow } = await import('../../src/extraction/scene-state.js');
            const result = getSceneExtractionWindow(chat, sceneStates, skipSystem);
            // Use send_date for fingerprint comparison since getFingerprint uses send_date
            expect(result.map((m) => m.send_date)).toEqual(expectedFps);
        });
    });

    describe('findCurrentSceneState', () => {
        it.each([
            [
                'exact match at last message',
                [
                    { send_date: 'fp-1', mes: 'Message 1' },
                    { send_date: 'fp-2', mes: 'Message 2' },
                    { send_date: 'fp-3', mes: 'Message 3' },
                ],
                { 'fp-3': { location: 'Garden', time: 'Afternoon', source_fp: 'fp-3' } },
                { location: 'Garden', time: 'Afternoon', source_fp: 'fp-3' },
            ],
            [
                'match at earlier message (interval gap)',
                [
                    { send_date: 'fp-1', mes: 'Message 1' },
                    { send_date: 'fp-2', mes: 'Message 2' },
                    { send_date: 'fp-3', mes: 'Message 3' },
                    { send_date: 'fp-4', mes: 'Message 4' },
                ],
                {
                    'fp-2': { location: 'Kitchen', time: 'Morning', source_fp: 'fp-2' },
                    'fp-4': { location: 'Bedroom', time: 'Night', source_fp: 'fp-4' },
                },
                { location: 'Bedroom', time: 'Night', source_fp: 'fp-4' },
            ],
            ['empty map returns null', [{ send_date: 'fp-1', mes: 'Message' }], {}, null],
            [
                'all messages before any extraction returns null',
                [
                    { send_date: 'fp-1', mes: 'Message 1' },
                    { send_date: 'fp-2', mes: 'Message 2' },
                ],
                { 'fp-5': { location: 'Office', time: 'Day', source_fp: 'fp-5' } },
                null,
            ],
        ])('$desc', async (_desc, chat, sceneStates, expected) => {
            const { findCurrentSceneState } = await import('../../src/extraction/scene-state.js');
            const result = findCurrentSceneState(chat, sceneStates);
            expect(result).toEqual(expected);
        });
    });

    describe('shouldTriggerSceneExtraction', () => {
        it.each([
            ['counter equal to interval triggers', 3, 3, true],
            ['counter greater than interval triggers', 5, 3, true],
            ['counter less than interval does not trigger', 2, 3, false],
            ['counter zero does not trigger', 0, 3, false],
        ])('$desc', async (_desc, sceneCounter, interval, expected) => {
            const { shouldTriggerSceneExtraction } = await import('../../src/extraction/scene-state.js');
            const result = shouldTriggerSceneExtraction(sceneCounter, interval);
            expect(result).toBe(expected);
        });
    });
});
