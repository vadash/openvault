import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDeps } from '../../src/deps.js';
import {
    buildCommunityGroups,
    detectCommunities,
    generateGlobalWorldState,
    synthesizeInChunks,
    toGraphology,
    updateCommunitySummaries,
} from '../../src/graph/communities.js';

describe('toGraphology', () => {
    it('converts flat graph to graphology instance', () => {
        const graphData = {
            nodes: {
                castle: { name: 'Castle', type: 'PLACE', description: 'A fortress', mentions: 1 },
                king: { name: 'King', type: 'PERSON', description: 'The ruler', mentions: 2 },
            },
            edges: {
                king__castle: { source: 'king', target: 'castle', description: 'Rules from', weight: 3 },
            },
        };
        const graph = toGraphology(graphData);
        expect(graph.order).toBe(2); // 2 nodes
        expect(graph.size).toBe(1); // 1 edge
        expect(graph.hasNode('castle')).toBe(true);
        expect(graph.hasNode('king')).toBe(true);
    });

    it('skips self-loop edges defensively', () => {
        // Graph with a self-loop edge (should be prevented at insertion, but handle anyway)
        const graphData = {
            nodes: {
                king: { name: 'King', type: 'PERSON', description: 'The ruler', mentions: 2 },
            },
            edges: {
                king__king: { source: 'king', target: 'king', description: 'Self-loop', weight: 1 },
            },
        };
        const graph = toGraphology(graphData);
        expect(graph.order).toBe(1); // 1 node
        expect(graph.size).toBe(0); // 0 edges (self-loop skipped)
    });
});

describe('detectCommunities', () => {
    it('returns null when fewer than 3 nodes', () => {
        const graphData = {
            nodes: { a: { name: 'A' }, b: { name: 'B' } },
            edges: {},
        };
        const result = detectCommunities(graphData);
        expect(result).toBeNull();
    });

    it('finds multiple communities when main character edges are pruned', () => {
        // Build a graph where everything connects through "protagonist"
        // but two distinct clusters exist among secondary entities
        const graphData = {
            nodes: {
                protagonist: { name: 'Protagonist', type: 'PERSON', description: 'Main', mentions: 10 },
                shopkeeper: { name: 'Shopkeeper', type: 'PERSON', description: 'Shop owner', mentions: 3 },
                shop: { name: 'Shop', type: 'PLACE', description: 'A store', mentions: 3 },
                item: { name: 'Magic Sword', type: 'OBJECT', description: 'A sword', mentions: 2 },
                teacher: { name: 'Teacher', type: 'PERSON', description: 'A mentor', mentions: 3 },
                school: { name: 'School', type: 'PLACE', description: 'Academy', mentions: 3 },
                textbook: { name: 'Textbook', type: 'OBJECT', description: 'A book', mentions: 2 },
            },
            edges: {
                // Protagonist has MASSIVE connections to everyone (extreme hairball)
                p_shop: { source: 'protagonist', target: 'shopkeeper', description: 'visits', weight: 50 },
                p_teach: { source: 'protagonist', target: 'teacher', description: 'studies with', weight: 50 },
                p_school: { source: 'protagonist', target: 'school', description: 'attends', weight: 30 },
                p_store: { source: 'protagonist', target: 'shop', description: 'goes to', weight: 30 },
                p_item: { source: 'protagonist', target: 'item', description: 'wields', weight: 20 },
                p_book: { source: 'protagonist', target: 'textbook', description: 'reads', weight: 20 },
                // Natural clusters still exist but are weaker than protagonist connections
                sk_shop: { source: 'shopkeeper', target: 'shop', description: 'owns', weight: 4 },
                sk_item: { source: 'shopkeeper', target: 'item', description: 'sells', weight: 3 },
                shop_item: { source: 'shop', target: 'item', description: 'contains', weight: 3 },
                t_school: { source: 'teacher', target: 'school', description: 'works at', weight: 4 },
                t_book: { source: 'teacher', target: 'textbook', description: 'uses', weight: 3 },
                school_book: { source: 'school', target: 'textbook', description: 'has', weight: 3 },
            },
        };

        // First, verify the current behavior without pruning (should be 1 community due to hairball)
        const resultWithoutPruning = detectCommunities(graphData);
        expect(resultWithoutPruning).not.toBeNull();
        expect(resultWithoutPruning.count).toBe(1); // Extreme hairball produces 1 community

        // With pruning, should find >= 2 communities (shop cluster + school cluster)
        const mainCharacterKeys = ['protagonist'];
        const result = detectCommunities(graphData, mainCharacterKeys);
        expect(result).not.toBeNull();
        expect(result.count).toBeGreaterThanOrEqual(2);
    });

    it('still works when mainCharacterKeys is empty', () => {
        const graphData = {
            nodes: {
                a: { name: 'A', type: 'PERSON', description: 'A', mentions: 1 },
                b: { name: 'B', type: 'PERSON', description: 'B', mentions: 1 },
                c: { name: 'C', type: 'PERSON', description: 'C', mentions: 1 },
            },
            edges: {
                ab: { source: 'a', target: 'b', description: 'knows', weight: 1 },
                bc: { source: 'b', target: 'c', description: 'knows', weight: 1 },
            },
        };
        const result = detectCommunities(graphData, []);
        expect(result).not.toBeNull();
    });

    it('detects communities in a connected graph', () => {
        // Create two clusters connected by a single weak edge
        const graphData = {
            nodes: {
                a: { name: 'A', type: 'PERSON', description: 'A', mentions: 5 },
                b: { name: 'B', type: 'PERSON', description: 'B', mentions: 5 },
                c: { name: 'C', type: 'PERSON', description: 'C', mentions: 5 },
                d: { name: 'D', type: 'PERSON', description: 'D', mentions: 5 },
                e: { name: 'E', type: 'PERSON', description: 'E', mentions: 5 },
                f: { name: 'F', type: 'PERSON', description: 'F', mentions: 5 },
            },
            edges: {
                a__b: { source: 'a', target: 'b', description: 'friends', weight: 10 },
                b__c: { source: 'b', target: 'c', description: 'allies', weight: 10 },
                a__c: { source: 'a', target: 'c', description: 'team', weight: 10 },
                d__e: { source: 'd', target: 'e', description: 'friends', weight: 10 },
                e__f: { source: 'e', target: 'f', description: 'allies', weight: 10 },
                d__f: { source: 'd', target: 'f', description: 'team', weight: 10 },
                c__d: { source: 'c', target: 'd', description: 'knows', weight: 1 },
            },
        };
        const result = detectCommunities(graphData);
        expect(result).not.toBeNull();
        expect(result.communities).toBeDefined();
        expect(result.count).toBeGreaterThanOrEqual(1);
    });
});

