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
export const LAST_PROCESSED_KEY = 'last_processed_message_id';
export const PROCESSED_MESSAGES_KEY = 'processed_message_ids';

// Default settings
export const defaultSettings = {
    enabled: true,
    extractionProfile: '',
    debugMode: false,
    requestLogging: false,
    // Extraction settings
    extractionTokenBudget: 12000, // Token threshold for extraction batches
    extractionRearviewTokens: 8000, // Token budget for extraction memory context
    // Retrieval pipeline settings (token-based)
    retrievalFinalTokens: 10000, // Final context budget
    // Auto-hide settings
    autoHideEnabled: true,
    visibleChatBudget: 16000, // Maximum tokens visible in chat history
    // Backfill settings
    backfillMaxRPM: 20,
    // Embedding settings (Local RAG)
    embeddingSource: 'multilingual-e5-small', // model name or 'ollama'
    ollamaUrl: '',
    embeddingModel: '',
    embeddingQueryPrefix: '', // Empty by default — e5-small works best without prefixes
    embeddingDocPrefix: '', // Empty by default — e5-small works best without prefixes
    embeddingRounding: false, // Round embeddings to 4 decimal places to reduce chatMetadata JSON size
    // Alpha-blend scoring
    alpha: 0.7, // Vector vs keyword blend: 1.0 = vector only, 0.0 = BM25 only
    combinedBoostWeight: 15, // Max boost points for retrieval (BM25 + vector)
    vectorSimilarityThreshold: 0.5,
    // Deduplication settings
    // Cosine similarity threshold for filtering duplicate events (0-1).
    // With small embedding models (e5-small), same-domain content clusters tightly (0.85-0.93),
    // so 0.94 filters true paraphrases while keeping nuanced roleplay actions distinct.
    dedupSimilarityThreshold: 0.95,
    dedupJaccardThreshold: 0.6, // Token-overlap (Jaccard index) threshold for near-duplicate filtering
    // Forgetfulness curve settings (scoring)
    forgetfulnessBaseLambda: 0.05, // Base decay rate for exponential curve
    forgetfulnessImportance5Floor: 5, // Minimum score for importance-5 memories
    // Reflection settings
    reflectionThreshold: 40,
    maxInsightsPerReflection: 3,
    reflectionDedupThreshold: 0.9,
    // World context settings
    worldContextBudget: 2000,
    communityDetectionInterval: 100,
    // Entity settings
    entityDescriptionCap: 3,
    edgeDescriptionCap: 5,
    entityMergeSimilarityThreshold: 0.95,
    // Query context settings (previously only in QUERY_CONTEXT_DEFAULTS)
    entityWindowSize: 10, // messages to scan for entities
    embeddingWindowSize: 5, // messages for embedding query
    recencyDecayFactor: 0.09, // weight reduction per position
    topEntitiesCount: 5, // max entities to inject
    entityBoostWeight: 5.0, // BM25 boost for extracted entities
    // Reflection decay settings
    // Reflections older than this many messages get a linear penalty (down to 0.25x).
    // 750 gives medium-length chats (~700 msgs) breathing room before decay kicks in.
    reflectionDecayThreshold: 750,
    maxReflectionsPerCharacter: 50,
    // Community staleness settings
    communityStalenessThreshold: 100,
    // Preamble & prefill settings
    preambleLanguage: 'cn',
    extractionPrefill: 'think_tag',
};

// Embedding prefix defaults per model
// When user switches model, prefixes auto-populate from this table.
// User can still override manually.
export const embeddingModelPrefixes = {
    'multilingual-e5-small': { queryPrefix: '', docPrefix: '' },
    'bge-small-en-v1.5': { queryPrefix: 'Represent this sentence for searching relevant passages: ', docPrefix: '' },
    'embeddinggemma-300m': { queryPrefix: 'search for similar scenes: ', docPrefix: '' },
    _default: { queryPrefix: 'query: ', docPrefix: 'passage: ' },
};

