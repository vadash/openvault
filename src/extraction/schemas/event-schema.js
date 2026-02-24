import { z } from 'https://esm.sh/zod@4';

/**
 * Enum for event types - categorizes the nature of significant events
 * - action: Character takes action, fights, moves, etc.
 * - revelation: Information revealed, secrets shared, truths learned
 * - emotion_shift: Character's emotional state changes significantly
 * - relationship_change: Relationship dynamics shift (trust, alliance, dominance, etc.)
 */
export const EventTypeEnum = z.enum(['action', 'revelation', 'emotion_shift', 'relationship_change']);

/**
 * Schema for relationship impact between characters
 * Maps "A->B" string to 1-3 word change description
 */
export const RelationshipImpactSchema = z.record(z.string(), z.string());

/**
 * Schema for a single memory event
 * Event type is required as first field to guide LLM output classification
 */
export const EventSchema = z.object({
    event_type: EventTypeEnum,
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
 * Reasoning comes FIRST to enable chain-of-thought before committing to events
 * This encourages the model to think before outputting structured data
 * Events array can be empty (no significant events found)
 */
export const ExtractionResponseSchema = z.object({
    reasoning: z.string().nullable().default(null),
    events: z.array(EventSchema),
});
