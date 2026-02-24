import { z } from 'https://esm.sh/zod@4';
import { ExtractionResponseSchema, EventSchema, TagEnum } from './schemas/event-schema.js';
import { RetrievalResponseSchema } from './schemas/retrieval-schema.js';
import { stripThinkingTags, log } from '../utils.js';

/**
 * Valid tag values from TagEnum for sanitization
 */
const VALID_TAGS = new Set(TagEnum.options);

/**
 * Sanitize tags in parsed extraction data before Zod validation.
 * - Uppercases tag strings
 * - Strips invalid tags
 * - Falls back to ['NONE'] if all tags removed
 * - Logs corrections for debugging
 *
 * @param {Object} parsed - Raw parsed JSON (mutated in place)
 */
function sanitizeExtractionTags(parsed) {
    if (!parsed?.events || !Array.isArray(parsed.events)) return;

    for (const event of parsed.events) {
        if (!Array.isArray(event.tags)) continue;

        const original = [...event.tags];
        event.tags = event.tags
            .map(t => (typeof t === 'string' ? t.toUpperCase().trim() : t))
            .filter(t => VALID_TAGS.has(t));

        if (event.tags.length === 0) {
            event.tags = ['NONE'];
        }

        if (event.tags.length > 3) {
            event.tags = event.tags.slice(0, 3);
        }

        const removed = original.filter(t => !VALID_TAGS.has(typeof t === 'string' ? t.toUpperCase().trim() : t));
        if (removed.length > 0) {
            log(`Tag sanitization: removed invalid tags [${removed.join(', ')}] from event "${event.summary?.slice(0, 50)}..."`);
        }
    }
}

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
    let cleanedContent = stripThinkingTags(content);
    // Then strip markdown code blocks
    let jsonContent = stripMarkdown(cleanedContent);

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
    let cleanedContent = stripThinkingTags(content);
    let jsonContent = stripMarkdown(cleanedContent);

    let parsed;
    try {
        parsed = JSON.parse(jsonContent);
    } catch (e) {
        throw new Error(`JSON parse failed: ${e.message}`);
    }

    // Sanitize tags before validation to handle LLM mistakes
    sanitizeExtractionTags(parsed);

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
