/**
 * OpenVault Constants
 *
 * Central location for all constants, default settings, and metadata keys.
 */

export const extensionName = 'openvault';
export const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Metadata keys for chat storage
export const METADATA_KEY = 'openvault';
export const MEMORIES_KEY = 'memories';
export const CHARACTERS_KEY = 'character_states';
export const RELATIONSHIPS_KEY = 'relationships';
export const LAST_PROCESSED_KEY = 'last_processed_message_id';
export const LAST_BATCH_KEY = 'last_extraction_batch';

// Default settings
export const defaultSettings = {
    enabled: true,
    automaticMode: true,
    extractionProfile: '',
    retrievalProfile: '',
    tokenBudget: 1000,
    maxMemoriesPerRetrieval: 100,
    debugMode: false,
    // Extraction settings
    messagesPerExtraction: 10,
    memoryContextCount: -1,
    smartRetrievalEnabled: true,
    // Auto-hide settings
    autoHideEnabled: true,
    autoHideThreshold: 50,
    // Backfill settings
    backfillMaxRPM: 30,
    // Embedding settings (Local RAG)
    ollamaUrl: '',
    embeddingModel: '',
    vectorSimilarityWeight: 15,
    vectorSimilarityThreshold: 0.5,
};

// Timeout constants
export const RETRIEVAL_TIMEOUT_MS = 60000; // 60 seconds max for retrieval
export const GENERATION_LOCK_TIMEOUT_MS = 120000; // 2 minutes safety timeout

// Pagination constants
export const MEMORIES_PER_PAGE = 10;

// Scoring weights for simple relevance scoring
export const SCORING_WEIGHTS = {
    IMPORTANCE_MULTIPLIER: 4,     // importance (1-5) * 4 = 4-20 points
    RECENCY_MAX_POINTS: 10,       // up to 10 points for recent memories
    CHARACTER_INVOLVED: 5,        // points for character involvement
    CHARACTER_WITNESS: 3,         // points for witness
    KEYWORD_MATCH: 1,             // points per keyword match
    EVENT_TYPE_REVELATION: 3,     // bonus for revelation events
    EVENT_TYPE_RELATIONSHIP: 2,   // bonus for relationship_change events
};

// Forgetfulness curve constants
export const FORGETFULNESS = {
    BASE_LAMBDA: 0.05,         // Base decay rate for exponential curve
    IMPORTANCE_5_FLOOR: 5,     // Minimum score for importance-5 memories
};

// Retrieval filter constants
export const RECENT_MESSAGE_BUFFER = 10; // exclude memories from last N messages
