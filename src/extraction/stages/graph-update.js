// @ts-check

/**
 * OpenVault Extraction - Graph Update Stage
 *
 * Handles Stage 2 of extraction pipeline: LLM graph extraction and graph updates.
 * Extracts entities/relationships and merges them into the knowledge graph.
 */

/** @typedef {import('../../types').GraphExtraction} GraphExtraction */
/** @typedef {import('../../types').ExtractedEvent} ExtractedEvent */
/** @typedef {import('../../types').ExtractionContextParams} ExtractionContextParams */

import { CHARACTERS_KEY, ENTITY_TYPES } from '../../constants.js';
import { mergeOrInsertEntity, upsertRelationship } from '../../graph/graph.js';
import { callLLM, LLM_CONFIGS } from '../../llm.js';
import { buildGraphExtractionPrompt } from '../../prompts/index.js';
import { logDebug } from '../../utils/logging.js';
import { resolveCharacterName, transliterateCyrToLat } from '../../utils/transliterate.js';
import { parseGraphExtractionResponse } from '../structured.js';

/**
 * Fetch graph data from LLM based on extracted events.
 *
 * @param {ExtractionContextParams} contextParams - Extraction context parameters
 * @param {ExtractedEvent[]} events - Previously extracted events
 * @param {AbortSignal} abortSignal - Abort signal for cancellation
 * @returns {Promise<GraphExtraction>}
 */
export async function fetchGraphFromLLM(contextParams, events, abortSignal) {
    const formattedEvents = events.map((e, i) => `${i + 1}. [${e.importance}★] ${e.summary}`);
    const graphPrompt = buildGraphExtractionPrompt({
        messages: contextParams.messagesText,
        names: contextParams.names,
        extractedEvents: formattedEvents,
        context: {
            charDesc: contextParams.charDesc,
            personaDesc: contextParams.personaDesc,
        },
        preamble: contextParams.preamble,
        prefill: contextParams.prefill,
        outputLanguage: contextParams.outputLanguage,
    });

    const graphResponse = await callLLM(graphPrompt, LLM_CONFIGS.EXTRACTION, { signal: abortSignal });

    const graphResult = parseGraphExtractionResponse(graphResponse);

    logDebug(
        `LLM extracted ${graphResult.entities.length} entities, ${graphResult.relationships.length} relationships`
    );

    return graphResult;
}

/**
 * Canonicalize character names in extracted events by resolving cross-script
 * variants (e.g., Cyrillic "Мина" → English "Mina") against known canonical names.
 * Mutates events in place.
 *
 * @param {ExtractedEvent[]} events - Extracted events (mutated)
 * @param {string[]} contextNames - Known context character names (e.g., [characterName, userName])
 * @param {Object} graphNodes - Graph nodes keyed by normalized name
 */
export function canonicalizeEventCharNames(events, contextNames, graphNodes) {
    // Build canonical name registry: context names + all PERSON graph node names
    const canonicalNames = [...contextNames];
    for (const [, node] of Object.entries(graphNodes || {})) {
        if (node.type === ENTITY_TYPES.PERSON && !canonicalNames.includes(node.name)) {
            canonicalNames.push(node.name);
        }
    }

    if (canonicalNames.length === 0) return;

    function resolve(name) {
        const match = resolveCharacterName(name, canonicalNames);
        return match || name;
    }

    for (const event of events) {
        if (event.characters_involved) {
            event.characters_involved = [...new Set(event.characters_involved.map(resolve))];
        }
        if (event.witnesses) {
            event.witnesses = [...new Set(event.witnesses.map(resolve))];
        }
        if (event.emotional_impact) {
            const newImpact = /** @type {{ [key: string]: string }} */ ({});
            for (const [charName, emotion] of Object.entries(event.emotional_impact)) {
                newImpact[resolve(charName)] = emotion;
            }
            event.emotional_impact = newImpact;
        }
    }
}

/**
 * Update character states based on extracted events.
 *
 * @param {ExtractedEvent[]} events - Extracted events
 * @param {Object} data - OpenVault data object (mutated in-place)
 * @param {string[]} validCharNames - Known valid character names (e.g., [characterName, userName])
 */
