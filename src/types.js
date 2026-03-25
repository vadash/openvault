// @ts-check

/**
 * Core memory object stored in chatMetadata.openvault.memories
 * @typedef {Object} Memory
 * @property {string} id - Unique identifier (cyrb53 hash)
 * @property {string} summary - Human-readable event description
 * @property {number} importance - 1-5 scale, affects forgetfulness curve
 * @property {number[]} [embedding] - Vector embedding for similarity search
 * @property {number} message_id - Source message sequence number
 * @property {number} timestamp - Unix timestamp
 * @property {string[]} [witnesses] - Character names present
 * @property {string} [type] - 'event' | 'reflection' | 'global_synthesis'
 * @property {number} [level] - Reflection level (1-3) for decay calculation
 * @property {string[]} tokens - Pre-computed BM25 stem tokens
 * @property {number[]} [message_ids] - Multiple message IDs for merged memories
 * @property {number} [mentions] - How many times this memory was mentioned
 * @property {number} [retrieval_hits] - Access counter for reinforcement
 * @property {boolean} [archived] - Whether memory is archived
 * @property {boolean} [_st_synced] - Sync status for ST Vector Storage
 * @property {number} [_proxyVectorScore] - Temporary proxy score from ST Vector
 */

/**
 * Knowledge graph entity
 * @typedef {Object} Entity
 * @property {string} key - Normalized unique key (lowercase, no possessives)
 * @property {string} name - Display name
 * @property {string} [description] - LLM-generated description
 * @property {string} [type] - 'character' | 'object' | 'location' | 'abstract'
 * @property {string} [entityType] - Alias for type (used in graph operations)
 * @property {number} [firstSeen] - Message ID where first extracted
 * @property {number} [lastSeen] - Message ID where last mentioned
 * @property {string[]} [aliases] - Alternative names
 * @property {number[]} [embedding] - Vector representation
 * @property {boolean} [_st_synced]
 */

/**
 * Relationship between two entities
 * @typedef {Object} Relationship
 * @property {string} source - Source entity key
 * @property {string} target - Target entity key
 * @property {string} relation - Relationship type
 * @property {number} [strength] - 1-10 scale
 * @property {number} [firstSeen]
 * @property {number} [lastSeen]
 * @property {string} [description]
 * @property {boolean} [_st_synced]
 */

/**
 * Extracted event from LLM
 * @typedef {Object} ExtractedEvent
 * @property {string} summary
 * @property {number} importance - 1-5
 * @property {string[]} witnesses
 * @property {string} [mood] - Emotional tone
 * @property {string[]} [tags]
 * @property {string} [thinking] - LLM reasoning (stripped before storage)
 */

/**
 * Graph extraction result from LLM
 * @typedef {Object} GraphExtraction
 * @property {Array<{name: string, entityType: string, description: string}>} entities
 * @property {Array<{source: string, target: string, relation: string, description: string}>} relationships
 */

/**
 * Scored memory result
 * @typedef {Object} ScoredMemory
 * @property {Memory} memory
 * @property {number} score - Final computed score
 * @property {Object} breakdown - Score components
 * @property {number} breakdown.total
 * @property {number} breakdown.base
 * @property {number} breakdown.baseAfterFloor
 * @property {number} breakdown.recencyPenalty
 * @property {number} breakdown.vectorBonus
 * @property {number} breakdown.vectorSimilarity
 * @property {number} breakdown.bm25Bonus
 * @property {number} breakdown.bm25Score
 * @property {number} breakdown.distance
 * @property {number} breakdown.importance
 * @property {number} [breakdown.hitDamping]
 * @property {number} [breakdown.frequencyFactor]
 */

/**
 * BM25 calculation context
 * @typedef {Object} BM25Context
 * @property {Map<string, number>} idfMap - Term to IDF score
 * @property {number} avgDL - Average document length
 */

