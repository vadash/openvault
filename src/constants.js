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

// Default settings
export const defaultSettings = {
    enabled: true,
    extractionProfile: '',
    retrievalProfile: '',
    debugMode: false,
    // Extraction settings
    messagesPerExtraction: 10,
    extractionRearviewTokens: 12000, // Token budget for extraction memory context
    // Retrieval pipeline settings (token-based)
    retrievalPreFilterTokens: 24000, // Stage 1: Algorithmic filter budget
    retrievalFinalTokens: 12000,     // Stage 2/3: Final context budget
    smartRetrievalEnabled: true,
    // Auto-hide settings
    autoHideEnabled: true,
    autoHideThreshold: 50,
    // Backfill settings
    backfillMaxRPM: 30,
    // Embedding settings (Local RAG)
    embeddingSource: 'multilingual-e5-small', // 'multilingual-e5-small', 'paraphrase-multilingual-MiniLM-L12-v2', 'all-MiniLM-L6-v2', 'bge-small-en-v1.5', 'ollama'
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

// Relationship decay constants
export const RELATIONSHIP_DECAY_INTERVAL = 50; // Messages before decay triggers
export const TENSION_DECAY_RATE = 0.5;         // Tension drops per interval (dissipates naturally)
export const TRUST_DECAY_RATE = 0.1;           // High trust decay per interval (trust is stickier)
