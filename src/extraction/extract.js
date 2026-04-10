// @ts-check

/** @typedef {import('../types').Memory} Memory */
/** @typedef {import('../types').Entity} Entity */
/** @typedef {import('../types').Relationship} Relationship */
/** @typedef {import('../types').ExtractedEvent} ExtractedEvent */
/** @typedef {import('../types').GraphExtraction} GraphExtraction */
/** @typedef {import('../types').StSyncChanges} StSyncChanges */
/** @typedef {import('../types').ExtractionOptions} ExtractionOptions */
/** @typedef {import('../types').ExtractionContextParams} ExtractionContextParams */
/** @typedef {import('../types').ExtractionLLMOptions} ExtractionLLMOptions */
/** @typedef {import('../types').GenerateReflectionsResult} GenerateReflectionsResult */
/** @typedef {import('../types').ConsolidateEdgesResult} ConsolidateEdgesResult */

/**
 * OpenVault Extraction - Simplified Procedural Interface
 *
 * Consolidates the 5-stage extraction process into a single module.
 * Previously: ExtractionPipeline class + 5 separate stage files.
 */

import {
    CHARACTERS_KEY,
    COMMUNITY_STALENESS_THRESHOLD,
    CONSOLIDATION,
    EDGE_DESCRIPTION_CAP,
    EMBEDDING_SOURCES,
    ENTITY_DESCRIPTION_CAP,
    ENTITY_TYPES,
    extensionName,
    MEMORIES_KEY,
} from '../constants.js';
import { getDeps } from '../deps.js';
import { enrichEventsWithEmbeddings } from '../embeddings.js';
import { buildCommunityGroups, detectCommunities, updateCommunitySummaries } from '../graph/communities.js';
import {
    consolidateEdges,
    expandMainCharacterKeys,
    findCrossScriptCharacterKeys,
    mergeOrInsertEntity,
    normalizeKey,
    upsertRelationship,
} from '../graph/graph.js';
import { callLLM, LLM_CONFIGS } from '../llm.js';
import { record } from '../perf/store.js';
import {
    buildEventExtractionPrompt,
    buildGraphExtractionPrompt,
    resolveExtractionPreamble,
    resolveExtractionPrefill,
    resolveOutputLanguage,
} from '../prompts/index.js';
import { accumulateImportance, generateReflections, shouldReflect } from '../reflection/reflect.js';
import { calculateIDF, cosineSimilarity, tokenize } from '../retrieval/math.js';
import { deleteItemsFromST, isStVectorSource, syncItemsToST } from '../services/st-vector.js';
import { clearAllLocks, getLastApiCallTime, isWorkerRunning, operationState, setLastApiCallTime } from '../state.js';
import {
    addMemories,
    getCurrentChatId,
    getOpenVaultData,
    incrementGraphMessageCount,
    markMessagesProcessed,
    saveOpenVaultData,
} from '../store/chat-data.js';
import { showToast } from '../utils/dom.js';
import { cyrb53, getEmbedding, hasEmbedding, isStSynced, markStSynced } from '../utils/embedding-codec.js';
import { logDebug, logError, logInfo } from '../utils/logging.js';
import { createLadderQueue } from '../utils/queue.js';
import { isExtensionEnabled, safeSetExtensionPrompt, yieldToMain } from '../utils/st-helpers.js';
import { jaccardSimilarity, sliceToTokenBudget, sortMemoriesBySequence } from '../utils/text.js';
import { countTokens } from '../utils/tokens.js';
import { resolveCharacterName, transliterateCyrToLat } from '../utils/transliterate.js';
import {
    getBackfillMessageIds,
    getBackfillStats,
    getFingerprint,
    getNextBatch,
    getProcessedFingerprints,
} from './scheduler.js';
import { parseEventExtractionResponse, parseGraphExtractionResponse } from './structured.js';

/**
 * Backoff schedule in seconds for failed extraction batches.
 * Retries indefinitely through this schedule until cumulative backoff exceeds MAX_BACKOFF_TOTAL_MS.
 */
const BACKOFF_SCHEDULE_SECONDS = [1, 2, 3, 10, 20, 30, 30, 60, 60];

/**
 * Maximum cumulative backoff time before stopping extraction entirely (15 minutes)
 */
const MAX_BACKOFF_TOTAL_MS = 15 * 60 * 1000;

/**
 * Wait based on the configured RPM rate limit.
 * Accounts for elapsed time since the last API call — only sleeps the remaining delta.
 * Uses the shared lastApiCallTime from state.js, which is updated by callLLM
 * after every response, so the delay tracks actual API activity.
 * @param {Object} settings - Extension settings containing backfillMaxRPM
 * @param {string} [label='Rate limit'] - Log label
 * @returns {Promise<void>}
 */
async function rpmDelay(settings, label = 'Rate limit') {
    const rpm = settings.backfillMaxRPM;
    const delayMs = Math.ceil(60000 / rpm);
    const now = Date.now();
    const timeSinceLastCall = now - getLastApiCallTime();

    if (timeSinceLastCall < delayMs) {
        const sleepTime = delayMs - timeSinceLastCall;
        logDebug(`${label}: waiting ${sleepTime}ms (${rpm} RPM)`);
        await new Promise((r) => setTimeout(r, sleepTime));
    }
    setLastApiCallTime(Date.now());
}

