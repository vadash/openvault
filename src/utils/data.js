import { CHARACTERS_KEY, LAST_PROCESSED_KEY, MEMORIES_KEY, METADATA_KEY } from '../constants.js';
import { getDeps } from '../deps.js';
import { record } from '../perf/store.js';
import { showToast } from './dom.js';
import { clearStSynced, deleteEmbedding, hasEmbedding, isStSynced } from './embedding-codec.js';
import { logDebug, logError, logInfo, logWarn } from './logging.js';

/**
 * Get the ST Vector Storage collection ID for the current chat.
 * Includes chat ID to prevent cross-chat data leakage.
 * @param {string} chatId - Current chat ID
 * @returns {string} Collection ID
 */
function getSTCollectionId(chatId) {
    const source = getDeps().getExtensionSettings()?.openvault?.embeddingSource || 'openvault';
    return `openvault-${chatId || 'default'}-${source}`;
}

/**
 * Extract OpenVault ID from ST text field with OV_ID prefix.
 * @param {string} text - Text like "[OV_ID:event_123] The actual text..."
 * @returns {string|null} Extracted ID or null
 */
function extractOvId(text) {
    if (!text) return null;
    const match = text.match(/^\[OV_ID:([^\]]+)\]/);
    return match ? match[1] : null;
}

/**
 * Get the ST Vector Storage source from ST settings.
 * @returns {string} The configured source (e.g., 'openrouter', 'openai', 'ollama')
 */
function getSTVectorSource() {
    const extSettings = getDeps().getExtensionSettings();
    // ST stores vector source in extension_settings.vectors.source
    return extSettings?.vectors?.source || 'transformers';
}

/**
 * Get the API URL for a local text-generation source, respecting alt endpoint override.
 * Mirrors ST's logic: use alt_endpoint_url if enabled, otherwise textCompletionSettings.server_urls.
 * @param {string} sourceType - The textgen source type key (e.g., 'ollama', 'llamacpp', 'vllm')
 * @returns {string|undefined} The API URL
 */
function getSourceApiUrl(sourceType) {
    const vectors = getDeps().getExtensionSettings()?.vectors;
    if (vectors?.use_alt_endpoint && vectors?.alt_endpoint_url) {
        return vectors.alt_endpoint_url;
    }
    const ctx = getDeps().getContext();
    return ctx?.textCompletionSettings?.server_urls?.[sourceType];
}

/**
 * Get additional request body parameters based on the source.
 * Mirrors ST's getVectorsRequestBody function.
 * @param {string} source - The vector source
 * @returns {Object} Additional parameters for the request body
 */
function getSTVectorRequestBody(source) {
    const extSettings = getDeps().getExtensionSettings();
    const body = {};

    switch (source) {
        case 'extras':
            body.extrasUrl = extSettings?.apiUrl;
            body.extrasKey = extSettings?.apiKey;
            break;
        case 'electronhub':
            body.model = extSettings?.vectors?.electronhub_model;
            break;
        case 'openrouter':
            body.model = extSettings?.vectors?.openrouter_model;
            break;
        case 'togetherai':
            body.model = extSettings?.vectors?.togetherai_model;
            break;
        case 'openai':
            body.model = extSettings?.vectors?.openai_model;
            break;
        case 'cohere':
            body.model = extSettings?.vectors?.cohere_model;
            break;
        case 'ollama':
            body.model = extSettings?.vectors?.ollama_model;
            body.apiUrl = getSourceApiUrl('ollama');
            body.keep = !!extSettings?.vectors?.ollama_keep;
            break;
        case 'llamacpp':
            body.apiUrl = getSourceApiUrl('llamacpp');
            break;
        case 'vllm':
            body.apiUrl = getSourceApiUrl('vllm');
            body.model = extSettings?.vectors?.vllm_model;
            break;
        case 'webllm':
            body.model = extSettings?.vectors?.webllm_model;
            break;
        case 'palm':
            body.model = extSettings?.vectors?.google_model;
            body.api = 'makersuite';
            break;
        case 'vertexai': {
            body.model = extSettings?.vectors?.google_model;
            body.api = 'vertexai';
            const oaiSettings = getDeps().getContext()?.chatCompletionSettings;
            body.vertexai_auth_mode = oaiSettings?.vertexai_auth_mode;
            body.vertexai_region = oaiSettings?.vertexai_region;
            body.vertexai_express_project_id = oaiSettings?.vertexai_express_project_id;
            break;
        }
        case 'mistral':
            body.model = 'mistral-embed';
            break;
        case 'nomicai':
            body.model = 'nomic-embed-text-v1.5';
            break;
        case 'chutes':
            body.model = extSettings?.vectors?.chutes_model;
            break;
        case 'nanogpt':
            body.model = extSettings?.vectors?.nanogpt_model;
            break;
        case 'transformers':
        default:
            // No additional params needed
            break;
    }

    return body;
}

