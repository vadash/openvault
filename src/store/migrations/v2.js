import { MEMORIES_KEY, PROCESSED_MESSAGES_KEY } from '../../constants.js';
import { getFingerprint } from '../../extraction/scheduler.js';
import { createEmptyGraph } from '../../graph/graph.js';
import { _migrateEncodeBase64 } from '../../utils/embedding-codec.js';

/**
 * Parse ST's send_date into ms timestamp.
 * @param {string|number} sendDate
 * @returns {number}
 */
function parseSendDate(sendDate) {
    const val = String(sendDate);
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    return Date.parse(val) || 0;
}

/**
 * Migrate processed_message_ids from indices to fingerprints.
 * @param {Object} data - OpenVault data
 * @param {Array} chat - Chat messages
 * @returns {boolean} True if migrated
 */
function migrateProcessedMessages(data, chat) {
    const processed = data[PROCESSED_MESSAGES_KEY];
    if (!processed?.length || typeof processed[0] !== 'number') return false;

    const fps = new Set();

    // Temporal boundary: messages sent after last extraction are new
    // Use iterative max to avoid stack overflow with large memory arrays (>65k)
    let lastMemoryTime = 0;
    for (const m of data[MEMORIES_KEY] || []) {
        const time = m.created_at || 0;
        if (time > lastMemoryTime) {
            lastMemoryTime = time;
        }
    }

    // Migrate processed_message_ids indices
    for (const idx of processed) {
        const msg = chat[idx];
        if (!msg) continue;
        if (lastMemoryTime > 0 && msg.send_date) {
            const sendTime = parseSendDate(msg.send_date);
            if (sendTime && sendTime > lastMemoryTime) continue;
        }
        fps.add(getFingerprint(msg));
    }

    // Migrate memory.message_ids as safety net
    for (const memory of data[MEMORIES_KEY] || []) {
        for (const idx of memory.message_ids || []) {
            const msg = chat[idx];
            if (!msg) continue;
            if (lastMemoryTime > 0 && msg.send_date) {
                const sendTime = parseSendDate(msg.send_date);
                if (sendTime && sendTime > lastMemoryTime) continue;
            }
            fps.add(getFingerprint(msg));
        }
    }

    data[PROCESSED_MESSAGES_KEY] = Array.from(fps);
    delete data.last_processed_message_id;
    return true;
}

/**
 * Convert embedding arrays to Base64 strings.
 * @param {Object} data - OpenVault data
 * @returns {boolean} True if any conversion happened
 */
function migrateEmbeddings(data) {
    let converted = false;

    // Memories
    for (const mem of data[MEMORIES_KEY] || []) {
        if (mem.embedding && Array.isArray(mem.embedding)) {
            mem.embedding_b64 = _migrateEncodeBase64(mem.embedding);
            delete mem.embedding;
            converted = true;
        }
    }

    // Graph nodes
    for (const node of data.graph?.nodes || []) {
        if (node.embedding && Array.isArray(node.embedding)) {
            node.embedding_b64 = _migrateEncodeBase64(node.embedding);
            delete node.embedding;
            converted = true;
        }
    }

    // Communities (summaries may have embeddings)
    for (const key of Object.keys(data.communities || {})) {
        const comm = data.communities[key];
        if (comm?.summary_embedding && Array.isArray(comm.summary_embedding)) {
            comm.summary_embedding_b64 = _migrateEncodeBase64(comm.summary_embedding);
            delete comm.summary_embedding;
            converted = true;
        }
    }

    return converted;
}

/**
 * Ensure graph state exists (legacy backfill).
 * @param {Object} data - OpenVault data
 */
function initGraphState(data) {
    if (!data.graph) data.graph = createEmptyGraph();
    if (!data.communities) data.communities = {};
    if (data.graph_message_count == null) data.graph_message_count = 0;
    if (!data.reflection_state) data.reflection_state = {};
}

/**
 * Run full v2 migration.
 * @param {Object} data - OpenVault data (mutated)
 * @param {Array} chat - Chat messages
 * @returns {boolean} True if any changes made
 */
export function migrateToV2(data, chat) {
    let changed = false;

    // 1. Migrate processed_message_ids
    if (migrateProcessedMessages(data, chat)) {
        changed = true;
    }

    // 2. Convert embeddings
    if (migrateEmbeddings(data)) {
        changed = true;
    }

    // 3. Initialize graph state
    initGraphState(data);

    return changed;
}
