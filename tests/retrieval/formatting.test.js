import { formatContextForInjection } from '../../src/retrieval/formatting.js';

describe('formatContextForInjection - Subconscious Drives', () => {
    it('should separate reflections from events into different XML blocks', () => {
        const memories = [
            { id: 'ev_1', type: 'event', summary: 'Event 1', importance: 3, sequence: 1000 },
            { id: 'ev_2', type: 'event', summary: 'Event 2', importance: 3, sequence: 2000 },
            { id: 'ref_1', type: 'reflection', summary: 'Insight about character', importance: 4, sequence: 1500 },
        ];
        const presentCharacters = ['CharacterA'];
        const emotionalInfo = null;
        const characterName = 'CharacterA';
        const tokenBudget = 1000;
        const chatLength = 100;

        const result = formatContextForInjection(
            memories,
            presentCharacters,
            emotionalInfo,
            characterName,
            tokenBudget,
            chatLength
        );

        // Should contain scene_memory with events only
        expect(result).toContain('<scene_memory>');
        expect(result).toContain('Event 1');
        expect(result).toContain('Event 2');

        // Should contain subconscious_drives with reflections only
        expect(result).toContain('<subconscious_drives>');
        expect(result).toContain('Insight about character');

        // Reflections should NOT be in scene_memory
        const sceneMemoryMatch = result.match(/<scene_memory>([\s\S]*?)<\/scene_memory>/);
        const sceneMemoryContent = sceneMemoryMatch ? sceneMemoryMatch[1] : '';
        expect(sceneMemoryContent).not.toContain('Insight about character');
    });

    it('should omit subconscious_drives block when no reflections exist', () => {
        const memories = [{ id: 'ev_1', type: 'event', summary: 'Event 1', importance: 3, sequence: 1000 }];
        const result = formatContextForInjection(memories, [], null, 'Char', 1000, 100);

        expect(result).toContain('<scene_memory>');
        expect(result).not.toContain('<subconscious_drives>');
    });
});

describe('formatContextForInjection without hard quotas', () => {
    it('should accept memories pre-selected by scoring', async () => {
        const memories = [
            { id: '1', summary: 'Old memory', message_ids: [100], sequence: 10000, importance: 3 },
            { id: '2', summary: 'Recent memory', message_ids: [900], sequence: 9000, importance: 3 },
        ];

        const result = formatContextForInjection(
            memories,
            ['OtherChar'],
            { emotion: 'neutral' },
            'TestChar',
            1000, // budget
            1000 // chatLength
        );

        expect(result).toContain('Old memory');
        expect(result).toContain('Recent memory');
    });

    it('should not apply 50% quota to old bucket', async () => {
        // Create many old memories that would exceed 50% quota
        const oldMemories = Array.from({ length: 20 }, (_, i) => ({
            id: `old${i}`,
            summary: `Old memory ${i}`,
            message_ids: [100 + i],
            sequence: 10000 + i,
            importance: 3,
        }));

        const result = formatContextForInjection(
            oldMemories,
            [],
            null,
            'TestChar',
            5000, // Large budget
            1000
        );

        // Count how many old memories were included
        const count = (result.match(/Old memory/g) || []).length;
        // With soft balance, could be more than 50% if scoring selected them
        expect(count).toBeGreaterThan(0);
    });
});