/**
 * Forgetfulness curve constants
 * @typedef {Object} ForgetfulnessConstants
 * @property {number} BASE_LAMBDA - Base decay rate
 * @property {number} IMPORTANCE_5_FLOOR - Floor for max importance memories
 * @property {number} reflectionDecayThreshold - Message distance for reflection penalty
 * @property {number} [reflectionLevelMultiplier] - Level decay divisor
 */

/**
 * Scoring settings
 * @typedef {Object} ScoringSettings
 * @property {number} vectorSimilarityThreshold - Cosine similarity cutoff
 * @property {number} alpha - Blend factor between BM25 and vector
 * @property {number} combinedBoostWeight - Weight for combined score
 */

/**
 * Scoring configuration (flat structure from settings)
 * @typedef {Object} ScoringConfig
 * @property {number} forgetfulnessBaseLambda
 * @property {number} forgetfulnessImportance5Floor
 * @property {number} reflectionDecayThreshold
 * @property {number} reflectionLevelMultiplier
 * @property {number} vectorSimilarityThreshold
 * @property {number} alpha
 * @property {number} combinedBoostWeight
 * @property {string} embeddingSource - 'local' | 'ollama' | 'st_vector'
 */

/**
 * Query context configuration
 * @typedef {Object} QueryConfig
 * @property {number} [contextWindowSize]
 * @property {number} [entityBoostWeight]
 * @property {number} [corpusGroundedBoost]
 * @property {number} [corpusNonGroundedBoost]
 * @property {number} [exactPhraseBoostWeight]
 */

/**
 * Retrieval context for scoring
 * @typedef {Object} RetrievalContext
 * @property {string} recentContext - Recent chat messages
 * @property {string} userMessages - Last 3 user messages for embedding
 * @property {string[]} activeCharacters - Characters in scene
 * @property {number} chatLength - Current message count
 * @property {number} finalTokens - Token budget
 * @property {ScoringConfig} scoringConfig
 * @property {QueryConfig} queryConfig
 * @property {Object} [graphNodes] - Entity graph nodes
 * @property {Object} [graphEdges] - Entity graph edges
 * @property {Memory[]} [allAvailableMemories] - All memories for IDF corpus
 * @property {Object} [idfCache] - Pre-computed IDF cache
 */

/**
 * ST Vector sync changes
 * @typedef {Object} StSyncChanges
 * @property {Array<{hash: number, text: string, item: Object}>} [toSync] - Items to upsert
 * @property {Array<{hash: number}>} [toDelete] - Items to remove
 */

/**
 * Extraction phase options
 * @typedef {Object} ExtractionOptions
 * @property {boolean} [isBackfill] - Skip Phase 2 enrichment
 * @property {boolean} [isEmergencyCut] - Enable cancellation
 * @property {boolean} [silent] - Suppress toast notifications
 * @property {Object} [abortSignal] - Cancellation signal (AbortSignal)
 * @property {function(number, number, number): void} [progressCallback] - Progress handler (batchNum, totalBatches, eventsCreated)
 * @property {function(): void} [onPhase2Start] - Phase 2 start callback
 */

/**
 * IDF cache object stored in chat metadata
 * @typedef {Object} IDFCache
 * @property {number} memoryCount - Corpus size when cache was built
 * @property {Object.<string, number>} idfMap - Serialized term -> IDF mapping
 * @property {number} avgDL - Average document length
 */

/**
 * Context parameters for LLM extraction calls
 * @typedef {Object} ExtractionContextParams
 * @property {string} messagesText - Concatenated message text
 * @property {string[]} names - Character names
 * @property {string} charDesc - Character description
 * @property {string} personaDesc - Persona description
 * @property {string} preamble - System prompt preamble
 * @property {string} prefill - Assistant prefill text
 * @property {string} outputLanguage - Output language ('en' | 'ru')
 */

/**
 * LLM call options for structured extraction
 * @typedef {Object} ExtractionLLMOptions
 * @property {boolean} structured - Enable structured output
 * @property {Object} [signal] - AbortSignal for cancellation
 */

