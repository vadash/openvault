/**
 * OpenVault Context Formatting
 *
 * Formats memories and relationships for injection into prompts.
 */

import { RELATIONSHIPS_KEY } from '../constants.js';
import { sortMemoriesBySequence, estimateTokens } from '../utils.js';

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
 * Format context for injection into prompt
 * @param {Object[]} memories - Selected memories
 * @param {Object[]} relationships - Relevant relationships
 * @param {Object} emotionalInfo - Emotional state info { emotion, fromMessages }
 * @param {string} characterName - Character name for header
 * @param {number} tokenBudget - Maximum token budget
 * @param {number} chatLength - Current chat length for context
 * @returns {string} Formatted context string
 */
export function formatContextForInjection(memories, relationships, emotionalInfo, characterName, tokenBudget, chatLength = 0) {
    // Get current message number for context
    const currentMessageNum = chatLength;

    // Build header lines
    const headerLines = [
        '<scene_memory>',
        `(Current chat has #${currentMessageNum} messages)`,
        ''
    ];

    // Emotional state - handle both old string format and new object format
    const emotion = typeof emotionalInfo === 'string' ? emotionalInfo : emotionalInfo?.emotion;
    const fromMessages = typeof emotionalInfo === 'object' ? emotionalInfo?.fromMessages : null;

    if (emotion && emotion !== 'neutral') {
        let emotionLine = `Emotional state: ${emotion}`;
        if (fromMessages) {
            const { min, max } = fromMessages;
            emotionLine += min === max
                ? ` (as of msg #${min})`
                : ` (as of msgs #${min}-${max})`;
        }
        headerLines.push(emotionLine);
        headerLines.push('');
    }

    // Relationships
    if (relationships && relationships.length > 0) {
        headerLines.push('Relationships with present characters:');
        for (const rel of relationships) {
            const trustDesc = rel.trust >= 7 ? 'high trust' : rel.trust <= 3 ? 'low trust' : 'moderate trust';
            const tensionDesc = rel.tension >= 7 ? 'high tension' : rel.tension >= 4 ? 'some tension' : '';
            headerLines.push(`- ${rel.character}: ${rel.type || 'acquaintance'} (${trustDesc}${tensionDesc ? ', ' + tensionDesc : ''})`);
        }
        headerLines.push('');
    }

    const footerLine = '</scene_memory>';

    // Calculate overhead tokens (header + footer)
    const overheadTokens = estimateTokens(headerLines.join('\n') + footerLine);
    const availableForMemories = tokenBudget - overheadTokens;

    // Pre-truncate memories to fit within budget
    let memoriesToFormat = memories || [];
    if (memoriesToFormat.length > 0) {
        const truncatedMemories = [];
        let currentTokens = 0;

        for (const memory of memoriesToFormat) {
            const memoryTokens = estimateTokens(memory.summary || '') + 5; // +5 for formatting overhead
            if (currentTokens + memoryTokens <= availableForMemories) {
                truncatedMemories.push(memory);
                currentTokens += memoryTokens;
            } else {
                break;
            }
        }
        memoriesToFormat = truncatedMemories;
    }

    // Build memory lines
    const memoryLines = [];
    if (memoriesToFormat.length > 0) {
        const sortedMemories = sortMemoriesBySequence(memoriesToFormat, true);

        memoryLines.push('Relevant memories (in chronological order, # show position in chat when it happened, \u2605=minor to \u2605\u2605\u2605\u2605\u2605=critical):');
        sortedMemories.forEach((memory) => {
            const prefix = memory.is_secret ? '[Secret] ' : '';
            const msgIds = memory.message_ids || [];
            let msgLabel = '';
            if (msgIds.length === 1) {
                msgLabel = `#${msgIds[0]}`;
            } else if (msgIds.length > 1) {
                const minMsg = Math.min(...msgIds);
                msgLabel = `#${minMsg}`;
            }
            const importance = memory.importance || 3;
            const importanceLabel = '\u2605'.repeat(importance);
            memoryLines.push(`${msgLabel} [${importanceLabel}] ${prefix}${memory.summary}`);
        });
    }

    // Combine all lines
    return [...headerLines, ...memoryLines, footerLine].join('\n');
}
