// @ts-check
/**
 * Tests for schemas.js factory pattern
 */

import { beforeEach, describe, expect, it } from 'vitest';

describe('schemas.js factory pattern', () => {
    beforeEach(async () => {
        await registerCdnOverrides();
    });

    it('getSchemas() returns an object with all expected schema names', async () => {
        const { getSchemas } = await import('../../src/store/schemas.js');
        const schemas = await getSchemas();

        const expectedSchemaNames = [
            'MemorySchema',
            'GraphNodeSchema',
            'GraphEdgeSchema',
            'GraphDataSchema',
            'ScoreBreakdownSchema',
            'ScoredMemorySchema',
            'BaseEntitySchema',
            'BaseRelationshipSchema',
            'EventSchema',
            'EventExtractionSchema',
            'CharacterDataSchema',
            'ReflectionStateSchema',
            'GlobalWorldStateSchema',
            'OpenVaultDataSchema',
            'ScoringConfigSchema',
            'QueryConfigSchema',
            'GraphExtractionSchema',
            'ExtractionOptionsSchema',
            'IDFCacheSchema',
            'ExtractionContextParamsSchema',
            'ExtractionLLMOptionsSchema',
            'GenerateReflectionsResultSchema',
            'ConsolidateEdgesResultSchema',
            'MergeEntityResultSchema',
            'LLMConfigSchema',
            'LLMCallOptionsSchema',
            'LLMMessagesSchema',
            'RetrievalContextSchema',
            'BM25ContextSchema',
            'ForgetfulnessConstantsSchema',
            'ScoringSettingsSchema',
            'MemoryUpdateSchema',
            'CharacterNamesSchema',
            'PromptContextSchema',
            'BasePromptParamsSchema',
            'GraphPromptParamsSchema',
            'EdgeConsolidationParamsSchema',
            'ReflectionPromptParamsSchema',
        ];

        for (const name of expectedSchemaNames) {
            expect(schemas[name]).toBeDefined();
            expect(typeof schemas[name].parse).toBe('function');
        }
    });

    it('schemas are cached (second call returns same reference)', async () => {
        const { getSchemas } = await import('../../src/store/schemas.js');
        const schemas1 = await getSchemas();
        const schemas2 = await getSchemas();

        expect(schemas1).toBe(schemas2);
        expect(schemas1.MemorySchema).toBe(schemas2.MemorySchema);
    });

    it('generated schemas validate correct data', async () => {
        const { getSchemas } = await import('../../src/store/schemas.js');
        const schemas = await getSchemas();

        // Test MemorySchema
        const memory = {
            id: 'test_123',
            summary: 'A test memory',
            importance: 3,
            message_id: 456,
            timestamp: Date.now(),
            tokens: ['test', 'memory'],
        };
        const result = schemas.MemorySchema.parse(memory);
        expect(result).toEqual(memory);

        // Test BaseEntitySchema
        const entity = {
            name: 'TestEntity',
            type: 'PERSON',
            description: 'A test entity',
        };
        const entityResult = schemas.BaseEntitySchema.parse(entity);
        expect(entityResult).toEqual(entity);

        // Test GraphNodeSchema
        const graphNode = {
            name: 'TestNode',
            type: 'PLACE',
            description: 'A test location',
            mentions: 5,
        };
        const nodeResult = schemas.GraphNodeSchema.parse(graphNode);
        expect(nodeResult).toEqual(graphNode);
    });
});