/**
 * Apply ST Vector Storage sync changes from domain function return values.
 * Handles both sync (insert) and delete operations in bulk.
 * @param {StSyncChanges} stChanges
 * @returns {Promise<void>}
 */
export async function applySyncChanges(stChanges) {
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

// =============================================================================
// Message Hiding (moved from ui/settings.js)
// =============================================================================

/**
 * Hide all extracted messages from LLM context by setting is_system=true.
 * Only hides messages that have been successfully processed (fingerprint in processed set).
 * @returns {Promise<number>} Number of messages hidden
 */
export async function hideExtractedMessages() {
    const context = getDeps().getContext();
    const chat = context.chat || [];
    const data = getOpenVaultData();
    const processedFps = getProcessedFingerprints(data);

    let hiddenCount = 0;
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (processedFps.has(getFingerprint(msg)) && !msg.is_system) {
            msg.is_system = true;
            msg.openvault_hidden = true;
            hiddenCount++;
        }
    }

    if (hiddenCount > 0) {
        await getDeps().saveChatConditional();
        logInfo(`Emergency Cut: hid ${hiddenCount} messages (all extracted)`);
    }
    return hiddenCount;
}

/**
 * Execute an Emergency Cut — extract all unprocessed messages and hide them.
 * Domain orchestrator with callback injection for UI updates.
 * @param {Object} options
 * @param {function(string): void} [options.onWarning] - Called for non-fatal warnings
 * @param {function(string): boolean} [options.onConfirmPrompt] - Called for user confirmation; return false to cancel
 * @param {function(): void} [options.onStart] - Called when extraction phase begins
 * @param {function(number, number, number): void} [options.onProgress] - Called per batch (batchNum, totalBatches, eventsCreated)
 * @param {function({messagesProcessed: number, eventsCreated: number, hiddenCount: number}): void} [options.onComplete] - Called on success
 * @param {function(Error, boolean): void} [options.onError] - Called on failure (error, isCancel)
 * @param {AbortSignal} [options.abortSignal] - For cancellation
 * @returns {Promise<void>}
 */
export async function executeEmergencyCut(options = {}) {
    const { onWarning, onConfirmPrompt, onStart, onProgress, onComplete, onError, abortSignal } = options;

    if (isWorkerRunning()) {
        onWarning?.('Background extraction in progress. Please wait a moment.');
        return;
    }

    const context = getDeps().getContext();
    const chat = context.chat || [];
    const data = getOpenVaultData();
    const stats = getBackfillStats(chat, data);

    let shouldExtract = true;

    if (stats.unextractedCount === 0) {
        const processedFps = getProcessedFingerprints(data);
        const hideableCount = chat.filter((m) => !m.is_system && processedFps.has(getFingerprint(m))).length;

        if (hideableCount === 0) {
            onWarning?.('No messages to hide');
            return;
        }

        const msg =
            `All messages are already extracted. Hide ${hideableCount} messages from the LLM to break the loop?\n\n` +
            'The LLM will only see: preset, char card, lorebooks, and OpenVault memories.';
        if (!onConfirmPrompt?.(msg)) return;
        shouldExtract = false;
    } else {
        const msg =
            `Extract and hide ${stats.unextractedCount} unprocessed messages?\n\n` +
            'The LLM will only see: preset, char card, lorebooks, and OpenVault memories.';
        if (!onConfirmPrompt?.(msg)) return;
    }

    if (!shouldExtract) {
        const hiddenCount = await hideExtractedMessages();
        onComplete?.({ messagesProcessed: 0, eventsCreated: 0, hiddenCount });
        return;
    }

    onStart?.();
    operationState.extractionInProgress = true;

    try {
        const result = await extractAllMessages({
            isEmergencyCut: true,
            progressCallback: onProgress,
            abortSignal,
        });

        const hiddenCount = await hideExtractedMessages();

        onComplete?.({
            messagesProcessed: result.messagesProcessed,
            eventsCreated: result.eventsCreated,
            hiddenCount,
        });
    } catch (err) {
        onError?.(err, err.name === 'AbortError');
    } finally {
        operationState.extractionInProgress = false;
    }
}

/**
 * Canonicalize character names in extracted events by resolving cross-script
 * variants (e.g., Cyrillic "Мина" → English "Mina") against known canonical names.
 * Mutates events in place.
 *
 * @param {Object[]} events - Extracted events (mutated)
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
            const newImpact = {};
            for (const [charName, emotion] of Object.entries(event.emotional_impact)) {
                newImpact[resolve(charName)] = emotion;
            }
            event.emotional_impact = newImpact;
        }
    }
}

/**
 * Update character states based on extracted events
 * @param {Array} events - Extracted events
 * @param {Object} data - OpenVault data object
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
        const messageIds = event.message_ids || [];
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
            if (!data[CHARACTERS_KEY][witness].known_events.includes(event.id)) {
                data[CHARACTERS_KEY][witness].known_events.push(event.id);
            }
        }
    }
}

/**
 * Cleanup corrupted character state entries
 * Removes entries where the character name is not in validCharNames AND not in any memory's characters_involved
 * @param {Object} data - OpenVault data object
 * @param {string[]} validCharNames - Known valid character names (e.g., [characterName, userName])
 */