/**
 * Check if the current embedding source is ST Vector Storage.
 * @returns {boolean}
 */
export function isStVectorSource() {
    const settings = getDeps().getExtensionSettings()?.openvault;
    return settings?.embeddingSource === 'st_vector';
}

/**
 * Sync items to ST Vector Storage via /api/vector/insert.
 * @param {Array<{hash: number, text: string}>} items - Items to insert
 * @param {string} chatId - Current chat ID
 * @returns {Promise<boolean>} True if successful
 */
export async function syncItemsToST(items, chatId) {
    if (!items || items.length === 0) return true;

    try {
        const collectionId = getSTCollectionId(chatId);
        const source = getSTVectorSource();
        const body = {
            collectionId,
            items,
            source,
            ...getSTVectorRequestBody(source),
        };

        const response = await getDeps().fetch('/api/vector/insert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            logWarn(`ST Vector insert failed: ${response.status}`);
            return false;
        }
        return true;
    } catch (error) {
        logError('ST Vector insert error', error);
        return false;
    }
}

/**
 * Delete items from ST Vector Storage via /api/vector/delete.
 * @param {number[]} hashes - Cyrb53 hashes to delete
 * @param {string} chatId - Current chat ID
 * @returns {Promise<boolean>} True if successful
 */
export async function deleteItemsFromST(hashes, chatId) {
    if (!hashes || hashes.length === 0) return true;

    try {
        const collectionId = getSTCollectionId(chatId);
        const source = getSTVectorSource();
        const body = {
            collectionId,
            hashes,
            source,
            ...getSTVectorRequestBody(source),
        };

        const response = await getDeps().fetch('/api/vector/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            logWarn(`ST Vector delete failed: ${response.status}`);
            return false;
        }
        return true;
    } catch (error) {
        logError('ST Vector delete error', error);
        return false;
    }
}

/**
 * Purge entire ST Vector Storage collection.
 * @param {string} chatId - Current chat ID
 * @returns {Promise<boolean>} True if successful
 */
export async function purgeSTCollection(chatId) {
    try {
        const collectionId = getSTCollectionId(chatId);
        const response = await getDeps().fetch('/api/vector/purge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collectionId }),
        });
        if (!response.ok) {
            logWarn(`ST Vector purge failed: ${response.status}`);
            return false;
        }
        return true;
    } catch (error) {
        logError('ST Vector purge error', error);
        return false;
    }
}

/**
 * Query ST Vector Storage for similar items.
 * @param {string} searchText - Query text
 * @param {number} topK - Number of results
 * @param {number} threshold - Similarity threshold
 * @param {string} chatId - Current chat ID
 * @returns {Promise<Array<{id: string, hash: number, text: string}>>} Results with extracted OV IDs
 */
