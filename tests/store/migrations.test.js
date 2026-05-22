import { beforeEach, describe, expect, it } from 'vitest';
import { MEMORIES_KEY, PROCESSED_MESSAGES_KEY } from '../../src/constants.js';
import { getFingerprint } from '../../src/extraction/scheduler.js';
import { CURRENT_SCHEMA_VERSION, runSchemaMigrations } from '../../src/store/migrations/index.js';

describe('migration orchestrator', () => {
    describe('runSchemaMigrations', () => {
        it('returns false when no migration needed (already at current)', () => {
            const data = { schema_version: CURRENT_SCHEMA_VERSION, memories: [] };
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

    it('initializes missing graph/graph_message_count/reflection_state', () => {
        const data = {};

        runSchemaMigrations(data, chat);

        expect(data.graph).toBeDefined();
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
        const data = { schema_version: CURRENT_SCHEMA_VERSION };
        const result = runSchemaMigrations(data, chat);
        expect(result).toBe(false);
    });
});

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
        expect(data.schema_version).toBe(CURRENT_SCHEMA_VERSION);
        expect(data.memories[0].message_fingerprints).toEqual(['1000000', '2000000']);
        expect(data.memories[1].message_fingerprints).toEqual(['3000000']);
        expect(data.memories[2].message_fingerprints).toEqual([]);
    });

    it('migrates when already v3 (adds injection.reflections)', () => {
        const data = {
            schema_version: 3,
            memories: [{ id: 'mem1', message_ids: [0], message_fingerprints: ['1000000'] }],
        };

        const result = runSchemaMigrations(data, chat);

        expect(result).toBe(true);
        expect(data.schema_version).toBe(CURRENT_SCHEMA_VERSION);
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

describe('v4 migration - add injection.reflections', () => {
    it('adds injection.reflections with defaults to fresh data', () => {
        const data = {
            schema_version: 3,
            settings: {
                injection: {
                    memory: { position: 1, depth: 4 },
                    world: { position: 1, depth: 4 },
                },
            },
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(true);
        expect(data.schema_version).toBe(CURRENT_SCHEMA_VERSION);
        expect(data.settings.injection.reflections).toEqual({ position: 1, depth: 4 });
    });

    it('preserves existing injection.reflections when already v4', () => {
        const data = {
            schema_version: 4,
            settings: {
                injection: {
                    memory: { position: 0, depth: 5 },
                    reflections: { position: 2, depth: 3 },
                    world: { position: 1, depth: 4 },
                },
            },
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(false);
        expect(data.settings.injection.reflections).toEqual({ position: 2, depth: 3 });
    });

    it('adds reflections to partial data without touching memory or world', () => {
        const data = {
            schema_version: 3,
            settings: {
                injection: {
                    memory: { position: 0, depth: 5 },
                    world: { position: 2, depth: 3 },
                },
            },
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(true);
        expect(data.settings.injection.memory).toEqual({ position: 0, depth: 5 });
        expect(data.settings.injection.reflections).toEqual({ position: 1, depth: 4 });
        expect(data.settings.injection.world).toEqual({ position: 2, depth: 3 });
    });

    it('handles missing injection object', () => {
        const data = {
            schema_version: 3,
            settings: {},
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(true);
        expect(data.settings.injection).toBeDefined();
        expect(data.settings.injection.reflections).toEqual({ position: 1, depth: 4 });
    });
});

describe('v5 migration - convert reflection toggles to position -2', () => {
    it('converts reflectionInjectionEnabled: false to position -2', () => {
        const data = {
            schema_version: 4,
            settings: {
                reflectionGenerationEnabled: true,
                reflectionInjectionEnabled: false,
                injection: {
                    reflections: { position: 1, depth: 4 },
                },
            },
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(true);
        expect(data.schema_version).toBe(7);
        expect(data.settings.injection.reflections.position).toBe(-2);
    });

    it('deletes both reflectionGenerationEnabled and reflectionInjectionEnabled keys', () => {
        const data = {
            schema_version: 4,
            settings: {
                reflectionGenerationEnabled: false,
                reflectionInjectionEnabled: false,
                injection: {
                    reflections: { position: 1, depth: 4 },
                },
            },
        };

        runSchemaMigrations(data, []);

        expect(data.settings).not.toHaveProperty('reflectionGenerationEnabled');
        expect(data.settings).not.toHaveProperty('reflectionInjectionEnabled');
    });

    it('preserves position when reflectionInjectionEnabled is true', () => {
        const data = {
            schema_version: 4,
            settings: {
                reflectionGenerationEnabled: true,
                reflectionInjectionEnabled: true,
                injection: {
                    reflections: { position: 2, depth: 3 },
                },
            },
        };

        runSchemaMigrations(data, []);

        expect(data.settings.injection.reflections.position).toBe(2);
    });

    it('deletes old keys even when injection.reflections does not exist', () => {
        const data = {
            schema_version: 4,
            settings: {
                reflectionGenerationEnabled: false,
                reflectionInjectionEnabled: false,
            },
        };

        runSchemaMigrations(data, []);

        expect(data.settings).not.toHaveProperty('reflectionGenerationEnabled');
        expect(data.settings).not.toHaveProperty('reflectionInjectionEnabled');
    });

    it('handles data with no settings object', () => {
        const data = {
            schema_version: 4,
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(false);
        expect(data.schema_version).toBe(7);
    });

    it('is idempotent - running twice produces the same result', () => {
        const data = {
            schema_version: 4,
            settings: {
                reflectionGenerationEnabled: true,
                reflectionInjectionEnabled: false,
                injection: {
                    reflections: { position: 1, depth: 4 },
                },
            },
        };

        runSchemaMigrations(data, []);
        const firstRun = structuredClone(data);

        runSchemaMigrations(data, []);

        expect(data).toEqual(firstRun);
    });
});

describe('v6 migration - remove community data', () => {
    it('deletes communities object', () => {
        const data = {
            schema_version: 5,
            communities: { nodes: [] },
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(true);
        expect(data).not.toHaveProperty('communities');
    });

    it('removes community_count from global_world_state', () => {
        const data = {
            schema_version: 5,
            global_world_state: { summary: 'Test', community_count: 3 },
        };

        runSchemaMigrations(data, []);

        expect(data.global_world_state).not.toHaveProperty('community_count');
        expect(data.global_world_state.summary).toBe('Test');
    });

    it('renames communityDetectionInterval to worldStateInterval', () => {
        const data = {
            schema_version: 5,
            settings: { communityDetectionInterval: 50 },
        };

        runSchemaMigrations(data, []);

        expect(data.settings).not.toHaveProperty('communityDetectionInterval');
        expect(data.settings.worldStateInterval).toBe(50);
    });

    it('handles data with no communities or global_world_state', () => {
        const data = {
            schema_version: 5,
            settings: {},
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(false);
    });
});

describe('v7 migration - delete Level 2+ reflections', () => {
    it('deletes reflections where level > 1 but keeps Level 1 reflections and events', () => {
        const data = {
            schema_version: 6,
            memories: [
                { id: 'm1', type: 'event', summary: 'Event 1', level: 1 },
                { id: 'm2', type: 'reflection', summary: 'Level 1 reflection', level: 1 },
                { id: 'm3', type: 'reflection', summary: 'Level 2 reflection', level: 2 },
                { id: 'm4', type: 'reflection', summary: 'Level 3 reflection', level: 3 },
                { id: 'm5', type: 'reflection', summary: 'Reflection no explicit level' }, // no level defaults to 1 (kept)
            ],
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(true);
        expect(data.memories).toHaveLength(3);
        expect(data.memories.some((m) => m.id === 'm1')).toBe(true);
        expect(data.memories.some((m) => m.id === 'm2')).toBe(true);
        expect(data.memories.some((m) => m.id === 'm3')).toBe(false);
        expect(data.memories.some((m) => m.id === 'm4')).toBe(false);
        expect(data.memories.some((m) => m.id === 'm5')).toBe(true);
    });

    it('keeps data unchanged when no Level 2+ reflections exist', () => {
        const data = {
            schema_version: 6,
            memories: [
                { id: 'm1', type: 'event', summary: 'Event 1' },
                { id: 'm2', type: 'reflection', summary: 'Level 1 reflection', level: 1 },
            ],
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(false);
        expect(data.memories).toHaveLength(2);
    });

    it('removes maxReflectionLevel and reflectionLevelMultiplier from data.settings if present', () => {
        const data = {
            schema_version: 6,
            memories: [],
            settings: {
                maxReflectionLevel: 3,
                reflectionLevelMultiplier: 2.0,
                otherSetting: 'value',
            },
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(true);
        expect(data.settings).not.toHaveProperty('maxReflectionLevel');
        expect(data.settings).not.toHaveProperty('reflectionLevelMultiplier');
        expect(data.settings.otherSetting).toBe('value');
    });

    it('handles missing data.memories gracefully (no crash)', () => {
        const data = {
            schema_version: 6,
            settings: {},
        };

        expect(() => runSchemaMigrations(data, [])).not.toThrow();
        expect(data.memories).toBeUndefined();
    });

    it('returns true when changes made, false when no changes needed', () => {
        const dataWithL2 = {
            schema_version: 6,
            memories: [{ id: 'm1', type: 'reflection', level: 2 }],
        };

        const dataWithoutL2 = {
            schema_version: 6,
            memories: [{ id: 'm1', type: 'reflection', level: 1 }],
        };

        expect(runSchemaMigrations(dataWithL2, [])).toBe(true);
        expect(runSchemaMigrations(dataWithoutL2, [])).toBe(false);
    });

    it('removes stale settings even when no memories exist', () => {
        const data = {
            schema_version: 6,
            settings: {
                maxReflectionLevel: 3,
                reflectionLevelMultiplier: 2.0,
            },
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(true);
        expect(data.settings).not.toHaveProperty('maxReflectionLevel');
        expect(data.settings).not.toHaveProperty('reflectionLevelMultiplier');
    });

    it('treats reflection with no level field as level 1 (keeps it)', () => {
        const data = {
            schema_version: 6,
            memories: [{ id: 'm1', type: 'reflection', summary: 'No level specified' }],
        };

        const result = runSchemaMigrations(data, []);

        expect(result).toBe(false);
        expect(data.memories).toHaveLength(1);
        expect(data.memories[0].id).toBe('m1');
    });
});
