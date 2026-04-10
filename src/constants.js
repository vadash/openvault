/**
 * OpenVault Constants
 *
 * Central location for all constants, default settings, and metadata keys.
 */

export const extensionName = 'openvault';

// Dynamic path detection - works regardless of folder name
const currentUrl = new URL(import.meta.url);
const pathFromST = currentUrl.pathname;
// Handle both Unix and Windows paths, remove /src/constants.js suffix
export const extensionFolderPath = pathFromST
    .replace(/^\/([A-Z]:)/, '$1') // Fix Windows drive letter (e.g., /C: -> C:)
    .replace(/[/\\]src[/\\]constants\.js$/, '');

// Metadata keys for chat storage
export const METADATA_KEY = 'openvault';
export const MEMORIES_KEY = 'memories';
export const CHARACTERS_KEY = 'character_states';
export const PROCESSED_MESSAGES_KEY = 'processed_message_ids';

// =============================================================================
// Injection Position Constants
// =============================================================================

export const INJECTION_POSITIONS = Object.freeze({
    BEFORE_MAIN: 0, // ↑Char - Before character definitions
    AFTER_MAIN: 1, // ↓Char - After character definitions (default)
    BEFORE_AN: 2, // ↑AN - Before author's note
    AFTER_AN: 3, // ↓AN - After author's note
    IN_CHAT: 4, // In-chat - At specified message depth
    CUSTOM: -1, // Custom - Macro-only, no auto-injection
});

export const POSITION_LABELS = Object.freeze([
    { value: 0, label: '↑Char', description: 'Before character definitions' },
    { value: 1, label: '↓Char', description: 'After character definitions' },
    { value: 2, label: '↑AN', description: "Before author's note" },
    { value: 3, label: '↓AN', description: "After author's note" },
    { value: 4, label: 'In-chat', description: 'At specified message depth' },
    { value: -1, label: 'Custom', description: 'Use macro manually' },
]);

// ============== Entity Types ==============
export const ENTITY_TYPES = Object.freeze({
    PERSON: 'PERSON',
    PLACE: 'PLACE',
    ORGANIZATION: 'ORGANIZATION',
    OBJECT: 'OBJECT',
    CONCEPT: 'CONCEPT',
});

// Default settings
export const defaultSettings = {
    enabled: true,
    extractionProfile: '',
    backupProfile: '',
    debugMode: false,
    requestLogging: false,
    // Extraction settings
    extractionTokenBudget: 8000, // Token threshold for extraction batches
    extractionRearviewTokens: 6000, // Token budget for extraction memory context
    // Retrieval pipeline settings (token-based)
    retrievalFinalTokens: 10000, // Final context budget
    // Auto-hide settings
    autoHideEnabled: true,
    visibleChatBudget: 16000, // Maximum tokens visible in chat history
    // Backfill settings
    backfillMaxRPM: 20,
    // Concurrency settings (Phase 2 parallelism)
    maxConcurrency: 1, // Default to 1 to protect local/VRAM-bound LLM users
    // Embedding settings (Local RAG)
    embeddingSource: 'multilingual-e5-small', // model name, 'ollama', or 'st_vector'
    ollamaUrl: '',
    embeddingModel: '',
    embeddingQueryPrefix: '', // Empty by default — e5-small works best without prefixes
    embeddingDocPrefix: '', // Empty by default — e5-small works best without prefixes
    // Alpha-blend scoring
    alpha: 0.7, // Vector vs keyword blend: 1.0 = vector only, 0.0 = BM25 only
    vectorSimilarityThreshold: 0.5,
    // Deduplication settings
    // Cosine similarity threshold for filtering duplicate events (0-1).
    // With small embedding models (e5-small), same-domain content clusters tightly (0.85-0.93),
    // so 0.94 filters true paraphrases while keeping nuanced roleplay actions distinct.
    dedupSimilarityThreshold: 0.95,
    dedupJaccardThreshold: 0.6, // Token-overlap (Jaccard index) threshold for near-duplicate filtering
    // Forgetfulness curve settings (scoring)
    forgetfulnessBaseLambda: 0.05, // Base decay rate for exponential curve
    transientDecayMultiplier: 5.0, // Multiplier for short-term (transient) memory decay
    // Reflection settings
    reflectionThreshold: 40,
    maxInsightsPerReflection: 3,
    // World context settings
    worldContextBudget: 2000,
    communityDetectionInterval: 100,
    // Entity settings
    // Query context settings (previously only in QUERY_CONTEXT_DEFAULTS)
    entityWindowSize: 10, // messages to scan for entities
    embeddingWindowSize: 5, // messages for embedding query
    recencyDecayFactor: 0.09, // weight reduction per position
    topEntitiesCount: 5, // max entities to inject
    entityBoostWeight: 5.0, // BM25 boost for extracted entities
    exactPhraseBoostWeight: 10.0, // 10x boost for multi-word entity exact phrases
    // Reflection decay settings
    // Reflections older than this many messages get a linear penalty (down to 0.25x).
    // 750 gives medium-length chats (~700 msgs) breathing room before decay kicks in.
    maxReflectionsPerCharacter: 50,
    maxReflectionLevel: 3, // Maximum reflection tree depth
    reflectionLevelMultiplier: 2.0, // Decay slows by 2x per level
    // Bucket balance settings (score-first budgeting with soft chronological balancing)
    bucketMinRepresentation: 0.2, // 20% minimum per bucket
    bucketSoftBalanceBudget: 0.05, // 5% budget for soft balancing
    // Preamble & prefill settings
    preambleLanguage: 'cn',
    extractionPrefill: 'cn_compliance',
    outputLanguage: 'auto',
    // Injection settings
    injection: {
        memory: { position: 1, depth: 4 },
        world: { position: 1, depth: 4 },
    },
    postHistoryPrompt: '',
};