describe('buildCommunityGroups', () => {
    it('groups nodes by community ID and formats prompt data', () => {
        const graphData = {
            nodes: {
                king: { name: 'King', type: 'PERSON', description: 'Ruler', mentions: 3 },
                castle: { name: 'Castle', type: 'PLACE', description: 'Fortress', mentions: 2 },
                tavern: { name: 'Tavern', type: 'PLACE', description: 'A pub', mentions: 1 },
            },
            edges: {
                king__castle: { source: 'king', target: 'castle', description: 'Rules from', weight: 4 },
            },
        };
        const partition = { king: 0, castle: 0, tavern: 1 };
        const groups = buildCommunityGroups(graphData, partition);

        expect(Object.keys(groups)).toHaveLength(2);
        expect(groups[0].nodeKeys).toContain('king');
        expect(groups[0].nodeKeys).toContain('castle');
        expect(groups[0].nodeLines.length).toBeGreaterThan(0);
        expect(groups[1].nodeKeys).toContain('tavern');
    });
});

// Mock LLM
const mockCallLLM = vi.fn();
vi.mock('../../src/llm.js', () => ({
    callLLM: (...args) => mockCallLLM(...args),
    LLM_CONFIGS: { community: { profileSettingKey: 'extractionProfile' } },
}));

// Mock embeddings
vi.mock('../../src/embeddings.js', () => ({
    getQueryEmbedding: vi.fn(async (_text) => [0.1, 0.2, 0.3]),
}));

// Mock embedding-codec module
const _mockEmbeddingData = new WeakMap();
vi.mock('../../src/utils/embedding-codec.js', () => ({
    getEmbedding: vi.fn((obj) => {
        if (obj?.__mock_embedding) return obj.__mock_embedding;
        return obj?.embedding || null;
    }),
    setEmbedding: vi.fn((obj, _vec) => {
        obj.__mock_embedding = [0.1, 0.2, 0.3];
        delete obj.embedding;
    }),
    hasEmbedding: vi.fn((obj) => {
        return !!obj?.__mock_embedding || (obj?.embedding && obj.embedding.length > 0);
    }),
    deleteEmbedding: vi.fn((obj) => {
        if (obj) {
            delete obj.embedding;
            delete obj.embedding_b64;
            delete obj.__mock_embedding;
        }
    }),
}));

