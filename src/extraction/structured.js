import { jsonrepair } from 'https://esm.sh/jsonrepair';
import { z } from 'https://esm.sh/zod';
import { stripThinkingTags } from '../utils/text.js';

// --- Schemas (inlined from schemas/) ---

/**
 * Schema for relationship impact between characters
 */
export const RelationshipImpactSchema = z.record(z.string(), z.string());

/**
 * Schema for a single memory event
 */
export const EventSchema = z.object({
    summary: z.string().min(20, 'Summary must be a complete descriptive sentence (min 20 characters)'),
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
 * Uses .catch() fallbacks to salvage partial LLM output —
 * invalid entries (name = "Unknown") are dropped downstream.
 */
export const EntitySchema = z.object({
    name: z.string().min(1).catch('Unknown').describe('Entity name, capitalized'),
    type: z.enum(['PERSON', 'PLACE', 'ORGANIZATION', 'OBJECT', 'CONCEPT']).catch('OBJECT'),
    description: z.string().catch('No description available').describe('Comprehensive description of the entity'),
});

/**
 * Schema for a relationship between two entities
 * Uses .catch() fallbacks to salvage partial LLM output in large batches —
 * invalid entries (source/target = "Unknown") are dropped downstream.
 */
export const RelationshipSchema = z.object({
    source: z.string().min(1).catch('Unknown').describe('Source entity name'),
    target: z.string().min(1).catch('Unknown').describe('Target entity name'),
    description: z.string().min(1).catch('No description').describe('Description of the relationship'),
});

/**
 * Schema for Stage 1: Event extraction only
 */
export const EventExtractionSchema = z.object({
    events: z.array(EventSchema),
});

/**
 * Schema for Stage 2: Graph extraction only
 */
export const GraphExtractionSchema = z.object({
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
    // Complete fences: ```json ... ```
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) return fenceMatch[1].trim();
    // Unclosed opening fence: ```json\n{...}
    let result = trimmed.replace(/^```(?:json)?\s*/i, '');
    // Orphan closing fence: {...}\n```
    result = result.replace(/\s*```\s*$/i, '');
    return result.trim();
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
        // Use jsonrepair to handle common LLM JSON issues (unescaped control chars, etc)
        const repaired = jsonrepair(jsonContent);
        parsed = JSON.parse(repaired);
    } catch (e) {
        throw new Error(`JSON parse failed: ${e.message}`);
    }

    // Array recovery - if LLM returned a bare array instead of expected object
    // Note: callers expecting objects must handle this appropriately
    if (Array.isArray(parsed)) {
        console.warn('[OpenVault] LLM returned array instead of object in parseStructuredResponse');
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
        throw new Error(`Schema validation failed: ${result.error.message}`);
    }

    return result.data;
}

/**
 * Get jsonSchema for Stage 1: Event extraction
 * @returns {Object} ConnectionManager jsonSchema object
 */
export function getEventExtractionJsonSchema() {
    return toJsonSchema(EventExtractionSchema, 'EventExtraction');
}

/**
 * Get jsonSchema for Stage 2: Graph extraction
 * @returns {Object} ConnectionManager jsonSchema object
 */
export function getGraphExtractionJsonSchema() {
    return toJsonSchema(GraphExtractionSchema, 'GraphExtraction');
}

/**
 * Parse event extraction response (Stage 1)
 *
 * @param {string} content - Raw LLM response
 * @returns {Object} Validated event extraction response with {events}
 */
export function parseEventExtractionResponse(content) {
    const cleanedContent = stripThinkingTags(content);
    const jsonContent = stripMarkdown(cleanedContent);

    let parsed;
    try {
        const repaired = jsonrepair(jsonContent);
        parsed = JSON.parse(repaired);
    } catch (e) {
        throw new Error(`JSON parse failed: ${e.message}`);
    }

    // Array recovery
    if (Array.isArray(parsed)) {
        parsed = { events: parsed };
    }

    // Per-event validation: salvage valid events instead of rejecting the entire batch
    const rawEvents = parsed?.events;
    if (!Array.isArray(rawEvents)) {
        throw new Error('Schema validation failed: events array is missing');
    }

    // Allow empty arrays as a valid successful extraction (no events found)
    if (rawEvents.length === 0) {
        return { events: [] };
    }

    const validEvents = [];
    for (const raw of rawEvents) {
        const result = EventSchema.safeParse(raw);
        if (result.success) {
            validEvents.push(result.data);
        }
    }

    if (validEvents.length === 0) {
        // All events were invalid - return empty array (salvage behavior)
        return { events: [] };
    }

    return { events: validEvents };
}

/**
 * Parse graph extraction response (Stage 2)
 *
 * @param {string} content - Raw LLM response
 * @returns {Object} Validated graph extraction response with {entities, relationships}
 */
export function parseGraphExtractionResponse(content) {
    const cleanedContent = stripThinkingTags(content);
    const jsonContent = stripMarkdown(cleanedContent);

    let parsed;
    try {
        const repaired = jsonrepair(jsonContent);
        parsed = JSON.parse(repaired);
    } catch (e) {
        throw new Error(`JSON parse failed: ${e.message}`);
    }

    const result = GraphExtractionSchema.safeParse(parsed);
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

// --- Community Summary Schema ---

/**
 * Schema for community summarization output
 * Title, summary, and 1-5 key findings about a community
 */
export const CommunitySummarySchema = z.object({
    title: z.string().min(1, 'Title is required'),
    summary: z.string().min(1, 'Summary is required'),
    findings: z.array(z.string()).min(1, 'At least one finding required').max(5, 'Maximum 5 findings'),
});

/**
 * Get jsonSchema for community summarization
 * @returns {Object} ConnectionManager jsonSchema object
 */
export function getCommunitySummaryJsonSchema() {
    return toJsonSchema(CommunitySummarySchema, 'CommunitySummary');
}

/**
 * Parse community summary response
 * @param {string} content - Raw LLM response
 * @returns {Object} Validated community summary
 */
export function parseCommunitySummaryResponse(content) {
    return parseStructuredResponse(content, CommunitySummarySchema);
}
