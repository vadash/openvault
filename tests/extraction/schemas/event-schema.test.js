import { describe, it, expect } from 'vitest';
import { TagEnum, EventSchema, ExtractionResponseSchema } from '../../../src/extraction/schemas/event-schema.js';

describe('TagEnum', () => {
    it('accepts all 31 valid tags', () => {
        const allTags = [
            'EXPLICIT', 'BDSM', 'FETISH', 'ROMANCE', 'FLIRTING', 'SEDUCTION',
            'COMBAT', 'THREAT', 'INJURY', 'BETRAYAL', 'HORROR',
            'DOMESTIC', 'SOCIAL', 'TRAVEL', 'COMMERCE', 'FOOD', 'CELEBRATION',
            'LORE', 'SECRET', 'TRAUMA', 'GROWTH', 'EMOTION', 'BONDING', 'REUNION',
            'MYSTERY', 'MAGIC', 'STEALTH', 'POLITICAL', 'HUMOR', 'CRAFTING',
            'NONE'
        ];
        for (const tag of allTags) {
            expect(TagEnum.parse(tag)).toBe(tag);
        }
    });

    it('rejects invalid tags', () => {
        expect(() => TagEnum.parse('INVALID')).toThrow();
        expect(() => TagEnum.parse('action')).toThrow();
    });
});

describe('EventSchema', () => {
    it('requires tags array with 1-3 elements', () => {
        const base = {
            summary: 'Test summary here',
            importance: 3,
            characters_involved: [],
            witnesses: [],
            location: null,
            is_secret: false,
        };

        // Valid: 1 tag
        expect(() => EventSchema.parse({ ...base, tags: ['COMBAT'] })).not.toThrow();
        // Valid: 3 tags
        expect(() => EventSchema.parse({ ...base, tags: ['COMBAT', 'INJURY', 'HORROR'] })).not.toThrow();
        // Invalid: 0 tags
        expect(() => EventSchema.parse({ ...base, tags: [] })).toThrow();
        // Invalid: 4 tags
        expect(() => EventSchema.parse({ ...base, tags: ['A', 'B', 'C', 'D'] })).toThrow();
    });

    it('defaults tags to ["NONE"] when omitted', () => {
        const result = EventSchema.parse({
            summary: 'Test summary here',
            importance: 3,
            characters_involved: [],
            witnesses: [],
            location: null,
            is_secret: false,
        });
        expect(result.tags).toEqual(['NONE']);
    });

    it('does NOT have event_type field', () => {
        const result = EventSchema.parse({
            summary: 'Test summary here',
            importance: 3,
            tags: ['DOMESTIC'],
            characters_involved: [],
            witnesses: [],
            location: null,
            is_secret: false,
        });
        expect(result.event_type).toBeUndefined();
    });
});

describe('ExtractionResponseSchema', () => {
    it('validates response with events array', () => {
        const result = ExtractionResponseSchema.safeParse({
            reasoning: 'Because something happened',
            events: [
                { summary: 'Event 1', importance: 3, tags: ['COMBAT'], characters_involved: ['Alice'] }
            ],
        });
        expect(result.success).toBe(true);
    });

    it('allows null reasoning', () => {
        const result = ExtractionResponseSchema.safeParse({
            reasoning: null,
            events: [
                { summary: 'Event 1', importance: 3, tags: ['LORE'], characters_involved: ['Alice'] }
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
