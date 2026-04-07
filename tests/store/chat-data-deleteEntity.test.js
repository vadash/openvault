// @ts-check
/* global describe, it, expect, beforeEach, vi, setupTestContext */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { METADATA_KEY } from '../../src/constants.js';
import { setDeps } from '../../src/deps.js';
import { deleteEntity, getOpenVaultData } from '../../src/store/chat-data.js';
import { buildMockGraphNode } from '../factories.js';

describe('deleteEntity', () => {
    let mockContext;

    beforeEach(() => {
        // Use a stable context reference so getOpenVaultData() always returns the same object
        mockContext = { chatMetadata: { [METADATA_KEY]: {} }, chatId: 'test-chat-123' };
        setupTestContext({
            deps: { saveChatConditional: vi.fn() },
        });
        // Override getContext to return stable reference
        setDeps({
            getContext: () => mockContext,
        });
        // Initialize graph data
        mockContext.chatMetadata[METADATA_KEY].graph = {
            nodes: {},
            edges: {},
            _mergeRedirects: {},
        };
    });

    it('should delete entity with no edges', async () => {
        const data = getOpenVaultData();
        data.graph.nodes['marcus_hale'] = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
        });

        const result = await deleteEntity('marcus_hale');

        expect(result.success).toBe(true);
        expect(data.graph.nodes['marcus_hale']).toBeUndefined();
    });

    it('should delete entity and remove connected edges', async () => {
        const data = getOpenVaultData();
        data.graph.nodes['marcus_hale'] = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
        });
        data.graph.nodes['tavern'] = buildMockGraphNode({
            name: 'The Tavern',
            type: 'PLACE',
            description: 'A pub',
        });
        data.graph.edges['marcus_hale__tavern'] = {
            source: 'marcus_hale',
            target: 'tavern',
            relation: 'frequents',
        };
        data.graph.edges['tavern__marcus_hale'] = {
            source: 'tavern',
            target: 'marcus_hale',
            relation: 'patron',
        };

        const result = await deleteEntity('marcus_hale');

        expect(result.success).toBe(true);
        expect(data.graph.nodes['marcus_hale']).toBeUndefined();
        expect(data.graph.edges['marcus_hale__tavern']).toBeUndefined();
        expect(data.graph.edges['tavern__marcus_hale']).toBeUndefined();
    });

    it('should clean up merge redirects when deleting entity', async () => {
        const data = getOpenVaultData();
        data.graph.nodes['marcus_hale'] = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
        });
        data.graph._mergeRedirects = {
            'old_name': 'marcus_hale',
            'marcus_hale': 'new_name',
        };

        await deleteEntity('marcus_hale');

        expect(data.graph._mergeRedirects['old_name']).toBeUndefined();
        expect(data.graph._mergeRedirects['marcus_hale']).toBeUndefined();
    });

    it('should handle missing _mergeRedirects without error', async () => {
        const data = getOpenVaultData();
        data.graph.nodes['marcus_hale'] = buildMockGraphNode({
            name: 'Marcus Hale',
            type: 'PERSON',
            description: 'A soldier',
        });
        // Intentionally no _mergeRedirects field (simulates older data structure)
        delete data.graph._mergeRedirects;

        const result = await deleteEntity('marcus_hale');

        expect(result.success).toBe(true);
        expect(data.graph.nodes['marcus_hale']).toBeUndefined();
    });

    it('should return failure for non-existent entity', async () => {
        const result = await deleteEntity('non_existent');
        expect(result.success).toBe(false);
    });
});
