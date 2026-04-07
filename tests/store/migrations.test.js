import { beforeEach, describe, expect, it } from 'vitest';
import { MEMORIES_KEY, PROCESSED_MESSAGES_KEY } from '../../src/constants.js';
import { getFingerprint } from '../../src/extraction/scheduler.js';
import { CURRENT_SCHEMA_VERSION, runSchemaMigrations } from '../../src/store/migrations/index.js';

describe('migration orchestrator', () => {
    describe('runSchemaMigrations', () => {
        it('returns false when no migration needed (already v2)', () => {
            const data = { schema_version: 2, memories: [] };
            const result = runSchemaMigrations(data, []);
            expect(result).toBe(false);
        });

        it('returns false when schema_version equals current', () => {
            const data = { schema_version: CURRENT_SCHEMA_VERSION };
            const result = runSchemaMigrations(data, []);
            expect(result).toBe(false);
        });

        it('treats missing schema_version as v1', () => {
            const data = { [PROCESSED_MESSAGES_KEY]: [0, 1, 2] };
            // Will fail until v2 migration is implemented
            expect(() => runSchemaMigrations(data, [])).not.toThrow();
        });
    });
});

describe('v2 migration', () => {
    let chat;

    beforeEach(() => {
        let ts = 1000000;
        chat = [
            { mes: 'Hello', is_user: true, send_date: String(ts++) },
            { mes: 'Hi', is_user: false, send_date: String(ts++) },
            { mes: 'Bye', is_user: true, send_date: String(ts++) },
        ];
    });

    it('migrates index-based processed_message_ids to fingerprints', () => {
        const data = {
            [PROCESSED_MESSAGES_KEY]: [0, 2],
        };
        runSchemaMigrations(data, chat);

        expect(data[PROCESSED_MESSAGES_KEY]).toContain(getFingerprint(chat[0]));
        expect(data[PROCESSED_MESSAGES_KEY]).toContain(getFingerprint(chat[2]));
        expect(data[PROCESSED_MESSAGES_KEY]).not.toContain(0);
        expect(data[PROCESSED_MESSAGES_KEY]).not.toContain(2);
    });

    it('converts embedding arrays to embedding_b64', () => {
        const data = {
            [MEMORIES_KEY]: [
                { id: 'm1', embedding: [0.1, 0.2, 0.3] },
                { id: 'm2', embedding_b64: 'existing' }, // already converted
            ],
            graph: {
                nodes: [{ name: 'Alice', embedding: [0.5, 0.6] }],
            },
            communities: {},
        };

        runSchemaMigrations(data, chat);

        expect(data[MEMORIES_KEY][0].embedding).toBeUndefined();
        expect(data[MEMORIES_KEY][0].embedding_b64).toBeTypeOf('string');
        expect(data[MEMORIES_KEY][1].embedding_b64).toBe('existing'); // unchanged
        expect(data.graph.nodes[0].embedding).toBeUndefined();
        expect(data.graph.nodes[0].embedding_b64).toBeTypeOf('string');
    });

    it('initializes missing graph/communities/graph_message_count/reflection_state', () => {
        const data = {};

        runSchemaMigrations(data, chat);

        expect(data.graph).toBeDefined();
        expect(data.communities).toBeDefined();
        expect(data.graph_message_count).toBe(0);
        expect(data.reflection_state).toEqual({});
    });

    it('sets schema_version to current', () => {
        const data = {};
        runSchemaMigrations(data, chat);
        expect(data.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('returns true when migrations applied', () => {
        const data = { [PROCESSED_MESSAGES_KEY]: [0] };
        const result = runSchemaMigrations(data, chat);
        expect(result).toBe(true);
    });

    it('returns false when no changes needed', () => {
        const data = { schema_version: 2 };
        const result = runSchemaMigrations(data, chat);
        expect(result).toBe(false);
    });
});
