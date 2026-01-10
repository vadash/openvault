/**
 * OpenVault Context Formatting
 *
 * Formats memories and character presence for injection into prompts.
 */

import { estimateTokens } from '../utils.js';

// Narrative engine constants
export const CURRENT_SCENE_SIZE = 100;   // "Current Scene" = last 100 messages
export const LEADING_UP_SIZE = 500;     // "Leading Up" = messages 101-500 ago

// Gap thresholds (for separators in "Story So Far")
const GAP_SMALL = 15;    // No separator
const GAP_MEDIUM = 100;  // "..."
const GAP_LARGE = 500;   // "...Later..." / "...Much later..."

// Causality thresholds
const IMMEDIATE_GAP = 5;  // "⤷ IMMEDIATELY AFTER"
const CLOSE_GAP = 15;     // "⤷ Shortly after"

// Annotation threshold
const EMOTIONAL_IMPORTANCE_MIN = 4;

/**
 * Get gap separator text based on message distance
 * @param {number} gap - Number of messages between memories
 * @returns {string|null} Separator text or null if no separator needed
 */
function getGapSeparator(gap) {
    if (gap >= GAP_LARGE) {
        return '...Much later...';
    } else if (gap >= GAP_MEDIUM) {
        return '...Later...';
    } else if (gap >= GAP_SMALL) {
        return '...';
    }
    return null;
}

/**
 * Get causality hint text based on message distance
 * @param {number} gap - Number of messages between memories
 * @returns {string|null} Causality hint or null if gap too large
 */
function getCausalityHint(gap) {
    if (gap < IMMEDIATE_GAP) {
        return '    ⤷ IMMEDIATELY AFTER';
    } else if (gap < CLOSE_GAP) {
        return '    ⤷ Shortly after';
    }
    return null;
}

/**
 * Get emotional annotation for high-importance memories
 * @param {Object} memory - Memory object
 * @returns {string|null} Emotional annotation or null
 */
function getEmotionalAnnotation(memory) {
    if (memory.importance < EMOTIONAL_IMPORTANCE_MIN || !memory.emotional_impact) {
        return null;
    }

    const impact = memory.emotional_impact;

    // Handle object format: {"CharacterName": "emotion"}
    if (typeof impact === 'object' && !Array.isArray(impact)) {
        const entries = Object.entries(impact);
        if (entries.length === 0) {
            return null;
        }
        const formatted = entries.map(([char, emotion]) => `${char} feels ${emotion}`).join(', ');
        return `    💔 Emotional: ${formatted}`;
    }

    // Handle array or string format (legacy)
    const emotions = Array.isArray(impact) ? impact : [impact];
    if (emotions.length === 0) {
        return null;
    }
    return `    💔 Emotional: ${emotions.join(', ')}`;
}

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

    // Fixed window thresholds
    const recentThreshold = Math.max(0, chatLength - CURRENT_SCENE_SIZE);
    const midThreshold = Math.max(0, chatLength - LEADING_UP_SIZE);

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
 * Format context for injection into prompt using timeline buckets
 * @param {Object[]} memories - Selected memories
 * @param {string[]} presentCharacters - Characters present in the scene (excluding POV)
 * @param {Object} emotionalInfo - Emotional state info { emotion, fromMessages }
 * @param {string} characterName - Character name for header
 * @param {number} tokenBudget - Maximum token budget
 * @param {number} chatLength - Current chat length for context
 * @returns {string} Formatted context string
 */
