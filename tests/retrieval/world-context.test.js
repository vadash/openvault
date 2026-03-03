import { describe, it, expect } from 'vitest';
import { retrieveWorldContext } from '../../src/retrieval/world-context.js';

describe('retrieveWorldContext', () => {
    const communities = {
        C0: {
            nodeKeys: ['king', 'castle'],
            title: 'The Royal Court',
            summary: 'King Aldric rules from the Castle with his loyal Guard.',
            findings: ['The King is powerful', 'The Guard is loyal'],
            embedding: [0.9, 0.1, 0.0],
        },
        C1: {
            nodeKeys: ['tavern', 'bard'],
            title: 'The Tavern Folk',
            summary: 'The bard plays at the tavern every night.',
            findings: ['Music brings joy'],
            embedding: [0.0, 0.1, 0.9],
        },
    };

    it('returns most relevant community summaries by cosine similarity', () => {
        const queryEmbedding = [0.8, 0.2, 0.0]; // Close to C0
        const result = retrieveWorldContext(communities, queryEmbedding, 2000);
        expect(result.text).toContain('The Royal Court');
        expect(result.communityIds).toContain('C0');
    });

    it('respects token budget', () => {
        const queryEmbedding = [0.5, 0.5, 0.5];
        const result = retrieveWorldContext(communities, queryEmbedding, 10); // Very tight budget
        // Should include at most 1 community
        expect(result.communityIds.length).toBeLessThanOrEqual(1);
    });

    it('returns empty when no communities exist', () => {
        const result = retrieveWorldContext({}, [0.5, 0.5], 2000);
        expect(result.text).toBe('');
        expect(result.communityIds).toEqual([]);
    });

    it('returns empty when communities have no embeddings', () => {
        const noEmbed = { C0: { ...communities.C0, embedding: [] } };
        const result = retrieveWorldContext(noEmbed, [0.5, 0.5], 2000);
        expect(result.communityIds).toEqual([]);
    });

    it('formats output with XML tags', () => {
        const queryEmbedding = [0.9, 0.1, 0.0];
        const result = retrieveWorldContext(communities, queryEmbedding, 2000);
        expect(result.text).toContain('<world_context>');
        expect(result.text).toContain('</world_context>');
    });
});
