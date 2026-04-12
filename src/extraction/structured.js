import { cdnImport } from '../utils/cdn.js';

const { z } = await cdnImport('zod');

import { ENTITY_TYPES } from '../constants.js';
// Import base schemas from store/schemas.js
import { BaseEntitySchema, BaseRelationshipSchema, EventExtractionSchema, EventSchema } from '../store/schemas.js';
import { logError, logWarn } from '../utils/logging.js';
import { safeParseJSON, stripMarkdownFences, stripThinkingTags } from '../utils/text.js';

// --- Schemas Extended with .catch() Fallbacks for LLM Validation ---

/**
 * Schema for relationship impact between characters
 */
export const RelationshipImpactSchema = z.record(z.string(), z.any());

/**
 * Schema for a single memory event
 * Re-exported from store/schemas.js
 */
export { EventSchema, EventExtractionSchema };

/**
 * Schema for an entity (person, place, organization, object, or concept)
 * Uses .catch() fallbacks to salvage partial LLM output —
 * invalid entries (name = "Unknown") are dropped downstream.
 */
export const EntitySchema = z.object({
    name: BaseEntitySchema.shape.name.catch('Unknown').describe('Entity name, capitalized'),
    type: BaseEntitySchema.shape.type.catch(ENTITY_TYPES.OBJECT),
    description: BaseEntitySchema.shape.description
        .catch('No description available')
        .describe('Comprehensive description of the entity'),
});

/**
 * Schema for a relationship between two entities
 * Uses .catch() fallbacks to salvage partial LLM output in large batches —
 * invalid entries (source/target = "Unknown") are dropped downstream.
 */
export const RelationshipSchema = z.object({
    source: BaseRelationshipSchema.shape.source.catch('Unknown').describe('Source entity name'),
    target: BaseRelationshipSchema.shape.target.catch('Unknown').describe('Target entity name'),
    description: BaseRelationshipSchema.shape.description
        .catch('No description')
        .describe('Description of the relationship'),
});

/**
 * Schema for Stage 2: Graph extraction only
 */
