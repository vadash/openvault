/**
 * OpenVault POV & Character Detection
 *
 * Handles point-of-view determination and character detection for memory filtering.
 */

import { CHARACTERS_KEY, MEMORIES_KEY } from './constants.js';
import { getDeps } from './deps.js';
import { resolveKey } from './graph/graph.js';
import { getOpenVaultData } from './store/chat-data.js';
import { logDebug } from './utils/logging.js';

/**
 * Build an expanded set of lowercased names for POV matching.
 * Includes canonical names plus any aliases discovered by graph entity merging,
 * so cross-script variants (e.g. Cyrillic "Сузи" for Latin "Suzy") pass the filter.
 * @param {string[]} povCharacters - Canonical POV character names
 * @param {Object} graphData - Full graph object with nodes and _mergeRedirects
 * @returns {Set<string>} Lowercased name variants to match against
 */
function _expandPOVNames(povCharacters, graphData) {
    const nodes = graphData?.nodes || {};
    const names = new Set(povCharacters.map((c) => c.toLowerCase()));
    for (const charName of povCharacters) {
        const resolvedKey = resolveKey(graphData || {}, charName);
        const node = nodes[resolvedKey];
        if (node?.aliases) {
            for (const alias of node.aliases) {
                names.add(alias.toLowerCase());
            }
        }
    }
    return names;
}

/**
 * Filter memories by POV accessibility
 * Returns only memories that the POV characters would know about.
 * @param {Object[]} memories - All memories
 * @param {string[]} povCharacters - POV character names
 * @param {Object} data - OpenVault data containing character states
 * @returns {Object[]} Memories accessible to POV characters
 */
export function filterMemoriesByPOV(memories, povCharacters, data) {
    if (!memories || memories.length === 0) return [];
    if (!povCharacters || povCharacters.length === 0) return memories;

    // Collect known events from all POV characters
    const knownEventIds = new Set();
    for (const charName of povCharacters) {
        const charState = data[CHARACTERS_KEY]?.[charName];
        if (charState?.known_events) {
            for (const eventId of charState.known_events) {
                knownEventIds.add(eventId);
            }
        }
    }

    // Filter memories by POV - memories that ANY of the POV characters know
    const povNamesLower = _expandPOVNames(povCharacters, data.graph);
    return memories.filter((m) => {
        // Any POV character (or alias) was a witness (case-insensitive)
        if (m.witnesses?.some((w) => povNamesLower.has(w.toLowerCase()))) return true;
        // Events that any POV character (or alias) is involved in
        if (m.characters_involved?.some((c) => povNamesLower.has(c.toLowerCase()))) return true;
        // Explicitly in any POV character's known events
        if (knownEventIds.has(m.id)) return true;
        return false;
    });
}

/**
 * Get active characters in the conversation
 * @returns {string[]}
 */
export function getActiveCharacters() {
    const context = getDeps().getContext();
    const characters = [context.name2]; // Main character

    // Add user
    if (context.name1) {
        characters.push(context.name1);
    }

    // Add group members if in group chat
    if (context.groupId) {
        const group = context.groups?.find((g) => g.id === context.groupId);
        if (group?.members) {
            for (const member of group.members) {
                const char = context.characters?.find((c) => c.avatar === member);
                if (char?.name && !characters.includes(char.name)) {
                    characters.push(char.name);
                }
            }
        }
    }

    return characters;
}

/**
 * Detect characters present in recent messages (for narrator mode)
 * Scans message content for character names from stored memories
 * @param {number} messageCount - Number of recent messages to scan
 * @returns {string[]} - List of detected character names
 */
export function detectPresentCharactersFromMessages(messageCount = 2) {
    const context = getDeps().getContext();
    const chat = context.chat || [];
    const data = getOpenVaultData();

    if (!data) {
        // Return just the basic character names if no data
        const characters = [];
        if (context.name1) characters.push(context.name1);
        if (context.name2) characters.push(context.name2);
        return characters;
    }

    // Get all known character names from memories
    const knownCharacters = new Set();
    for (const memory of data[MEMORIES_KEY] || []) {
        for (const char of memory.characters_involved || []) {
            knownCharacters.add(char.toLowerCase());
        }
        for (const witness of memory.witnesses || []) {
            knownCharacters.add(witness.toLowerCase());
        }
    }
    // Also add from character states
    for (const charName of Object.keys(data[CHARACTERS_KEY] || {})) {
        knownCharacters.add(charName.toLowerCase());
    }

    // Add user and main character
    if (context.name1) knownCharacters.add(context.name1.toLowerCase());
    if (context.name2) knownCharacters.add(context.name2.toLowerCase());

    // Scan recent messages
    const recentMessages = chat.filter((m) => !m.is_system).slice(-messageCount);

    const presentCharacters = new Set();

    for (const msg of recentMessages) {
        const text = (msg.mes || '').toLowerCase();
        const name = (msg.name || '').toLowerCase();

        // Add message sender
        if (name) {
            presentCharacters.add(name);
        }

        // Scan message content for character names (use Unicode-aware word boundaries to avoid false positives)
        for (const charName of knownCharacters) {
            const escapedName = charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Use Unicode-aware word boundaries: match if preceded/followed by
            // non-letter, non-digit, non-underscore, or string start/end
            const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedName}(?![\\p{L}\\p{N}])`, 'iu');
            if (regex.test(text)) {
                presentCharacters.add(charName);
            }
        }
    }

    // Convert back to original case by finding matches
    const result = [];
    for (const lowerName of presentCharacters) {
        // Try to find original casing from data
        for (const charName of Object.keys(data[CHARACTERS_KEY] || {})) {
            if (charName.toLowerCase() === lowerName) {
                result.push(charName);
                break;
            }
        }
        // Fallback: check context names
        if (!result.some((r) => r.toLowerCase() === lowerName)) {
            if (context.name1?.toLowerCase() === lowerName) result.push(context.name1);
            else if (context.name2?.toLowerCase() === lowerName) result.push(context.name2);
            else result.push(lowerName); // Keep lowercase if no match found
        }
    }

    logDebug(`Detected present characters: ${result.join(', ')}`);
    return result;
}

/**
 * Get POV characters for memory filtering
 * - Group chat: Use the responding character's name (true POV)
 * - Solo chat: Use characters detected in recent messages (narrator mode)
 * @returns {{ povCharacters: string[], isGroupChat: boolean }}
 */
export function getPOVContext() {
    const context = getDeps().getContext();
    const isGroupChat = !!context.groupId;

    if (isGroupChat) {
        // Group chat: Use the specific responding character
        logDebug(`Group chat mode: POV character = ${context.name2}`);
        return {
            povCharacters: [context.name2],
            isGroupChat: true,
        };
    } else {
        // Solo chat (narrator mode): Detect characters from recent messages
        const presentCharacters = detectPresentCharactersFromMessages(2);

        // If no characters detected, fall back to context names
        if (presentCharacters.length === 0) {
            presentCharacters.push(context.name2);
            if (context.name1) presentCharacters.push(context.name1);
        }

        logDebug(`Narrator mode: POV characters = ${presentCharacters.join(', ')}`);
        return {
            povCharacters: presentCharacters,
            isGroupChat: false,
        };
    }
}
