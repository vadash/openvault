import { z } from 'https://esm.sh/zod@4';

/**
 * Schema for relationship impact between characters
 */
export const RelationshipImpactSchema = z.record(
    z.string(),
    z.object({
        change: z.enum(['improved', 'worsened', 'unchanged']),
        new_dynamic: z.string().optional(),
    })
);

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
 * Used for JSON schema generation
 */
export const ExtractionResponseSchema = z.object({
    events: z.array(EventSchema).min(1, 'At least one event is required'),
    reasoning: z.string().nullable().default(null),
});

/**
 * Normalize extraction response to structured format
 * Handles both array and object inputs (for backward compatibility)
 * @param {any} input - Parsed JSON response (array or object)
 * @returns {Object} Normalized response with {events, reasoning} structure
 */
export function normalizeExtractionResponse(input) {
    // If input is an array, wrap it
    if (Array.isArray(input)) {
        return { events: input, reasoning: null };
    }
    // If already has events property, return as-is
    if (input && typeof input === 'object' && input.events) {
        return { events: input.events, reasoning: input.reasoning ?? null };
    }
    // Fallback: treat input as single event array
    return { events: [input], reasoning: null };
}