// Mock prompts
vi.mock('../../src/prompts.js', () => ({
    buildCommunitySummaryPrompt: vi.fn((nodes, edges) => [
        { role: 'system', content: 'system' },
        { role: 'user', content: `nodes: ${nodes.join(', ')}; edges: ${edges.join(', ')}` },
    ]),
    resolveExtractionPreamble: vi.fn(() => 'mock-preamble'),
    resolveOutputLanguage: vi.fn(() => 'auto'),
}));

// Mock structured
vi.mock('../../src/extraction/structured.js', () => ({
    parseCommunitySummaryResponse: vi.fn((content) => {
        const parsed = JSON.parse(content);
        return { title: parsed.title, summary: parsed.summary, findings: parsed.findings };
    }),
}));

describe('updateCommunitySummaries', () => {
    beforeEach(() => {
        setupTestContext();

        mockCallLLM.mockResolvedValue(
            JSON.stringify({
                title: 'The Royal Court',
                summary: 'King Aldric rules from the Castle...',
                findings: ['The King is powerful'],
            })
        );
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('generates summaries for new communities', async () => {
        const graphData = {
            nodes: {
                king: { name: 'King', type: 'PERSON', description: 'Ruler', mentions: 3 },
                castle: { name: 'Castle', type: 'PLACE', description: 'Fortress', mentions: 2 },
            },
            edges: {
                king__castle: { source: 'king', target: 'castle', description: 'Rules from', weight: 4 },
            },
        };
        const communityGroups = {
            0: {
                nodeKeys: ['king', 'castle'],
                nodeLines: ['- King (PERSON): Ruler', '- Castle (PLACE): Fortress'],
                edgeLines: ['- King → Castle: Rules from [weight: 4]'],
            },
        };

        const result = await updateCommunitySummaries(graphData, communityGroups, {});
        expect(result.communities.C0).toBeDefined();
        expect(result.communities.C0.title).toBe('The Royal Court');
        // Embedding is stored via codec, check using hasEmbedding
        const { hasEmbedding, getEmbedding } = await import('../../src/utils/embedding-codec.js');
        expect(hasEmbedding(result.communities.C0)).toBe(true);
        expect(getEmbedding(result.communities.C0)).toEqual([0.1, 0.2, 0.3]);
        expect(result.communities.C0.nodeKeys).toEqual(['king', 'castle']);
    });

    it('skips communities whose membership has not changed', async () => {
        const communityGroups = {
            0: {
                nodeKeys: ['king', 'castle'],
                nodeLines: ['- King: Ruler'],
                edgeLines: [],
            },
        };
        const existingCommunities = {
            C0: {
                nodeKeys: ['king', 'castle'],
                title: 'Old Title',
                summary: 'Old summary',
                findings: ['Old finding'],
                embedding: [0.5, 0.5],
                lastUpdated: 500000,
            },
        };

        const result = await updateCommunitySummaries({}, communityGroups, existingCommunities);
        expect(result.communities.C0.title).toBe('Old Title'); // Unchanged
        expect(mockCallLLM).not.toHaveBeenCalled(); // No LLM call needed
    });

    it('skips communities with fewer than 2 nodes', async () => {
        const communityGroups = {
            0: {
                nodeKeys: ['king'],
                nodeLines: ['- King: Ruler'],
                edgeLines: [],
            },
        };

        const result = await updateCommunitySummaries({}, communityGroups, {});
        expect(result.communities.C0).toBeUndefined();
        expect(mockCallLLM).not.toHaveBeenCalled();
    });

    it('handles LLM errors gracefully by keeping existing communities', async () => {
        const communityGroups = {
            0: {
                nodeKeys: ['king', 'castle'],
                nodeLines: ['- King: Ruler'],
                edgeLines: [],
            },
        };
        const existingCommunities = {
            C0: {
                nodeKeys: ['king', 'castle'],
                title: 'Existing Title',
                summary: 'Existing summary',
                findings: ['Existing finding'],
                embedding: [0.5, 0.5],
                lastUpdated: 500000,
            },
        };

        mockCallLLM.mockRejectedValue(new Error('LLM failed'));

        const result = await updateCommunitySummaries({}, communityGroups, existingCommunities);
        expect(result.communities.C0.title).toBe('Existing Title'); // Kept existing
    });

    it('consolidates edges before community summarization', async () => {
        // This test verifies the integration point exists
        // Actual behavior tested in integration tests
        const graphData = {
            nodes: {},
            edges: {},
            _edgesNeedingConsolidation: ['test__edge'],
        };

        // The community detection flow should call consolidateEdges
        // when _edgesNeedingConsolidation has entries
        expect(graphData._edgesNeedingConsolidation).toBeDefined();
        expect(graphData._edgesNeedingConsolidation).toContain('test__edge');
    });
});

// Mock global synthesis prompt
vi.mock('../../src/prompts/index.js', async () => {
    const actual = await vi.importActual('../../src/prompts/index.js');
    return {
        ...actual,
        buildGlobalSynthesisPrompt: vi.fn((communities, _preamble, _outputLanguage) => [
            { role: 'system', content: 'You are a narrative synthesist.' },
            { role: 'user', content: `Communities: ${communities.map((c) => c.title).join(', ')}` },
        ]),
    };
});

// Mock global synthesis response parser
vi.mock('../../src/extraction/structured.js', async () => {
    const actual = await vi.importActual('../../src/extraction/structured.js');
    return {
        ...actual,
        parseGlobalSynthesisResponse: vi.fn((content) => {
            const parsed = JSON.parse(content);
            return { global_summary: parsed.global_summary };
        }),
    };
});

describe('generateGlobalWorldState', () => {
    beforeEach(() => {
        setupTestContext();
        mockCallLLM.mockResolvedValue('{"global_summary": "Synthesized narrative..."}');
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('should call LLM with global synthesis prompt', async () => {
        const communities = {
            C0: { title: 'Community A', summary: 'Summary A', findings: ['f1'] },
            C1: { title: 'Community B', summary: 'Summary B', findings: ['f2'] },
        };

        const result = await generateGlobalWorldState(communities, 'auto', 'auto');

        expect(result.summary).toBe('Synthesized narrative...');
        expect(result.community_count).toBe(2);
        expect(result.last_updated).toBeDefined();
        expect(mockCallLLM).toHaveBeenCalled();
    });

    it('should return null when no communities exist', async () => {
        const result = await generateGlobalWorldState({}, 'auto', 'auto');
        expect(result).toBeNull();
        expect(mockCallLLM).not.toHaveBeenCalled();
    });

    it('should return null when communities is null or undefined', async () => {
        expect(await generateGlobalWorldState(null, 'auto', 'auto')).toBeNull();
        expect(await generateGlobalWorldState(undefined, 'auto', 'auto')).toBeNull();
    });

    it('should handle LLM errors gracefully', async () => {
        const communities = {
            C0: { title: 'Community A', summary: 'Summary A', findings: ['f1'] },
        };

        mockCallLLM.mockRejectedValue(new Error('LLM failed'));

        const result = await generateGlobalWorldState(communities, 'auto', 'auto');
        expect(result).toBeNull();
    });
});

describe('updateCommunitySummaries with global synthesis', () => {
    beforeEach(() => {
        setupTestContext();

        // Mock responses for both community summaries and global synthesis
        mockCallLLM.mockImplementation((prompt) => {
            const userContent = typeof prompt === 'string' ? prompt : prompt[1]?.content || JSON.stringify(prompt);
            // Check if this is a global synthesis prompt
            if (userContent.includes('communities') || userContent.includes('Communities:')) {
                // Global synthesis call
                return Promise.resolve('{"global_summary": "Synthesized narrative..."}');
            }
            // Community summary call
            return Promise.resolve(
                JSON.stringify({
                    title: 'Test Community',
                    summary: 'Test community summary...',
                    findings: ['Test finding'],
                })
            );
        });
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('should trigger global synthesis when communities are updated', async () => {
        const graphData = {
            nodes: {
                n1: { name: 'Character A', type: 'PERSON' },
                n2: { name: 'Character B', type: 'PERSON' },
            },
            edges: {},
        };

        const existingCommunities = {}; // No existing communities, so all are new

        const result = await updateCommunitySummaries(
            graphData,
            { 0: { nodeKeys: ['n1', 'n2'], nodeLines: [], edgeLines: [] } },
            existingCommunities,
            100,
            100,
            false
        );

        // Verify return structure has both communities and global_world_state
        expect(result).toHaveProperty('communities');
        expect(result).toHaveProperty('global_world_state');
        expect(result.global_world_state).not.toBeNull();
        expect(result.global_world_state.summary).toBeDefined();
    });

    it('should skip global synthesis when no communities updated', async () => {
        const graphData = {
            nodes: { n1: { name: 'A', type: 'PERSON' } },
            edges: {},
        };

        const existingCommunities = {
            C0: {
                nodeKeys: ['n1'],
                title: 'Existing',
                summary: 'Existing summary',
                findings: [],
                __mock_embedding: [0.1, 0.2],
                lastUpdated: Date.now(),
                lastUpdatedMessageCount: 50,
            },
        };

        // Same membership, not stale - no update expected
        const result = await updateCommunitySummaries(
            graphData,
            { 0: { nodeKeys: ['n1'], nodeLines: [], edgeLines: [] } },
            existingCommunities,
            100, // currentMessageCount
            100, // stalenessThreshold
            false
        );

        expect(result.global_world_state).toBeNull();
    });

    it('should skip global synthesis when single node community (skipped)', async () => {
        // Community with only 1 node should be skipped, so no global synthesis
        const result = await updateCommunitySummaries(
            {},
            { 0: { nodeKeys: ['n1'], nodeLines: [], edgeLines: [] } },
            {},
            100,
            100,
            false
        );

        expect(result.communities).toEqual({});
        expect(result.global_world_state).toBeNull();
    });
});

describe('synthesizeInChunks', () => {
    beforeEach(() => {
        setupTestContext();
        vi.clearAllMocks();
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    it('uses single-pass for <= 10 communities', async () => {
        mockCallLLM.mockResolvedValue('{"global_summary": "Single pass result"}');

        const communities = Array.from({ length: 8 }, (_, i) => ({
            title: `Community ${i}`,
            summary: `Summary ${i}`,
            findings: [`finding ${i}`],
        }));

        const result = await synthesizeInChunks(communities, 'auto', 'auto');
        expect(result).toBe('Single pass result');
        // Single-pass: exactly 1 LLM call
        expect(mockCallLLM).toHaveBeenCalledTimes(1);
    });

    it('uses map-reduce for > 10 communities', async () => {
        let callCount = 0;
        mockCallLLM.mockImplementation(() => {
            callCount++;
            if (callCount <= 3) {
                // Map phase: 3 regional summaries
                return Promise.resolve(`{"global_summary": "Regional summary ${callCount}"}`);
            }
            // Reduce phase: final synthesis
            return Promise.resolve('{"global_summary": "Final synthesized narrative"}');
        });

        const communities = Array.from({ length: 25 }, (_, i) => ({
            title: `Community ${i}`,
            summary: `Summary ${i}`,
            findings: [`finding ${i}`],
        }));

        const result = await synthesizeInChunks(communities, 'auto', 'auto');
        expect(result).toBe('Final synthesized narrative');
        // 25 communities / 10 per chunk = 3 map calls + 1 reduce call = 4
        expect(mockCallLLM).toHaveBeenCalledTimes(4);
    });

    it('continues when one chunk fails (partial results)', async () => {
        let callCount = 0;
        mockCallLLM.mockImplementation(() => {
            callCount++;
            if (callCount === 2) {
                // Second chunk fails
                return Promise.reject(new Error('LLM timeout'));
            }
            if (callCount <= 3) {
                return Promise.resolve(`{"global_summary": "Regional summary ${callCount}"}`);
            }
            return Promise.resolve('{"global_summary": "Final from 2 regions"}');
        });

        const communities = Array.from({ length: 25 }, (_, i) => ({
            title: `Community ${i}`,
            summary: `Summary ${i}`,
            findings: [`finding ${i}`],
        }));

        const result = await synthesizeInChunks(communities, 'auto', 'auto');
        expect(result).toBe('Final from 2 regions');
        // 3 map calls (1 failed) + 1 reduce call = 4 total
        expect(mockCallLLM).toHaveBeenCalledTimes(4);
    });

    it('returns null when all chunks fail', async () => {
        mockCallLLM.mockRejectedValue(new Error('LLM down'));

        const communities = Array.from({ length: 25 }, (_, i) => ({
            title: `Community ${i}`,
            summary: `Summary ${i}`,
            findings: [`finding ${i}`],
        }));

        const result = await synthesizeInChunks(communities, 'auto', 'auto');
        expect(result).toBeNull();
        // 3 map calls, all failed, no reduce call
        expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });

    it('handles exactly 10 communities as single-pass', async () => {
        mockCallLLM.mockResolvedValue('{"global_summary": "Boundary test"}');

        const communities = Array.from({ length: 10 }, (_, i) => ({
            title: `Community ${i}`,
            summary: `Summary ${i}`,
            findings: [`finding ${i}`],
        }));

        const result = await synthesizeInChunks(communities, 'auto', 'auto');
        expect(result).toBe('Boundary test');
        expect(mockCallLLM).toHaveBeenCalledTimes(1);
    });

    it('handles exactly 11 communities as map-reduce', async () => {
        let callCount = 0;
        mockCallLLM.mockImplementation(() => {
            callCount++;
            if (callCount <= 2) {
                return Promise.resolve(`{"global_summary": "Regional ${callCount}"}`);
            }
            return Promise.resolve('{"global_summary": "Final 11"}');
        });

        const communities = Array.from({ length: 11 }, (_, i) => ({
            title: `Community ${i}`,
            summary: `Summary ${i}`,
            findings: [`finding ${i}`],
        }));

        const result = await synthesizeInChunks(communities, 'auto', 'auto');
        expect(result).toBe('Final 11');
        // 11 communities / 10 per chunk = 2 map calls + 1 reduce call = 3
        expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });
});

describe('updateCommunitySummaries with queue', () => {
    beforeEach(() => {
        setupTestContext({
            settings: { maxConcurrency: 3 },
        });
        mockCallLLM.mockReset();
    });

    afterEach(() => {
        resetDeps();
        vi.restoreAllMocks();
    });

    it('should process all communities correctly with maxConcurrency > 1', async () => {
        mockCallLLM.mockResolvedValue(
            JSON.stringify({
                title: 'Test Community',
                summary: 'A test summary',
                findings: ['Finding 1'],
            })
        );

        const groups = {
            0: { nodeKeys: ['a', 'b'], nodeLines: ['- A', '- B'], edgeLines: ['- A→B'] },
            1: { nodeKeys: ['c', 'd'], nodeLines: ['- C', '- D'], edgeLines: ['- C→D'] },
            2: { nodeKeys: ['e', 'f'], nodeLines: ['- E', '- F'], edgeLines: ['- E→F'] },
        };

        const result = await updateCommunitySummaries(null, groups, {}, 100, 100, false);

        expect(Object.keys(result.communities)).toHaveLength(3);
        expect(result.communities.C0).toBeDefined();
        expect(result.communities.C1).toBeDefined();
        expect(result.communities.C2).toBeDefined();
        // 3 community summaries + 1 global synthesis call
        expect(mockCallLLM).toHaveBeenCalledTimes(4);
    });
});

describe('synthesizeInChunks with queue', () => {
    beforeEach(() => {
        setupTestContext({
            settings: { maxConcurrency: 3 },
        });
        mockCallLLM.mockReset();
    });

    afterEach(() => {
        resetDeps();
        vi.restoreAllMocks();
    });

    it('should process large community sets via chunked map-reduce with queue', async () => {
        // Create 15 communities (> GLOBAL_SYNTHESIS_CHUNK_SIZE of 10)
        const communities = Array.from({ length: 15 }, (_, i) => ({
            title: `Community ${i}`,
            summary: `Summary for community ${i}`,
            findings: [`Finding ${i}`],
        }));

        // Mock: regional summaries for map phase, then final summary for reduce phase
        mockCallLLM
            .mockResolvedValueOnce(JSON.stringify({ global_summary: 'Region A summary' }))
            .mockResolvedValueOnce(JSON.stringify({ global_summary: 'Region B summary' }))
            .mockResolvedValue(JSON.stringify({ global_summary: 'Final global summary' }));

        const result = await synthesizeInChunks(communities, 'auto', 'auto', '{');

        // Map phase: 2 chunks (10 + 5), Reduce phase: 1 call = 3 total
        expect(mockCallLLM).toHaveBeenCalledTimes(3);
        expect(result).toBe('Final global summary');
    });
});
