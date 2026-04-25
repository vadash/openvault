// @ts-check

/**
 * OpenVault Extraction - Enrichment Stage
 *
 * Handles Stage 3 of extraction pipeline: event enrichment, deduplication,
 * Phase 2 operations (reflections, communities, IDF cache).
 */

/** @typedef {import('../../types').Memory} Memory */
/** @typedef {import('../../types').ExtractedEvent} ExtractedEvent */
/** @typedef {import('../../types').StSyncChanges} StSyncChanges */

import { CHARACTERS_KEY, COMMUNITY_STALENESS_THRESHOLD, CONSOLIDATION, MEMORIES_KEY } from '../../constants.js';
import { enrichEventsWithEmbeddings } from '../../embeddings.js';
import { buildCommunityGroups, detectCommunities, updateCommunitySummaries } from '../../graph/communities.js';
import {
    consolidateEdges,
    expandMainCharacterKeys,
    findCrossScriptCharacterKeys,
    normalizeKey,
} from '../../graph/graph.js';
import { record } from '../../perf/store.js';
import { generateReflections, shouldReflect } from '../../reflection/reflect.js';
import { cosineSimilarity, tokenize } from '../../retrieval/math.js';
import { getSettings } from '../../settings.js';
import { getCurrentChatId, saveOpenVaultData } from '../../store/chat-data.js';
import { getEmbedding, hasEmbedding, markStSynced } from '../../utils/embedding-codec.js';
import { logDebug, logError } from '../../utils/logging.js';
import { createLadderQueue } from '../../utils/queue.js';
import { yieldToMain } from '../../utils/st-helpers.js';
import { jaccardSimilarity } from '../../utils/text.js';

/**
 * Apply ST Vector Storage sync changes from domain function return values.
 * Handles both sync (insert) and delete operations in bulk.
 *
 * @param {StSyncChanges} stChanges
 * @returns {Promise<void>}
 */
async function applySyncChanges(stChanges) {
    if (!isStVectorSource()) return;
    const chatId = getCurrentChatId();
    let requiresSave = false;
    if (stChanges.toSync?.length > 0) {
        const items = stChanges.toSync.map((c) => ({ hash: c.hash, text: c.text, index: 0 }));
        const success = await syncItemsToST(items, chatId);
        if (success) {
            for (const c of stChanges.toSync) markStSynced(c.item);
            requiresSave = true;
        }
    }
    if (stChanges.toDelete?.length > 0) {
        await deleteItemsFromST(
            stChanges.toDelete.map((c) => c.hash),
            chatId
        );
    }
    if (requiresSave) {
        await saveOpenVaultData();
    }
}

import { deleteItemsFromST, isStVectorSource, syncItemsToST } from '../../services/st-vector.js';
import { addMemories } from '../../store/chat-data.js';

/**
 * Update IDF cache for BM25 scoring.
 * Filters archived memories and recalculates inverse document frequency.
 *
 * @param {Object} data - OpenVault data object
 * @param {Object} _graphNodes - Graph nodes (unused, kept for API compatibility)
 * @returns {Promise<void>}
 */
export async function updateIDFCache(data, _graphNodes = {}) {
    const memories = (data[MEMORIES_KEY] || []).filter((m) => !m.archived);
    if (memories.length === 0) {
        data.idf_cache = {};
        return;
    }

    const { calculateIDF, tokenize } = await import('../../retrieval/math.js');
    const tokenizedMemories = new Map(memories.map((m, i) => [i, m.tokens || tokenize(m.summary || '')]));
    data.idf_cache = calculateIDF(memories, tokenizedMemories);
    logDebug(`Updated IDF cache with ${memories.length} memories`);
}

/**
 * Filter out events that are too similar to existing memories OR to each other within the batch.
 * Uses both cosine similarity (embeddings) and Jaccard similarity (tokens) for robust deduplication.
 *
 * @param {ExtractedEvent[]} newEvents - Events to filter
 * @param {Memory[]} existingMemories - Already-stored memories
 * @param {number} cosineThreshold - Cosine similarity threshold for existing memory dedup
 * @param {number} jaccardThreshold - Jaccard token similarity threshold for intra-batch dedup
 * @returns {Promise<ExtractedEvent[]>} Filtered events
 */
