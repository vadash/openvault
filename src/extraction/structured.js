import { z } from 'zod';
import { ExtractionResponseSchema, EventSchema } from './schemas/event-schema.js';

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
 * Parse LLM response with markdown stripping and Zod validation
 *
 * @param {string} content - Raw LLM response
 * @param {z.ZodType} schema - Zod schema to validate against
 * @returns {Object} Validated parsed data
 * @throws {Error} If JSON parsing or validation fails
 */
function parseStructuredResponse(content, schema) {
    let jsonContent = stripMarkdown(content);

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
 * Parse extraction response with full validation
 *
 * @param {string} content - Raw LLM response
 * @returns {Object} Validated extraction response
 */
export function parseExtractionResponse(content) {
    return parseStructuredResponse(content, ExtractionResponseSchema);
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