export function cleanupCharacterStates(data, validCharNames = []) {
    if (!data[CHARACTERS_KEY]) return;

    // Build valid set from known names + all characters_involved from memories
    // Include both original names and their transliterations for cross-script matching
    const validSet = new Set();
    for (const n of validCharNames) {
        const lower = n.toLowerCase();
        validSet.add(lower);
        const translit = transliterateCyrToLat(lower);
        if (translit !== lower) validSet.add(translit);
    }
    const memories = data[MEMORIES_KEY] || [];
    for (const memory of memories) {
        for (const char of memory.characters_involved || []) {
            const lower = char.toLowerCase();
            validSet.add(lower);
            const translit = transliterateCyrToLat(lower);
            if (translit !== lower) validSet.add(translit);
        }
    }

    // Remove character state entries that are not in the valid set
    const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
    const removedEntries = [];
    for (const charName of Object.keys(data[CHARACTERS_KEY])) {
        const lower = charName.toLowerCase();
        const isValid = validSet.has(lower) || (CYRILLIC_RE.test(lower) && validSet.has(transliterateCyrToLat(lower)));
        if (!isValid) {
            removedEntries.push(charName);
            delete data[CHARACTERS_KEY][charName];
        }
    }

    if (removedEntries.length > 0) {
        logDebug(`Cleaned up ${removedEntries.length} invalid character states: ${removedEntries.join(', ')}`);
    }
}

/**
 * Calculate and cache IDF map for BM25 scoring.
 * Called after Phase 1 commit when memories are added.
 * IDF only changes when corpus changes (new memories extracted), not during retrieval.
 * @param {Object} data - OpenVault data object
 * @param {Object} _graphNodes - Graph nodes keyed by normalized name (unused, for API compatibility)
 */
export function updateIDFCache(data, _graphNodes = {}) {
    const allMemories = data[MEMORIES_KEY] || [];
    // Only include active (non-archived) memories in IDF calculation
    const memories = allMemories.filter((m) => !m.archived);
    if (memories.length === 0) return;

    // Build tokenized corpus from active memory tokens
    const tokenizedMemories = new Map();
    for (let i = 0; i < memories.length; i++) {
        const m = memories[i];
        // Use pre-computed tokens if available, otherwise tokenize summary
        tokenizedMemories.set(i, m.tokens || tokenize(m.summary || ''));
    }

    // Calculate IDF from active memories only
    const { idfMap, avgDL } = calculateIDF(memories, tokenizedMemories);

    // Convert Map to plain object for JSON serialization
    const idfCache = {
        idfMap: Object.fromEntries(idfMap),
        avgDL,
        memoryCount: memories.length,
        timestamp: Date.now(),
    };

    data.idf_cache = idfCache;
    logDebug(`IDF cache updated: ${memories.length} active memories, avgDL=${avgDL.toFixed(2)}`);
}

/**
 * Select relevant memories for extraction context using hybrid recency/importance
 * @param {Object} data - OpenVault data object
 * @param {Object} settings - Extension settings
 * @returns {Object[]} Selected memories sorted chronologically
 */
export function selectMemoriesForExtraction(data, settings) {
    const allMemories = data[MEMORIES_KEY] || [];
    const totalBudget = settings.extractionRearviewTokens;
    const recencyBudget = Math.floor(totalBudget * 0.25);
    const importanceBudget = totalBudget - recencyBudget;

    // Step A: Recency - most recent memories (sorted desc by sequence)
    const recentSorted = sortMemoriesBySequence(allMemories, false);
    const recencyMemories = sliceToTokenBudget(recentSorted, recencyBudget);
    const selectedIds = new Set(recencyMemories.map((m) => m.id));

    // Step B: Importance - from remaining, importance >= 4
    const remaining = allMemories.filter((m) => !selectedIds.has(m.id));
    const highImportance = remaining
        .filter((m) => (m.importance || 3) >= 4)
        .sort((a, b) => {
            // Sort by importance desc, then sequence desc
            const impDiff = (b.importance || 3) - (a.importance || 3);
            return impDiff !== 0 ? impDiff : (b.sequence || 0) - (a.sequence || 0);
        });
    const importanceMemories = sliceToTokenBudget(highImportance, importanceBudget);

    // Calculate remaining budget after importance selection
    let usedImportanceBudget = 0;
    for (const m of importanceMemories) {
        usedImportanceBudget += countTokens(m.summary);
        selectedIds.add(m.id);
    }

    // Step C: Fill remaining importance budget with more recent memories
    const fillBudget = importanceBudget - usedImportanceBudget;
    let fillMemories = [];
    if (fillBudget > 0) {
        const stillRemaining = remaining.filter((m) => !selectedIds.has(m.id));
        const recentRemaining = sortMemoriesBySequence(stillRemaining, false);
        fillMemories = sliceToTokenBudget(recentRemaining, fillBudget);
    }

    // Step D: Merge all selected memories
    const mergedMemories = [...recencyMemories, ...importanceMemories, ...fillMemories];

    // Step E: Final sort by sequence ascending (chronological order for LLM)
    return sortMemoriesBySequence(mergedMemories, true);
}

/**
 * Filter out events that are too similar to existing memories OR to each other within the batch.
 * @param {Object[]} newEvents - Events to filter
 * @param {Object[]} existingMemories - Already-stored memories
 * @param {number} cosineThreshold - Cosine similarity threshold for existing memory dedup
 * @param {number} jaccardThreshold - Jaccard token similarity threshold for intra-batch dedup
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
                keptEvent.mentions = (keptEvent.mentions || 1) + 1;
                break;
            }
        }
        if (!isDuplicate) kept.push(event);
    }
    record('event_dedup', performance.now() - t0, `${newEvents.length}×${existingMemories?.length || 0} O(n×m)`);
    return kept;
}

// =============================================================================
// Pipeline Stage Functions (internal — called by orchestrators below)
// =============================================================================

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
 */