export async function filterSimilarEvents(
    newEvents,
    existingMemories,
    cosineThreshold = CONSOLIDATION.dedupSimilarityThreshold,
    jaccardThreshold = CONSOLIDATION.dedupJaccardThreshold
) {
    const t0 = performance.now();
    // Phase 1: Filter against existing memories (cosine + Jaccard cross-check)
    let filtered = newEvents;
    if (existingMemories?.length) {
        const results = [];
        let idx = 0;
        for (const event of newEvents) {
            if (idx % 10 === 0) await yieldToMain();
            idx++;
            if (!hasEmbedding(event)) {
                results.push(event);
                continue;
            }
            let isDuplicate = false;
            for (const memory of existingMemories) {
                if (!hasEmbedding(memory)) continue;
                const similarity = cosineSimilarity(getEmbedding(event), getEmbedding(memory));
                if (similarity >= cosineThreshold) {
                    // Cross-check: require lexical overlap to prevent false positives
                    // (events with same actors + similar structure but different actions)
                    const eventTokens = new Set(tokenize(event.summary || ''));
                    const memoryTokens = new Set(tokenize(memory.summary || ''));
                    const jaccard = jaccardSimilarity(eventTokens, memoryTokens);

                    if (jaccard < jaccardThreshold * 0.5) {
                        logDebug(
                            `Dedup: Cosine ${(similarity * 100).toFixed(1)}% but Jaccard ${(jaccard * 100).toFixed(1)}% too low — keeping:\n  "${event.summary}"\n  vs existing: "${memory.summary}"`
                        );
                        continue;
                    }

                    logDebug(
                        `Dedup: Skipping new event:\n  "${event.summary}"\n  (${(similarity * 100).toFixed(1)}% similar to existing memory:\n  "${memory.summary}")`
                    );
                    isDuplicate = true;
                    memory.mentions = (memory.mentions || 1) + 1;
                    break;
                }
            }
            if (!isDuplicate) results.push(event);
        }
        filtered = results;
    }

    // Phase 2: Intra-batch Jaccard dedup
    const kept = [];
    for (let i = 0; i < filtered.length; i++) {
        if (i % 10 === 0) await yieldToMain();
        const event = filtered[i];
        const eventTokens = new Set(tokenize(event.summary || ''));
        let isDuplicate = false;
        for (const keptEvent of kept) {
            const keptTokens = new Set(tokenize(keptEvent.summary || ''));
            const jaccard = jaccardSimilarity(eventTokens, keptTokens);
            if (jaccard >= jaccardThreshold) {
                logDebug(
                    `Dedup: Skipping new event:\n  "${event.summary}"\n  (Jaccard ${(jaccard * 100).toFixed(1)}% with kept event:\n  "${keptEvent.summary}")`
                );
                isDuplicate = true;
                const mentionsObj = /** @type {{ mentions?: number }} */ (keptEvent);
                mentionsObj.mentions = (mentionsObj.mentions || 1) + 1;
                break;
            }
        }
        if (!isDuplicate) kept.push(event);
    }
    record('event_dedup', performance.now() - t0, `${newEvents.length}×${existingMemories?.length || 0} O(n×m)`);
    return kept;
}

/**
 * Enrich and deduplicate events from the extraction pipeline.
 *
 * @param {ExtractedEvent[]} rawEvents - Events from LLM
 * @param {number[]} messageIds - Message IDs for the batch
 * @param {string[]} messageFingerprints - Message fingerprints for the batch
 * @param {Object} data - OpenVault data object (mutated in-place)
 * @returns {Promise<{events: import('../../types').Memory[], stChanges: StSyncChanges}>}
 */
export async function enrichAndDedupEvents(rawEvents, messageIds, messageFingerprints, data, _settings) {
    const t0 = performance.now();

    // Attach message metadata to events
    for (let i = 0; i < rawEvents.length; i++) {
        const event = rawEvents[i];
        /** @type {{ message_ids?: number[], message_fingerprints?: string[], created_at?: number }} */ (
            event
        ).message_ids = messageIds;
        /** @type {{ message_ids?: number[], message_fingerprints?: string[], created_at?: number }} */ (
            event
        ).message_fingerprints = messageFingerprints;
        /** @type {{ message_ids?: number[], message_fingerprints?: string[], created_at?: number }} */ (
            event
        ).created_at = Date.now();
    }

    // Enrich with embeddings
    await enrichEventsWithEmbeddings(rawEvents);
    const embeddedEvents = rawEvents; // Events are mutated in-place with embeddings
    const embedStChanges = { toSync: [], toDelete: [] }; // Embeddings don't produce ST changes directly

    // Deduplicate against existing memories and within batch
    const existingMemories = data[MEMORIES_KEY] || [];
    const dedupedEvents = await filterSimilarEvents(embeddedEvents, existingMemories);

    record('event_enrichment', performance.now() - t0, `${rawEvents.length} events → ${dedupedEvents.length} kept`);

    // Convert deduped events to memories with IDs
    const newMemories = dedupedEvents.map((e, idx) => {
        const eventData = /** @type {{ message_ids?: number[], created_at?: number }} */ (e);
        return {
            ...e,
            id: `mem_${Date.now()}_${idx}`,
            sequence: (data[MEMORIES_KEY]?.length || 0) + idx,
            message_id: eventData.message_ids?.[0] || 0,
            timestamp: eventData.created_at || Date.now(),
            tokens: [], // Will be calculated during sync
        };
    });

    return {
        events: newMemories,
        stChanges: embedStChanges,
    };
}

