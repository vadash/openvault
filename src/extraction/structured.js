import { ENTITY_TYPES } from '../constants.js';
import { getSchemas } from '../store/schemas.js';
import { cdnImport } from '../utils/cdn.js';
import { logError, logWarn } from '../utils/logging.js';
import { safeParseJSON, stripThinkingTags } from '../utils/text.js';

// Lazy zod init — CDN failures degrade gracefully instead of blocking the entire extension
let _z = null;

async function getZ() {
    if (_z === null) {
        const zod = await cdnImport('zod');
        _z = zod.z;
    }
    return _z;
}

// Lazy extended schemas — built only when first needed
let _extended = null;

async function getExtendedSchemas() {
    if (_extended === null) {
        const z = await getZ();
        const { BaseEntitySchema, BaseRelationshipSchema, EventSchema, EventExtractionSchema } = await getSchemas();

        // Re-export base schemas
        const exported = {
            EventSchema,
            EventExtractionSchema,
        };

        // RelationshipImpactSchema
        exported.RelationshipImpactSchema = z.record(z.string(), z.any());

        // EntitySchema
        exported.EntitySchema = z.object({
            name: BaseEntitySchema.shape.name.catch('Unknown').describe('Entity name, capitalized'),
            type: BaseEntitySchema.shape.type.catch(ENTITY_TYPES.OBJECT),
            description: BaseEntitySchema.shape.description
                .catch('No description available')
                .describe('Comprehensive description of the entity'),
        });

        // RelationshipSchema
        exported.RelationshipSchema = z.object({
            source: BaseRelationshipSchema.shape.source.catch('Unknown').describe('Source entity name'),
            target: BaseRelationshipSchema.shape.target.catch('Unknown').describe('Target entity name'),
            description: BaseRelationshipSchema.shape.description
                .catch('No description')
                .describe('Description of the relationship'),
        });

        // GraphExtractionSchema
        exported.GraphExtractionSchema = z.object({
            entities: z
                .array(exported.EntitySchema)
                .max(5, 'Limit to 5 most significant entities per batch')
                .default([]),
            relationships: z
                .array(exported.RelationshipSchema)
                .max(5, 'Limit to 5 most significant relationships per batch')
                .default([]),
        });

        // SalientQuestionsSchema
        exported.SalientQuestionsSchema = z.object({
            questions: z.array(z.string()).length(3),
        });

        // InsightExtractionSchema
        exported.InsightExtractionSchema = z.object({
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

        // UnifiedReflectionSchema
        exported.UnifiedReflectionSchema = z.object({
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

        // CommunitySummarySchema
        exported.CommunitySummarySchema = z.object({
            title: z.string().min(1, 'Title is required'),
            summary: z.string().min(1, 'Summary is required'),
            findings: z.array(z.string()).min(1, 'At least one finding required').max(5, 'Maximum 5 findings'),
        });

        // GlobalSynthesisSchema
        exported.GlobalSynthesisSchema = z.object({
            global_summary: z
                .string()
                .min(50, 'Global summary must be substantive')
                .describe(
                    'Overarching summary of current story state, focusing on macro-relationships and trajectory (max ~300 tokens)'
                ),
        });

        // EdgeConsolidationSchema
        exported.EdgeConsolidationSchema = z.object({
            consolidated_description: z.string().min(1, 'Consolidated description is required'),
        });

        // SceneStateSchema (extended with catch fallbacks for LLM output)
        const { SceneCharacterSchema } = await getSchemas();
        exported.SceneCharacterLLMSchema = z.object({
            clothing: z.array(z.string()).catch([]),
            posture: z.string().catch('unknown posture'),
            physical_status: z.array(z.string()).catch([]),
            mental_status: z.array(z.string()).catch([]),
        });

        exported.SceneStateLLMSchema = z.object({
            location: z.string().min(1, 'Location is required').catch('Unknown location'),
            time: z.string().min(1, 'Time is required').catch('Unknown time'),
            environment: z.string().optional().catch(undefined),
            characters: z.record(z.string(), exported.SceneCharacterLLMSchema).catch({}),
            active_props: z.array(z.string()).catch([]),
            source_fp: z.string().min(1, 'Source fingerprint is required').catch('unknown'),
        });

        _extended = exported;
    }
    return _extended;
}

// Async getters for re-exported schemas
export async function getEventSchema() {
    return (await getExtendedSchemas()).EventSchema;
}

export async function getEventExtractionSchema() {
    return (await getExtendedSchemas()).EventExtractionSchema;
}

export async function getGlobalSynthesisSchema() {
    return (await getExtendedSchemas()).GlobalSynthesisSchema;
}

/**
 * Convert Zod schema to ConnectionManager jsonSchema format
 * Uses Zod v4's native toJSONSchema with jsonSchema4 target
 *
 * @param {z.ZodType} zodSchema - The Zod schema to convert
 * @param {string} schemaName - Name for the JSON schema
 * @returns {Promise<Object>} ConnectionManager-compatible jsonSchema object
 */
async function toJsonSchema(zodSchema, schemaName) {
    const z = await getZ();
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
 * @param {string} [prefill] - Expected prefill prefix for reconstruction if stripped by proxy
 * @returns {Promise<Object>} Validated parsed data
 * @throws {Error} If JSON parsing or validation fails
 */
export async function parseStructuredResponse(content, schema, recoverFn = null, prefill = undefined) {
    // Use safeParseJSON with new API (handles thinking tags and markdown internally)
    const result = await safeParseJSON(content, { prefill });
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
            const argsResult = await safeParseJSON(args);
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
 * @returns {Promise<Object>} ConnectionManager jsonSchema object
 */
export async function getEventExtractionJsonSchema() {
    const { EventExtractionSchema } = await getExtendedSchemas();
    return toJsonSchema(EventExtractionSchema, 'EventExtraction');
}

/**
 * Get jsonSchema for Stage 2: Graph extraction
 * @returns {Promise<Object>} ConnectionManager jsonSchema object
 */
export async function getGraphExtractionJsonSchema() {
    const { GraphExtractionSchema } = await getExtendedSchemas();
    return toJsonSchema(GraphExtractionSchema, 'GraphExtraction');
}

/**
 * Parse event extraction response (Stage 1)
 *
 * @param {string} content - Raw LLM response
 * @returns {Promise<Object>} Validated event extraction response with {events}
 */
export async function parseEventExtractionResponse(content) {
    // Handle lazy exits: strip thinking tags and check for empty output
    const stripped = stripThinkingTags(content);
    if (stripped.trim().length === 0) {
        logWarn('LLM returned only thinking tags or whitespace, returning empty events');
        return { events: [] };
    }

    const result = await safeParseJSON(content);
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

    const { EventSchema } = await getExtendedSchemas();
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
 * @returns {Promise<Object>} Validated graph extraction response with {entities, relationships}
 */
export async function parseGraphExtractionResponse(content) {
    // Handle lazy exits: strip thinking tags and check for empty output
    const stripped = stripThinkingTags(content);
    if (stripped.trim().length === 0) {
        logWarn('LLM returned only thinking tags or whitespace, returning empty entities and relationships');
        return { entities: [], relationships: [] };
    }

    const result = await safeParseJSON(content);
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

    const { EntitySchema, RelationshipSchema } = await getExtendedSchemas();

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
 * @returns {Promise<Object>} Validated event object
 */
export async function parseEvent(content) {
    const { EventSchema } = await getExtendedSchemas();
    return parseStructuredResponse(content, EventSchema);
}

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
 * Get jsonSchema for unified reflection
 * @returns {Promise<Object>} ConnectionManager jsonSchema object
 */
export async function getUnifiedReflectionJsonSchema() {
    const { UnifiedReflectionSchema } = await getExtendedSchemas();
    return toJsonSchema(UnifiedReflectionSchema, 'UnifiedReflection');
}

/**
 * Parse unified reflection response
 * @param {string} content - Raw LLM response
 * @returns {Promise<Object>} Validated unified reflection with reflections array
 */
export async function parseUnifiedReflectionResponse(content) {
    // Handle lazy exits: strip thinking tags and check for empty output
    const stripped = stripThinkingTags(content);
    if (stripped.trim().length === 0) {
        logWarn('LLM returned only thinking tags or whitespace, returning empty reflections');
        return { reflections: [] };
    }

    const { UnifiedReflectionSchema } = await getExtendedSchemas();
    const result = await parseStructuredResponse(content, UnifiedReflectionSchema);
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
 * Get jsonSchema for community summarization
 * @returns {Promise<Object>} ConnectionManager jsonSchema object
 */
export async function getCommunitySummaryJsonSchema() {
    const { CommunitySummarySchema } = await getExtendedSchemas();
    return toJsonSchema(CommunitySummarySchema, 'CommunitySummary');
}

/**
 * Parse community summary response
 * @param {string} content - Raw LLM response
 * @returns {Promise<Object>} Validated community summary
 */
export async function parseCommunitySummaryResponse(content) {
    const { CommunitySummarySchema } = await getExtendedSchemas();
    return parseStructuredResponse(content, CommunitySummarySchema);
}

// --- Global Synthesis Schema ---

/**
 * Get jsonSchema for global synthesis
 * @returns {Promise<Object>} ConnectionManager jsonSchema object
 */
export async function getGlobalSynthesisJsonSchema() {
    const { GlobalSynthesisSchema } = await getExtendedSchemas();
    return toJsonSchema(GlobalSynthesisSchema, 'GlobalSynthesis');
}

/**
 * Parse global synthesis response
 * @param {string} content - Raw LLM response
 * @returns {Promise<Object>} Validated global synthesis with global_summary
 */
export async function parseGlobalSynthesisResponse(content) {
    const { GlobalSynthesisSchema } = await getExtendedSchemas();
    return parseStructuredResponse(content, GlobalSynthesisSchema, (data) => recoverBareString(data, 'global_summary'));
}

// --- Edge Consolidation Schema ---

/**
 * Get jsonSchema for edge consolidation
 * @returns {Promise<Object>} ConnectionManager jsonSchema object
 */
export async function getEdgeConsolidationJsonSchema() {
    const { EdgeConsolidationSchema } = await getExtendedSchemas();
    return toJsonSchema(EdgeConsolidationSchema, 'EdgeConsolidation');
}

/**
 * Parse edge consolidation response
 * @param {string} content - Raw LLM response
 * @param {string} [prefill] - Expected prefill prefix for reconstruction if stripped by proxy
 * @returns {Promise<Object>} Validated consolidation response
 */
export async function parseConsolidationResponse(content, prefill = undefined) {
    const { EdgeConsolidationSchema } = await getExtendedSchemas();
    // Default prefill used by consolidateEdges() in graph.js - pass for reconstruction if stripped
    const defaultPrefill = '{\n  "consolidated_description": "';
    return parseStructuredResponse(
        content,
        EdgeConsolidationSchema,
        (data) => recoverBareString(data, 'consolidated_description'),
        prefill ?? defaultPrefill
    );
}

// --- Scene State Schema ---

/**
 * Get jsonSchema for scene state extraction
 * @returns {Promise<Object>} ConnectionManager jsonSchema object
 */
export async function getSceneStateJsonSchema() {
    const { SceneStateLLMSchema } = await getExtendedSchemas();
    return toJsonSchema(SceneStateLLMSchema, 'SceneState');
}

/**
 * Parse scene state response
 * @param {string} content - Raw LLM response
 * @returns {Promise<Object>} Validated scene state
 */
export async function parseSceneStateResponse(content) {
    const { SceneStateLLMSchema } = await getExtendedSchemas();
    return parseStructuredResponse(content, SceneStateLLMSchema);
}