// Embedding prefix defaults per model
// When user switches model, prefixes auto-populate from this table.
// User can still override manually.
export const embeddingModelPrefixes = {
    'multilingual-e5-small': { queryPrefix: 'query: ', docPrefix: 'passage: ' },
    'bge-small-en-v1.5': { queryPrefix: 'Represent this sentence for searching relevant passages: ', docPrefix: '' },
    'embeddinggemma-300m': {
        queryPrefix: 'task: sentence similarity | query: ',
        docPrefix: 'task: sentence similarity | query: ',
    },
    _default: { queryPrefix: 'query: ', docPrefix: 'passage: ' },
};

// ============== Embedding Sources ==============
export const EMBEDDING_SOURCES = Object.freeze({
    LOCAL: 'local',
    OLLAMA: 'ollama',
    ST_VECTOR: 'st_vector',
});

// Timeout constants
export const RETRIEVAL_TIMEOUT_MS = 60000; // 60 seconds max for retrieval
export const GENERATION_LOCK_TIMEOUT_MS = 120000; // 2 minutes safety timeout

// Pagination constants
export const MEMORIES_PER_PAGE = 20;

// Two-pass retrieval: maximum memories to calculate vector similarity on
// After fast-pass (Base + BM25), only top N get expensive cosine similarity
export const VECTOR_PASS_LIMIT = 200;

/** Over-fetch multiplier for ST Vector Storage candidate retrieval */
export const OVER_FETCH_MULTIPLIER = 3;

/** Max trimmed candidates to include in debug export (highest-scoring memories cut by budget) */
export const DEBUG_TRIMMED_CANDIDATES = 10;

// Query context extraction defaults
export const QUERY_CONTEXT_DEFAULTS = {
    entityWindowSize: 10, // messages to scan for entities
    embeddingWindowSize: 5, // messages for embedding query
    recencyDecayFactor: 0.09, // weight reduction per position
    topEntitiesCount: 5, // max entities to inject
    entityBoostWeight: 5.0, // BM25 boost for extracted entities
    exactPhraseBoostWeight: 10.0,
};

/**
 * Payload calculator constants — single source of truth.
 * Used by the settings UI to show how much total context the background LLM needs.
 * OVERHEAD = prompt template estimate only (excludes LLM output and safety buffer).
 * Thresholds determine the color-coded severity of the total.
 */
export const PAYLOAD_CALC = {
    PROMPT_ESTIMATE: 2000, // Approximate system/user prompt template size
    /** Derived: total overhead added on top of user-controlled sliders */
    get OVERHEAD() {
        return this.PROMPT_ESTIMATE;
    },
    /** Color thresholds for total context (sliders + OVERHEAD) */
    THRESHOLD_GREEN: 32000, // ≤ this = safe (green ✅)
    THRESHOLD_YELLOW: 48000, // ≤ this = caution (yellow ⚠️)
    THRESHOLD_ORANGE: 64000, // ≤ this = warning (orange 🟠), above = danger (red 🔴)
};

