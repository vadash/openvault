import { z } from 'https://esm.sh/zod@4';
import { stripThinkingTags } from '../utils.js';

// --- Schemas (inlined from schemas/) ---

/**
 * Schema for relationship impact between characters
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
 * Schema for an entity (person, place, organization, object, or concept)
 */
export const EntitySchema = z.object({
    name: z.string().min(1, 'Entity name is required').describe('Entity name, capitalized'),
    type: z.enum(['PERSON', 'PLACE', 'ORGANIZATION', 'OBJECT', 'CONCEPT']),
    description: z.string().min(1).describe('Comprehensive description of the entity'),
});

/**
 * Schema for a relationship between two entities
 */
export const RelationshipSchema = z.object({
    source: z.string().min(1).describe('Source entity name'),
    target: z.string().min(1).describe('Target entity name'),
    description: z.string().min(1).describe('Description of the relationship'),
});

/**
 * Schema for the full extraction response from LLM (structured format)
 */
export const ExtractionResponseSchema = z.object({
    reasoning: z.string().nullable().default(null),
    events: z.array(EventSchema),
    entities: z.array(EntitySchema).default([]),
    relationships: z.array(RelationshipSchema).default([]),
});

/**
 * Convert Zod schema to ConnectionManager jsonSchema format
 * Uses Zod v4's native toJSONSchema with jsonSchema4 target
 *
 * @param {z.ZodType} zodSchema - The Zod schema to convert
 * @param {string} schemaName - Name for the JSON schema
 * @returns {Object} ConnectionManager-compatible jsonSchema object
 */
function toJsonSchema(zodSchema, schemaName) {
    const draft = z.toJSONSchema(zodSchema, { target: 'jsonSchema4' });

    return {
        name: schemaName,
        strict: true,
        value: draft,
    };
}

/**
 * Strip markdown code blocks from content
 * Handles both ```json and ``` variants
 *
 * @param {string} content - Content that may contain markdown
 * @returns {string} Content with markdown stripped
 */
function stripMarkdown(content) {
    const trimmed = content.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

/**
 * Parse LLM response with markdown stripping, thinking tag removal, and Zod validation
 *
 * @param {string} content - Raw LLM response
 * @param {z.ZodType} schema - Zod schema to validate against
 * @returns {Object} Validated parsed data
 * @throws {Error} If JSON parsing or validation fails
 */
function parseStructuredResponse(content, schema) {
    // Strip thinking/reasoning tags first (models may return extended thinking)
    const cleanedContent = stripThinkingTags(content);
    // Then strip markdown code blocks
    const jsonContent = stripMarkdown(cleanedContent);

    let parsed;
    try {
        parsed = JSON.parse(jsonContent);
    } catch (e) {
        throw new Error(`JSON parse failed: ${e.message}`);
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
        throw new Error(`Schema validation failed: ${result.error.message}`);
    }

    return result.data;
}

/**
 * Get jsonSchema for ConnectionManager sendRequest
 * For use in structured output mode
 *
 * @returns {Object} ConnectionManager jsonSchema object
 */
export function getExtractionJsonSchema() {
    return toJsonSchema(ExtractionResponseSchema, 'MemoryExtraction');
}

/**
 * Parse extraction response with tag sanitization and full validation
 *
 * @param {string} content - Raw LLM response
 * @returns {Object} Validated extraction response with {events, reasoning} format
 */
export function parseExtractionResponse(content) {
    // Strip thinking/reasoning tags first
    const cleanedContent = stripThinkingTags(content);
    const jsonContent = stripMarkdown(cleanedContent);

    let parsed;
    try {
        parsed = JSON.parse(jsonContent);
    } catch (e) {
        throw new Error(`JSON parse failed: ${e.message}`);
    }

    // Validate against schema
    const result = ExtractionResponseSchema.safeParse(parsed);
    if (!result.success) {
        throw new Error(`Schema validation failed: ${result.error.message}`);
    }

    return result.data;
}

/**
 * Parse single event (for backfill/retry scenarios)
 *
 * @param {string} content - Raw LLM response for single event
 * @returns {Object} Validated event object
 */
export function parseEvent(content) {
    return parseStructuredResponse(content, EventSchema);
}

/**
 * Strip markdown from content (exported for testing)
 * @param {string} content
 * @returns {string}
 */
export function _testStripMarkdown(content) {
    return stripMarkdown(content);
}

// --- Reflection Schemas ---

/**
 * Schema for salient questions generated during reflection
 * Exactly 3 high-level questions about a character's current state
 */
export const SalientQuestionsSchema = z.object({
    questions: z.array(z.string()).length(3),
});

/**
 * Schema for insight extraction during reflection
 * 1-5 insights with evidence citations
 */
export const InsightExtractionSchema = z.object({
    insights: z
        .array(
            z.object({
                insight: z.string().min(1),
                evidence_ids: z.array(z.string()),
            })
        )
        .min(1)
        .max(5),
});

/**
 * Get jsonSchema for salient questions (reflection step 1)
 * @returns {Object} ConnectionManager jsonSchema object
 */
export function getSalientQuestionsJsonSchema() {
    return toJsonSchema(SalientQuestionsSchema, 'SalientQuestions');
}

/**
 * Get jsonSchema for insight extraction (reflection step 2)
 * @returns {Object} ConnectionManager jsonSchema object
 */
export function getInsightExtractionJsonSchema() {
    return toJsonSchema(InsightExtractionSchema, 'InsightExtraction');
}

/**
 * Parse salient questions response
 * @param {string} content - Raw LLM response
 * @returns {Object} Validated salient questions
 */
export function parseSalientQuestionsResponse(content) {
    return parseStructuredResponse(content, SalientQuestionsSchema);
}

/**
 * Parse insight extraction response
 * @param {string} content - Raw LLM response
 * @returns {Object} Validated insights
 */
export function parseInsightExtractionResponse(content) {
    return parseStructuredResponse(content, InsightExtractionSchema);
}
