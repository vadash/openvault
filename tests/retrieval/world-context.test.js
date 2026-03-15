import { describe, expect, it } from 'vitest';
import { detectMacroIntent, retrieveWorldContext } from '../../src/retrieval/world-context.js';

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
        const result = retrieveWorldContext(communities, null, '', queryEmbedding, 2000);
        expect(result.text).toContain('The Royal Court');
        expect(result.communityIds).toContain('C0');
    });

    it('respects token budget', () => {
        const queryEmbedding = [0.5, 0.5, 0.5];
        const result = retrieveWorldContext(communities, null, '', queryEmbedding, 10); // Very tight budget
        // Should include at most 1 community
        expect(result.communityIds.length).toBeLessThanOrEqual(1);
    });

    it('returns empty when no communities exist', () => {
        const result = retrieveWorldContext({}, null, '', [0.5, 0.5], 2000);
        expect(result.text).toBe('');
        expect(result.communityIds).toEqual([]);
    });

    it('returns empty when communities have no embeddings', () => {
        const noEmbed = { C0: { ...communities.C0, embedding: [] } };
        const result = retrieveWorldContext(noEmbed, null, '', [0.5, 0.5], 2000);
        expect(result.communityIds).toEqual([]);
    });

    it('formats output with XML tags', () => {
        const queryEmbedding = [0.9, 0.1, 0.0];
        const result = retrieveWorldContext(communities, null, '', queryEmbedding, 2000);
        expect(result.text).toContain('<world_context>');
        expect(result.text).toContain('</world_context>');
    });
});

describe('detectMacroIntent', () => {
    it('should detect English macro intent keywords', () => {
        expect(detectMacroIntent('Can you summarize what happened so far?')).toBe(true);
        expect(detectMacroIntent('Give me a recap of the story')).toBe(true);
        expect(detectMacroIntent('What is the overall dynamic?')).toBe(true);
        expect(detectMacroIntent('Tell me about what has happened lately')).toBe(true);
    });

    it('should detect Russian macro intent keywords', () => {
        expect(detectMacroIntent('Расскажи вкратце, что было')).toBe(true);
        expect(detectMacroIntent('Какой итог нашей истории?')).toBe(true);
        expect(detectMacroIntent('Наполни контекст о происходящем')).toBe(true);
        expect(detectMacroIntent('Напомни, как всё началось')).toBe(true);
    });

    it('should return false for local queries', () => {
        expect(detectMacroIntent("Let's go to the kitchen")).toBe(false);
        expect(detectMacroIntent('I kiss her gently')).toBe(false);
        expect(detectMacroIntent('Пойдём в спальню')).toBe(false);
    });

    it('should handle empty input gracefully', () => {
        expect(detectMacroIntent('')).toBe(false);
        expect(detectMacroIntent(null)).toBe(false);
        expect(detectMacroIntent(undefined)).toBe(false);
    });
});

describe('retrieveWorldContext with intent routing', () => {
    it('should return global state when macro intent detected and state exists', () => {
        const globalState = { summary: 'Global narrative...' };
        const communities = {};
        const queryEmbedding = new Float32Array([0.1, 0.2]);
        const userMessages = 'Please summarize the story so far';

        const result = retrieveWorldContext(communities, globalState, userMessages, queryEmbedding, 2000);

        expect(result.text).toContain('<world_context>');
        expect(result.text).toContain('Global narrative...');
        expect(result.communityIds).toEqual([]);
    });

    it('should fall back to vector search when no macro intent', () => {
        const globalState = { summary: 'Global...' };
        const communities = {
            C0: {
                nodeKeys: ['king', 'castle'],
                title: 'Community A',
                summary: 'Summary A',
                embedding: [0.9, 0.1, 0.0],
            },
        };
        const queryEmbedding = new Float32Array([0.9, 0.1, 0.0]);
        const userMessages = "Let's go to the kitchen";

        const result = retrieveWorldContext(communities, globalState, userMessages, queryEmbedding, 2000);

        // Should run vector search, not use global state
        expect(result.text).not.toContain('Global...');
        expect(result.text).toContain('Community A');
    });

    it('should fall back to vector search when global state is null', () => {
        const globalState = null;
        const communities = {
            C0: {
                nodeKeys: ['king'],
                title: 'Community A',
                summary: 'Summary A',
                embedding: [0.9, 0.1, 0.0],
            },
        };
        const userMessages = 'Summarize everything'; // has macro intent
        const queryEmbedding = new Float32Array([0.9, 0.1, 0.0]);

        const result = retrieveWorldContext(communities, globalState, userMessages, queryEmbedding, 2000);

        // No global state available, fall back to vector search
        expect(result.text).toContain('Community A');
    });

    it('should handle empty communities with global state', () => {
        const globalState = { summary: 'Global narrative...' };
        const userMessages = 'Summarize everything';
        const queryEmbedding = new Float32Array([0.1]);

        const result = retrieveWorldContext({}, globalState, userMessages, queryEmbedding, 2000);

        expect(result.text).toContain('Global narrative...');
    });
});
