/**
 * OpenVault Query Context Extraction
 *
 * Extracts entities and themes from recent chat context for enriched retrieval queries.
 * Uses graph-anchored stem matching to detect known entities.
 */

import { extensionName, QUERY_CONTEXT_DEFAULTS } from '../constants.js';
import { getDeps } from '../deps.js';
import { getOptimalChunkSize } from '../embeddings.js';
import { stemName, stemWord } from '../utils/stemmer.js';
import { tokenize } from './math.js';

/**
 * Get settings for query context extraction
 * @returns {Object} Settings object
 */
function getQueryContextSettings() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    return {
        entityWindowSize: settings?.entityWindowSize ?? QUERY_CONTEXT_DEFAULTS.entityWindowSize,
        embeddingWindowSize: settings?.embeddingWindowSize ?? QUERY_CONTEXT_DEFAULTS.embeddingWindowSize,
        recencyDecayFactor: settings?.recencyDecayFactor ?? QUERY_CONTEXT_DEFAULTS.recencyDecayFactor,
        topEntitiesCount: settings?.topEntitiesCount ?? QUERY_CONTEXT_DEFAULTS.topEntitiesCount,
        entityBoostWeight: settings?.entityBoostWeight ?? QUERY_CONTEXT_DEFAULTS.entityBoostWeight,
    };
}

/**
 * Extract entities from recent messages using graph-anchored stem matching
 * @param {Array<{mes: string}>} messages - Recent messages (newest first)
 * @param {string[]} [activeCharacters=[]] - Known character names (highest priority)
 * @param {Object} [graphNodes={}] - Graph nodes keyed by normalized name
 * @returns {{entities: string[], weights: Object<string, number>}}
 */
export function extractQueryContext(messages, activeCharacters = [], graphNodes = {}) {
    if (!messages || messages.length === 0) {
        return { entities: [], weights: {} };
    }

    const settings = getQueryContextSettings();

    // Build stem → display name map from graph nodes + aliases + characters
    const stemToEntity = new Map();
    for (const [, node] of Object.entries(graphNodes)) {
        for (const stem of stemName(node.name)) {
            stemToEntity.set(stem, node.name);
        }
        for (const alias of node.aliases || []) {
            for (const stem of stemName(alias)) {
                stemToEntity.set(stem, node.name);
            }
        }
    }
    for (const char of activeCharacters) {
        for (const stem of stemName(char)) {
            stemToEntity.set(stem, char);
        }
    }

    const entityScores = new Map();
    const entityMessageCounts = new Map();
    const messagesToScan = messages.slice(0, settings.entityWindowSize);

    messagesToScan.forEach((msg, index) => {
        const recencyWeight = 1 - index * settings.recencyDecayFactor;
        const text = msg.mes || msg.message || '';

        // Stem message words (no stopword filter — entity names could be stopwords)
        const words = (text.toLowerCase().match(/[\p{L}0-9]+/gu) || [])
            .filter((w) => w.length > 2)
            .map(stemWord)
            .filter((w) => w.length > 2);

        const matchedInMsg = new Set();
        for (const word of words) {
            const entity = stemToEntity.get(word);
            if (entity) matchedInMsg.add(entity);
        }

        for (const entity of matchedInMsg) {
            entityMessageCounts.set(entity, (entityMessageCounts.get(entity) || 0) + 1);
            const current = entityScores.get(entity) || { count: 0, weightSum: 0 };
            current.count++;
            current.weightSum += recencyWeight;
            entityScores.set(entity, current);
        }
    });

    // Boost active characters
    for (const charName of activeCharacters) {
        if (charName && charName.length >= 2) {
            const current = entityScores.get(charName) || { count: 0, weightSum: 0 };
            current.weightSum += 3.0;
            entityScores.set(charName, current);
        }
    }

    // Filter entities appearing in >50% of messages
    const threshold = messagesToScan.length * 0.5;
    for (const [entity, count] of entityMessageCounts.entries()) {
        if (count > threshold) {
            entityScores.delete(entity);
        }
    }

    // Sort by weight sum and take top N
    const sorted = Array.from(entityScores.entries())
        .sort((a, b) => b[1].weightSum - a[1].weightSum)
        .slice(0, settings.topEntitiesCount);

    const entities = sorted.map(([entity]) => entity);
    const weights = Object.fromEntries(sorted.map(([entity, data]) => [entity, data.weightSum]));
    return { entities, weights };
}

/**
 * Build enriched query text for embedding
 * @param {Array<{mes: string}>} messages - Recent messages (newest first)
 * @param {{entities: string[], weights: Object}} extractedEntities - Extracted entity context
 * @returns {string} Query text for embedding
 */
export function buildEmbeddingQuery(messages, extractedEntities) {
    if (!messages || messages.length === 0) {
        return '';
    }

    const settings = getQueryContextSettings();
    const recent = messages.slice(0, settings.embeddingWindowSize);

    // Take recent messages without repetition (Gemma supports 512 tokens, ~1800 chars for Cyrillic)
    const weighted = [];
    for (const msg of recent) {
        if (msg?.mes) weighted.push(msg.mes);
    }

    const weightedText = weighted.filter(Boolean).join(' ');

    // Append top entities (adds semantic anchors)
    const topEntities = (extractedEntities?.entities || []).slice(0, 5).join(' ');

    // Cap at strategy's optimal chunk size
    const chunkSize = getOptimalChunkSize();
    return (weightedText + ' ' + topEntities).slice(0, chunkSize);
}

/**
 * Build enriched token array for BM25 scoring
 * @param {string} userMessage - Original user message
 * @param {{entities: string[], weights: Object}} extractedEntities - Extracted entity context
 * @returns {string[]} Token array with boosted entities
 */
export function buildBM25Tokens(userMessage, extractedEntities) {
    // Start with original user message tokens
    const tokens = tokenize(userMessage || '');

    if (!extractedEntities || !extractedEntities.entities) {
        return tokens;
    }

    const settings = getQueryContextSettings();

    // Add entities with boost (repeat = higher term frequency)
    // Entities go through tokenize() for consistent stemming with memory tokens
    for (const entity of extractedEntities.entities) {
        const weight = (extractedEntities.weights[entity] || 1) * settings.entityBoostWeight;
        const repeats = Math.ceil(weight);
        const stemmed = tokenize(entity);
        for (let r = 0; r < repeats; r++) {
            tokens.push(...stemmed);
        }
    }

    return tokens;
}

/**
 * Parse recent messages from context string
 * @param {string} recentContext - Recent chat context (newline-separated)
 * @param {number} count - Maximum messages to parse
 * @returns {Array<{mes: string}>} Parsed messages array (newest first)
 */
export function parseRecentMessages(recentContext, count = 10) {
    if (!recentContext) return [];

    // Split by newlines and filter empty
    const lines = recentContext.split('\n').filter((line) => line.trim());

    // Take last N messages, then reverse so newest is first
    const recent = lines.slice(-count).reverse();

    return recent.map((line) => ({ mes: line }));
}
