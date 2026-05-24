/**
 * OpenVault Context Formatting
 *
 * Formats memories and character presence for injection into prompts.
 */

import { assignMemoriesToBuckets, getMemoryPosition } from '../utils/text.js';
import { countTokens } from '../utils/tokens.js';

// Re-export for external consumers
export { assignMemoriesToBuckets, getMemoryPosition };

// Narrative engine constants
export const CURRENT_SCENE_SIZE = 100; // "Current Scene" = last 100 messages
export const LEADING_UP_SIZE = 500; // "Leading Up" = messages 101-500 ago

// Gap thresholds (for separators in "Story So Far")
const GAP_SMALL = 15; // No separator
const GAP_MEDIUM = 100; // "..."
const GAP_LARGE = 500; // "...Later..." / "...Much later..."

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
 * Format emotional trajectory for Current Scene
 * @param {Object} emotionalInfo - Emotional info with characterEmotions
 * @param {number} limit - Max characters to show (default 5)
 * @returns {string|null} Formatted emotions line or null
 */
function formatEmotionalTrajectory(emotionalInfo, limit = 5) {
    if (!emotionalInfo || typeof emotionalInfo !== 'object') return null;

    const characterEmotions = emotionalInfo.characterEmotions;
    if (!characterEmotions || typeof characterEmotions !== 'object') return null;

    const lines = [];
    for (const [name, emotion] of Object.entries(characterEmotions)) {
        if (emotion && emotion !== 'neutral') {
            lines.push(`${name} ${emotion}`);
        }
    }

    if (lines.length === 0) return null;
    return `Emotions: ${lines.slice(0, limit).join(', ')}`;
}

/**
 * Format a single memory for display
 * @param {Object} memory - Memory object with summary, importance, is_secret, witnesses, temporal_anchor
 * @returns {string} Formatted memory string
 */
export function formatMemory(memory) {
    const importance = memory.importance || 3;
    const stars = '\u2605'.repeat(importance);

    // Tag [Known] for public events with >2 witnesses, default is private
    const isKnown = !memory.is_secret && (memory.witnesses?.length || 0) > 2;
    const prefix = isKnown ? '[Known] ' : '';

    // Prepend temporal anchor if present
    const timePrefix = memory.temporal_anchor ? `[${memory.temporal_anchor}] ` : '';

    return `[${stars}] ${timePrefix}${prefix}${memory.summary}`;
}

/**
 * Format scene state for injection into prompt
 * Produces a dense XML block (~60-100 tokens) with location, time, characters, and props.
 * @param {Object} sceneState - Scene state object with location, time, environment, characters, active_props
 * @returns {string} Formatted scene state XML block, or empty string if invalid
 */
export function formatSceneStateForInjection(sceneState) {
    if (!sceneState || typeof sceneState !== 'object') return '';
    if (!sceneState.location || !sceneState.time) return '';

    const lines = ['<scene_status>'];

    // Header: Location and Time (with optional environment)
    const headerParts = [`[Location]: ${sceneState.location}`, `[Time]: ${sceneState.time}`];
    if (sceneState.environment) {
        headerParts.push(sceneState.environment);
    }
    lines.push(headerParts.join(' | '));

    // Characters: one line per character
    const characters = sceneState.characters || {};
    for (const [name, char] of Object.entries(characters)) {
        const charParts = [name];

        // Posture (required)
        charParts.push(char.posture || 'Unknown posture');

        // Clothing (optional, omit if empty)
        const clothing = char.clothing || [];
        if (clothing.length > 0) {
            charParts.push(`Wearing: ${clothing.join(', ')}`);
        }

        // Status: physical_status only (not mental_status)
        const physicalStatus = char.physical_status || [];
        if (physicalStatus.length > 0) {
            charParts.push(`Status: ${physicalStatus.join(', ')}`);
        }

        lines.push(`[${charParts[0]}]: ${charParts.slice(1).join('. ')}.`);
    }

    // Props (optional, omit if empty)
    const props = sceneState.active_props || [];
    if (props.length > 0) {
        lines.push(`[Props]: ${props.join(', ')}`);
    }

    lines.push('</scene_status>');
    return lines.join('\n');
}

/**
 * Format context for injection into prompt using timeline buckets
 * @param {Object[]} memories - Selected memories
 * @param {string[]} presentCharacters - Characters present in the scene (excluding POV)
 * @param {Object} emotionalInfo - Emotional state info { emotion, fromMessages }
 * @param {string} characterName - Character name for header
 * @param {number} tokenBudget - Maximum token budget
 * @param {number} chatLength - Current chat length for context
 * @param {Map<string, number>|null} [chatFingerprintMap] - Map of fingerprint to current position
 * @returns {string} Formatted context string
 */