// Timeout constants
export const RETRIEVAL_TIMEOUT_MS = 60000; // 60 seconds max for retrieval
export const GENERATION_LOCK_TIMEOUT_MS = 120000; // 2 minutes safety timeout

// Pagination constants
export const MEMORIES_PER_PAGE = 20;

// Query context extraction defaults
export const QUERY_CONTEXT_DEFAULTS = {
    entityWindowSize: 10, // messages to scan for entities
    embeddingWindowSize: 5, // messages for embedding query
    recencyDecayFactor: 0.09, // weight reduction per position
    topEntitiesCount: 5, // max entities to inject
    entityBoostWeight: 5.0, // BM25 boost for extracted entities
};

/**
 * Payload calculator constants — single source of truth.
 * Used by the settings UI to show how much total context the background LLM needs.
 * OVERHEAD = output tokens reserved for LLM response + prompt template estimate + safety buffer.
 * Thresholds determine the color-coded severity of the total.
 */
export const PAYLOAD_CALC = {
    LLM_OUTPUT_TOKENS: 8000, // Matches maxTokens in all LLM_CONFIGS (see llm.js)
    PROMPT_ESTIMATE: 2000, // Approximate system/user prompt template size
    SAFETY_BUFFER: 2000, // Headroom for variance in prompt size
    /** Derived: total overhead added on top of user-controlled sliders */
    get OVERHEAD() {
        return this.LLM_OUTPUT_TOKENS + this.PROMPT_ESTIMATE + this.SAFETY_BUFFER;
    },
    /** Color thresholds for total context (sliders + OVERHEAD) */
    THRESHOLD_GREEN: 32000, // ≤ this = safe (green ✅)
    THRESHOLD_YELLOW: 48000, // ≤ this = caution (yellow ⚠️)
    THRESHOLD_ORANGE: 64000, // ≤ this = warning (orange 🟠), above = danger (red 🔴)
};

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
    combinedBoostWeight: defaultSettings.combinedBoostWeight,
    vectorSimilarityThreshold: defaultSettings.vectorSimilarityThreshold,
    dedupSimilarityThreshold: defaultSettings.dedupSimilarityThreshold,

    // Entity settings
    entityWindowSize: QUERY_CONTEXT_DEFAULTS.entityWindowSize,
    embeddingWindowSize: QUERY_CONTEXT_DEFAULTS.embeddingWindowSize,
    topEntitiesCount: QUERY_CONTEXT_DEFAULTS.topEntitiesCount,
    entityBoostWeight: QUERY_CONTEXT_DEFAULTS.entityBoostWeight,

    // Summarization
    contextWindowSize: defaultSettings.extractionRearviewTokens,
    backfillRateLimit: defaultSettings.backfillMaxRPM,
    // Features
    reflectionThreshold: defaultSettings.reflectionThreshold,
    maxInsightsPerReflection: defaultSettings.maxInsightsPerReflection,
    reflectionDedupThreshold: defaultSettings.reflectionDedupThreshold,
    worldContextBudget: defaultSettings.worldContextBudget,
    communityDetectionInterval: defaultSettings.communityDetectionInterval,
    communityStalenessThreshold: defaultSettings.communityStalenessThreshold,
    // Entity merge settings
    entityMergeSimilarityThreshold: defaultSettings.entityMergeSimilarityThreshold,
    edgeDescriptionCap: defaultSettings.edgeDescriptionCap,
    // Decay & forgetfulness curve tuning
    forgetfulnessBaseLambda: defaultSettings.forgetfulnessBaseLambda,
    forgetfulnessImportance5Floor: defaultSettings.forgetfulnessImportance5Floor,
    reflectionDecayThreshold: defaultSettings.reflectionDecayThreshold,
    // Graph cap settings
    entityDescriptionCap: defaultSettings.entityDescriptionCap,
    maxReflectionsPerCharacter: defaultSettings.maxReflectionsPerCharacter,
    // Dedup
    dedupJaccardThreshold: defaultSettings.dedupJaccardThreshold,
};
