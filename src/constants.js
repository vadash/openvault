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
export const EXTRACTED_BATCHES_KEY = 'extracted_batches';

// Default settings
export const defaultSettings = {
    enabled: true,
    automaticMode: true,
    extractionProfile: '',
    retrievalProfile: '',
    tokenBudget: 1000,
    maxMemoriesPerRetrieval: 10,
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
};

// Timeout constants
export const RETRIEVAL_TIMEOUT_MS = 30000; // 30 seconds max for retrieval
export const GENERATION_LOCK_TIMEOUT_MS = 120000; // 2 minutes safety timeout

// Pagination constants
export const MEMORIES_PER_PAGE = 10;
