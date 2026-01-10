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
    .replace(/^\/([A-Z]:)/, '$1')  // Fix Windows drive letter (e.g., /C: -> C:)
    .replace(/[/\\]src[/\\]constants\.js$/, '');

// Metadata keys for chat storage
export const METADATA_KEY = 'openvault';
export const MEMORIES_KEY = 'memories';
export const CHARACTERS_KEY = 'character_states';
export const RELATIONSHIPS_KEY = 'relationships';
export const LAST_PROCESSED_KEY = 'last_processed_message_id';
export const PROCESSED_MESSAGES_KEY = 'processed_message_ids';

// Default settings
export const defaultSettings = {
    enabled: true,
    extractionProfile: '',
    retrievalProfile: '',
    debugMode: false,
    // Extraction settings
    messagesPerExtraction: 30,
    extractionBuffer: 5,         // Recent messages to exclude from auto-extraction
    extractionRearviewTokens: 12000, // Token budget for extraction memory context
    // Retrieval pipeline settings (token-based)
    retrievalPreFilterTokens: 20000, // Stage 1: Algorithmic filter budget
    retrievalFinalTokens: 10000,     // Stage 2/3: Final context budget
    smartRetrievalEnabled: false,
    // Auto-hide settings
    autoHideEnabled: true,
    autoHideThreshold: 40,
    // Backfill settings
    backfillMaxRPM: 20,
    // Embedding settings (Local RAG)
    embeddingSource: 'multilingual-e5-small', // model name or 'ollama'
    ollamaUrl: '',
    embeddingModel: '',
    vectorSimilarityWeight: 15,
    vectorSimilarityThreshold: 0.5,
    keywordMatchWeight: 3.0,
    // Deduplication settings
    dedupSimilarityThreshold: 0.85,     // Cosine similarity threshold for filtering duplicates (0-1)
    // Forgetfulness curve settings (scoring)
    forgetfulnessBaseLambda: 0.05,      // Base decay rate for exponential curve
    forgetfulnessImportance5Floor: 5,   // Minimum score for importance-5 memories
    // Relationship decay settings
    relationshipDecayInterval: 50,      // Messages before decay triggers
    tensionDecayRate: 0.5,              // Tension drops per interval
    trustDecayRate: 0.1,                // High trust decay per interval
};

// Timeout constants
export const RETRIEVAL_TIMEOUT_MS = 60000; // 60 seconds max for retrieval
export const GENERATION_LOCK_TIMEOUT_MS = 120000; // 2 minutes safety timeout

// Pagination constants
export const MEMORIES_PER_PAGE = 20;

// Query context extraction defaults
export const QUERY_CONTEXT_DEFAULTS = {
    entityWindowSize: 10,       // messages to scan for entities
    embeddingWindowSize: 5,     // messages for embedding query
    recencyDecayFactor: 0.09,   // weight reduction per position
    topEntitiesCount: 5,        // max entities to inject
    entityBoostWeight: 5.0      // BM25 boost for extracted entities
};

// UI hint defaults - derived from defaultSettings and QUERY_CONTEXT_DEFAULTS
// Used to populate "(default: X)" hints in settings_panel.html
export const UI_DEFAULT_HINTS = {
    // Extraction
    messagesPerExtraction: defaultSettings.messagesPerExtraction,

    // Context budget
    retrievalFinalTokens: defaultSettings.retrievalFinalTokens,
    autoHideThreshold: defaultSettings.autoHideThreshold,

    // Retrieval weights
    vectorSimilarityWeight: defaultSettings.vectorSimilarityWeight,
    keywordMatchWeight: defaultSettings.keywordMatchWeight,
    vectorSimilarityThreshold: defaultSettings.vectorSimilarityThreshold,
    dedupSimilarityThreshold: defaultSettings.dedupSimilarityThreshold,

    // Entity settings
    entityWindowSize: QUERY_CONTEXT_DEFAULTS.entityWindowSize,
    embeddingWindowSize: QUERY_CONTEXT_DEFAULTS.embeddingWindowSize,
    topEntitiesCount: QUERY_CONTEXT_DEFAULTS.topEntitiesCount,
    entityBoostWeight: QUERY_CONTEXT_DEFAULTS.entityBoostWeight,

    // Summarization
    contextWindowSize: defaultSettings.extractionRearviewTokens,
    retrievalPreFilterTokens: defaultSettings.retrievalPreFilterTokens,
    backfillRateLimit: defaultSettings.backfillMaxRPM,
};

