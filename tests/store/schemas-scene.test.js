// @ts-check
/**
 * Tests for Scene State Zod schemas
 */

import { beforeEach, describe, expect, it } from 'vitest';

describe('Scene State schemas', () => {
    beforeEach(async () => {
        await registerCdnOverrides();
    });

    describe('SceneCharacterSchema', () => {
        it.each([
            [
                'full character with all fields',
                {
                    clothing: ['red dress', 'black heels'],
                    posture: 'standing by the window',
                    physical_status: ['slightly tired', 'blushing'],
                    mental_status: [' nervous', 'excited'],
                },
                true,
            ],
            [
                'character with empty arrays',
                {
                    clothing: [],
                    posture: 'sitting',
                    physical_status: [],
                    mental_status: [],
                },
                true,
            ],
            [
                'character with only posture',
                {
                    posture: 'lying on bed',
                },
                false,
            ],
            [
                'character with clothing as string (invalid)',
                {
                    clothing: 'red dress',
                    posture: 'standing',
                },
                false,
            ],
        ])('validates $desc', async (_desc, input, shouldPass) => {
            const { getSchemas } = await import('../../src/store/schemas.js');
            const { SceneCharacterSchema } = await getSchemas();

            if (shouldPass) {
                const result = SceneCharacterSchema.parse(input);
                expect(result).toEqual(input);
            } else {
                expect(() => SceneCharacterSchema.parse(input)).toThrow();
            }
        });
    });

    describe('SceneStateSchema', () => {
        it.each([
            [
                'full scene state',
                {
                    location: 'Living Room',
                    time: 'Friday evening, around 7 PM',
                    environment: 'warm lighting, soft music playing',
                    characters: {
                        Alice: {
                            clothing: ['blue sweater', 'jeans'],
                            posture: 'sitting on the couch',
                            physical_status: ['relaxed'],
                            mental_status: ['content'],
                        },
                        Bob: {
                            clothing: ['t-shirt', ' shorts'],
                            posture: 'standing near the fireplace',
                            physical_status: [],
                            mental_status: ['thoughtful'],
                        },
                    },
                    active_props: ['wine glass', 'book'],
                    source_fp: 'msg-123-abc',
                },
                true,
            ],
            [
                'scene state without environment (optional)',
                {
                    location: 'Kitchen',
                    time: 'Saturday morning',
                    characters: {
                        Alice: {
                            clothing: ['apron'],
                            posture: 'cooking',
                            physical_status: ['busy'],
                            mental_status: ['focused'],
                        },
                    },
                    active_props: [],
                    source_fp: 'msg-456-def',
                },
                true,
            ],
            [
                'scene state with default empty active_props',
                {
                    location: 'Bedroom',
                    time: 'Night',
                    characters: {},
                    source_fp: 'msg-789',
                },
                true,
            ],
            [
                'scene state missing location (invalid)',
                {
                    time: 'Morning',
                    characters: {},
                    source_fp: 'msg-111',
                },
                false,
            ],
            [
                'scene state missing time (invalid)',
                {
                    location: 'Office',
                    characters: {},
                    source_fp: 'msg-222',
                },
                false,
            ],
            [
                'scene state missing source_fp (invalid)',
                {
                    location: 'Garden',
                    time: 'Afternoon',
                    characters: {},
                },
                false,
            ],
        ])('validates $desc', async (_desc, input, shouldPass) => {
            const { getSchemas } = await import('../../src/store/schemas.js');
            const { SceneStateSchema } = await getSchemas();

            if (shouldPass) {
                const result = SceneStateSchema.parse(input);
                // Check that active_props defaults to [] if not provided
                if (!input.active_props) {
                    expect(result.active_props).toEqual([]);
                } else {
                    expect(result).toMatchObject(input);
                }
            } else {
                expect(() => SceneStateSchema.parse(input)).toThrow();
            }
        });
    });

    describe('SceneLedgerEntrySchema', () => {
        it.each([
            [
                'valid ledger entry',
                {
                    fp: 'msg-123-abc',
                    location: 'Living Room',
                    time: 'Friday evening',
                },
                true,
            ],
            [
                'ledger entry missing fp (invalid)',
                {
                    location: 'Kitchen',
                    time: 'Morning',
                },
                false,
            ],
            [
                'ledger entry missing location (invalid)',
                {
                    fp: 'msg-456',
                    time: 'Night',
                },
                false,
            ],
            [
                'ledger entry missing time (invalid)',
                {
                    fp: 'msg-789',
                    location: 'Bedroom',
                },
                false,
            ],
        ])('validates $desc', async (_desc, input, shouldPass) => {
            const { getSchemas } = await import('../../src/store/schemas.js');
            const { SceneLedgerEntrySchema } = await getSchemas();

            if (shouldPass) {
                const result = SceneLedgerEntrySchema.parse(input);
                expect(result).toEqual(input);
            } else {
                expect(() => SceneLedgerEntrySchema.parse(input)).toThrow();
            }
        });
    });

    it('schemas are exported in getSchemas()', async () => {
        const { getSchemas } = await import('../../src/store/schemas.js');
        const schemas = await getSchemas();

        expect(schemas.SceneStateSchema).toBeDefined();
        expect(schemas.SceneCharacterSchema).toBeDefined();
        expect(schemas.SceneLedgerEntrySchema).toBeDefined();
        expect(typeof schemas.SceneStateSchema.parse).toBe('function');
        expect(typeof schemas.SceneCharacterSchema.parse).toBe('function');
        expect(typeof schemas.SceneLedgerEntrySchema.parse).toBe('function');
    });
});
