import { renderMemoryItem, renderMemoryEdit } from '../src/ui/templates/memory.js';

const mockMemory = {
    id: 'test-1',
    summary: 'Test summary',
    importance: 3,
    characters_involved: ['Alice'],
    witnesses: [],
    location: null,
    is_secret: false,
    created_at: Date.now(),
};

describe('renderMemoryItem', () => {
    it('renders memory summary', () => {
        const html = renderMemoryItem(mockMemory);
        expect(html).toContain('Test summary');
    });
});

describe('renderMemoryEdit', () => {
    it('renders memory edit form', () => {
        const html = renderMemoryEdit(mockMemory);
        expect(html).toBeDefined();
    });
});
