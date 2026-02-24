import { z } from 'https://esm.sh/zod@4';

/**
 * Enum for content category tags assigned by extraction LLM.
 * 31 tags across 6 groups: Intimate, Conflict, Slice-of-life, Character, World, Fallback.
 */
export const TagEnum = z.enum([
    // Intimate
    'EXPLICIT', 'BDSM', 'FETISH', 'ROMANCE', 'FLIRTING', 'SEDUCTION',
    // Conflict
    'COMBAT', 'THREAT', 'INJURY', 'BETRAYAL', 'HORROR',
    // Slice-of-life
    'DOMESTIC', 'SOCIAL', 'TRAVEL', 'COMMERCE', 'FOOD', 'CELEBRATION',
    // Character
    'LORE', 'SECRET', 'TRAUMA', 'GROWTH', 'EMOTION', 'BONDING', 'REUNION',
    // World/Adventure
    'MYSTERY', 'MAGIC', 'STEALTH', 'POLITICAL', 'HUMOR', 'CRAFTING',
    // Fallback
    'NONE'
]);

/**
 * Schema for relationship impact between characters
 * Maps "A->B" string to 1-3 word change description
 */
export const RelationshipImpactSchema = z.record(z.string(), z.string());

/**
 * Schema for a single memory event
 * Tags are required (1-3 per event) to categorize content for embedding separation.
 */
export const EventSchema = z.object({
    summary: z.string().min(1, 'Summary is required'),
    importance: z.number().int().min(1).max(5).default(3),
    tags: z.array(TagEnum).min(1).max(3).default(['NONE']),
    characters_involved: z.array(z.string()).default([]),
    witnesses: z.array(z.string()).default([]),
    location: z.string().nullable().default(null),
    is_secret: z.boolean().default(false),
    emotional_impact: z.record(z.string(), z.string()).optional().default({}),
    relationship_impact: RelationshipImpactSchema.optional().default({}),
});

/**
 * Schema for the full extraction response from LLM (structured format)
 * Reasoning comes FIRST to enable chain-of-thought before committing to events
 */
export const ExtractionResponseSchema = z.object({
    reasoning: z.string().nullable().default(null),
    events: z.array(EventSchema),
});
