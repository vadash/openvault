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
    keywordMatchWeight: 1.0,
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

