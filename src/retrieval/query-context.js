/**
 * OpenVault Query Context Extraction
 *
 * Extracts entities and themes from recent chat context for enriched retrieval queries.
 * Uses graph-anchored stem matching to detect known entities.
 */

import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { getOptimalChunkSize } from '../embeddings.js';
import { stemName, stemWord } from '../utils/stemmer.js';
import { tokenize } from './math.js';

// Three-tier BM25 token weights (multipliers of entityBoostWeight)
const CORPUS_GROUNDED_BOOST_RATIO = 0.6; // Layer 2: 60% of entity boost (3x when entityBoostWeight=5)
const NON_GROUNDED_BOOST_RATIO = 0.4; // Layer 3: 40% of entity boost (2x when entityBoostWeight=5)

/**
 * Get settings for query context extraction
 * @returns {Object} Settings object
 */
function getQueryContextSettings() {
    const settings = getDeps().getExtensionSettings()[extensionName];
    return {
        entityWindowSize: settings.entityWindowSize,
        embeddingWindowSize: settings.embeddingWindowSize,
        recencyDecayFactor: settings.recencyDecayFactor,
        topEntitiesCount: settings.topEntitiesCount,
        entityBoostWeight: settings.entityBoostWeight,
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
 * Build enriched token array for BM25 scoring.
 * Four-tier token approach:
 * - Layer 0: Multi-word entity exact phrases (un-tokenized, added once, boost applied in scoring)
 * - Layer 1: Single-word entity stems with full boost (5x)
 * - Layer 2: Corpus-grounded message stems at 60% boost (3x)
 * - Layer 3: Non-grounded message stems at 40% boost (2x)
 *
 * @param {string} userMessage - Original user message
 * @param {{entities: string[], weights: Object}} extractedEntities - Extracted entity context
 * @param {Set<string>|null} [corpusVocab=null] - Corpus vocabulary for grounding.
 *   When provided, user-message tokens are split into grounded/non-grounded tiers.
 *   When null, falls back to including all user-message tokens at 1x (backward compat).
 * @param {Object} [meta=null] - Optional metadata object to populate with layer counts
 * @returns {string[]} Token array with boosted entities and message stems
 */
export function buildBM25Tokens(userMessage, extractedEntities, corpusVocab = null, meta = null) {
    const tokens = [];
    const settings = getQueryContextSettings();

    // Layer 0: Multi-word entities (exact phrases, un-tokenized, added ONCE)
    // Layer 1: Single-word entities (stems, with 5x boost)
    let layer0Count = 0,
        layer1Count = 0;

    if (extractedEntities?.entities) {
        for (const entity of extractedEntities.entities) {
            const weight = extractedEntities.weights[entity] || 1;

            // Check if entity is multi-word (contains space after trimming)
            const isMultiWord = entity.trim().includes(' ');

            if (isMultiWord) {
                // Layer 0: Exact phrase token (un-tokenized, added ONCE)
                // Boost will be applied in BM25 scoring via hasExactPhrase check
                tokens.push(entity);
                layer0Count += 1;
            } else {
                // Layer 1: Single-word entity stems (existing behavior, 5x boost)
                const stemBoost = Math.ceil(weight * settings.entityBoostWeight);
                const stemmed = tokenize(entity);
                for (let r = 0; r < stemBoost; r++) {
                    tokens.push(...stemmed);
                }
                layer1Count += stemmed.length * stemBoost;
            }
        }
    }

    const entityStemCount = layer1Count; // Count of Layer 1 stems (Layer 0 counted separately)
    let groundedCount = 0,
        nonGroundedCount = 0;

    // Three-tier message token processing
    if (corpusVocab && corpusVocab.size > 0) {
        const msgStems = tokenize(userMessage || '');
        const grounded = msgStems.filter((t) => corpusVocab.has(t));
        const nonGrounded = msgStems.filter((t) => !corpusVocab.has(t));

        // DEBUG: Log corpus grounding behavior
        if (msgStems.length > 0) {
            console.log('[BM25-DEBUG] Three-tier BM25:', {
                msgStems: msgStems.slice(0, 20),
                groundedCount: grounded.length,
                nonGroundedCount: nonGrounded.length,
                sampleGrounded: grounded.slice(0, 10),
                sampleNonGrounded: nonGrounded.slice(0, 10),
                vocabSize: corpusVocab.size,
                weights: {
                    layer1: `${settings.entityBoostWeight}x (entities)`,
                    layer2: `${Math.ceil(settings.entityBoostWeight * CORPUS_GROUNDED_BOOST_RATIO)}x (grounded)`,
                    layer3: `${Math.ceil(settings.entityBoostWeight * NON_GROUNDED_BOOST_RATIO)}x (non-grounded)`,
                },
            });
        }

        // Layer 2: Corpus-grounded tokens (60% boost = 3x when entityBoostWeight=5)
        const uniqueGrounded = [...new Set(grounded)];
        const groundedBoost = Math.ceil(settings.entityBoostWeight * CORPUS_GROUNDED_BOOST_RATIO);
        for (const t of uniqueGrounded) {
            for (let r = 0; r < groundedBoost; r++) {
                tokens.push(t);
            }
        }

        // Layer 3: Non-grounded tokens (40% boost = 2x when entityBoostWeight=5)
        const uniqueNonGrounded = [...new Set(nonGrounded)];
        const nonGroundedBoost = Math.ceil(settings.entityBoostWeight * NON_GROUNDED_BOOST_RATIO);
        for (const t of uniqueNonGrounded) {
            for (let r = 0; r < nonGroundedBoost; r++) {
                tokens.push(t);
            }
        }

        groundedCount = uniqueGrounded.length * groundedBoost;
        nonGroundedCount = uniqueNonGrounded.length * nonGroundedBoost;
    } else if (!corpusVocab) {
        // Backward compat: no corpus vocab → include all message tokens at 1x
        tokens.push(...tokenize(userMessage || ''));
    }

    if (meta) {
        meta.entityStems = entityStemCount;
        meta.layer0Count = layer0Count;
        meta.layer1Count = layer1Count;
        meta.grounded = corpusVocab && corpusVocab.size > 0 ? groundedCount : 0;
        meta.nonGrounded = corpusVocab && corpusVocab.size > 0 ? nonGroundedCount : 0;
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

/**
 * Build vocabulary Set from memory tokens and graph descriptions.
 * Used to filter user-message stems to only corpus-relevant ones.
 * @param {Object[]} memories - Candidate memories (with m.tokens)
 * @param {Object[]} hiddenMemories - Hidden memories (with m.tokens)
 * @param {Object} graphNodes - Graph nodes keyed by normalized name
 * @param {Object} graphEdges - Graph edges keyed by "src__tgt"
 * @returns {Set<string>} Set of all stems present in the corpus
 */
export function buildCorpusVocab(memories, hiddenMemories, graphNodes, graphEdges) {
    const vocab = new Set();

    // Memory tokens (pre-computed at extraction time)
    for (const m of memories) {
        if (m.tokens) for (const t of m.tokens) vocab.add(t);
    }
    for (const m of hiddenMemories) {
        if (m.tokens) for (const t of m.tokens) vocab.add(t);
    }

    // Graph node descriptions
    for (const node of Object.values(graphNodes || {})) {
        if (node.description) {
            for (const t of tokenize(node.description)) vocab.add(t);
        }
    }

    // Graph edge descriptions
    for (const edge of Object.values(graphEdges || {})) {
        if (edge.description) {
            for (const t of tokenize(edge.description)) vocab.add(t);
        }
    }

    return vocab;
}
