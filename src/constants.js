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
    extractionBuffer: 5,         // Recent messages to exclude from auto-extraction
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
    embeddingSource: 'multilingual-e5-small', // model name or 'ollama'
    ollamaUrl: '',
    embeddingModel: '',
    vectorSimilarityWeight: 15,
    vectorSimilarityThreshold: 0.5,
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

