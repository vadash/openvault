import { describe, it, expect } from 'vitest';
import { EventSchema, ExtractionResponseSchema } from '../../../src/extraction/structured.js';

describe('EventSchema', () => {
    it('requires summary', () => {
        expect(() => EventSchema.parse({
            importance: 3,
            characters_involved: [],
            witnesses: [],
            location: null,
            is_secret: false,
        })).toThrow();
    });

    it('applies defaults for optional fields', () => {
        const result = EventSchema.parse({
            summary: 'Test summary here',
        });
        expect(result.importance).toBe(3);
        expect(result.characters_involved).toEqual([]);
        expect(result.witnesses).toEqual([]);
        expect(result.location).toBeNull();
        expect(result.is_secret).toBe(false);
    });

    it('does NOT have event_type field', () => {
        const result = EventSchema.parse({
            summary: 'Test summary here',
            importance: 3,
            characters_involved: [],
            witnesses: [],
            location: null,
            is_secret: false,
        });
        expect(result.event_type).toBeUndefined();
    });

    it('does NOT have tags field', () => {
        const result = EventSchema.parse({
            summary: 'Test summary here',
        });
        expect(result.tags).toBeUndefined();
    });
});

describe('ExtractionResponseSchema', () => {
    it('validates response with events array', () => {
        const result = ExtractionResponseSchema.safeParse({
            reasoning: 'Because something happened',
            events: [
                { summary: 'Event 1', importance: 3, characters_involved: ['Alice'] }
            ],
        });
        expect(result.success).toBe(true);
    });

    it('allows null reasoning', () => {
        const result = ExtractionResponseSchema.safeParse({
            reasoning: null,
            events: [
                { summary: 'Event 1', importance: 3, characters_involved: ['Alice'] }
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
});
