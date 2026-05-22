import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateWorldState, selectTopEntities } from '../../src/graph/world-state.js';
import { buildMockGraphNode } from '../factories.js';

// Mock llm module
vi.mock('../../src/llm.js', () => ({
    callLLM: vi.fn(),
    LLM_CONFIGS: {
        community: {
            profileSettingKey: 'extractionProfile',
            maxTokens: 8000,
            errorContext: 'World state generation',
            timeoutMs: 180000,
            getJsonSchema: undefined,
        },
    },
}));

// Mock extraction/structured module
vi.mock('../../src/extraction/structured.js', () => ({
    parseGlobalSynthesisResponse: vi.fn((content) => ({
        global_summary: content.replace(/"/g, ''),
    })),
}));

// Mock prompts/index module
vi.mock('../../src/prompts/index.js', () => ({
    buildGlobalWorldStatePrompt: vi.fn((entities, edges, _preamble, _outputLanguage, prefill) => [
        { role: 'system', content: 'World state synthesizer' },
        { role: 'user', content: `Entities: ${entities.length}, Edges: ${edges.length}` },
        { role: 'assistant', content: prefill || '' },
    ]),
    resolveExtractionPreamble: (settings) => settings.preambleLanguage || 'cn',
    resolveOutputLanguage: (settings) => settings.outputLanguage || 'auto',
    resolveExtractionPrefill: (settings) => settings.extractionPrefill || 'cn_compliance',
}));

// Mock deps module
vi.mock('../../src/deps.js', () => ({
    getDeps: vi.fn(() => ({
        Date: { now: () => 1234567890 },
    })),
}));

describe('selectTopEntities', () => {
    let graphData;

    beforeEach(() => {
        graphData = {
            nodes: {},
            edges: {},
        };
    });

    it('returns empty arrays for empty graph', () => {
        const result = selectTopEntities(graphData, 5);
        expect(result.entities).toEqual([]);
        expect(result.edges).toEqual([]);
    });

    it('sorts by mentions descending', () => {
        graphData.nodes = {
            alice: buildMockGraphNode({ name: 'Alice', type: 'PERSON', mentions: 10 }),
            bob: buildMockGraphNode({ name: 'Bob', type: 'PERSON', mentions: 5 }),
            castle: buildMockGraphNode({ name: 'Castle', type: 'PLACE', mentions: 15 }),
        };

        const result = selectTopEntities(graphData, 10);
        expect(result.entities).toHaveLength(3);
        expect(result.entities[0].name).toBe('Castle'); // 15 mentions
        expect(result.entities[1].name).toBe('Alice'); // 10 mentions
        expect(result.entities[2].name).toBe('Bob'); // 5 mentions
    });

    it('caps at count parameter', () => {
        graphData.nodes = {
            alice: buildMockGraphNode({ name: 'Alice', type: 'PERSON', mentions: 10 }),
            bob: buildMockGraphNode({ name: 'Bob', type: 'PERSON', mentions: 5 }),
            castle: buildMockGraphNode({ name: 'Castle', type: 'PLACE', mentions: 15 }),
            dungeon: buildMockGraphNode({ name: 'Dungeon', type: 'PLACE', mentions: 8 }),
            empress: buildMockGraphNode({ name: 'Empress', type: 'PERSON', mentions: 12 }),
        };

        const result = selectTopEntities(graphData, 3);
        expect(result.entities).toHaveLength(3);
        expect(result.entities[0].name).toBe('Castle');
        expect(result.entities[1].name).toBe('Empress');
        expect(result.entities[2].name).toBe('Alice');
    });

    it('resolves edge keys to display names (never returns raw keys)', () => {
        graphData.nodes = {
            'alice smith': buildMockGraphNode({ name: 'Alice Smith', type: 'PERSON', mentions: 10 }),
            'castle black': buildMockGraphNode({ name: 'Castle Black', type: 'PLACE', mentions: 5 }),
        };
        graphData.edges = {
            'alice smith__castle black': {
                source: 'alice smith',
                target: 'castle black',
                description: 'Alice visits the castle',
                weight: 3,
            },
        };

        const result = selectTopEntities(graphData, 10);
        expect(result.entities[0].name).toBe('Alice Smith');
        expect(result.entities[1].name).toBe('Castle Black');
        expect(result.edges[0].source).toBe('Alice Smith');
        expect(result.edges[0].target).toBe('Castle Black');
    });

    it('includes sourceType and targetType on edges', () => {
        graphData.nodes = {
            alice: buildMockGraphNode({ name: 'Alice', type: 'PERSON', mentions: 10 }),
            castle: buildMockGraphNode({ name: 'Castle', type: 'PLACE', mentions: 5 }),
        };
        graphData.edges = {
            alice__castle: {
                source: 'alice',
                target: 'castle',
                description: 'Alice lives here',
                weight: 5,
            },
        };

        const result = selectTopEntities(graphData, 10);
        expect(result.edges[0].sourceType).toBe('PERSON');
        expect(result.edges[0].targetType).toBe('PLACE');
    });

    it('excludes edges where only one endpoint is in the set', () => {
        graphData.nodes = {
            alice: buildMockGraphNode({ name: 'Alice', type: 'PERSON', mentions: 10 }),
            bob: buildMockGraphNode({ name: 'Bob', type: 'PERSON', mentions: 8 }),
            castle: buildMockGraphNode({ name: 'Castle', type: 'PLACE', mentions: 3 }),
        };
        graphData.edges = {
            alice__bob: {
                source: 'alice',
                target: 'bob',
                description: 'Friends',
                weight: 5,
            },
            alice__castle: {
                source: 'alice',
                target: 'castle',
                description: 'Alice visits',
                weight: 2,
            },
            bob__castle: {
                source: 'bob',
                target: 'castle',
                description: 'Bob visits',
                weight: 2,
            },
        };

        // Only top 2 by mentions: Alice (10) and Bob (8)
        const result = selectTopEntities(graphData, 2);
        expect(result.entities).toHaveLength(2);
        expect(result.entities.map((e) => e.name)).toEqual(['Alice', 'Bob']);
        // Only Alice-Bob edge should be included (both endpoints in set)
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].source).toBe('Alice');
        expect(result.edges[0].target).toBe('Bob');
    });

    it('uses WORLD_STATE_ENTITY_COUNT as default', () => {
        graphData.nodes = {
            alice: buildMockGraphNode({ name: 'Alice', type: 'PERSON', mentions: 10 }),
            bob: buildMockGraphNode({ name: 'Bob', type: 'PERSON', mentions: 5 }),
        };

        const result = selectTopEntities(graphData);
        expect(result.entities).toHaveLength(2);
    });
});

