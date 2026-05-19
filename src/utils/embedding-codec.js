// @ts-check

// OpenVault Embedding Codec
// Encodes/decodes embedding vectors as Base64 Float32Array strings.
// Provides accessor functions for lazy migration from legacy number[] format.

/**
 * cyrb53 (a.k.a. splitmix64) - Simple fast 64-bit hash function
 * Used for content hashing when timestamps aren't available
 * @param {string} str - String to hash
 * @param {number} [seed=0] - Optional seed value
 * @returns {number} 53-bit hash integer
 */
export function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Encode a number array to a Base64 string via Float32Array.
 * @param {number[] | Float32Array} vec - Embedding vector
 * @returns {string} Base64-encoded string
 */
function encode(vec) {
    const f32 = vec instanceof Float32Array ? vec : new Float32Array(vec);
    const bytes = new Uint8Array(f32.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Decode a Base64 string back to a Float32Array.
 * @param {string} b64 - Base64-encoded Float32Array
 * @returns {Float32Array} Decoded embedding vector
 */
function decode(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Float32Array(bytes.buffer);
}

/**
 * Read embedding from an object. Prefers Base64 format, falls back to legacy array.
 * @param {Record<string, any>} obj - Object with embedding_b64 or embedding property
 * @returns {Float32Array | null} Embedding vector or null
 */
export function getEmbedding(obj) {
    if (!obj) return null;
    if (obj.embedding_b64) return decode(obj.embedding_b64);
    // Legacy fallback: only needed during transition from v1 to v2
    // After all chats are migrated, this branch can be removed
    if (obj.embedding && obj.embedding.length > 0) return new Float32Array(obj.embedding);
    return null;
}

/**
 * Write embedding to an object in Base64 format. Removes legacy key.
 * @param {Record<string, any>} obj - Target object (mutated)
 * @param {number[] | Float32Array} vec - Embedding vector
 * @returns {void}
 */
export function setEmbedding(obj, vec) {
    obj.embedding_b64 = encode(vec);
    delete obj.embedding;
}

/**
 * Check if an object has an embedding (either format).
 * @param {Record<string, any>} obj - Object to check
 * @returns {boolean}
 */
export function hasEmbedding(obj) {
    if (!obj) return false;
    if (obj.embedding_b64) return true;
    if (obj.embedding && obj.embedding.length > 0) return true;
    return false;
}

/**
 * Remove embedding from an object (both formats).
 * @param {Record<string, any>} obj - Object to clean (mutated)
 * @returns {void}
 */
export function deleteEmbedding(obj) {
    if (!obj) return;
    delete obj.embedding;
    delete obj.embedding_b64;
}

/**
 * Export encode as _migrateEncodeBase64 for migrations only.
 * The underscore prefix signals it's NOT part of the standard codec API.
 * Use setEmbedding() for normal operations — this is only for v1->v2 migration.
 * @param {number[] | Float32Array} vec - Embedding vector
 * @returns {string} Base64-encoded string
 */
export {
    /** @param {number[] | Float32Array} vec */
    encode as _migrateEncodeBase64,
};
