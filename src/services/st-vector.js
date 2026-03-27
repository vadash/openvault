// @ts-check
import { EMBEDDING_SOURCES, ST_API_ENDPOINTS } from '../constants.js';
import { getDeps } from '../deps.js';
import { showToast } from '../utils/dom.js';
import { logError, logWarn } from '../utils/logging.js';

/** @typedef {import('../types.d.ts').StVectorItem} StVectorItem */
/** @typedef {import('../types.d.ts').StVectorQueryResult} StVectorQueryResult */

// Cache of validated chats for this session (module-level state)
const validatedChats = new Set();

/**
 * Clear the validated chats cache. Used for testing.
 * @returns {void}
 */
export function _clearValidatedChatsCache() {
    validatedChats.clear();
}

/**
 * Check if a chat still exists in ST
 * @param {string} chatId
 * @returns {Promise<boolean>}
 */
async function chatExists(chatId) {
    try {
        const { getContext, getRequestHeaders } = getDeps();
        const context = getContext();

        // Get character ID for individual chats
        const characterId = context.characterId;
        if (characterId !== undefined) {
            const response = await getDeps().fetch('/api/characters/chats', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ character_id: characterId }),
            });
            if (!response.ok) {
                logWarn('Failed to fetch character chats list', { status: response.status });
                return true; // Fail-safe: assume exists on error
            }
            const chats = await response.json();
            return chats.some((chat) => chat.file_name.replace('.jsonl', '') === chatId);
        }

        // For group chats - check group data
        const groupId = context.groupId;
        if (groupId) {
            const response = await getDeps().fetch('/api/groups/get', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ id: groupId }),
            });
            if (!response.ok) {
                logWarn('Failed to fetch group data', { status: response.status });
                return true; // Fail-safe: assume exists on error
            }
            const group = await response.json();
            return group?.chats?.includes(chatId);
        }

        // Neither character nor group context - assume exists
        return true;
    } catch (err) {
        logWarn('Failed to validate chat existence', err);
        return true; // Assume exists on error to avoid false cleanup
    }
}

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
export function getSTVectorSource() {
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
export function getSTVectorRequestBody(source) {
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
    return settings?.embeddingSource === EMBEDDING_SOURCES.ST_VECTOR;
}

/**
 * Sync items to ST Vector Storage via /api/vector/insert.
 * @param {StVectorItem[]} items - Items to insert
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

        const response = await getDeps().fetch(ST_API_ENDPOINTS.INSERT, {
            method: 'POST',
            headers: getDeps().getRequestHeaders(),
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

        const response = await getDeps().fetch(ST_API_ENDPOINTS.DELETE, {
            method: 'POST',
            headers: getDeps().getRequestHeaders(),
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
        const response = await getDeps().fetch(ST_API_ENDPOINTS.PURGE, {
            method: 'POST',
            headers: getDeps().getRequestHeaders(),
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
 * @returns {Promise<StVectorQueryResult[]>} Results with extracted OV IDs
 */
export async function querySTVector(searchText, topK, threshold, chatId) {
    // Check for orphans (with session cache)
    if (!validatedChats.has(chatId)) {
        const exists = await chatExists(chatId);
        if (!exists) {
            logWarn(`Detected orphaned ST collection for deleted chat: ${chatId}`);
            await purgeSTCollection(chatId);
            showToast('info', 'Cleaned up orphaned vector storage for deleted chat');
            return [];
        }
        validatedChats.add(chatId);
    }

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

        const response = await getDeps().fetch(ST_API_ENDPOINTS.QUERY, {
            method: 'POST',
            headers: getDeps().getRequestHeaders(),
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