describe('generateWorldState', () => {
    it('calls buildGlobalWorldStatePrompt with resolved entities and edges', async () => {
        const { buildGlobalWorldStatePrompt } = await import('../../src/prompts/index.js');
        const { callLLM } = await import('../../src/llm.js');
        const { parseGlobalSynthesisResponse } = await import('../../src/extraction/structured.js');

        callLLM.mockResolvedValue('"Test world state summary"');
        parseGlobalSynthesisResponse.mockReturnValue({ global_summary: 'Test world state summary' });

        const entities = [{ name: 'Alice', type: 'PERSON', description: 'A character' }];
        const edges = [
            {
                source: 'Alice',
                target: 'Bob',
                sourceType: 'PERSON',
                targetType: 'PERSON',
                description: 'Knows each other',
            },
        ];

        const result = await generateWorldState(entities, edges, 'cn', 'auto', '{');

        expect(buildGlobalWorldStatePrompt).toHaveBeenCalledWith(entities, edges, 'cn', 'auto', '{');
        expect(callLLM).toHaveBeenCalled();
        expect(parseGlobalSynthesisResponse).toHaveBeenCalled();
        expect(result.summary).toBe('Test world state summary');
        expect(result.last_updated).toBeDefined();
    });

    it('returns { summary, last_updated } structure', async () => {
        const { callLLM } = await import('../../src/llm.js');
        callLLM.mockResolvedValue('"Summary text"');

        const result = await generateWorldState([], [], 'cn', 'auto', '{');

        expect(result).toHaveProperty('summary');
        expect(result).toHaveProperty('last_updated');
        expect(typeof result.summary).toBe('string');
        expect(typeof result.last_updated).toBe('number');
    });
});
