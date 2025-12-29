/**
 * OpenVault Context Formatting
 *
 * Formats memories and relationships for injection into prompts.
 */

import { getContext } from '../../../../../extensions.js';
import { RELATIONSHIPS_KEY } from '../constants.js';
import { sortMemoriesBySequence } from '../utils.js';

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
 * @returns {string} Formatted context string
 */
export function formatContextForInjection(memories, relationships, emotionalInfo, characterName, tokenBudget) {
    // Get current message number for context
    const context = getContext();
    const currentMessageNum = context.chat?.length || 0;

    // Build header lines
    const headerLines = [
        `[${characterName}'s Memory & State]`,
        `(Current message: #${currentMessageNum})`,
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

    const footerLine = `[End ${characterName}'s Memory]`;

    // Calculate overhead tokens (header + footer)
    const overheadTokens = (headerLines.join('\n').length + footerLine.length) / 4;
    const availableForMemories = tokenBudget - overheadTokens;

    // Pre-truncate memories to fit within budget
    let memoriesToFormat = memories || [];
    if (memoriesToFormat.length > 0) {
        const truncatedMemories = [];
        let currentTokens = 0;

        for (const memory of memoriesToFormat) {
            const memoryTokens = (memory.summary?.length || 0) / 4 + 5;
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

        memoryLines.push('Relevant memories (in chronological order, \u2605=minor to \u2605\u2605\u2605\u2605\u2605=critical):');
        sortedMemories.forEach((memory, index) => {
            const prefix = memory.is_secret ? '[Secret] ' : '';
            const msgIds = memory.message_ids || [];
            let msgLabel = '';
            if (msgIds.length === 1) {
                msgLabel = `(msg #${msgIds[0]})`;
            } else if (msgIds.length > 1) {
                const minMsg = Math.min(...msgIds);
                const maxMsg = Math.max(...msgIds);
                msgLabel = `(msgs #${minMsg}-${maxMsg})`;
            }
            const importance = memory.importance || 3;
            const importanceLabel = '\u2605'.repeat(importance);
            memoryLines.push(`${index + 1}. ${msgLabel} [${importanceLabel}] ${prefix}${memory.summary}`);
        });
    }

    // Combine all lines
    return [...headerLines, ...memoryLines, footerLine].join('\n');
}