/**
 * Return value from generateReflections
 * @typedef {Object} GenerateReflectionsResult
 * @property {Memory[]} reflections - New reflection memories
 * @property {StSyncChanges} stChanges - ST Vector sync changes
 */

/**
 * Return value from consolidateEdges
 * @typedef {Object} ConsolidateEdgesResult
 * @property {number} count - Number of edges consolidated
 * @property {StSyncChanges} stChanges - ST Vector sync changes
 */

/**
 * Flat graph structure stored in chatMetadata.openvault.graph
 * @typedef {Object} GraphData
 * @property {Object.<string, GraphNode>} nodes - Keyed by normalized entity name
 * @property {Object.<string, GraphEdge>} edges - Keyed by "source__target"
 * @property {Object.<string, string>} [_mergeRedirects] - Maps old keys to merged keys
 * @property {string[]} [_edgesNeedingConsolidation] - Edge keys pending consolidation
 */

/**
 * Graph node (entity) structure
 * @typedef {Object} GraphNode
 * @property {string} name - Display name (original casing preserved)
 * @property {string} type - PERSON | PLACE | ORGANIZATION | OBJECT | CONCEPT
 * @property {string} description - Entity description (pipe-separated segments)
 * @property {number} mentions - How many times this entity was seen
 * @property {number[]} [embedding] - Vector representation (deprecated, use embedding_b64)
 * @property {string} [embedding_b64] - Base64-encoded Float32Array embedding
 * @property {string[]} [aliases] - Alternative names merged into this node
 * @property {boolean} [_st_synced] - ST Vector sync status
 */

/**
 * Graph edge (relationship) structure
 * @typedef {Object} GraphEdge
 * @property {string} source - Source entity key (normalized)
 * @property {string} target - Target entity key (normalized)
 * @property {string} description - Relationship description (pipe-separated segments)
 * @property {number} weight - Strength/occurrence count
 * @property {number} [_descriptionTokens] - Token count for consolidation trigger
 * @property {number[]} [embedding] - Vector representation (deprecated)
 * @property {string} [embedding_b64] - Base64-encoded Float32Array embedding
 * @property {boolean} [_st_synced] - ST Vector sync status
 */

/**
 * Complete OpenVault data structure from chat metadata
 * @typedef {Object} OpenVaultData
 * @property {number} schema_version - Data schema version (current: 2)
 * @property {Memory[]} [memories] - Stored memory objects
 * @property {Object.<string, CharacterData>} [characters] - Character data keyed by name
 * @property {string[]} [processed_messages] - Message fingerprints already extracted
 * @property {GraphData} [graph] - Entity relationship graph
 * @property {Object.<string, CommunitySummary>} [communities] - Community summaries
 * @property {ReflectionState} [reflection_state] - Reflection tracking
 * @property {number} [graph_message_count] - Messages processed since last community detection
 * @property {GlobalWorldState} [global_world_state] - Macro-level world state synthesis
 */

/**
 * Character tracking data
 * @typedef {Object} CharacterData
 * @property {number} [firstSeen] - First message ID where character appeared
 * @property {number} [lastSeen] - Most recent message ID
 * @property {number} [mentionCount] - How many times character mentioned
 */

/**
 * Reflection state tracking
 * @typedef {Object} ReflectionState
 * @property {number} [lastMessageId] - Last message processed for reflections
 * @property {number} [reflectionCount] - Number of reflections generated
 */

/**
 * Global world state synthesis
 * @typedef {Object} GlobalWorldState
 * @property {string} summary - Global narrative summary
 * @property {number} last_updated - Message ID when last updated
 * @property {number} community_count - Number of communities at time of synthesis
 */

/**
 * Memory update fields for updateMemory()
 * @typedef {Object} MemoryUpdate
 * @property {string} [summary] - New summary text
 * @property {number} [importance] - New importance (1-5)
 * @property {string[]} [tags] - New tags
 * @property {boolean} [is_secret] - Secret flag
 */

