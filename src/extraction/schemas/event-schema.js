import { z } from 'https://esm.sh/zod@4';

/**
 * Schema for relationship impact between characters
 * Maps "A->B" string to 1-3 word change description
 */
export const RelationshipImpactSchema = z.record(z.string(), z.string());

/**
 * Schema for a single memory event
 */
export const EventSchema = z.object({
    summary: z.string().min(1, 'Summary is required'),
    importance: z.number().int().min(1).max(5).default(3),
    characters_involved: z.array(z.string()).default([]),
    witnesses: z.array(z.string()).default([]),
    location: z.string().nullable().default(null),
    is_secret: z.boolean().default(false),
    emotional_impact: z.record(z.string(), z.string()).optional().default({}),
    relationship_impact: RelationshipImpactSchema.optional().default({}),
});

/**
 * Schema for the full extraction response from LLM (structured format)
 * Must be object with "events" array and "reasoning" field
 * Events array can be empty (no significant events found)
 */
export const ExtractionResponseSchema = z.object({
    events: z.array(EventSchema),
    reasoning: z.string().nullable().default(null),
});
