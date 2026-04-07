import { MEMORIES_KEY } from '../../constants.js';
import { getFingerprint } from '../../extraction/scheduler.js';

/**
 * Backfill message_fingerprints from message_ids indices.
 * Leaves message_ids intact for backward compatibility.
 * @param {Object} data - OpenVault data (mutated)
 * @param {Array} chat - Chat messages
 * @returns {boolean} True if any memories were backfilled
 */
function migrateMessageFingerprints(data, chat) {
    const memories = data[MEMORIES_KEY];
    if (!memories?.length) return false;

    let changed = false;
    for (const memory of memories) {
        // Already has fingerprints — skip
        if (memory.message_fingerprints) continue;

        const indices = memory.message_ids || [];
        if (indices.length === 0) {
            memory.message_fingerprints = [];
            changed = true;
            continue;
        }

        const fps = [];
        for (const idx of indices) {
            const msg = chat[idx];
            if (msg) {
                fps.push(getFingerprint(msg));
            }
        }

        memory.message_fingerprints = fps;
        changed = true;
    }

    return changed;
}

/**
 * Run full v3 migration.
 * @param {Object} data - OpenVault data (mutated)
 * @param {Array} chat - Chat messages
 * @returns {boolean} True if any changes made
 */
export function migrateToV3(data, chat) {
    return migrateMessageFingerprints(data, chat);
}
