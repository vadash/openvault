// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { METADATA_KEY } from '../../src/constants.js';
import { setDeps } from '../../src/deps.js';
import { deleteEntity, getOpenVaultData, updateEntity } from '../../src/store/chat-data.js';
import { filterEntities } from '../../src/ui/helpers.js';
import { renderEntityCard, renderEntityEdit } from '../../src/ui/templates.js';
import { buildMockGraphNode } from '../factories.js';

describe('Entity CRUD Integration', () => {
    let mockContext;

    beforeEach(() => {
        mockContext = { chatMetadata: { [METADATA_KEY]: {} }, chatId: 'test-chat-123' };
        setupTestContext({
            deps: { saveChatConditional: vi.fn() },
        });
        setDeps({
            getContext: () => mockContext,
        });
        mockContext.chatMetadata[METADATA_KEY].graph = {
            nodes: {},
            edges: {},
            _mergeRedirects: {},
        };
    });

    it('should complete full entity workflow', async () => {
        const data = getOpenVaultData();

        // Create initial entity (key = normalized name)
        data.graph.nodes['masked figure'] = buildMockGraphNode({
            name: 'Masked Figure',
            type: 'PERSON',
            description: 'A mysterious person in a mask',
            aliases: ['the stranger'],
            mentions: 3,
        });

        // Render view card
        const viewHtml = renderEntityCard(data.graph.nodes['masked figure'], 'masked figure');
        expect(viewHtml).toContain('Masked Figure');
        expect(viewHtml).toContain('the stranger');

        // Update with alias
        await updateEntity('masked figure', {
            aliases: ['the stranger', 'shadow walker'],
        });

        expect(data.graph.nodes['masked figure'].aliases).toContain('shadow walker');

        // Search by alias
        const results = filterEntities(data.graph, 'shadow walker', '');
        expect(results).toHaveLength(1);

        // Render edit form
        const editHtml = renderEntityEdit(data.graph.nodes['masked figure'], 'masked figure');
        expect(editHtml).toContain('shadow walker');
        expect(editHtml).toContain('openvault-alias-chip');

        // Rename entity
        const result = await updateEntity('masked figure', { name: 'Marcus Hale' });
        expect(result.key).toBe('marcus hale');
        expect(data.graph.nodes['marcus hale']).toBeDefined();
        expect(data.graph.nodes['masked figure']).toBeUndefined();

        // Delete entity
        const deleted = await deleteEntity('marcus hale');
        expect(deleted.success).toBe(true);
        expect(data.graph.nodes['marcus hale']).toBeUndefined();
    });
});