export async function querySTVector(searchText, topK, threshold, chatId) {
    try {
        const collectionId = getSTCollectionId(chatId);
        const source = getSTVectorSource();
        const body = {
            collectionId,
            searchText,
            topK,
            threshold,
            source,
            ...getSTVectorRequestBody(source),
        };

        const response = await getDeps().fetch('/api/vector/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            logWarn(`ST Vector query failed: ${response.status}`);
            return [];
        }

        const data = await response.json();
        if (!data?.metadata || !Array.isArray(data.metadata)) return [];

        return data.metadata.map((item) => ({
            id: extractOvId(item.text) || String(item.hash),
            hash: item.hash,
            text: item.text,
        }));
    } catch (error) {
        logError('ST Vector query error', error);
        return [];
    }
}

/**
 * Get OpenVault data from chat metadata
 * @returns {Object|null} Returns null if context is not available
 */
export function getOpenVaultData() {
    const context = getDeps().getContext();
    if (!context) {
        logWarn('getContext() returned null/undefined');
        return null;
    }
    if (!context.chatMetadata) {
        context.chatMetadata = {};
    }
    if (!context.chatMetadata[METADATA_KEY]) {
        context.chatMetadata[METADATA_KEY] = {
            [MEMORIES_KEY]: [],
            [CHARACTERS_KEY]: {},
            [LAST_PROCESSED_KEY]: -1,
        };
    }
    const data = context.chatMetadata[METADATA_KEY];

    return data;
}

/**
 * Get current chat ID for tracking across async operations
 * @returns {string|null}
 */
export function getCurrentChatId() {
    const context = getDeps().getContext();
    return context?.chatId || context?.chat_metadata?.chat_id || null;
}

/**
 * Save OpenVault data to chat metadata
 * @param {string} [expectedChatId] - If provided, verify chat hasn't changed before saving
 * @returns {Promise<boolean>} True if save succeeded, false otherwise
 */
export async function saveOpenVaultData(expectedChatId = null) {
    const t0 = performance.now();
    if (expectedChatId !== null) {
        const currentId = getCurrentChatId();
        if (currentId !== expectedChatId) {
            logWarn(
                `Chat changed during operation (expected: ${expectedChatId}, current: ${currentId}), aborting save`
            );
            return false;
        }
    }

    try {
        await getDeps().saveChatConditional();
        record('chat_save', performance.now() - t0);
        logDebug('Data saved to chat metadata');
        return true;
    } catch (error) {
        record('chat_save', performance.now() - t0);
        logError('Failed to save data', error);
        showToast('error', `Failed to save data: ${error.message}`);
        return false;
    }
}

/**
 * Generate a unique ID
 * @returns {string}
 */