// =============================================================================
// Internal Constants (Not Exposed in UI)
// These values are pre-calibrated and should not be user-configurable.
// =============================================================================

/** Reflection deduplication: reject threshold (cosine similarity) */
export const REFLECTION_DEDUP_REJECT_THRESHOLD = 0.9;

/** Reflection deduplication: replace threshold (auto: reject - 0.10) */
export const REFLECTION_DEDUP_REPLACE_THRESHOLD = 0.8;

/** Reflection decay: messages before reflections lose priority */
export const REFLECTION_DECAY_THRESHOLD = 750;

/** Entity graph: max description segments per entity (FIFO eviction) */
export const ENTITY_DESCRIPTION_CAP = 3;

/** Entity graph: max description segments per edge (FIFO eviction) */
export const EDGE_DESCRIPTION_CAP = 5;

/** Community detection: messages before summaries are stale */
export const COMMUNITY_STALENESS_THRESHOLD = 100;

/** Alpha-blend scoring: max boost weight (BM25 + vector) */
export const COMBINED_BOOST_WEIGHT = 15;

/** Forgetfulness curve: minimum score for importance-5 memories */
export const IMPORTANCE_5_FLOOR = 5;

/**
 * Entity merge: semantic similarity threshold for clustering.
 * PERSON entities: high cosine alone is sufficient (names are unique identifiers).
 * OBJECT/CONCEPT/PLACE/ORGANIZATION: always require token overlap confirmation
 * to prevent false merges when embeddings are inflated by shared context.
 */
export const ENTITY_MERGE_THRESHOLD = 0.9;

export const GRAPH_JACCARD_DUPLICATE_THRESHOLD = 0.6;
export const ENTITY_TOKEN_OVERLAP_MIN_RATIO = 0.5;
export const REFLECTION_SKIP_SIMILARITY = 0.85;
export const REFLECTION_MIN_MEMORIES = 40;
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
export const CORPUS_GROUNDED_BOOST_RATIO = 0.6;
export const NON_GROUNDED_BOOST_RATIO = 0.4;

// UI hint defaults - derived from defaultSettings and QUERY_CONTEXT_DEFAULTS
// Used to populate "(default: X)" hints in settings_panel.html
export const UI_DEFAULT_HINTS = {
    // Extraction
    extractionTokenBudget: defaultSettings.extractionTokenBudget,

    // Context budget
    retrievalFinalTokens: defaultSettings.retrievalFinalTokens,
    visibleChatBudget: defaultSettings.visibleChatBudget,

    // Retrieval weights (new alpha-blend)
    alpha: defaultSettings.alpha,
    vectorSimilarityThreshold: defaultSettings.vectorSimilarityThreshold,
    dedupSimilarityThreshold: defaultSettings.dedupSimilarityThreshold,

    // Entity settings
    entityWindowSize: QUERY_CONTEXT_DEFAULTS.entityWindowSize,
    embeddingWindowSize: QUERY_CONTEXT_DEFAULTS.embeddingWindowSize,
    topEntitiesCount: QUERY_CONTEXT_DEFAULTS.topEntitiesCount,
    entityBoostWeight: QUERY_CONTEXT_DEFAULTS.entityBoostWeight,
    exactPhraseBoostWeight: defaultSettings.exactPhraseBoostWeight,

    // Summarization
    contextWindowSize: defaultSettings.extractionRearviewTokens,
    backfillRateLimit: defaultSettings.backfillMaxRPM,
    // Features
    maxConcurrency: defaultSettings.maxConcurrency,
    reflectionThreshold: defaultSettings.reflectionThreshold,
    maxInsightsPerReflection: defaultSettings.maxInsightsPerReflection,
    worldContextBudget: defaultSettings.worldContextBudget,
    communityDetectionInterval: defaultSettings.communityDetectionInterval,
    // Decay & forgetfulness curve tuning
    forgetfulnessBaseLambda: defaultSettings.forgetfulnessBaseLambda,
    maxReflectionLevel: defaultSettings.maxReflectionLevel,
    reflectionLevelMultiplier: defaultSettings.reflectionLevelMultiplier,
    bucketMinRepresentation: defaultSettings.bucketMinRepresentation,
    bucketSoftBalanceBudget: defaultSettings.bucketSoftBalanceBudget,
    // Reflection count limit
    maxReflectionsPerCharacter: defaultSettings.maxReflectionsPerCharacter,
    // Dedup
    dedupJaccardThreshold: defaultSettings.dedupJaccardThreshold,
};

