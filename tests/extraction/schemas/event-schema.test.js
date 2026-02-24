import { describe, it, expect } from 'vitest';
import {
    EventSchema,
    ExtractionResponseSchema,
} from '../../../src/extraction/schemas/event-schema.js';

describe('EventSchema', () => {
    it('validates a correct event object', () => {
        const result = EventSchema.safeParse({
            summary: 'Alice smiled at Bob',
            importance: 3,
            characters_involved: ['Alice', 'Bob'],
        });
        expect(result.success).toBe(true);
    });

    it('rejects missing summary', () => {
        const result = EventSchema.safeParse({
            importance: 3,
            characters_involved: ['Alice'],
        });
        expect(result.success).toBe(false);
    });

    it('rejects importance outside 1-5 range', () => {
        const result = EventSchema.safeParse({
            summary: 'Test',
            importance: 10,
            characters_involved: ['Alice'],
        });
        expect(result.success).toBe(false);
    });

    it('applies defaults for optional fields', () => {
        const result = EventSchema.safeParse({
            summary: 'Test',
            importance: 3,
            characters_involved: [],
        });
        if (result.success) {
            expect(result.data.witnesses).toEqual([]);
            expect(result.data.location).toBe(null);
            expect(result.data.is_secret).toBe(false);
        } else {
            throw new Error('Should succeed with defaults');
        }
    });

    it('accepts full event with all fields', () => {
        const result = EventSchema.safeParse({
            summary: 'Full event',
            importance: 4,
            characters_involved: ['Alice'],
            witnesses: ['Bob'],
            location: 'garden',
            is_secret: true,
            emotional_impact: { Alice: 'happy' },
            relationship_impact: {
                'Alice->Bob': 'trust deepened'
            },
        });
        expect(result.success).toBe(true);
    });
});

describe('ExtractionResponseSchema', () => {
    it('validates response with events array', () => {
        const result = ExtractionResponseSchema.safeParse({
            events: [
                { summary: 'Event 1', importance: 3, characters_involved: ['Alice'] }
            ],
            reasoning: 'Because something happened',
        });
        expect(result.success).toBe(true);
    });

    it('allows null reasoning', () => {
        const result = ExtractionResponseSchema.safeParse({
            events: [
                { summary: 'Event 1', importance: 3, characters_involved: ['Alice'] }
            ],
            reasoning: null,
        });
        expect(result.success).toBe(true);
    });

    it('allows empty events array', () => {
        const result = ExtractionResponseSchema.safeParse({
            events: [],
            reasoning: 'No significant events found',
        });
        expect(result.success).toBe(true);
    });
});
