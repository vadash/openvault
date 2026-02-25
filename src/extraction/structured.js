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
 * Schema for the full extraction response from LLM (structured format)
 */
export const ExtractionResponseSchema = z.object({
    reasoning: z.string().nullable().default(null),
    events: z.array(EventSchema),
});

/**
 * Schema for smart retrieval LLM response
 */
export const RetrievalResponseSchema = z.object({
    reasoning: z.string().nullable().default(null),
    selected: z.array(z.number().int().min(1)),
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

/**
 * Get jsonSchema for retrieval responses from ConnectionManager sendRequest
 * For use in structured output mode
 *
 * @returns {Object} ConnectionManager jsonSchema object
 */
export function getRetrievalJsonSchema() {
    return toJsonSchema(RetrievalResponseSchema, 'MemoryRetrieval');
}

/**
 * Parse retrieval response with full validation
 *
 * @param {string} content - Raw LLM response
 * @returns {Object} Validated retrieval response with {selected, reasoning} format
 */
export function parseRetrievalResponse(content) {
    return parseStructuredResponse(content, RetrievalResponseSchema);
}