export function formatContextForInjection(memories, presentCharacters, emotionalInfo, characterName, tokenBudget, chatLength = 0) {
    const lines = [
        '<scene_memory>',
        `(Current chat has #${chatLength} messages)`,
        ''
    ];

    // Assign memories to buckets
    const buckets = assignMemoriesToBuckets(memories, chatLength);

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

    // Helper to format present characters
    const formatPresent = () => {
        if (!presentCharacters || presentCharacters.length === 0) return null;
        return `Present: ${presentCharacters.join(', ')}`;
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
        old: '## The Story So Far',
        mid: '## Leading Up To This Moment',
        recent: '## Current Scene',
    };

    // Determine which buckets will be rendered
    const emotionalLine = formatEmotionalState();
    const presentLine = formatPresent();
    const hasRecentContent = buckets.recent.length > 0 || emotionalLine || presentLine;

    // Calculate overhead tokens
    let overheadTokens = estimateTokens(lines.join('\n') + '</scene_memory>');
    if (buckets.old.length > 0) overheadTokens += estimateTokens(bucketHeaders.old);
    if (buckets.mid.length > 0) overheadTokens += estimateTokens(bucketHeaders.mid);
    if (hasRecentContent) {
        overheadTokens += estimateTokens(bucketHeaders.recent);
        if (emotionalLine) overheadTokens += estimateTokens(emotionalLine);
        if (presentLine) overheadTokens += estimateTokens(presentLine);
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

    // Render OLD bucket (with gap separators and causality hints)
    if (filteredBuckets.old.length > 0) {
        lines.push(bucketHeaders.old);
        for (let i = 0; i < filteredBuckets.old.length; i++) {
            const memory = filteredBuckets.old[i];
            let gap = 0;

            // Add gap separator if not first memory
            if (i > 0) {
                const prevMemory = filteredBuckets.old[i - 1];
                gap = getMemoryPosition(memory) - getMemoryPosition(prevMemory);
                const separator = getGapSeparator(gap);
                if (separator) {
                    lines.push('');
                    lines.push(separator);
                    lines.push('');
                }
            }

            lines.push(formatMemory(memory));

            // Add causality hint for small gaps (no separator was added)
            if (i > 0 && gap < GAP_SMALL) {
                const hint = getCausalityHint(gap);
                if (hint) {
                    lines.push(hint);
                }
            }

            // Add emotional annotation for high-importance memories
            const emotionalAnnotation = getEmotionalAnnotation(memory);
            if (emotionalAnnotation) {
                lines.push(emotionalAnnotation);
            }
        }
        lines.push('');
    }

    // Render MID bucket (with causality hints)
    if (filteredBuckets.mid.length > 0) {
        lines.push(bucketHeaders.mid);
        for (let i = 0; i < filteredBuckets.mid.length; i++) {
            const memory = filteredBuckets.mid[i];
            lines.push(formatMemory(memory));

            // Add causality hint for close memories
            if (i > 0) {
                const prevMemory = filteredBuckets.mid[i - 1];
                const gap = getMemoryPosition(memory) - getMemoryPosition(prevMemory);
                const hint = getCausalityHint(gap);
                if (hint) {
                    lines.push(hint);
                }
            }

            // Add emotional annotation for high-importance memories
            const emotionalAnnotation = getEmotionalAnnotation(memory);
            if (emotionalAnnotation) {
                lines.push(emotionalAnnotation);
            }
        }
        lines.push('');
    }

    // Render RECENT bucket (always if has content: memories, emotion, or present characters)
    const hasFilteredRecentContent = filteredBuckets.recent.length > 0 || emotionalLine || presentLine;
    if (hasFilteredRecentContent) {
        lines.push(bucketHeaders.recent);

        // Emotional state first
        if (emotionalLine) {
            lines.push(emotionalLine);
        }

        // Present characters second
        if (presentLine) {
            lines.push(presentLine);
        }

        // Add blank line before memories if we have context above
        if ((emotionalLine || presentLine) && filteredBuckets.recent.length > 0) {
            lines.push('');
        }

        // Recent memories (with causality hints and emotional annotations)
        for (let i = 0; i < filteredBuckets.recent.length; i++) {
            const memory = filteredBuckets.recent[i];
            lines.push(formatMemory(memory));

            // Add causality hint for close memories
            if (i > 0) {
                const prevMemory = filteredBuckets.recent[i - 1];
                const gap = getMemoryPosition(memory) - getMemoryPosition(prevMemory);
                const hint = getCausalityHint(gap);
                if (hint) {
                    lines.push(hint);
                }
            }

            // Add emotional annotation for high-importance memories
            const emotionalAnnotation = getEmotionalAnnotation(memory);
            if (emotionalAnnotation) {
                lines.push(emotionalAnnotation);
            }
        }
        lines.push('');
    }

    lines.push('</scene_memory>');

    return lines.join('\n');
}
