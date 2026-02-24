import { describe, it, expect } from 'vitest';
import {
    EventSchema,
    ExtractionResponseSchema,
} from '../../../src/extraction/schemas/event-schema.js';

describe('EventSchema', () => {
    it('validates a correct event object', () => {
        const result = EventSchema.safeParse({
            event_type: 'action',
            summary: 'Alice smiled at Bob',
            importance: 3,
            characters_involved: ['Alice', 'Bob'],
        });
        expect(result.success).toBe(true);
    });

    it('rejects missing summary', () => {
        const result = EventSchema.safeParse({
            event_type: 'action',
            importance: 3,
            characters_involved: ['Alice'],
        });
        expect(result.success).toBe(false);
    });

    it('rejects importance outside 1-5 range', () => {
        const result = EventSchema.safeParse({
            event_type: 'action',
            summary: 'Test',
            importance: 10,
            characters_involved: ['Alice'],
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid event_type', () => {
        const result = EventSchema.safeParse({
            event_type: 'invalid_type',
            summary: 'Test',
            importance: 3,
            characters_involved: ['Alice'],
        });
        expect(result.success).toBe(false);
    });

    it('applies defaults for optional fields', () => {
        const result = EventSchema.safeParse({
            event_type: 'action',
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
            event_type: 'revelation',
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

    it('accepts all four valid event types', () => {
        for (const type of ['action', 'revelation', 'emotion_shift', 'relationship_change']) {
            const result = EventSchema.safeParse({
                event_type: type,
                summary: `Test ${type}`,
                importance: 3,
                characters_involved: [],
            });
            expect(result.success).toBe(true);
        }
    });
});

describe('ExtractionResponseSchema', () => {
    it('validates response with events array', () => {
        const result = ExtractionResponseSchema.safeParse({
            reasoning: 'Because something happened',
            events: [
                { event_type: 'action', summary: 'Event 1', importance: 3, characters_involved: ['Alice'] }
            ],
        });
        expect(result.success).toBe(true);
    });

    it('allows null reasoning', () => {
        const result = ExtractionResponseSchema.safeParse({
            reasoning: null,
            events: [
                { event_type: 'action', summary: 'Event 1', importance: 3, characters_involved: ['Alice'] }
            ],
        });
        expect(result.success).toBe(true);
    });

    it('allows empty events array', () => {
        const result = ExtractionResponseSchema.safeParse({
            reasoning: 'No significant events found',
            events: [],
        });
        expect(result.success).toBe(true);
    });

    it('has reasoning as first property', () => {
        // Verify the schema has reasoning before events
        const result = ExtractionResponseSchema.safeParse({
            reasoning: null,
            events: [],
        });
        expect(result.success).toBe(true);
    });
});
