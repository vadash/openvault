import { describe, expect, it, vi, beforeEach } from 'vitest';
import { consolidateEdges, createEmptyGraph } from '../../src/graph/graph.js';

// Mock dependencies
vi.mock('../../src/embeddings.js', () => ({
    isEmbeddingsEnabled: () => false,
}));

const mockCallLLM = vi.fn();
vi.mock('../../src/llm.js', () => ({
    callLLM: (...args) => mockCallLLM(...args),
}));

describe('Edge Consolidation (BM25-only mode)', () => {
    beforeEach(() => {
        mockCallLLM.mockReset();
    });

    it('consolidates without embeddings when disabled', async () => {
        mockCallLLM.mockResolvedValue(
            JSON.stringify({ consolidated_description: 'Consolidated relationship' })
        );

        const graph = createEmptyGraph();
        graph.nodes.alice = { name: 'Alice', type: 'PERSON', description: 'test', mentions: 1 };
        graph.nodes.bob = { name: 'Bob', type: 'PERSON', description: 'test', mentions: 1 };
        graph.edges['alice__bob'] = {
            source: 'alice',
            target: 'bob',
            description: 'Seg1 | Seg2 | Seg3 | Seg4 | Seg5 | Seg6',
            weight: 6,
            _descriptionTokens: 600
        };
        graph._edgesNeedingConsolidation = ['alice__bob'];

        const result = await consolidateEdges(graph, {});
        expect(result).toBe(1);
        expect(graph.edges['alice__bob'].description).toBe('Consolidated relationship');
        expect(graph._edgesNeedingConsolidation).toHaveLength(0);
    });
});
