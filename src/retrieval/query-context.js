/**
 * OpenVault Query Context Extraction
 *
 * Extracts entities and themes from recent chat context for enriched retrieval queries.
 * Supports both Latin and Cyrillic text. Uses rule-based extraction (no ML model).
 */

import { getDeps } from '../deps.js';
import { extensionName, QUERY_CONTEXT_DEFAULTS } from '../constants.js';
import { getOptimalChunkSize } from '../embeddings/strategies.js';
import { tokenize } from './math.js';

// Common sentence starters to exclude (Latin)
const LATIN_STARTERS = new Set([
    'The', 'This', 'That', 'Then', 'There', 'These', 'Those',
    'When', 'Where', 'What', 'Which', 'While', 'Who', 'Why',
    'How', 'Here', 'Now', 'Just', 'But', 'And', 'Yet', 'Still',
    'Also', 'Only', 'Even', 'Well', 'Much', 'Very', 'Some'
]);

// Common sentence starters to exclude (Cyrillic/Russian)
const CYRILLIC_STARTERS = new Set([
    'После', 'Когда', 'Потом', 'Затем', 'Тогда', 'Здесь', 'Там',
    'Это', 'Эта', 'Этот', 'Эти', 'Что', 'Как', 'Где', 'Куда',
    'Почему', 'Зачем', 'Кто', 'Чей', 'Какой', 'Какая', 'Какое',
    'Пока', 'Если', 'Хотя', 'Также', 'Ещё', 'Уже', 'Вот', 'Вон'
]);

/**
 * Extract entities from a single text
 * @param {string} text - Text to extract entities from
 * @returns {string[]} Array of extracted entities
 */
function extractFromText(text) {
    if (!text) return [];

    const entities = [];

    // Capitalized words - Latin alphabet (3+ chars)
    const latinMatches = text.match(/\b[A-Z][a-z]{2,}\b/g) || [];
    for (const match of latinMatches) {
        if (!LATIN_STARTERS.has(match)) {
            entities.push(match);
        }
    }

    // Capitalized words - Cyrillic alphabet (3+ chars)
    // Note: \b doesn't work with Cyrillic, so use lookahead/lookbehind or split approach
    const cyrillicMatches = text.match(/(?:^|[^а-яёА-ЯЁ])([А-ЯЁ][а-яё]{2,})(?=[^а-яёА-ЯЁ]|$)/g) || [];
    for (const match of cyrillicMatches) {
        // Clean up the match (remove leading non-Cyrillic char)
        const cleaned = match.replace(/^[^А-ЯЁ]+/, '');
        if (cleaned && !CYRILLIC_STARTERS.has(cleaned)) {
            entities.push(cleaned);
        }
    }

    // Quoted speech (captures emphasis) - both Latin and Cyrillic quotes
    const latinQuotes = text.match(/"([^"]+)"/g) || [];
    const cyrillicQuotes = text.match(/«([^»]+)»/g) || [];
    const allQuotes = [...latinQuotes, ...cyrillicQuotes];
    for (const quote of allQuotes) {
        // Extract just the content without quotes
        const content = quote.replace(/["«»]/g, '').trim();
        if (content.length >= 3 && content.length <= 50) {
            entities.push(content);
        }
    }

    return entities;
}

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
 * Extract entities from recent messages with recency weighting
 * @param {Array<{mes: string}>} messages - Recent messages (newest first)
 * @param {string[]} [activeCharacters=[]] - Known character names (highest priority)
 * @returns {{entities: string[], weights: Object<string, number>}}
 */
export function extractQueryContext(messages, activeCharacters = []) {
    if (!messages || messages.length === 0) {
        return { entities: [], weights: {} };
    }

    const settings = getQueryContextSettings();
    const entityScores = new Map();
    const messagesToScan = messages.slice(0, settings.entityWindowSize);

    // Track entity frequency across all messages for filtering
    const entityMessageCounts = new Map();

    // Process each message
    messagesToScan.forEach((msg, index) => {
        const recencyWeight = 1 - (index * settings.recencyDecayFactor);
        const text = msg.mes || msg.message || '';
        const entities = extractFromText(text);

        // Count which messages each entity appears in
        const uniqueEntitiesInMsg = new Set(entities);
        for (const entity of uniqueEntitiesInMsg) {
            entityMessageCounts.set(entity, (entityMessageCounts.get(entity) || 0) + 1);
        }

        // Accumulate weighted scores
        for (const entity of entities) {
            const current = entityScores.get(entity) || { count: 0, weightSum: 0 };
            current.count++;
            current.weightSum += recencyWeight;
            entityScores.set(entity, current);
        }
    });

    // Add known character names with high priority
    const charNamesSet = new Set(activeCharacters.map(c => c.toLowerCase()));
    for (const charName of activeCharacters) {
        if (charName && charName.length >= 2) {
            const current = entityScores.get(charName) || { count: 0, weightSum: 0 };
            current.weightSum += 3.0; // High boost for known characters
            entityScores.set(charName, current);
        }
    }

    // Filter out entities appearing in >50% of messages (too common)
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

    // Weight by recency (repeat more recent content)
    const weighted = [];
    if (recent[0]?.mes) {
        weighted.push(recent[0].mes); // 2x weight - repeat newest
        weighted.push(recent[0].mes);
    }
    if (recent[1]?.mes) {
        weighted.push(recent[1].mes); // 1.5x weight
        weighted.push(recent[1].mes.slice(0, Math.floor(recent[1].mes.length / 2)));
    }
    if (recent[2]?.mes) weighted.push(recent[2].mes);
    if (recent[3]?.mes) weighted.push(recent[3].mes);
    if (recent[4]?.mes) weighted.push(recent[4].mes);

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
    for (const entity of extractedEntities.entities) {
        const weight = (extractedEntities.weights[entity] || 1) * settings.entityBoostWeight;
        const repeats = Math.ceil(weight);
        for (let r = 0; r < repeats; r++) {
            tokens.push(entity.toLowerCase());
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
    const lines = recentContext.split('\n').filter(line => line.trim());

    // Take last N messages, then reverse so newest is first
    const recent = lines.slice(-count).reverse();

    return recent.map(line => ({ mes: line }));
}