export function updateCharacterStatesFromEvents(events, data, validCharNames = []) {
    data[CHARACTERS_KEY] = data[CHARACTERS_KEY] || {};

    // Build valid set from known names + all characters_involved from current events
    // Include both original names and their transliterations for cross-script matching
    const validSet = new Set();
    for (const n of validCharNames) {
        const lower = n.toLowerCase();
        validSet.add(lower);
        const translit = transliterateCyrToLat(lower);
        if (translit !== lower) validSet.add(translit);
    }
    for (const event of events) {
        for (const char of event.characters_involved || []) {
            const lower = char.toLowerCase();
            validSet.add(lower);
            const translit = transliterateCyrToLat(lower);
            if (translit !== lower) validSet.add(translit);
        }
    }

    const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
    function isValid(name) {
        const lower = name.toLowerCase();
        if (validSet.has(lower)) return true;
        if (CYRILLIC_RE.test(lower)) return validSet.has(transliterateCyrToLat(lower));
        return false;
    }

    for (const event of events) {
        // Get message range for this event
        const eventData = /** @type {{ message_ids?: number[] }} */ (event);
        const messageIds = eventData.message_ids || [];
        const messageRange =
            messageIds.length > 0 ? { min: Math.min(...messageIds), max: Math.max(...messageIds) } : null;

        // Update emotional impact
        if (event.emotional_impact) {
            for (const [charName, emotion] of Object.entries(event.emotional_impact)) {
                // Validate character name before creating state entry
                if (!isValid(charName)) {
                    logDebug(`Skipping invalid character name "${charName}" in emotional_impact`);
                    continue;
                }

                if (!data[CHARACTERS_KEY][charName]) {
                    data[CHARACTERS_KEY][charName] = {
                        name: charName,
                        current_emotion: 'neutral',
                        emotion_intensity: 5,
                        known_events: [],
                    };
                }

                // Update emotion and track which messages it's from
                data[CHARACTERS_KEY][charName].current_emotion = emotion;
                data[CHARACTERS_KEY][charName].last_updated = Date.now();
                if (messageRange) {
                    data[CHARACTERS_KEY][charName].emotion_from_messages = messageRange;
                }
            }
        }

        // Add event to witnesses' knowledge
        for (const witness of event.witnesses || []) {
            // Validate character name before creating state entry
            if (!isValid(witness)) {
                logDebug(`Skipping invalid character name "${witness}" in witnesses`);
                continue;
            }

            if (!data[CHARACTERS_KEY][witness]) {
                data[CHARACTERS_KEY][witness] = {
                    name: witness,
                    current_emotion: 'neutral',
                    emotion_intensity: 5,
                    known_events: [],
                };
            }

            const knownEvents = data[CHARACTERS_KEY][witness].known_events || [];
            const eventId = /** @type {{ id?: string }} */ (event).id;
            if (eventId && !knownEvents.includes(eventId)) {
                knownEvents.push(eventId);
                data[CHARACTERS_KEY][witness].known_events = knownEvents;
            }
        }
    }
}

/**
 * Clean up character states by removing entries that don't match valid names.
 *
 * @param {Object} data - OpenVault data object (mutated in-place)
 * @param {string[]} validCharNames - Known valid character names
 */
export function cleanupCharacterStates(data, validCharNames = []) {
    if (!data[CHARACTERS_KEY]) return;

    const validSet = new Set(validCharNames.map((n) => n.toLowerCase()));
    const removed = [];

    for (const charName of Object.keys(data[CHARACTERS_KEY])) {
        if (!validSet.has(charName.toLowerCase())) {
            delete data[CHARACTERS_KEY][charName];
            removed.push(charName);
        }
    }

    if (removed.length > 0) {
        logDebug(`Cleaned up ${removed.length} invalid character state entries: ${removed.join(', ')}`);
    }
}

/**
 * Process graph updates by merging entities and upserting relationships.
 *
 * @param {GraphExtraction} graphResult - Graph extraction result from LLM
 * @param {Object} data - OpenVault data object (mutated in-place)
 * @param {Object} settings - Extension settings
 * @returns {Promise<{stChanges: import('../../types').StSyncChanges}>}
 */
export async function processGraphUpdates(graphResult, data, settings) {
    const stChanges = { toSync: [], toDelete: [] };

    // Merge entities
    for (const entity of graphResult.entities || []) {
        const result = await mergeOrInsertEntity(
            data.graph,
            entity.name,
            /** @type {"PERSON" | "PLACE" | "ORGANIZATION" | "OBJECT" | "CONCEPT"} */ (entity.entityType),
            entity.description,
            5, // cap
            settings
        );
        if (result?.stChanges) {
            if (result.stChanges.toSync) stChanges.toSync.push(...result.stChanges.toSync);
            if (result.stChanges.toDelete) stChanges.toDelete.push(...result.stChanges.toDelete);
        }
    }

    // Upsert relationships
    for (const relationship of graphResult.relationships || []) {
        upsertRelationship(
            data.graph,
            relationship.source,
            relationship.target,
            relationship.description,
            5 // cap
        );
        // Note: upsertRelationship doesn't return stChanges, it handles sync internally
    }

    logDebug(
        `Graph update: ${graphResult.entities.length} entities, ${graphResult.relationships.length} relationships`
    );

    return { stChanges };
}
