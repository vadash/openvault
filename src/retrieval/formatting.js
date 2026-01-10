/**
 * OpenVault Context Formatting
 *
 * Formats memories and relationships for injection into prompts.
 */

import { RELATIONSHIPS_KEY } from '../constants.js';
import { sortMemoriesBySequence, estimateTokens } from '../utils.js';

/**
 * Get the effective position of a memory in the chat timeline
 * @param {Object} memory - Memory object
 * @returns {number} Position as message number
 */
export function getMemoryPosition(memory) {
    const msgIds = memory.message_ids || [];
    if (msgIds.length > 0) {
        const sum = msgIds.reduce((a, b) => a + b, 0);
        return Math.round(sum / msgIds.length);
    }
    if (memory.sequence) {
        return Math.floor(memory.sequence / 1000);
    }
    return 0;
}

/**
 * Assign memories to temporal buckets based on chat position
 * @param {Object[]} memories - Array of memory objects
 * @param {number} chatLength - Current chat length
 * @returns {Object} Object with old, mid, recent arrays
 */
export function assignMemoriesToBuckets(memories, chatLength) {
    const result = { old: [], mid: [], recent: [] };

    if (!memories || memories.length === 0) {
        return result;
    }

    // Calculate thresholds (Recent: last 20%, Mid: 40-80%, Old: 0-40%)
    const recentThreshold = chatLength * 0.80;
    const midThreshold = chatLength * 0.40;

    for (const memory of memories) {
        const position = getMemoryPosition(memory);

        if (chatLength === 0 || position >= recentThreshold) {
            result.recent.push(memory);
        } else if (position >= midThreshold) {
            result.mid.push(memory);
        } else {
            result.old.push(memory);
        }
    }

    // Sort each bucket chronologically by sequence
    const sortBySequence = (a, b) => (a.sequence || 0) - (b.sequence || 0);
    result.old.sort(sortBySequence);
    result.mid.sort(sortBySequence);
    result.recent.sort(sortBySequence);

    return result;
}

/**
 * Get relationship context for active characters
 * @param {Object} data - OpenVault data
 * @param {string} povCharacter - POV character name
 * @param {string[]} activeCharacters - List of active characters
 * @returns {Object[]} Array of relevant relationships
 */
export function getRelationshipContext(data, povCharacter, activeCharacters) {
    const relationships = data[RELATIONSHIPS_KEY] || {};
    const relevant = [];

    for (const [_key, rel] of Object.entries(relationships)) {
        // Check if this relationship involves POV character and any active character
        const involvesPov = rel.character_a === povCharacter || rel.character_b === povCharacter;
        const involvesActive = activeCharacters.some(c =>
            c !== povCharacter && (rel.character_a === c || rel.character_b === c)
        );

        if (involvesPov && involvesActive) {
            const other = rel.character_a === povCharacter ? rel.character_b : rel.character_a;
            relevant.push({
                character: other,
                trust: rel.trust_level,
                tension: rel.tension_level,
                type: rel.relationship_type,
            });
        }
    }

    // Deduplicate by character name (in case multiple relationship entries exist for same pair)
    const deduped = [];
    const seen = new Set();
    for (const rel of relevant) {
        if (!seen.has(rel.character)) {
            seen.add(rel.character);
            deduped.push(rel);
        }
    }

    return deduped;
}

/**
 * Format context for injection into prompt using timeline buckets
 * @param {Object[]} memories - Selected memories
 * @param {Object[]} relationships - Relevant relationships
 * @param {Object} emotionalInfo - Emotional state info { emotion, fromMessages }
 * @param {string} characterName - Character name for header
 * @param {number} tokenBudget - Maximum token budget
 * @param {number} chatLength - Current chat length for context
 * @returns {string} Formatted context string
 */