/**
 * Character names pair for prompt building
 * @typedef {Object} CharacterNames
 * @property {string} char - Character name
 * @property {string} user - User name
 */

/**
 * Context object for prompt builders
 * @typedef {Object} PromptContext
 * @property {Memory[]} [memories] - Existing memories for context
 * @property {string} [charDesc] - Character description
 * @property {string} [personaDesc] - Persona description
 */
/**
 * @type {PromptContext}
 */
const _EMPTY_PROMPT_CONTEXT = {};

/**
 * Base prompt builder parameters
 * @typedef {Object} BasePromptParams
 * @property {string} messages - Chat message text
 * @property {CharacterNames} names - Character and user names
 * @property {PromptContext} [context] - Additional context
 * @property {string} preamble - System prompt preamble
 * @property {string} prefill - Assistant prefill text (required)
 * @property {'auto'|'en'|'ru'} [outputLanguage] - Output language
 */

/**
 * Graph extraction prompt parameters
 * @typedef {Object} GraphPromptParams
 * @property {string} messages - Chat message text
 * @property {CharacterNames} names - Character and user names
 * @property {PromptContext} [context] - Additional context
 * @property {string} preamble - System prompt preamble
 * @property {string} prefill - Assistant prefill text (required)
 * @property {'auto'|'en'|'ru'} [outputLanguage] - Output language
 * @property {string[]} [extractedEvents] - Previously extracted events for context
 */

/**
 * Edge consolidation prompt parameters
 * @typedef {Object} EdgeConsolidationParams
 * @property {GraphEdge} edgeData - Edge to consolidate
 * @property {string} preamble - System prompt preamble
 * @property {string} prefill - Assistant prefill text (required)
 * @property {'auto'|'en'|'ru'} [outputLanguage] - Output language
 */

/**
 * Reflection prompt parameters
 * @typedef {Object} ReflectionPromptParams
 * @property {string} characterName - Character name to reflect on
 * @property {Memory[]} recentMemories - Recent memories for reflection
 * @property {string} preamble - System prompt preamble
 * @property {string} prefill - Assistant prefill text (required)
 * @property {'auto'|'en'|'ru'} [outputLanguage] - Output language
 */

/**
 * Community summary prompt parameters
 * @typedef {Object} CommunitySummaryParams
 * @property {string[]} nodeLines - Formatted node descriptions
 * @property {string[]} edgeLines - Formatted edge descriptions
 * @property {string} preamble - System prompt preamble
 * @property {string} prefill - Assistant prefill text (required)
 * @property {'auto'|'en'|'ru'} [outputLanguage] - Output language
 */

/**
 * Global synthesis prompt parameters
 * @typedef {Object} GlobalSynthesisParams
 * @property {CommunitySummary[]} communities - Community summaries to synthesize
 * @property {string} preamble - System prompt preamble
 * @property {string} prefill - Assistant prefill text (required)
 * @property {'auto'|'en'|'ru'} [outputLanguage] - Output language
 */

/**
 * Community summary result (from LLM)
 * @typedef {Object} CommunitySummaryResult
 * @property {string} title - Community title
 * @property {string} summary - Community summary
 * @property {string[]} [findings] - Key findings
 */

/**
 * LLM message array (OpenAI format)
 * @typedef {Array<{role: string, content: string}>} LLMMessages
 */

/**
 * Return value from mergeOrInsertEntity
 * @typedef {Object} MergeEntityResult
 * @property {string} key - The node key (may be merged target)
 * @property {StSyncChanges} stChanges - ST Vector sync changes
 */

/**
 * Community summary from GraphRAG Louvain clustering
 * @typedef {Object} CommunitySummary
 * @property {string} id - Community identifier
 * @property {string} title - Community title
 * @property {string} summary - Community narrative summary
 * @property {string[]} [entities] - Entity keys in this community
 * @property {string[]} [findings] - Key findings
 * @property {number} [last_updated] - Message ID when last updated
 */

// Empty export to make this file a module for JSDoc imports
export {};