/**
 * Run reflection synthesis for a list of characters.
 * Checks each character against the reflection threshold, generates reflections via LLM,
 * pushes results to data.memories, and resets the importance accumulator.
 *
 * @param {Object} data - OpenVault data object (mutated in-place)
 * @param {string[]} characterNames - Characters to check for reflection trigger
 * @param {Object} settings - Extension settings
 * @param {Object} [options={}]
 * @param {AbortSignal} [options.abortSignal=null] - Abort signal for cancellation
 * @returns {Promise<{stChanges: StSyncChanges}>}
 */
export async function synthesizeReflections(data, characterNames, settings, options = {}) {
    const { abortSignal = null } = options;

    // Check if reflection generation is enabled
    if (!getSettings('reflectionGenerationEnabled', true)) {
        logDebug('[Extraction] Reflection generation disabled, skipping Phase 2');
        return { stChanges: { toSync: [], toDelete: [] } };
    }

    const reflectionThreshold = settings.reflectionThreshold;
    const ladderQueue = await createLadderQueue(settings.maxConcurrency);
    const reflectionPromises = [];

    for (const characterName of characterNames) {
        if (abortSignal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        if (shouldReflect(data.reflection_state, characterName, reflectionThreshold)) {
            reflectionPromises.push(
                ladderQueue
                    .add(async () => {
                        // Reset accumulator BEFORE LLM call to prevent infinite retry loop on failure
                        // The accumulated importance is "consumed" here - even if the LLM call fails,
                        // we don't want to retry immediately (to avoid token burning)
                        data.reflection_state[characterName].importance_sum = 0;

                        const { reflections, stChanges } = await generateReflections(
                            characterName,
                            data[MEMORIES_KEY] || [],
                            data[CHARACTERS_KEY] || {}
                        );
                        if (reflections.length > 0) {
                            addMemories(reflections);
                        }
                        await applySyncChanges(stChanges);
                    })
                    .catch((error) => {
                        if (error.name === 'AbortError') throw error;
                        logError(`Reflection error for ${characterName}`, error);
                    })
            );
        }
    }

    await Promise.all(reflectionPromises);

    return { stChanges: { toSync: [], toDelete: [] } };
}

/**
 * Run community detection, edge consolidation, and community summarization.
 * Wrapped in try-catch — community errors are non-fatal and logged.
 *
 * @param {Object} data - OpenVault data object (mutated in-place)
 * @param {Object} settings - Extension settings
 * @param {string} characterName - Main character name (for main character key derivation)
 * @param {string} userName - User name (for main character key derivation)
 * @returns {Promise<{stChanges: StSyncChanges}>}
 */
export async function synthesizeCommunities(data, settings, characterName, userName) {
    try {
        const baseKeys = [normalizeKey(characterName), normalizeKey(userName)];
        const mainCharacterKeys = expandMainCharacterKeys(baseKeys, data.graph.nodes || {});
        const crossScriptKeys = findCrossScriptCharacterKeys(baseKeys, data.graph.nodes || {});
        mainCharacterKeys.push(...crossScriptKeys.filter((k) => !mainCharacterKeys.includes(k)));

        const communityResult = detectCommunities(data.graph, mainCharacterKeys);

        if (communityResult) {
            // Consolidate bloated edges before summarization
            if (data.graph._edgesNeedingConsolidation?.length > 0) {
                const { count: consolidated, stChanges: edgeChanges } = await consolidateEdges(data.graph, settings);
                if (consolidated > 0) {
                    logDebug(`Consolidated ${consolidated} graph edges before community summarization`);
                }
                await applySyncChanges(edgeChanges);
            }

            const groups = buildCommunityGroups(data.graph, communityResult.communities);
            const stalenessThreshold = COMMUNITY_STALENESS_THRESHOLD;
            const isSingleCommunity = communityResult.count === 1;

            const communityUpdateResult = await updateCommunitySummaries(
                data.graph,
                groups,
                data.communities || {},
                data.graph_message_count || 0,
                stalenessThreshold,
                isSingleCommunity
            );

            data.communities = communityUpdateResult.communities;

            await applySyncChanges(communityUpdateResult.stChanges);

            logDebug(`Community synthesis complete: ${Object.keys(data.communities).length} communities`);
        }

        return { stChanges: { toSync: [], toDelete: [] } };
    } catch (error) {
        logError('Community synthesis failed (non-fatal)', error);
        return { stChanges: { toSync: [], toDelete: [] } };
    }
}
