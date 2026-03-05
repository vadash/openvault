import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, extensionName } from '../../src/constants.js';
import { resetDeps, setDeps } from '../../src/deps.js';
import {
    buildCommunityGroups,
    detectCommunities,
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

// Mock prompts
vi.mock('../../src/prompts.js', () => ({
    buildCommunitySummaryPrompt: vi.fn((nodes, edges) => [
        { role: 'system', content: 'system' },
        { role: 'user', content: `nodes: ${nodes.join(', ')}; edges: ${edges.join(', ')}` },
    ]),
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
        setDeps({
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            getExtensionSettings: () => ({
                [extensionName]: { ...defaultSettings },
            }),
            Date: { now: () => 1000000 },
        });

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
        expect(result.C0).toBeDefined();
        expect(result.C0.title).toBe('The Royal Court');
        expect(result.C0.embedding).toEqual([0.1, 0.2, 0.3]);
        expect(result.C0.nodeKeys).toEqual(['king', 'castle']);
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
        expect(result.C0.title).toBe('Old Title'); // Unchanged
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
        expect(result.C0).toBeUndefined();
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
        expect(result.C0.title).toBe('Existing Title'); // Kept existing
    });
});