export function formatContextForInjection(memories, relationships, emotionalInfo, characterName, tokenBudget, chatLength = 0) {
    const lines = [
        '<scene_memory>',
        `(Current chat has #${chatLength} messages)`,
        ''
    ];

    // Assign memories to buckets
    const buckets = assignMemoriesToBuckets(memories, chatLength);

    // Calculate bucket boundaries for headers
    const midThreshold = Math.floor(chatLength * 0.40);
    const recentThreshold = Math.floor(chatLength * 0.80);

    // Helper to format emotional state
    const formatEmotionalState = () => {
        const emotion = typeof emotionalInfo === 'string' ? emotionalInfo : emotionalInfo?.emotion;
        const fromMessages = typeof emotionalInfo === 'object' ? emotionalInfo?.fromMessages : null;

        if (!emotion || emotion === 'neutral') return null;

        let emotionLine = `Emotional state: ${emotion}`;
        if (fromMessages) {
            const { min, max } = fromMessages;
            emotionLine += min === max
                ? ` (as of msg #${min})`
                : ` (as of msgs #${min}-${max})`;
        }
        return emotionLine;
    };

    // Helper to format relationships
    const formatRelationships = () => {
        if (!relationships || relationships.length === 0) return [];

        const relLines = ['Relationships with present characters:'];
        for (const rel of relationships) {
            const trustDesc = rel.trust >= 7 ? 'high trust' : rel.trust <= 3 ? 'low trust' : 'moderate trust';
            const tensionDesc = rel.tension >= 7 ? 'high tension' : rel.tension >= 4 ? 'some tension' : '';
            relLines.push(`- ${rel.character}: ${rel.type || 'acquaintance'} (${trustDesc}${tensionDesc ? ', ' + tensionDesc : ''})`);
        }
        return relLines;
    };

    // Helper to format a single memory
    const formatMemory = (memory) => {
        const importance = memory.importance || 3;
        const stars = '\u2605'.repeat(importance);
        const prefix = memory.is_secret ? '[Secret] ' : '';
        return `[${stars}] ${prefix}${memory.summary}`;
    };

    // Calculate token overhead for non-empty bucket headers
    const bucketHeaders = {
        old: `[ESTABLISHED HISTORY] (messages 1-${midThreshold})`,
        mid: `[PREVIOUSLY] (messages ${midThreshold}-${recentThreshold})`,
        recent: `[RECENT EVENTS] (messages ${recentThreshold}-${chatLength})`,
    };

    // Determine which buckets will be rendered
    const emotionalLine = formatEmotionalState();
    const relLines = formatRelationships();
    const hasRecentContent = buckets.recent.length > 0 || emotionalLine || relLines.length > 0;

    // Calculate overhead tokens
    let overheadTokens = estimateTokens(lines.join('\n') + '</scene_memory>');
    if (buckets.old.length > 0) overheadTokens += estimateTokens(bucketHeaders.old);
    if (buckets.mid.length > 0) overheadTokens += estimateTokens(bucketHeaders.mid);
    if (hasRecentContent) {
        overheadTokens += estimateTokens(bucketHeaders.recent);
        if (emotionalLine) overheadTokens += estimateTokens(emotionalLine);
        if (relLines.length > 0) overheadTokens += estimateTokens(relLines.join('\n'));
    }

    const availableForMemories = tokenBudget - overheadTokens;

    // Truncate memories to fit budget (across all buckets)
    const allMemories = [...buckets.old, ...buckets.mid, ...buckets.recent];
    let currentTokens = 0;
    const fittingMemoryIds = new Set();

    for (const memory of allMemories) {
        const memoryTokens = estimateTokens(memory.summary || '') + 5;
        if (currentTokens + memoryTokens <= availableForMemories) {
            fittingMemoryIds.add(memory.id);
            currentTokens += memoryTokens;
        } else {
            break;
        }
    }

    // Filter buckets to only include fitting memories
    const filteredBuckets = {
        old: buckets.old.filter(m => fittingMemoryIds.has(m.id)),
        mid: buckets.mid.filter(m => fittingMemoryIds.has(m.id)),
        recent: buckets.recent.filter(m => fittingMemoryIds.has(m.id)),
    };

    // Render OLD bucket
    if (filteredBuckets.old.length > 0) {
        lines.push(bucketHeaders.old);
        for (const memory of filteredBuckets.old) {
            lines.push(formatMemory(memory));
        }
        lines.push('');
    }

    // Render MID bucket
    if (filteredBuckets.mid.length > 0) {
        lines.push(bucketHeaders.mid);
        for (const memory of filteredBuckets.mid) {
            lines.push(formatMemory(memory));
        }
        lines.push('');
    }

    // Render RECENT bucket (always if has content: memories, emotion, or relationships)
    const hasFilteredRecentContent = filteredBuckets.recent.length > 0 || emotionalLine || relLines.length > 0;
    if (hasFilteredRecentContent) {
        lines.push(bucketHeaders.recent);

        // Emotional state first
        if (emotionalLine) {
            lines.push(emotionalLine);
        }

        // Relationships second
        if (relLines.length > 0) {
            lines.push(...relLines);
        }

        // Add blank line before memories if we have context above
        if ((emotionalLine || relLines.length > 0) && filteredBuckets.recent.length > 0) {
            lines.push('');
        }

        // Recent memories
        for (const memory of filteredBuckets.recent) {
            lines.push(formatMemory(memory));
        }
        lines.push('');
    }

    lines.push('</scene_memory>');

    return lines.join('\n');
}
