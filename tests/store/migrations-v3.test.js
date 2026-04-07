// @ts-check
/* global describe, expect, it */
import { describe, expect, it } from 'vitest';
import { runSchemaMigrations, CURRENT_SCHEMA_VERSION } from '../../src/store/migrations/index.js';

describe('v3 migration - backfill message_fingerprints', () => {
    const chat = [
        { send_date: '1000000', name: 'Alice', mes: 'Hello' },
        { send_date: '2000000', name: 'Bob', mes: 'World' },
        { send_date: '3000000', name: 'Alice', mes: 'Goodbye' },
    ];

    it('converts message_ids indices to message_fingerprints for existing memories', () => {
        const data = {
            schema_version: 2,
            memories: [
                { id: 'mem1', message_ids: [0, 1] },
                { id: 'mem2', message_ids: [2] },
                { id: 'mem3', message_ids: [] },
            ],
        };

        const result = runSchemaMigrations(data, chat);

        expect(result).toBe(true);
        expect(data.schema_version).toBe(3);
        expect(data.memories[0].message_fingerprints).toEqual(['1000000', '2000000']);
        expect(data.memories[1].message_fingerprints).toEqual(['3000000']);
        expect(data.memories[2].message_fingerprints).toEqual([]);
    });

    it('skips migration when already v3', () => {
        const data = {
            schema_version: 3,
            memories: [{ id: 'mem1', message_ids: [0], message_fingerprints: ['1000000'] }],
        };

        const result = runSchemaMigrations(data, chat);

        expect(result).toBe(false);
    });

    it('handles memories with missing message_ids', () => {
        const data = {
            schema_version: 2,
            memories: [
                { id: 'mem1' }, // no message_ids at all
            ],
        };

        const result = runSchemaMigrations(data, chat);

        expect(result).toBe(true);
        expect(data.memories[0].message_fingerprints).toEqual([]);
    });

    it('handles out-of-bounds indices gracefully', () => {
        const data = {
            schema_version: 2,
            memories: [
                { id: 'mem1', message_ids: [0, 99, 2] }, // index 99 doesn't exist
            ],
        };

        const result = runSchemaMigrations(data, chat);

        expect(result).toBe(true);
        expect(data.memories[0].message_fingerprints).toEqual(['1000000', '3000000']);
    });

    it('leaves message_ids intact for backward compatibility', () => {
        const data = {
            schema_version: 2,
            memories: [{ id: 'mem1', message_ids: [0] }],
        };

        runSchemaMigrations(data, chat);

        expect(data.memories[0].message_ids).toEqual([0]); // still there
    });
});