export function generateId() {
    return `${getDeps().Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Update a memory by ID
 * @param {string} id - Memory ID to update
 * @param {Object} updates - Fields to update (summary, importance, tags, is_secret)
 * @returns {Promise<boolean>} True if updated, false otherwise
 */
export async function updateMemory(id, updates) {
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat loaded');
        return false;
    }

    const memory = data[MEMORIES_KEY]?.find((m) => m.id === id);
    if (!memory) {
        logDebug(`Memory ${id} not found`);
        return false;
    }

    // Track if summary changed (requires re-embedding)
    const summaryChanged = updates.summary !== undefined && updates.summary !== memory.summary;

    // Apply allowed updates
    const allowedFields = ['summary', 'importance', 'tags', 'is_secret'];
    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            memory[field] = updates[field];
        }
    }

    // If summary changed, invalidate embedding so it can be regenerated
    if (summaryChanged) {
        deleteEmbedding(memory);
    }

    await getDeps().saveChatConditional();
    logDebug(`Updated memory ${id}${summaryChanged ? ' (embedding invalidated)' : ''}`);
    return true;
}

/**
 * Delete a memory by ID
 * @param {string} id - Memory ID to delete
 * @returns {Promise<boolean>} True if deleted, false otherwise
 */
export async function deleteMemory(id) {
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat loaded');
        return false;
    }

    const idx = data[MEMORIES_KEY]?.findIndex((m) => m.id === id);
    if (idx === -1) {
        logDebug(`Memory ${id} not found`);
        return false;
    }

    data[MEMORIES_KEY].splice(idx, 1);
    await getDeps().saveChatConditional();
    logDebug(`Deleted memory ${id}`);
    return true;
}

/**
 * Delete all OpenVault data for the current chat
 * @returns {Promise<boolean>} True if deleted, false otherwise
 */
export async function deleteCurrentChatData() {
    const context = getDeps().getContext();

    if (!context.chatMetadata) {
        logDebug('No chat metadata found');
        return false;
    }

    delete context.chatMetadata[METADATA_KEY];
    await getDeps().saveChatConditional();
    logDebug('Deleted all chat data');
    return true;
}

/**
 * Check if stored embeddings were generated by a different model.
 * If mismatch detected, wipe all embeddings and update the model tag.
 *
 * @param {Object} data - OpenVault chat data (chatMetadata.openvault)
 * @param {string} currentModelId - Currently selected embedding source
 * @returns {number} Number of embeddings wiped (0 = no mismatch)
 */
export function invalidateStaleEmbeddings(data, currentModelId) {
    if (!data || !currentModelId) return 0;

    const hasAnyEmbedding = _countEmbeddings(data) > 0;

    // No tag yet
    if (!data.embedding_model_id) {
        if (!hasAnyEmbedding) {
            // Brand new chat — just stamp
            data.embedding_model_id = currentModelId;
            return 0;
        }
        // Legacy chat with embeddings but no tag → fall through to wipe
    }

    // Match → no-op
    if (data.embedding_model_id === currentModelId) {
        return 0;
    }

    // MISMATCH — wipe everything
    const oldModel = data.embedding_model_id || 'unknown';
    let count = 0;

    for (const m of data[MEMORIES_KEY] || []) {
        if (hasEmbedding(m)) {
            deleteEmbedding(m);
            count++;
        }
    }

    for (const node of Object.values(data.graph?.nodes || {})) {
        if (hasEmbedding(node)) {
            deleteEmbedding(node);
            count++;
        }
    }

    for (const community of Object.values(data.communities || {})) {
        if (hasEmbedding(community)) {
            deleteEmbedding(community);
            count++;
        }
    }

    // Also clear ST sync flags
    for (const m of data[MEMORIES_KEY] || []) {
        if (isStSynced(m)) {
            clearStSynced(m);
        }
    }
    for (const node of Object.values(data.graph?.nodes || {})) {
        if (isStSynced(node)) {
            clearStSynced(node);
        }
    }
    for (const community of Object.values(data.communities || {})) {
        if (isStSynced(community)) {
            clearStSynced(community);
        }
    }

    data.embedding_model_id = currentModelId;
    logInfo(`Embedding model changed (${oldModel} → ${currentModelId}). Wiped ${count} embeddings.`);
    return count;
}

/**
 * Count total embeddings across memories, graph nodes, and communities.
 * @param {Object} data - OpenVault chat data
 * @returns {number}
 */
function _countEmbeddings(data) {
    let count = 0;
    for (const m of data[MEMORIES_KEY] || []) {
        if (hasEmbedding(m)) count++;
    }
    for (const node of Object.values(data.graph?.nodes || {})) {
        if (hasEmbedding(node)) count++;
    }
    for (const community of Object.values(data.communities || {})) {
        if (hasEmbedding(community)) count++;
    }
    return count;
}

/**
 * Delete embeddings from current chat's memories
 * @returns {Promise<number>} Number of embeddings deleted
 */
export async function deleteCurrentChatEmbeddings() {
    const data = getOpenVaultData();
    if (!data || !data[MEMORIES_KEY]) {
        return 0;
    }

    let count = 0;
    for (const memory of data[MEMORIES_KEY]) {
        if (hasEmbedding(memory)) {
            deleteEmbedding(memory);
            count++;
        }
    }

    if (count > 0) {
        await getDeps().saveChatConditional();
        logDebug(`Deleted ${count} embeddings`);
    }

    return count;
}