export async function synthesizeReflections(data, characterNames, settings, options = {}) {
    const { abortSignal = null } = options;
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
}

/**
 * Run community detection, edge consolidation, and community summarization.
 * Wrapped in try-catch — community errors are non-fatal and logged.
 *
 * @param {Object} data - OpenVault data object (mutated in-place)
 * @param {Object} settings - Extension settings
 * @param {string} characterName - Main character name (for main character key derivation)
 * @param {string} userName - User name (for main character key derivation)
 */
async function synthesizeCommunities(data, settings, characterName, userName) {
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
            if (communityUpdateResult.global_world_state) {
                data.global_world_state = communityUpdateResult.global_world_state;
            }
            await applySyncChanges(communityUpdateResult.stChanges);
            logDebug(`Community detection: ${communityResult.count} communities found`);
        }
    } catch (error) {
        logError('Community detection error', error);
    }
}

/**
 * Stage 1: Fetch events from LLM.
 * @param {Object} contextParams - Context parameters
 * @param {string} contextParams.messagesText
 * @param {{char: string, user: string}} contextParams.names - Character names
 * @param {string} contextParams.charDesc
 * @param {string} contextParams.personaDesc
 * @param {string} contextParams.preamble
 * @param {string} contextParams.prefill
 * @param {'auto'|'en'|'ru'} contextParams.outputLanguage
 * @param {Array} existingMemories - Curated memory subset for prompt context
 * @param {AbortSignal} [abortSignal] - Abort signal for mid-request cancellation
 * @returns {Promise<{events: ExtractedEvent[]}>}
 */
async function fetchEventsFromLLM(contextParams, existingMemories, abortSignal) {
    const prompt = buildEventExtractionPrompt({
        messages: contextParams.messagesText,
        names: contextParams.names,
        context: {
            memories: existingMemories,
            charDesc: contextParams.charDesc,
            personaDesc: contextParams.personaDesc,
        },
        preamble: contextParams.preamble,
        prefill: contextParams.prefill,
        outputLanguage: contextParams.outputLanguage,
    });

    const t0 = performance.now();
    const eventJson = await callLLM(prompt, LLM_CONFIGS.extraction_events, {
        structured: true,
        signal: abortSignal,
    });
    record('llm_events', performance.now() - t0);
    return parseEventExtractionResponse(eventJson);
}

/**
 * Stage 2: Fetch graph entities and relationships from LLM.
 * @param {Object} contextParams - Context parameters
 * @param {string} contextParams.messagesText
 * @param {{char: string, user: string}} contextParams.names - Character names
 * @param {string} contextParams.charDesc
 * @param {string} contextParams.personaDesc
 * @param {string} contextParams.preamble
 * @param {string} contextParams.prefill
 * @param {'auto'|'en'|'ru'} contextParams.outputLanguage
 * @param {string[]} formattedEvents - Pre-formatted event strings for the prompt
 * @param {AbortSignal} [abortSignal] - Abort signal for mid-request cancellation
 * @returns {Promise<GraphExtraction>}
 */
