// @ts-check
/**
 * Zod schemas for OpenVault data structures
 *
 * These schemas serve dual purposes:
 * 1. Runtime validation where needed (optional, to save CPU)
 * 2. Source of truth for TypeScript type generation via zod-to-ts
 *
 * For LLM I/O schemas with .catch() fallbacks, define a Base schema here
 * and extend it in src/extraction/structured.js with the fallbacks.
 */

import { cdnImport } from '../utils/cdn.js';

let _schemas = null;

/**
 * Get all Zod schemas. Lazily initializes zod via CDN and caches the result.
 * @returns {Promise<Object>} Object containing all schema definitions
 */
export async function getSchemas() {
    if (_schemas) {
        return _schemas;
    }

    const { z } = await cdnImport('zod');

    // --- Core Memory Schema ---

    const MemorySchema = z.object({
        id: z.string(),
        summary: z.string(),
        importance: z.number().int().min(1).max(5),
        embedding: z.array(z.number()).optional(),
        message_id: z.number(),
        timestamp: z.number(),
        witnesses: z.array(z.string()).optional(),
        type: z.enum(['event', 'reflection', 'global_synthesis']).optional(),
        level: z.number().optional(),
        tokens: z.array(z.string()),
        message_ids: z.array(z.number()).optional(),
        message_fingerprints: z.array(z.string()).optional(),
        mentions: z.number().optional(),
        retrieval_hits: z.number().optional(),
        archived: z.boolean().optional(),
        temporal_anchor: z.string().nullable().optional(),
        is_transient: z.boolean().optional(),
    });

    // --- Graph Schemas ---

    const GraphNodeSchema = z.object({
        name: z.string().min(1),
        type: z.enum(['PERSON', 'PLACE', 'ORGANIZATION', 'OBJECT', 'CONCEPT']),
        description: z.string(),
        mentions: z.number(),
        embedding: z.array(z.number()).optional(),
        embedding_b64: z.string().optional(),
        aliases: z.array(z.string()).optional(),
    });

    const GraphEdgeSchema = z.object({
        source: z.string(),
        target: z.string(),
        description: z.string(),
        weight: z.number(),
        _descriptionTokens: z.number().optional(),
        embedding: z.array(z.number()).optional(),
        embedding_b64: z.string().optional(),
    });

    const GraphDataSchema = z.object({
        nodes: z.record(z.string(), GraphNodeSchema),
        edges: z.record(z.string(), GraphEdgeSchema),
        _mergeRedirects: z.record(z.string(), z.string()).optional(),
        _edgesNeedingConsolidation: z.array(z.string()).optional(),
    });

    // --- Entity & Relationship (Base Schemas for LLM Extension) ---

    /**
     * Base Entity schema - strict validation for type generation
     * Extended in structured.js with .catch() fallbacks for LLM output
     */
    const BaseEntitySchema = z.object({
        name: z.string().min(1).trim().describe('Entity name, capitalized'),
        type: z.enum(['PERSON', 'PLACE', 'ORGANIZATION', 'OBJECT', 'CONCEPT']),
        description: z.string().describe('Comprehensive description of the entity'),
    });

    /**
     * Base Relationship schema - strict validation for type generation
     * Extended in structured.js with .catch() fallbacks for LLM output
     */
    const BaseRelationshipSchema = z.object({
        source: z.string().min(1).trim().describe('Source entity name'),
        target: z.string().min(1).trim().describe('Target entity name'),
        description: z.string().min(1).describe('Description of the relationship'),
    });

    // --- Scoring & Retrieval Schemas ---

    const ScoreBreakdownSchema = z.object({
        total: z.number(),
        base: z.number(),
        baseAfterFloor: z.number(),
        recencyPenalty: z.number(),
        vectorBonus: z.number(),
        vectorSimilarity: z.number(),
        bm25Bonus: z.number(),
        bm25Score: z.number(),
        distance: z.number(),
        importance: z.number(),
        hitDamping: z.number().optional(),
        frequencyFactor: z.number().optional(),
        decayFactor: z.number().optional(),
    });

    const ScoredMemorySchema = z.object({
        memory: MemorySchema,
        score: z.number(),
        breakdown: ScoreBreakdownSchema,
    });

    // --- Event Schemas ---

    const EventSchema = z.object({
        summary: z.string().min(20, 'Summary must be a complete descriptive sentence'),
        importance: z.number().int().min(1).max(5).default(3),
        characters_involved: z.array(z.string().trim()).default([]),
        witnesses: z.array(z.string().trim()).default([]),
        location: z.string().nullable().default(null),
        is_secret: z.boolean().default(false),
        temporal_anchor: z.string().nullable().optional().default(null),
        is_transient: z.boolean().optional().default(false),
        emotional_impact: z.record(z.string().trim(), z.string()).optional().default({}),
        relationship_impact: z.record(z.string().trim(), z.string()).optional().default({}),
    });

    const EventExtractionSchema = z.object({
        events: z.array(EventSchema),
    });

    // --- Scene State Schemas ---

    const SceneCharacterSchema = z.object({
        clothing: z.array(z.string()),
        posture: z.string(),
        physical_status: z.array(z.string()),
        mental_status: z.array(z.string()),
    });

    const SceneStateSchema = z.object({
        location: z.string(),
        time: z.string(),
        environment: z.string().optional(),
        characters: z.record(z.string(), SceneCharacterSchema).default({}),
        active_props: z.array(z.string()).default([]),
        source_fp: z.string(),
    });

    const SceneLedgerEntrySchema = z.object({
        fp: z.string(),
        location: z.string(),
        time: z.string(),
    });

    // --- OpenVault Data Schema ---

    const CharacterDataSchema = z.object({
        firstSeen: z.number().optional(),
        lastSeen: z.number().optional(),
        mentionCount: z.number().optional(),
    });

    const ReflectionStateSchema = z.object({
        lastMessageId: z.number().optional(),
        reflectionCount: z.number().optional(),
    });

    const GlobalWorldStateSchema = z.object({
        summary: z.string(),
        last_updated: z.number(),
    });

    const OpenVaultDataSchema = z.object({
        schema_version: z.number(),
        memories: z.array(MemorySchema).optional(),
        characters: z.record(z.string(), CharacterDataSchema).optional(),
        processed_messages: z.array(z.string()).optional(),
        graph: GraphDataSchema.optional(),
        reflection_state: ReflectionStateSchema.optional(),
        graph_message_count: z.number().optional(),
        global_world_state: GlobalWorldStateSchema.optional(),
        embedding_model_id: z.string().optional(),
        scene_states: z.record(z.string(), SceneStateSchema).optional(),
        scene_ledger: z.array(SceneLedgerEntrySchema).optional(),
        scene_counter: z.number().optional(),
    });

    // --- Config Schemas ---

    const ScoringConfigSchema = z.object({
        forgetfulnessBaseLambda: z.number().min(0.001).max(1),
        forgetfulnessImportance5Floor: z.number().min(0),
        reflectionDecayThreshold: z.number().min(0),
        vectorSimilarityThreshold: z.number().min(0).max(0.99),
        alpha: z.number().min(0).max(1),
        combinedBoostWeight: z.number().min(0).max(100),
        embeddingSource: z.enum(['local', 'ollama']),
        transientDecayMultiplier: z.number().positive().max(50).optional().default(5.0),
    });

    const QueryConfigSchema = z.object({
        contextWindowSize: z.number().optional(),
        entityBoostWeight: z.number().optional(),
        corpusGroundedBoost: z.number().optional(),
        corpusNonGroundedBoost: z.number().optional(),
        exactPhraseBoostWeight: z.number().optional(),
    });

    // --- Additional Types for Type Generation ---

    // Graph extraction result from LLM
    const GraphExtractionSchema = z.object({
        entities: z.array(
            z.object({
                name: z.string(),
                entityType: z.string(),
                description: z.string(),
            })
        ),
        relationships: z.array(
            z.object({
                source: z.string(),
                target: z.string(),
                relation: z.string(),
                description: z.string(),
            })
        ),
    });

    // Extraction phase options
    const ExtractionOptionsSchema = z.object({
        isBackfill: z.boolean().optional(),
        isEmergencyCut: z.boolean().optional(),
        silent: z.boolean().optional(),
        abortSignal: z.unknown().optional(),
        progressCallback: z.unknown().optional(),
        onPhase2Start: z.unknown().optional(),
    });

    // IDF cache object
    const IDFCacheSchema = z.object({
        memoryCount: z.number(),
        idfMap: z.record(z.string(), z.number()),
        avgDL: z.number(),
    });

    // Context parameters for LLM extraction
    const ExtractionContextParamsSchema = z.object({
        messagesText: z.string(),
        names: z.array(z.string()),
        charDesc: z.string(),
        personaDesc: z.string(),
        preamble: z.string(),
        prefill: z.string(),
        outputLanguage: z.enum(['auto', 'en', 'ru']),
    });

    // LLM call options for structured extraction
    const ExtractionLLMOptionsSchema = z.object({
        structured: z.boolean(),
        signal: z.unknown().optional(),
    });

    // Return value from generateReflections
    const GenerateReflectionsResultSchema = z.object({
        reflections: z.array(MemorySchema),
    });

    // Return value from consolidateEdges
    const ConsolidateEdgesResultSchema = z.object({
        count: z.number(),
    });

    // Return value from mergeOrInsertEntity
    const MergeEntityResultSchema = z.object({
        key: z.string(),
    });

    // LLM configuration preset
    const LLMConfigSchema = z.object({
        profileSettingKey: z.string(),
        maxTokens: z.number(),
        errorContext: z.string(),
        timeoutMs: z.number(),
        getJsonSchema: z
            .function({
                input: [],
                output: z.promise(
                    z.object({ name: z.string(), strict: z.boolean(), value: z.record(z.string(), z.unknown()) })
                ),
            })
            .optional(),
    });

    // LLM call options
    const LLMCallOptionsSchema = z.object({
        structured: z.boolean().optional(),
        signal: z.unknown().optional(),
        profileId: z.string().optional(),
        backupProfileId: z.string().optional(),
    });

    // LLM message array (OpenAI format)
    const LLMMessagesSchema = z.array(
        z.object({
            role: z.string(),
            content: z.string(),
        })
    );

    // Retrieval context for scoring
    const RetrievalContextSchema = z.object({
        recentContext: z.string(),
        userMessages: z.string(),
        activeCharacters: z.array(z.string()),
        chatLength: z.number(),
        finalTokens: z.number(),
        scoringConfig: ScoringConfigSchema,
        queryConfig: QueryConfigSchema,
        graphNodes: z.record(z.string(), GraphNodeSchema).optional(),
        graphEdges: z.record(z.string(), GraphEdgeSchema).optional(),
        allAvailableMemories: z.array(MemorySchema).optional(),
        idfCache: IDFCacheSchema.optional(),
        chatFingerprintMap: z.map(z.string(), z.number()).nullable().optional(),
    });

    // BM25 calculation context
    const BM25ContextSchema = z.object({
        idfMap: z.map(z.string(), z.number()),
        avgDL: z.number(),
    });

    // Forgetfulness curve constants
    const ForgetfulnessConstantsSchema = z.object({
        BASE_LAMBDA: z.number(),
        IMPORTANCE_5_FLOOR: z.number(),
        reflectionDecayThreshold: z.number(),
    });

    // Scoring settings
    const ScoringSettingsSchema = z.object({
        vectorSimilarityThreshold: z.number().min(0).max(0.99),
        alpha: z.number().min(0).max(1),
        combinedBoostWeight: z.number().min(0).max(100),
        transientDecayMultiplier: z.number().positive().max(50).optional(),
    });

    // Memory update fields for updateMemory()
    const MemoryUpdateSchema = z.object({
        summary: z.string().optional(),
        importance: z.number().int().min(1).max(5).optional(),
        tags: z.array(z.string()).optional(),
        is_secret: z.boolean().optional(),
        temporal_anchor: z.string().nullable().optional(),
        is_transient: z.boolean().optional(),
    });

    // Character names pair for prompt building
    const CharacterNamesSchema = z.object({
        char: z.string(),
        user: z.string(),
    });

    // Context object for prompt builders
    const PromptContextSchema = z.object({
        memories: z.array(MemorySchema).optional(),
        charDesc: z.string().optional(),
        personaDesc: z.string().optional(),
    });

    // Base prompt builder parameters
    const BasePromptParamsSchema = z.object({
        messages: z.string(),
        names: CharacterNamesSchema,
        context: PromptContextSchema.optional(),
        preamble: z.string(),
        prefill: z.string(),
        outputLanguage: z.enum(['auto', 'en', 'ru']).optional(),
    });

    // Graph extraction prompt parameters
    const GraphPromptParamsSchema = z.object({
        messages: z.string(),
        names: CharacterNamesSchema,
        context: PromptContextSchema.optional(),
        preamble: z.string(),
        prefill: z.string(),
        outputLanguage: z.enum(['auto', 'en', 'ru']).optional(),
        extractedEvents: z.array(z.string()).optional(),
    });

    // Edge consolidation prompt parameters
    const EdgeConsolidationParamsSchema = z.object({
        edgeData: GraphEdgeSchema,
        preamble: z.string(),
        prefill: z.string(),
        outputLanguage: z.enum(['auto', 'en', 'ru']).optional(),
    });

    // Reflection prompt parameters
    const ReflectionPromptParamsSchema = z.object({
        characterName: z.string(),
        recentMemories: z.array(MemorySchema),
        preamble: z.string(),
        prefill: z.string(),
        outputLanguage: z.enum(['auto', 'en', 'ru']).optional(),
    });

    _schemas = {
        MemorySchema,
        GraphNodeSchema,
        GraphEdgeSchema,
        GraphDataSchema,
        ScoreBreakdownSchema,
        ScoredMemorySchema,
        BaseEntitySchema,
        BaseRelationshipSchema,
        EventSchema,
        EventExtractionSchema,
        CharacterDataSchema,
        ReflectionStateSchema,
        GlobalWorldStateSchema,
        OpenVaultDataSchema,
        ScoringConfigSchema,
        QueryConfigSchema,
        GraphExtractionSchema,
        ExtractionOptionsSchema,
        IDFCacheSchema,
        ExtractionContextParamsSchema,
        ExtractionLLMOptionsSchema,
        GenerateReflectionsResultSchema,
        ConsolidateEdgesResultSchema,
        MergeEntityResultSchema,
        LLMConfigSchema,
        LLMCallOptionsSchema,
        LLMMessagesSchema,
        RetrievalContextSchema,
        BM25ContextSchema,
        ForgetfulnessConstantsSchema,
        ScoringSettingsSchema,
        MemoryUpdateSchema,
        CharacterNamesSchema,
        PromptContextSchema,
        BasePromptParamsSchema,
        GraphPromptParamsSchema,
        EdgeConsolidationParamsSchema,
        ReflectionPromptParamsSchema,
        SceneCharacterSchema,
        SceneStateSchema,
        SceneLedgerEntrySchema,
    };

    return _schemas;
}