export const GraphExtractionSchema = z.object({
    entities: z.array(EntitySchema).max(5, 'Limit to 5 most significant entities per batch').default([]),
    relationships: z
        .array(RelationshipSchema)
        .max(5, 'Limit to 5 most significant relationships per batch')
        .default([]),
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
 * Wrap a bare string in a JSON object with the specified key.
 * Some LLMs (especially smaller or quantized models) return a raw string
 * instead of the expected `{ key: "string" }` object for single-field schemas.
 *
 * @param {any} data - The parsed data to check
 * @param {string} key - The key to wrap the string with
 * @returns {Object|any} Wrapped object, or original data if not a string
 */
function recoverBareString(data, key) {
    if (typeof data === 'string') {
        logWarn(`LLM returned bare string, wrapping in ${key}`);
        return { [key]: data };
    }
    return data;
}

/**
 * Parse LLM response with markdown stripping, thinking tag removal, and Zod validation
 *
 * @param {string} content - Raw LLM response
 * @param {z.ZodType} schema - Zod schema to validate against
 * @param {Function|null} [recoverFn=null] - Optional pre-validation transform (e.g. bare-string recovery)
 * @returns {Object} Validated parsed data
 * @throws {Error} If JSON parsing or validation fails
 */
export function parseStructuredResponse(content, schema, recoverFn = null) {
    // Use safeParseJSON with new API (handles thinking tags and markdown internally)
    const result = safeParseJSON(content);
    if (!result.success) {
        const start = content.slice(0, 500);
        const end = content.slice(-500);
        logError('JSON parse failed in structured response', result.error, {
            rawContentStart: start,
            rawContentEnd: end,
            length: content.length,
        });
        throw new Error(`JSON parse failed: ${result.error.message}`);
    }

    let parsed = result.data;

    // Auto-unwrap hallucinated OpenAI-style tool call payloads
    // LLMs sometimes output {"name": "...", "arguments": {...}} instead of the expected schema
    if (
        parsed != null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        'arguments' in parsed &&
        (parsed.name != null || parsed.tool != null || parsed.function != null)
    ) {
        logWarn('LLM returned tool-call wrapper, unwrapping arguments');
        let args = parsed.arguments;
        // arguments may be a JSON string (common with some models)
        if (typeof args === 'string') {
            const argsResult = safeParseJSON(args);
            if (argsResult.success) {
                args = argsResult.data;
            } else {
                throw new Error(`Failed to parse tool arguments string: ${argsResult.error.message}`);
            }
        }
        parsed = args;
    }

    // Apply recovery function before array unwrapping (e.g. bare-string → object)
    if (recoverFn) {
        parsed = recoverFn(parsed);
    }

    // Array recovery — unwrap bare arrays to first element
    if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
            throw new Error('LLM returned empty array');
        }
        logWarn(`LLM returned ${parsed.length}-element array instead of object — unwrapping first element`);
        parsed = parsed[0];
    }

    // Re-apply recovery after array unwrapping (bare string may emerge from [\"string\"])
    if (recoverFn) {
        parsed = recoverFn(parsed);
    }

    const schemaResult = schema.safeParse(parsed);
    if (!schemaResult.success) {
        throw new Error(`Schema validation failed: ${schemaResult.error.message}`);
    }

    return schemaResult.data;
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
    // Handle lazy exits: strip thinking tags and check for empty output
    const stripped = stripThinkingTags(content);
    if (stripped.trim().length === 0) {
        logWarn('LLM returned only thinking tags or whitespace, returning empty events');
        return { events: [] };
    }

    const result = safeParseJSON(content);
    if (!result.success) {
        const start = content.slice(0, 500);
        const end = content.slice(-500);
        logError('JSON parse failed in event extraction', result.error, {
            rawContentStart: start,
            rawContentEnd: end,
            length: content.length,
        });
        throw new Error(`JSON parse failed: ${result.error.message}`);
    }

    let parsed = result.data;

    // Domain-specific array recovery: wrap bare arrays in events object
    if (Array.isArray(parsed)) {
        logWarn('LLM returned bare array, wrapping in events object');
        parsed = { events: parsed };
    }

    // Per-event validation
    const rawEvents = parsed?.events;
    if (!Array.isArray(rawEvents)) {
        throw new Error('Schema validation failed: events array is missing');
    }

    if (rawEvents.length === 0) {
        return { events: [] };
    }

    const validEvents = [];
    for (const raw of rawEvents) {
        const eventResult = EventSchema.safeParse(raw);
        if (eventResult.success) {
            validEvents.push(eventResult.data);
        }
    }

    if (validEvents.length === 0) {
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
    // Handle lazy exits: strip thinking tags and check for empty output
    const stripped = stripThinkingTags(content);
    if (stripped.trim().length === 0) {
        logWarn('LLM returned only thinking tags or whitespace, returning empty entities and relationships');
        return { entities: [], relationships: [] };
    }

    const result = safeParseJSON(content);
    if (!result.success) {
        const start = content.slice(0, 500);
        const end = content.slice(-500);
        logError('JSON parse failed in graph extraction', result.error, {
            rawContentStart: start,
            rawContentEnd: end,
            length: content.length,
        });
        throw new Error(`JSON parse failed: ${result.error.message}`);
    }

    let parsed = result.data;

    // Domain-specific array recovery: bare arrays are entities (primary output)
    if (Array.isArray(parsed)) {
        logWarn('LLM returned bare array, mapping to entities');
        parsed = { entities: parsed, relationships: [] };
    }

    // Per-item validation
    const validEntities = [];
    for (const raw of parsed?.entities || []) {
        const res = EntitySchema.safeParse(raw);
        if (res.success) validEntities.push(res.data);
    }

    const validRelationships = [];
    for (const raw of parsed?.relationships || []) {
        const res = RelationshipSchema.safeParse(raw);
        if (res.success) validRelationships.push(res.data);
    }

    return { entities: validEntities, relationships: validRelationships };
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
    return stripMarkdownFences(content);
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

// --- Unified Reflection Schema ---

/**
 * Regex matching memory/event IDs that should not appear in prose text.
 * Matches: event_1234_0, ref_5678_1, and variants in parentheses or brackets.
 */
const MEMORY_ID_PATTERN = /\s*[(（[]?(?:event|ref)_[^\s)）\]]+[)）\]]?/g;

