// @ts-check
import { describe, expect, it } from 'vitest';
import { filterEntities } from '../../src/ui/helpers.js';
import { buildMockGraphNode } from '../factories.js';

describe('filterEntities alias search', () => {
    const mockGraph = {
        nodes: {
            marcus_hale: buildMockGraphNode({
                name: 'Marcus Hale',
                type: 'PERSON',
                description: 'A former soldier',
                aliases: ['masked figure', 'the stranger'],
                mentions: 5,
            }),
            tavern: buildMockGraphNode({
                name: 'The Tavern',
                type: 'PLACE',
                description: 'A drinking establishment',
                aliases: [],
                mentions: 3,
            }),
        },
    };

    it('should find entity by alias', () => {
        const results = filterEntities(mockGraph, 'masked figure', '');
        expect(results).toHaveLength(1);
        expect(results[0][0]).toBe('marcus_hale');
    });

    it('should find entity by second alias', () => {
        const results = filterEntities(mockGraph, 'stranger', '');
        expect(results).toHaveLength(1);
        expect(results[0][0]).toBe('marcus_hale');
    });

    it('should still find by name', () => {
        const results = filterEntities(mockGraph, 'Marcus', '');
        expect(results).toHaveLength(1);
        expect(results[0][0]).toBe('marcus_hale');
    });
});