async function fetchGraphFromLLM(contextParams, formattedEvents, abortSignal) {
    try {
        const prompt = buildGraphExtractionPrompt({
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

        const t0 = performance.now();
        const graphJson = await callLLM(prompt, LLM_CONFIGS.extraction_graph, {
            structured: true,
            signal: abortSignal,
        });
        record('llm_graph', performance.now() - t0);
        return parseGraphExtractionResponse(graphJson);
    } catch (error) {
        // AbortError = session cancel (chat switch) — must propagate
        if (error.name === 'AbortError') throw error;
        logError('Graph extraction failed, continuing with events only', error);
        return { entities: [], relationships: [] };
    }
}

/**
 * Stage 3: Stamp metadata on raw events, enrich with embeddings, and deduplicate.
 *
 * @param {Array} rawEvents - Events from LLM (no metadata yet)
 * @param {number[]} messageIdsArray - Source message IDs for this batch
 * @param {string[]} messageFingerprintsArray - Source message fingerprints for this batch
 * @param {string} batchId - Unique batch identifier
 * @param {Array} existingMemories - All existing memories (for dedup comparison)
 * @param {Object} settings - Extension settings
 * @returns {Promise<{events: Array}>}
 */
async function enrichAndDedupEvents(
    rawEvents,
    messageIdsArray,
    messageFingerprintsArray,
    batchId,
    existingMemories,
    settings
) {
    const minMessageId = Math.min(...messageIdsArray);

    let events = rawEvents.map((event, index) => ({
        id: `event_${Date.now()}_${index}`,
        type: 'event',
        ...event,
        tokens: tokenize(event.summary || ''),
        message_ids: messageIdsArray,
        message_fingerprints: messageFingerprintsArray,
        sequence: minMessageId * 1000 + index,
        created_at: Date.now(),
        batch_id: batchId,
        characters_involved: event.characters_involved || [],
        witnesses: (event.witnesses?.length > 0 ? event.witnesses : event.characters_involved) || [],
        location: event.location || null,
        is_secret: event.is_secret || false,
        importance: event.importance || 3,
        emotional_impact: event.emotional_impact || {},
        relationship_impact: event.relationship_impact || {},
    }));

    if (events.length > 0) {
        await enrichEventsWithEmbeddings(events);

        const dedupThreshold = settings.dedupSimilarityThreshold;
        const jaccardThreshold = settings.dedupJaccardThreshold;
        const preDedupCount = events.length;
        events = await filterSimilarEvents(events, existingMemories, dedupThreshold, jaccardThreshold);

        if (events.length < preDedupCount) {
            logDebug(`Dedup: Filtered ${preDedupCount - events.length} similar events`);
        }
    }

    return { events };
}

/**
 * Stage 4: Process graph updates (entity upserts, relationship upserts).
 * @param {Object} graphData - Graph data object (mutated in-place)
 * @param {Entity[]} entities - Entities from graph extraction
 * @param {Relationship[]} relationships - Relationships from graph extraction
 * @param {Object} settings - Extension settings
 * @returns {Promise<{graphSyncChanges: StSyncChanges}>}
 */
async function processGraphUpdates(graphData, entities, relationships, settings) {
    const graphSyncChanges = { toSync: [], toDelete: [] };

    if (entities?.length) {
        const entityCap = ENTITY_DESCRIPTION_CAP;
        const t0Merge = performance.now();
        const existingNodeCount = Object.keys(graphData.nodes).length;
        for (const entity of entities) {
            if (entity.name === 'Unknown') continue;
            const { stChanges: entityChanges } = await mergeOrInsertEntity(
                graphData,
                entity.name,
                entity.type,
                entity.description,
                entityCap,
                settings
            );
            graphSyncChanges.toSync.push(...entityChanges.toSync);
            graphSyncChanges.toDelete.push(...entityChanges.toDelete);
        }
        record('entity_merge', performance.now() - t0Merge, `${entities.length}×${existingNodeCount} nodes`);
    }

    if (relationships?.length) {
        const edgeCap = EDGE_DESCRIPTION_CAP;
        for (const rel of relationships) {
            if (rel.source === 'Unknown' || rel.target === 'Unknown') continue;
            upsertRelationship(graphData, rel.source, rel.target, rel.description, edgeCap);
        }
    }

    // Clean up runtime-only merge redirects (don't persist to storage)
    delete graphData._mergeRedirects;
    return { graphSyncChanges };
}

/**
 * Extract memories from a batch of messages.
 * Phase 1: Events + Graph extraction (critical, gates UI)
 * Phase 2: Reflections + Communities (non-critical, deferred during backfill)
 * @param {number[]} [messageIds=null] - Optional specific message IDs for targeted extraction
 * @param {string} [targetChatId=null] - Optional chat ID to verify before saving
 * @param {ExtractionOptions} [options={}] - Extraction options
 * @returns {Promise<{status: string, events_created?: number, messages_processed?: number, reason?: string}>}
 */
export async function extractMemories(messageIds = null, targetChatId = null, options = {}) {
    if (!isExtensionEnabled()) {
        return { status: 'skipped', reason: 'disabled' };
    }

    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    const context = deps.getContext();
    const chat = context.chat;

    // Guard: No chat
    if (!chat || chat.length === 0) {
        return { status: 'skipped', reason: 'no_messages' };
    }

    const data = getOpenVaultData();
    if (!data) {
        return { status: 'skipped', reason: 'no_context' };
    }

    // Stage 1: Message Selection
    let messagesToExtract = [];

    if (!messageIds || messageIds.length === 0) {
        // Defensive: use scheduler to get next batch if no IDs provided
        const batch = getNextBatch(chat, data, settings?.extractionTokenBudget || 2000);
        if (!batch) {
            logDebug('No messages to extract (scheduler returned empty batch)');
            return { status: 'skipped', reason: 'no_new_messages' };
        }
        messagesToExtract = batch.map((id) => ({ id, ...chat[id] }));
    } else {
        messagesToExtract = messageIds.map((id) => ({ id, ...chat[id] })).filter((m) => m != null);
    }

    if (messagesToExtract.length === 0) {
        return { status: 'skipped', reason: 'no_new_messages' };
    }

    const messages = messagesToExtract;
    const batchId = `batch_${deps.Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const { abortSignal = null } = options;

    logDebug(`Extracting ${messages.length} messages`);

    try {
        // Build context params once
        const characterName = context.name2;
        const userName = context.name1;

        const messagesText = messages
            .map((m) => {
                const speaker = m.is_user ? userName : m.name || characterName;
                return `[${speaker}]: ${m.mes}`;
            })
            .join('\n\n');

        const characterDescription = context.characters?.[context.characterId]?.description || '';
        const personaDescription = context.powerUserSettings?.persona_description || '';
        const contextParams = {
            messagesText,
            names: { char: characterName, user: userName },
            charDesc: characterDescription,
            personaDesc: personaDescription,
            preamble: resolveExtractionPreamble(settings),
            prefill: resolveExtractionPrefill(settings),
            outputLanguage: resolveOutputLanguage(settings),
        };

        // Stage 1: Event extraction (LLM call)
        const existingMemories = selectMemoriesForExtraction(data, settings);
        const { events: rawEvents } = await fetchEventsFromLLM(contextParams, existingMemories, abortSignal);

        // Stage 2: Graph extraction (LLM call)
        let graphResult = { entities: [], relationships: [] };
        await rpmDelay(settings, 'Inter-call rate limit');
        const formattedEvents = rawEvents.map((e, i) => `${i + 1}. [${e.importance}★] ${e.summary}`);
        graphResult = await fetchGraphFromLLM(contextParams, formattedEvents, abortSignal);

        // Stage 3: Enrich & dedup events
        const messageIdsArray = messages.map((m) => m.id);
        const messageFingerprintsArray = messages.map((m) => getFingerprint(m));
        logDebug(`LLM returned ${rawEvents.length} events from ${messages.length} messages`);
        const { events } = await enrichAndDedupEvents(
            rawEvents,
            messageIdsArray,
            messageFingerprintsArray,
            batchId,
            data.memories || [],
            settings
        );

        // Stamp embedding model ID on first successful embedding generation
        if (events.length > 0 && !data.embedding_model_id && events.some((e) => hasEmbedding(e))) {
            data.embedding_model_id = settings.embeddingSource;
            if (settings.embeddingSource === EMBEDDING_SOURCES.ST_VECTOR) {
                const { stampStVectorFingerprint } = await import('../embeddings/migration.js');
                stampStVectorFingerprint(data);
            }
        }

        // Stage 4: Graph updates
        const { graphSyncChanges } = await processGraphUpdates(
            data.graph,
            graphResult.entities,
            graphResult.relationships,
            settings
        );
        incrementGraphMessageCount(messages.length);

        // ===== PHASE 1 COMMIT: Events + Graph are done =====
        if (events.length > 0) {
            // Canonicalize cross-script character names before downstream consumption
            canonicalizeEventCharNames(events, [characterName, userName], data.graph?.nodes);
            addMemories(events);
            updateCharacterStatesFromEvents(events, data, [characterName, userName]);
        }

        // Mark processed AFTER events are committed to memories
        const processedFps = messages.map((m) => getFingerprint(m));
        markMessagesProcessed(processedFps);
        logDebug(`Phase 1 complete: ${events.length} events, ${processedFps.length} messages processed`);

        // Update IDF cache after Phase 1 commit — corpus has changed
        updateIDFCache(data, data.graph?.nodes);

        // Intermediate save — Phase 1 data is now persisted
        const phase1Saved = await saveOpenVaultData(targetChatId);
        if (!phase1Saved && targetChatId) {
            throw new Error('Chat changed during extraction');
        }

        // Sync events + graph to ST Vector Storage (single applySyncChanges call)
        const eventSyncChanges = { toSync: [], toDelete: [] };
        for (const e of events.filter((e) => !isStSynced(e))) {
            const text = `[OV_ID:${e.id}] ${e.summary}`;
            eventSyncChanges.toSync.push({ hash: cyrb53(text), text, item: e });
        }
        await applySyncChanges({
            toSync: [...eventSyncChanges.toSync, ...graphSyncChanges.toSync],
            toDelete: [...graphSyncChanges.toDelete],
        });

        // ===== PHASE 2: Enrichment (non-critical) =====
        try {
            // Stage 5: Reflection check (per character in new events)
            if (events.length > 0) {
                accumulateImportance(data.reflection_state, events);

                // ===== Backfill guard: skip Phase 2 LLM synthesis =====
                if (options.isBackfill) {
                    logDebug('Backfill mode: skipping Phase 2 LLM synthesis for this batch');
                    return { status: 'success', events_created: events.length, messages_processed: messages.length };
                }
                // ===== END BACKFILL GUARD =====

                // Collect unique characters from new events
                const characters = new Set();
                for (const event of events) {
                    for (const c of event.characters_involved || []) characters.add(c);
                    for (const w of event.witnesses || []) characters.add(w);
                }

                await rpmDelay(settings, 'Phase 2 reflection rate limit');
                await synthesizeReflections(data, [...characters], settings, { abortSignal });
            }

            // Stage 6: Community detection (interval check)
            const communityInterval = settings.communityDetectionInterval;
            const prevCount = (data.graph_message_count || 0) - messages.length;
            const currCount = data.graph_message_count || 0;
            if (Math.floor(currCount / communityInterval) > Math.floor(prevCount / communityInterval)) {
                await rpmDelay(settings, 'Phase 2 community rate limit');
                await synthesizeCommunities(data, settings, characterName, userName);
            }

            // Final save — Phase 2 enrichment persisted
            // Update IDF cache before save — reflections/communities may have been added
            updateIDFCache(data, data.graph?.nodes);
            await saveOpenVaultData(targetChatId);
        } catch (phase2Error) {
            // AbortError must propagate — it's not a Phase 2 failure, it's a session cancel
            if (phase2Error.name === 'AbortError') throw phase2Error;

            logError('Phase 2 error', phase2Error, { characterName });
            logDebug(`Phase 2 failed but Phase 1 data is safe: ${phase2Error.message}`);
            // Do NOT re-throw. Phase 1 data is already saved.
        }

        if (events.length > 0) {
            logInfo(`Extracted ${events.length} events`);
        } else {
            logDebug('No significant events found in messages');
        }

        return {
            status: 'success',
            events_created: events.length,
            messages_processed: messages.length,
        };
    } catch (error) {
        if (error.name === 'AbortError') throw error; // Don't log cancellation
        logError('Extraction error', error, { messageCount: messages.length });
        throw error;
    }
}

export async function runPhase2Enrichment(data, settings, targetChatId, options = {}) {
    const { abortSignal = null } = options;

    // Guard: No memories to enrich
    if (!data[MEMORIES_KEY]?.length) {
        logDebug('runPhase2Enrichment: No memories to enrich');
        return;
    }

    logDebug('runPhase2Enrichment: Starting comprehensive Phase 2 synthesis');

    try {
        // Enforce RPM spacing from the last Phase 1 API call to avoid 502s
        await rpmDelay(settings, 'Phase 2 rate limit');

        const characterNames = Object.keys(data.reflection_state || {});
        await synthesizeReflections(data, characterNames, settings, { abortSignal });

        await rpmDelay(settings, 'Phase 2 inter-step rate limit');

        const context = getDeps().getContext();
        await synthesizeCommunities(data, settings, context.name2, context.name1);

        // Update IDF cache before save — reflections may have been added
        updateIDFCache(data, data.graph?.nodes);
        await saveOpenVaultData(targetChatId);
        logInfo('runPhase2Enrichment: Complete');
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        logError('runPhase2Enrichment failed', error);
        throw error;
    }
}

/**
 * Extract memories from all unextracted messages in current chat
 * Processes in batches determined by extractionTokenBudget setting
 * @param {function|object} optionsOrCallback - Legacy callback OR options object
 */
export async function extractAllMessages(optionsOrCallback) {
    // v6: Normalize options to handle legacy function argument
    const opts = typeof optionsOrCallback === 'function' ? { onComplete: optionsOrCallback } : optionsOrCallback || {};

    const {
        isEmergencyCut = false,
        abortSignal = null,
        onComplete = null,
        // Backfill UI callbacks (non-Emergency-Cut path)
        onStart,
        onProgress,
        onPhase2Start,
        onBatchRetryWait,
        onFinish,
        onAbort,
        onError,
        // Emergency Cut path (unchanged)
        progressCallback = null,
    } = opts;
    const context = getDeps().getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
        showToast('warning', 'No chat messages to extract');
        return { messagesProcessed: 0, eventsCreated: 0 };
    }

    // Guard: Prevent concurrent extraction if background worker is running
    if (isWorkerRunning()) {
        showToast('warning', 'Background extraction in progress. Please wait.', 'OpenVault');
        return { messagesProcessed: 0, eventsCreated: 0 };
    }

    const settings = getDeps().getExtensionSettings()[extensionName];
    const tokenBudget = settings.extractionTokenBudget;
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat context available');
        return { messagesProcessed: 0, eventsCreated: 0 };
    }

    // v6: Check abort signal early (for Emergency Cut) - before any work
    if (abortSignal?.aborted) {
        throw new DOMException('Emergency Cut Cancelled', 'AbortError');
    }

    // Get initial estimate for progress display
    const { messageIds: initialMessageIds, batchCount: initialBatchCount } = getBackfillMessageIds(
        chat,
        data,
        tokenBudget,
        isEmergencyCut // Bypass token budget check for Emergency Cut
    );
    const processedFps = getProcessedFingerprints(data);

    if (processedFps.size > 0) {
        logDebug(`Backfill: Skipping ${processedFps.size} already-extracted messages`);
    }

    if (initialMessageIds.length === 0) {
        if (processedFps.size > 0) {
            showToast('info', `All eligible messages already extracted (${processedFps.size} messages have memories)`);
        } else {
            showToast('warning', `Not enough messages for a complete batch (need token budget met)`);
        }
        return { messagesProcessed: 0, eventsCreated: 0 };
    }

    // Notify caller that backfill is starting (skip for Emergency Cut - uses modal instead)
    if (!isEmergencyCut) {
        onStart?.(initialBatchCount);
    }

    // Capture chat ID to detect if user switches during backfill
    const targetChatId = getCurrentChatId();

    // Process in batches - re-fetch indices each iteration to handle chat mutations
    let totalEvents = 0;
    let batchesProcessed = 0;
    let messagesProcessed = 0;
    let currentBatch = null;
    let retryCount = 0;
    let cumulativeBackoffMs = 0;

    while (true) {
        // v6: Check abort signal at start of loop
        if (abortSignal?.aborted) {
            throw new DOMException('Emergency Cut Cancelled', 'AbortError');
        }

        // If we have no current batch or need to get a fresh one (after successful extraction)
        if (!currentBatch) {
            // Re-fetch current state to handle chat mutations (deletions/additions)
            const freshContext = getDeps().getContext();
            const freshChat = freshContext.chat;
            const freshData = getOpenVaultData();

            // Debug: log processed message tracking state
            const processedCount = (freshData?.processed_messages || []).length;
            const memoryCount = (freshData?.memories || []).length;
            logDebug(`Backfill state: ${processedCount} processed messages tracked, ${memoryCount} memories stored`);

            if (!freshChat || !freshData) {
                logDebug('Backfill: Lost chat context, stopping');
                break;
            }

            const { messageIds: freshIds, batchCount: remainingBatches } = getBackfillMessageIds(
                freshChat,
                freshData,
                tokenBudget,
                isEmergencyCut // Bypass token budget check for Emergency Cut
            );

            logDebug(
                `Backfill check: ${freshIds.length} unextracted messages available, ${remainingBatches} complete batches remaining`
            );

            // Get next batch using token budget
            currentBatch = getNextBatch(freshChat, freshData, tokenBudget, isEmergencyCut);
            if (!currentBatch) {
                logDebug('Backfill: No more complete batches available');
                break;
            }
        }

        // Update progress (toast for normal, callback for Emergency Cut)
        const _progress = Math.round((batchesProcessed / initialBatchCount) * 100);
        const retryText =
            retryCount > 0
                ? ` (retry ${retryCount}, backoff ${Math.round(cumulativeBackoffMs / 1000)}s/${Math.round(MAX_BACKOFF_TOTAL_MS / 1000)}s)`
                : '';

        if (!isEmergencyCut) {
            onProgress?.(batchesProcessed, initialBatchCount, totalEvents, retryText);
        } else if (progressCallback) {
            progressCallback(batchesProcessed + 1, initialBatchCount, totalEvents);
        }

        try {
            logDebug(`Processing batch ${batchesProcessed + 1}/${initialBatchCount}${retryText}...`);
            const result = await extractMemories(currentBatch, targetChatId, {
                isBackfill: true,
                silent: true,
                abortSignal, // v6: Pass signal to enable mid-request cancellation
            });
            totalEvents += result?.events_created || 0;
            messagesProcessed += currentBatch?.length || 0;

            // Success - clear current batch and reset retry count
            currentBatch = null;
            retryCount = 0;
            batchesProcessed++;

            await rpmDelay(settings, 'Batch rate limit');
        } catch (error) {
            // v6: AbortError propagation for Emergency Cut
            if (error.name === 'AbortError' || error.message === 'Chat changed during extraction') {
                if (isEmergencyCut) {
                    throw error; // Propagate to Emergency Cut handler
                }
                logDebug('Chat changed during backfill, aborting');
                clearAllLocks();
                onAbort?.();
                return { messagesProcessed: 0, eventsCreated: 0 };
            }

            retryCount++;
            const isTimeout = error.message.includes('timed out');
            const errorType = isTimeout ? 'timeout' : 'error';

            // Get backoff delay from schedule (cycle through schedule for retries beyond its length)
            const scheduleIndex = Math.min(retryCount - 1, BACKOFF_SCHEDULE_SECONDS.length - 1);
            const backoffSeconds = BACKOFF_SCHEDULE_SECONDS[scheduleIndex];
            const backoffMs = backoffSeconds * 1000;
            cumulativeBackoffMs += backoffMs;

            // If cumulative backoff exceeds limit, stop extraction entirely
            if (cumulativeBackoffMs >= MAX_BACKOFF_TOTAL_MS) {
                // v6: Throw for Emergency Cut instead of silent success
                if (isEmergencyCut) {
                    throw new Error(
                        `Extraction failed after ${Math.round(cumulativeBackoffMs / 1000)}s of API errors.`
                    );
                }

                logDebug(
                    `Batch ${batchesProcessed + 1} failed: cumulative backoff reached ${Math.round(cumulativeBackoffMs / 1000)}s (limit: ${Math.round(MAX_BACKOFF_TOTAL_MS / 1000)}s). Stopping extraction.`
                );
                logError('Extraction stopped after exceeding backoff limit', error);
                onError?.(
                    new Error(
                        `Extraction stopped: API errors persisted for ${Math.round(cumulativeBackoffMs / 1000)}s. Check your API connection and try again.`
                    )
                );
                break;
            }

            logDebug(
                `Batch ${batchesProcessed + 1} failed with ${errorType}, retrying in ${backoffSeconds}s (attempt ${retryCount}, cumulative backoff: ${Math.round(cumulativeBackoffMs / 1000)}s/${Math.round(MAX_BACKOFF_TOTAL_MS / 1000)}s)...`
            );

            // Notify caller of retry wait (skip for Emergency Cut - modal shows progress)
            if (!isEmergencyCut) {
                onBatchRetryWait?.(batchesProcessed, initialBatchCount, backoffSeconds, retryCount);
            }

            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            // Do NOT clear currentBatch or increment batchesProcessed - retry the same batch
        }
    }

    // ===== NEW: Run final Phase 2 synthesis (skip for Emergency Cut - speed priority) =====
    if (!isEmergencyCut) {
        // Update existing progress toast for the final heavy lifting
        logInfo('Backfill Phase 1 complete. Running final Phase 2 synthesis...');
        onPhase2Start?.();

        try {
            await runPhase2Enrichment(data, settings, targetChatId, { abortSignal });
        } catch (error) {
            logError('Final Phase 2 enrichment failed', error);
            onError?.(new Error('Events saved, but final summarization failed. You can re-run later.'));
            // Don't throw - Phase 1 data is safe
        }
    } else {
        logInfo('[Emergency Cut Debug] Skipping Phase 2 enrichment for speed');
    }
    // ===== END FINAL PHASE 2 =====

    // Reset operation state
    clearAllLocks();

    // Clear injection and save
    safeSetExtensionPrompt('');
    await getDeps().saveChatConditional();

    // Re-register event listeners
    if (onComplete) {
        onComplete(true);
    }

    // Notify caller of completion (skip for Emergency Cut - caller handles its own UI)
    if (!isEmergencyCut) {
        onFinish?.({ messagesProcessed, eventsCreated: totalEvents });
    }

    logDebug('Backfill complete');

    return { messagesProcessed, eventsCreated: totalEvents };
}
