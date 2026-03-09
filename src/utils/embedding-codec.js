/**
 * OpenVault Embedding Codec
 *
 * Encodes/decodes embedding vectors as Base64 Float32Array strings.
 * Provides accessor functions for lazy migration from legacy number[] format.
 */

/**
 * Encode a number array to a Base64 string via Float32Array.
 * @param {number[]|Float32Array} vec - Embedding vector
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
 * Decode a Base64 string back to a number[].
 * @param {string} b64 - Base64-encoded Float32Array
 * @returns {number[]} Decoded embedding vector
 */
function decode(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return Array.from(new Float32Array(bytes.buffer));
}

/**
 * Read embedding from an object. Prefers Base64 format, falls back to legacy array.
 * @param {Object} obj - Object with embedding_b64 or embedding property
 * @returns {number[]|null} Embedding vector or null
 */
export function getEmbedding(obj) {
    if (!obj) return null;
    if (obj.embedding_b64) return decode(obj.embedding_b64);
    if (obj.embedding && obj.embedding.length > 0) return obj.embedding;
    return null;
}

/**
 * Write embedding to an object in Base64 format. Removes legacy key.
 * @param {Object} obj - Target object (mutated)
 * @param {number[]|Float32Array} vec - Embedding vector
 */
export function setEmbedding(obj, vec) {
    obj.embedding_b64 = encode(vec);
    delete obj.embedding;
}

/**
 * Check if an object has an embedding (either format).
 * @param {Object} obj - Object to check
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
 * @param {Object} obj - Object to clean (mutated)
 */
export function deleteEmbedding(obj) {
    if (!obj) return;
    delete obj.embedding;
    delete obj.embedding_b64;
}
