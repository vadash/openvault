import { renderMemoryItem, renderMemoryEdit } from '../src/ui/templates/memory.js';

const mockMemory = {
    id: 'test-1',
    summary: 'Test summary',
    importance: 3,
    tags: ['COMBAT', 'INJURY'],
    characters_involved: ['Alice'],
    witnesses: [],
    location: null,
    is_secret: false,
    created_at: Date.now(),
};

describe('renderMemoryItem', () => {
    it('renders tag badges', () => {
        const html = renderMemoryItem(mockMemory);
        expect(html).toContain('COMBAT');
        expect(html).toContain('INJURY');
        expect(html).not.toContain('event_type');
        expect(html).not.toContain('action');
    });
});

describe('renderMemoryEdit', () => {
    it('renders tag checkboxes instead of event_type dropdown', () => {
        const html = renderMemoryEdit(mockMemory);
        expect(html).toContain('data-field="tags"');
        expect(html).not.toContain('data-field="event_type"');
    });
});