/**
 * Strip leaked memory/event IDs from reflection prose fields.
 * Catches patterns like "отказ Артёму (event_1775677567032_0)" and removes the ID part.
 * @param {string} text - Text that may contain leaked IDs
 * @returns {string} Cleaned text with IDs removed
 */
function stripLeakedIds(text) {
    return text
        .replace(MEMORY_ID_PATTERN, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * Schema for unified reflection (single-call: question + insight combined)
 * 1-3 reflections, each with question, insight, and evidence_ids.
 * ID stripping is applied in parseUnifiedReflectionResponse after validation.
 */
export const UnifiedReflectionSchema = z.object({
    reflections: z
        .array(
            z.object({
                question: z.string().min(1, 'Question is required'),
                insight: z.string().min(1, 'Insight is required'),
                evidence_ids: z.array(z.string()).default([]),
            })
        )
        .min(1, 'At least 1 reflection required')
        .max(3, 'Maximum 3 reflections'),
});

/**
 * Get jsonSchema for unified reflection
 * @returns {Object} ConnectionManager jsonSchema object
 */
export function getUnifiedReflectionJsonSchema() {
    return toJsonSchema(UnifiedReflectionSchema, 'UnifiedReflection');
}

/**
 * Parse unified reflection response
 * @param {string} content - Raw LLM response
 * @returns {Object} Validated unified reflection with reflections array
 */
export function parseUnifiedReflectionResponse(content) {
    const result = parseStructuredResponse(content, UnifiedReflectionSchema);
    return {
        reflections: result.reflections.map((r) => ({
            ...r,
            question: stripLeakedIds(r.question),
            insight: stripLeakedIds(r.insight),
        })),
    };
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

// --- Global Synthesis Schema ---

/**
 * Schema for global world state synthesis
 * Map-reduce output over all community summaries
 */
export const GlobalSynthesisSchema = z.object({
    global_summary: z
        .string()
        .min(50, 'Global summary must be substantive')
        .describe(
            'Overarching summary of current story state, focusing on macro-relationships and trajectory (max ~300 tokens)'
        ),
});

/**
 * Get jsonSchema for global synthesis
 * @returns {Object} ConnectionManager jsonSchema object
 */
export function getGlobalSynthesisJsonSchema() {
    return toJsonSchema(GlobalSynthesisSchema, 'GlobalSynthesis');
}

/**
 * Parse global synthesis response
 * @param {string} content - Raw LLM response
 * @returns {Object} Validated global synthesis with global_summary
 */
export function parseGlobalSynthesisResponse(content) {
    return parseStructuredResponse(content, GlobalSynthesisSchema, (data) => recoverBareString(data, 'global_summary'));
}

// --- Edge Consolidation Schema ---

/**
 * Schema for edge consolidation response
 */
export const EdgeConsolidationSchema = z.object({
    consolidated_description: z.string().min(1, 'Consolidated description is required'),
});

/**
 * Get jsonSchema for edge consolidation
 * @returns {Object} ConnectionManager jsonSchema object
 */
export function getEdgeConsolidationJsonSchema() {
    return toJsonSchema(EdgeConsolidationSchema, 'EdgeConsolidation');
}

/**
 * Parse edge consolidation response
 * @param {string} content - Raw LLM response
 * @returns {Object} Validated consolidation response
 */
export function parseConsolidationResponse(content) {
    return parseStructuredResponse(content, EdgeConsolidationSchema, (data) =>
        recoverBareString(data, 'consolidated_description')
    );
}