// Performance monitoring thresholds (ms) — values above threshold show red
export const PERF_THRESHOLDS = {
    retrieval_injection: 2000,
    auto_hide: 500,
    memory_scoring: 200,
    event_dedup: 500,
    idf_calculation: 100, // Full IDF setup: tokenization + calculation (larger corpus)
    llm_events: 30000,
    llm_graph: 30000,
    llm_reflection: 20000, // Reduced from 45000 (was 4-call, now 1-call)
    llm_communities: 30000,
    embedding_generation: 10000,
    louvain_detection: 1000,
    entity_merge: 1000,
    chat_save: 1000,
};

// Performance metric display metadata
export const PERF_METRICS = {
    retrieval_injection: { label: 'Pre-gen injection', icon: 'fa-bolt', sync: true },
    auto_hide: { label: 'Auto-hide messages', icon: 'fa-eye-slash', sync: true },
    memory_scoring: { label: 'Memory scoring', icon: 'fa-calculator', sync: false },
    event_dedup: { label: 'Event dedup', icon: 'fa-clone', sync: false },
    idf_calculation: { label: 'BM25 IDF calc', icon: 'fa-function', sync: false },
    llm_events: { label: 'LLM: Events', icon: 'fa-cloud', sync: false },
    llm_graph: { label: 'LLM: Graph', icon: 'fa-cloud', sync: false },
    llm_reflection: { label: 'LLM: Reflection', icon: 'fa-cloud', sync: false },
    llm_communities: { label: 'LLM: Communities', icon: 'fa-cloud', sync: false },
    embedding_generation: { label: 'Embeddings', icon: 'fa-vector-square', sync: false },
    louvain_detection: { label: 'Louvain', icon: 'fa-circle-nodes', sync: false },
    entity_merge: { label: 'Entity merge', icon: 'fa-code-merge', sync: false },
    chat_save: { label: 'Chat save', icon: 'fa-floppy-disk', sync: false },
};

// Edge consolidation constants
export const CONSOLIDATION = {
    TOKEN_THRESHOLD: 150, // Trigger consolidation when description exceeds this
    MAX_CONSOLIDATION_BATCH: 10, // Max edges to consolidate per community detection run
    CONSOLIDATED_DESCRIPTION_CAP: 2, // After consolidation, cap future additions to 2 segments
    dedupSimilarityThreshold: 0.92, // Cosine similarity threshold for intra-batch dedup fallback
    dedupJaccardThreshold: 0.6, // Token-overlap (Jaccard) threshold for intra-batch dedup fallback
};

// Maximum number of recent memories to consider as reflection candidates.
// Reducing from 100 to 50 cuts reflection prompt size without losing signal quality.
export const REFLECTION_CANDIDATE_LIMIT = 50;

// Maximum number of communities per chunk in map-reduce global synthesis.
// Sets larger than this are chunked into regional summaries before final reduction.
export const GLOBAL_SYNTHESIS_CHUNK_SIZE = 10;

// Attenuation factor for main character edges during Louvain community detection.
// Edges involving User/Char are multiplied by this value instead of being dropped,
// preventing object orphaning in hub-and-spoke topologies (closed-room RPs)
// while still breaking hairball gravity in open-world RPs.
export const MAIN_CHARACTER_ATTENUATION = 0.05;

/** Number of complete turns (User+Bot pairs) to exclude from the tail of extraction batches.
 *  Prevents hallucinated/swiped AI responses from being extracted before the user can review.
 *  Emergency Cut and backfill bypass this. */
export const SWIPE_PROTECTION_TAIL_MESSAGES = 1;

// ============== ST API Endpoints ==============
export const ST_API_ENDPOINTS = Object.freeze({
    INSERT: '/api/vector/insert',
    DELETE: '/api/vector/delete',
    PURGE: '/api/vector/purge',
    QUERY: '/api/vector/query',
});