export async function formatContextForInjection(
    memories,
    presentCharacters,
    emotionalInfo,
    _characterName,
    tokenBudget,
    chatLength = 0,
    chatFingerprintMap = null
) {
    const lines = ['<scene_memory>', `(#${chatLength} messages | ★=minor ★★★=notable ★★★★★=critical)`, ''];

    // Handle null/undefined memories
    if (!memories || !Array.isArray(memories)) {
        lines.push('</scene_memory>');
        return { memoryText: lines.join('\n'), reflectionText: '' };
    }

    // Separate memories into events and reflections for different XML blocks
    // Treat memories without a type field as events (backward compatibility)
    const events = memories.filter((m) => !m.type || m.type === 'event');
    const reflections = memories.filter((m) => m.type === 'reflection');

    // Assign only events to buckets (reflections go to subconscious_drives)
    const buckets = assignMemoriesToBuckets(events, chatLength, chatFingerprintMap);

    // Helper to format present characters
    const formatPresent = () => {
        if (!presentCharacters || presentCharacters.length === 0) return null;
        return `Present: ${presentCharacters.join(', ')}`;
    };

    // Calculate token overhead for non-empty bucket headers
    const bucketHeaders = {
        old: '## The Story So Far',
        mid: '## Leading Up To This Moment',
        recent: '## Current Scene',
    };

    // Determine which buckets will be rendered
    const presentLine = formatPresent();
    const emotionsLine = formatEmotionalTrajectory(emotionalInfo);
    const hasRecentContent = buckets.recent.length > 0 || presentLine || emotionsLine;

    // Calculate overhead tokens
    let overheadTokens = await countTokens(lines.join('\n') + '</scene_memory>');
    if (buckets.old.length > 0) overheadTokens += await countTokens(bucketHeaders.old);
    if (buckets.mid.length > 0) overheadTokens += await countTokens(bucketHeaders.mid);
    if (hasRecentContent) {
        overheadTokens += await countTokens(bucketHeaders.recent);
        if (presentLine) overheadTokens += await countTokens(presentLine);
        if (emotionsLine) overheadTokens += await countTokens(emotionsLine);
    }

    const availableForMemories = tokenBudget - overheadTokens;
    const fittingMemoryIds = new Set();

    // Simply fit all memories into budget (quota logic delegated to scoring layer)
    let totalTokens = 0;

    for (const memory of [...buckets.old, ...buckets.mid, ...buckets.recent]) {
        const memoryTokens = (await countTokens(formatMemory(memory))) + 1;
        if (totalTokens + memoryTokens <= availableForMemories) {
            fittingMemoryIds.add(memory.id);
            totalTokens += memoryTokens;
        } else {
            break;
        }
    }

    // Filter buckets to only include fitting memories
    const filteredBuckets = {
        old: buckets.old.filter((m) => fittingMemoryIds.has(m.id)),
        mid: buckets.mid.filter((m) => fittingMemoryIds.has(m.id)),
        recent: buckets.recent.filter((m) => fittingMemoryIds.has(m.id)),
    };

    // Render OLD bucket (with gap separators)
    if (filteredBuckets.old.length > 0) {
        lines.push(bucketHeaders.old);
        for (let i = 0; i < filteredBuckets.old.length; i++) {
            const memory = filteredBuckets.old[i];

            // Add gap separator if not first memory
            if (i > 0) {
                const prevMemory = filteredBuckets.old[i - 1];
                const gap =
                    getMemoryPosition(memory, chatFingerprintMap) - getMemoryPosition(prevMemory, chatFingerprintMap);
                const separator = getGapSeparator(gap);
                if (separator) {
                    lines.push('');
                    lines.push(separator);
                    lines.push('');
                }
            }

            lines.push(formatMemory(memory));
        }
        lines.push('');
    }

    // Render MID bucket
    if (filteredBuckets.mid.length > 0) {
        lines.push(bucketHeaders.mid);
        for (let i = 0; i < filteredBuckets.mid.length; i++) {
            const memory = filteredBuckets.mid[i];
            lines.push(formatMemory(memory));
        }
        lines.push('');
    }

    // Render RECENT bucket (always if has content: memories, emotion, or present characters)
    const hasFilteredRecentContent = filteredBuckets.recent.length > 0 || presentLine || emotionsLine;
    if (hasFilteredRecentContent) {
        lines.push(bucketHeaders.recent);

        // Present characters first
        if (presentLine) {
            lines.push(presentLine);
        }

        // Character emotions second
        if (emotionsLine) {
            lines.push(emotionsLine);
        }

        // Add blank line before memories if we have context above
        if ((presentLine || emotionsLine) && filteredBuckets.recent.length > 0) {
            lines.push('');
        }

        // Recent memories
        for (let i = 0; i < filteredBuckets.recent.length; i++) {
            const memory = filteredBuckets.recent[i];
            lines.push(formatMemory(memory));
        }
        lines.push('');
    }

    lines.push('</scene_memory>');
    const memoryText = lines.join('\n');

    // Build subconscious_drives block for reflections separately
    let reflectionText = '';
    if (reflections.length > 0) {
        const reflectionLines = [
            '<subconscious_drives>',
            '[CRITICAL RULE: The following are hidden psychological truths. The character is NOT consciously aware of these dynamics and would NEVER speak them aloud. Use this ONLY as subtext to influence their subtle actions and emotional reactions.]',
            '',
        ];
        for (const ref of reflections) {
            const importance = ref.importance || 3;
            const stars = '\u2605'.repeat(importance);
            reflectionLines.push(`[${stars}] ${ref.summary}`);
        }
        reflectionLines.push('');
        reflectionLines.push('</subconscious_drives>');
        reflectionText = reflectionLines.join('\n');
    }

    return { memoryText, reflectionText };
}
