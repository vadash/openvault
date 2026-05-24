// @ts-check
/**
 * Tests for v8 migration: Scene State backfill
 */

import { describe, expect, it } from 'vitest';
import { migrateToV8 } from '../../../src/store/migrations/v8.js';

describe('v8 migration', () => {
    it('should backfill scene_states, scene_ledger, and scene_counter for fresh data', () => {
        const freshData = {
            schema_version: 7,
            memories: [],
            characters: {},
            processed_messages: [],
        };

        const changed = migrateToV8(freshData, []);

        expect(changed).toBe(true);
        expect(freshData.scene_states).toEqual({});
        expect(freshData.scene_ledger).toEqual([]);
        expect(freshData.scene_counter).toBe(0);
    });

    it('should be no-op for already-migrated data with existing fields', () => {
        const alreadyMigratedData = {
            schema_version: 7,
            scene_states: {
                'fp-123': {
                    location: 'Living Room',
                    time: 'Evening',
                    characters: {},
                    source_fp: 'fp-123',
                },
            },
            scene_ledger: [{ fp: 'fp-123', location: 'Living Room', time: 'Evening' }],
            scene_counter: 5,
        };

        const changed = migrateToV8(alreadyMigratedData, []);

        expect(changed).toBe(false);
        expect(alreadyMigratedData.scene_states).toEqual({
            'fp-123': {
                location: 'Living Room',
                time: 'Evening',
                characters: {},
                source_fp: 'fp-123',
            },
        });
        expect(alreadyMigratedData.scene_ledger).toEqual([{ fp: 'fp-123', location: 'Living Room', time: 'Evening' }]);
        expect(alreadyMigratedData.scene_counter).toBe(5);
    });

    it('should recover partial migration with some fields missing', () => {
        const partialData = {
            schema_version: 7,
            scene_states: {
                'fp-456': {
                    location: 'Kitchen',
                    time: 'Morning',
                    characters: {},
                    source_fp: 'fp-456',
                },
            },
            // scene_ledger missing
            scene_counter: 2,
        };

        const changed = migrateToV8(partialData, []);

        expect(changed).toBe(true);
        expect(partialData.scene_states).toEqual({
            'fp-456': {
                location: 'Kitchen',
                time: 'Morning',
                characters: {},
                source_fp: 'fp-456',
            },
        });
        expect(partialData.scene_ledger).toEqual([]);
        expect(partialData.scene_counter).toBe(2);
    });

    it('should recover partial migration with scene_ledger present but others missing', () => {
        const partialData = {
            schema_version: 7,
            // scene_states missing
            scene_ledger: [{ fp: 'fp-789', location: 'Garden', time: 'Afternoon' }],
            // scene_counter missing
        };

        const changed = migrateToV8(partialData, []);

        expect(changed).toBe(true);
        expect(partialData.scene_states).toEqual({});
        expect(partialData.scene_ledger).toEqual([{ fp: 'fp-789', location: 'Garden', time: 'Afternoon' }]);
        expect(partialData.scene_counter).toBe(0);
    });

    it('should handle data with only scene_counter present', () => {
        const partialData = {
            schema_version: 7,
            // scene_states missing
            // scene_ledger missing
            scene_counter: 10,
        };

        const changed = migrateToV8(partialData, []);

        expect(changed).toBe(true);
        expect(partialData.scene_states).toEqual({});
        expect(partialData.scene_ledger).toEqual([]);
        expect(partialData.scene_counter).toBe(10);
    });
});
