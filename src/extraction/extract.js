/**
 * OpenVault Extraction - Simplified Procedural Interface
 *
 * Consolidates the 5-stage extraction process into a single module.
 * Previously: ExtractionPipeline class + 5 separate stage files.
 */

import {
    CHARACTERS_KEY,
    extensionName,
    LAST_PROCESSED_KEY,
    MEMORIES_KEY,
    PROCESSED_MESSAGES_KEY,
} from '../constants.js';

/**
 * Backoff schedule in seconds for failed extraction batches.
 * Retries indefinitely through this schedule until cumulative backoff exceeds MAX_BACKOFF_TOTAL_MS.
 */
const BACKOFF_SCHEDULE_SECONDS = [1, 2, 3, 10, 20, 30, 30, 60, 60];

/**
 * Maximum cumulative backoff time before stopping extraction entirely (15 minutes)
 */
const MAX_BACKOFF_TOTAL_MS = 15 * 60 * 1000;

let lastApiCallTime = 0;

/**
 * Wait based on the configured RPM rate limit.
 * Accounts for elapsed time since the last call — only sleeps the remaining delta.
 * @param {Object} settings - Extension settings containing backfillMaxRPM
 * @param {string} [label='Rate limit'] - Log label
 */
async function rpmDelay(settings, label = 'Rate limit') {
    const rpm = settings.backfillMaxRPM;
    const delayMs = Math.ceil(60000 / rpm);
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCallTime;

    if (timeSinceLastCall < delayMs) {
        const sleepTime = delayMs - timeSinceLastCall;
        logDebug(`${label}: waiting ${sleepTime}ms (${rpm} RPM)`);
        await new Promise((r) => setTimeout(r, sleepTime));
    }
    lastApiCallTime = Date.now();
}

import { getDeps } from '../deps.js';
import { enrichEventsWithEmbeddings } from '../embeddings.js';
import { buildCommunityGroups, detectCommunities, updateCommunitySummaries } from '../graph/communities.js';
import {
    consolidateEdges,
    expandMainCharacterKeys,
    initGraphState,
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
import { cosineSimilarity, tokenize } from '../retrieval/math.js';
import { clearAllLocks } from '../state.js';
import { refreshAllUI } from '../ui/render.js';
import { setStatus } from '../ui/status.js';
import { getCurrentChatId, getOpenVaultData, saveOpenVaultData } from '../utils/data.js';
import { showToast } from '../utils/dom.js';
import { getEmbedding, hasEmbedding } from '../utils/embedding-codec.js';
import { logDebug, logError, logInfo } from '../utils/logging.js';
import { createLadderQueue } from '../utils/queue.js';
import { isExtensionEnabled, safeSetExtensionPrompt, yieldToMain } from '../utils/st-helpers.js';
import { sliceToTokenBudget, sortMemoriesBySequence } from '../utils/text.js';
import { countTokens, getMessageTokenCount } from '../utils/tokens.js';
import { getBackfillMessageIds, getExtractedMessageIds, getNextBatch } from './scheduler.js';
import { parseEventExtractionResponse, parseGraphExtractionResponse } from './structured.js';

/**
 * Update character states based on extracted events
 * @param {Array} events - Extracted events
 * @param {Object} data - OpenVault data object
 * @param {string[]} validCharNames - Known valid character names (e.g., [characterName, userName])
 */
export function updateCharacterStatesFromEvents(events, data, validCharNames = []) {
    data[CHARACTERS_KEY] = data[CHARACTERS_KEY] || {};

    // Build valid set from known names + all characters_involved from current events
    const validSet = new Set(validCharNames.map((n) => n.toLowerCase()));
    for (const event of events) {
        for (const char of event.characters_involved || []) {
            validSet.add(char.toLowerCase());
        }
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
                if (!validSet.has(charName.toLowerCase())) {
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
            if (!validSet.has(witness.toLowerCase())) {
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
    const validSet = new Set(validCharNames.map((n) => n.toLowerCase()));
    const memories = data[MEMORIES_KEY] || [];
    for (const memory of memories) {
        for (const char of memory.characters_involved || []) {
            validSet.add(char.toLowerCase());
        }
    }

    // Remove character state entries that are not in the valid set
    const removedEntries = [];
    for (const charName of Object.keys(data[CHARACTERS_KEY])) {
        if (!validSet.has(charName.toLowerCase())) {
            removedEntries.push(charName);
            delete data[CHARACTERS_KEY][charName];
        }
    }

    if (removedEntries.length > 0) {
        logDebug(`Cleaned up ${removedEntries.length} invalid character states: ${removedEntries.join(', ')}`);
    }
}

/**
 * Select relevant memories for extraction context using hybrid recency/importance
 * @param {Object} data - OpenVault data object
 * @param {Object} settings - Extension settings
 * @returns {Object[]} Selected memories sorted chronologically
 */
function selectMemoriesForExtraction(data, settings) {
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
export async function filterSimilarEvents(newEvents, existingMemories, cosineThreshold = 0.92, jaccardThreshold = 0.6) {
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
                    const intersection = [...eventTokens].filter((t) => memoryTokens.has(t)).length;
                    const union = new Set([...eventTokens, ...memoryTokens]).size;
                    const jaccard = union > 0 ? intersection / union : 0;

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
            const intersection = [...eventTokens].filter((t) => keptTokens.has(t)).length;
            const union = new Set([...eventTokens, ...keptTokens]).size;
            const jaccard = union > 0 ? intersection / union : 0;
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

/**
 * Extract events from chat messages
 *
 * @param {number[]} [messageIds=null] - Optional specific message IDs for targeted extraction
 * @param {string} [targetChatId=null] - Optional chat ID to verify before saving
 * @param {Object} [options={}] - Optional configuration
 * @param {boolean} [options.silent=false] - Suppress toast notifications
 * @param {boolean} [options.isBackfill=false] - Skip Phase 2 LLM synthesis (for backfill mode)
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

    if (messageIds && messageIds.length > 0) {
        // Targeted mode: When specific IDs are provided (e.g., backfill)
        messagesToExtract = messageIds.map((id) => ({ id, ...chat[id] })).filter((m) => m != null);
    } else {
        // Incremental mode: Extract last few unprocessed messages using token budget
        const lastProcessedId = data[LAST_PROCESSED_KEY] || -1;
        const tokenBudget = settings.extractionTokenBudget;
        const candidates = chat
            .map((m, idx) => ({ id: idx, ...m }))
            .filter((m) => !m.is_system && m.id > lastProcessedId);

        // Take from the end (newest), accumulate until budget
        let accumulated = 0;
        let startIdx = candidates.length;
        for (let i = candidates.length - 1; i >= 0; i--) {
            const tokens = getMessageTokenCount(chat, candidates[i].id);
            if (accumulated + tokens > tokenBudget && startIdx < candidates.length) break;
            accumulated += tokens;
            startIdx = i;
        }
        messagesToExtract = candidates.slice(startIdx);
    }

    if (messagesToExtract.length === 0) {
        return { status: 'skipped', reason: 'no_new_messages' };
    }

    const messages = messagesToExtract;
    const batchId = `batch_${deps.Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const _silent = options.silent || false;

    logDebug(`Extracting ${messages.length} messages`);

    try {
        // Stage 2: Prompt Building
        const characterName = context.name2;
        const userName = context.name1;

        const messagesText = messages
            .map((m) => {
                const speaker = m.is_user ? userName : m.name || characterName;
                return `[${speaker}]: ${m.mes}`;
            })
            .join('\n\n');

        const existingMemories = selectMemoriesForExtraction(data, settings);
        const characterDescription = context.characters?.[context.characterId]?.description || '';
        const personaDescription = context.powerUserSettings?.persona_description || '';

        const preamble = resolveExtractionPreamble(settings);
        const prefill = resolveExtractionPrefill(settings);
        const outputLanguage = resolveOutputLanguage(settings);
        const prompt = buildEventExtractionPrompt({
            messages: messagesText,
            names: { char: characterName, user: userName },
            context: {
                memories: existingMemories,
                charDesc: characterDescription,
                personaDesc: personaDescription,
            },
            preamble,
            prefill,
            outputLanguage,
        });

        // Stage 3A: Event Extraction (LLM Call 1)
        const t0Events = performance.now();
        const eventJson = await callLLM(prompt, LLM_CONFIGS.extraction_events, { structured: true });
        record('llm_events', performance.now() - t0Events);
        const eventResult = parseEventExtractionResponse(eventJson);
        let events = eventResult.events;

        // Stage 3B: Graph Extraction (LLM Call 2) — skip if no events
        // Wrapped in try-catch: graph failure degrades gracefully (events are still saved).
        // Without this, a persistent graph parse failure (model refusal, truncation, non-JSON)
        // would throw the entire batch, discard successfully extracted events, leave messages
        // unprocessed, and cause the worker to retry the same batch indefinitely.
        let graphResult = { entities: [], relationships: [] };
        if (events.length > 0) {
            try {
                await rpmDelay(settings, 'Inter-call rate limit');
                const formattedEvents = events.map((e, i) => `${i + 1}. [${e.importance}★] ${e.summary}`);
                const graphPrompt = buildGraphExtractionPrompt({
                    messages: messagesText,
                    names: { char: characterName, user: userName },
                    extractedEvents: formattedEvents,
                    context: {
                        charDesc: characterDescription,
                        personaDesc: personaDescription,
                    },
                    preamble,
                    prefill,
                    outputLanguage,
                });

                const t0Graph = performance.now();
                const graphJson = await callLLM(graphPrompt, LLM_CONFIGS.extraction_graph, { structured: true });
                record('llm_graph', performance.now() - t0Graph);
                graphResult = parseGraphExtractionResponse(graphJson);
            } catch (graphError) {
                // AbortError = session cancel (chat switch) — must propagate
                if (graphError.name === 'AbortError') throw graphError;
                logError('Graph extraction failed, continuing with events only', graphError);
            }
        }

        // Merge into unified validated object for downstream stages
        const validated = {
            events,
            entities: graphResult.entities,
            relationships: graphResult.relationships,
        };

        // Enrich with metadata
        const messageIdsArray = messages.map((m) => m.id);
        const minMessageId = Math.min(...messageIdsArray);

        events = events.map((event, index) => ({
            id: `event_${Date.now()}_${index}`,
            type: 'event',
            ...event,
            tokens: tokenize(event.summary || ''),
            message_ids: messageIdsArray,
            sequence: minMessageId * 1000 + index,
            created_at: Date.now(),
            batch_id: batchId,
            characters_involved: event.characters_involved || [],
            witnesses: event.witnesses || event.characters_involved || [],
            location: event.location || null,
            is_secret: event.is_secret || false,
            importance: event.importance || 3,
            emotional_impact: event.emotional_impact || {},
            relationship_impact: event.relationship_impact || {},
        }));

        logDebug(`LLM returned ${events.length} events from ${messages.length} messages`);

        // Track processed message IDs (will be committed in Phase 1)
        const processedIds = messages.map((m) => m.id);

        // Stage 4: Event Processing (embedding + deduplication)
        if (events.length > 0) {
            await enrichEventsWithEmbeddings(events);

            // Stamp embedding model ID on first successful embedding generation
            // Prevents invalidateStaleEmbeddings from treating this chat as "legacy" on next open
            if (!data.embedding_model_id && events.some((e) => hasEmbedding(e))) {
                data.embedding_model_id = settings.embeddingSource;
            }

            const dedupThreshold = settings.dedupSimilarityThreshold;
            const jaccardThreshold = settings.dedupJaccardThreshold;
            const existingMemoriesList = data.memories || [];
            events = await filterSimilarEvents(events, existingMemoriesList, dedupThreshold, jaccardThreshold);

            if (events.length < validated.events.length) {
                logDebug(`Dedup: Filtered ${validated.events.length - events.length} similar events`);
            }
        }

        // Stage 4.5: Graph Update — upsert entities and relationships
        initGraphState(data);
        const entityCap = settings.entityDescriptionCap;
        if (validated.entities) {
            const t0Merge = performance.now();
            const existingNodeCount = Object.keys(data.graph.nodes).length;
            for (const entity of validated.entities) {
                if (entity.name === 'Unknown') continue;
                await mergeOrInsertEntity(
                    data.graph,
                    entity.name,
                    entity.type,
                    entity.description,
                    entityCap,
                    settings
                );
            }
            record(
                'entity_merge',
                performance.now() - t0Merge,
                `${validated.entities.length}×${existingNodeCount} nodes`
            );
        }
        const edgeCap = settings.edgeDescriptionCap;
        if (validated.relationships) {
            for (const rel of validated.relationships) {
                if (rel.source === 'Unknown' || rel.target === 'Unknown') continue;
                upsertRelationship(data.graph, rel.source, rel.target, rel.description, edgeCap);
            }
        }
        data.graph_message_count = (data.graph_message_count || 0) + messages.length;
        // Clean up runtime-only merge redirects (don't persist to storage)
        delete data.graph._mergeRedirects;

        // ===== PHASE 1 COMMIT: Events + Graph are done =====
        const maxId = processedIds.length > 0 ? Math.max(...processedIds) : 0;

        if (events.length > 0) {
            data[MEMORIES_KEY] = data[MEMORIES_KEY] || [];
            data[MEMORIES_KEY].push(...events);
            updateCharacterStatesFromEvents(events, data, [characterName, userName]);
        }

        // Mark processed AFTER events are committed to memories
        data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
        data[PROCESSED_MESSAGES_KEY].push(...processedIds);
        data[LAST_PROCESSED_KEY] = Math.max(data[LAST_PROCESSED_KEY] || -1, maxId);
        logDebug(`Phase 1 complete: ${events.length} events, ${processedIds.length} messages processed`);

        // Intermediate save — Phase 1 data is now persisted
        const phase1Saved = await saveOpenVaultData(targetChatId);
        if (!phase1Saved && targetChatId) {
            throw new Error('Chat changed during extraction');
        }

        // ===== PHASE 2: Enrichment (non-critical) =====
        try {
            // Stage 4.6: Reflection check (per character in new events)
            if (events.length > 0) {
                initGraphState(data); // Ensures reflection_state exists
                accumulateImportance(data.reflection_state, events);

                // Collect unique characters from new events
                const characters = new Set();
                for (const event of events) {
                    for (const c of event.characters_involved || []) characters.add(c);
                    for (const w of event.witnesses || []) characters.add(w);
                }

                // ===== Backfill guard: skip Phase 2 LLM synthesis =====
                if (options.isBackfill) {
                    logDebug('Backfill mode: skipping Phase 2 LLM synthesis for this batch');
                    return { status: 'success', events_created: events.length, messages_processed: messages.length };
                }
                // ===== END BACKFILL GUARD =====

                // Check each character for reflection trigger
                const reflectionThreshold = settings.reflectionThreshold;
                const ladderQueue = await createLadderQueue(settings.maxConcurrency);
                const reflectionPromises = [];

                for (const characterName of characters) {
                    if (shouldReflect(data.reflection_state, characterName, reflectionThreshold)) {
                        reflectionPromises.push(
                            ladderQueue
                                .add(async () => {
                                    const reflections = await generateReflections(
                                        characterName,
                                        data[MEMORIES_KEY] || [],
                                        data[CHARACTERS_KEY] || {}
                                    );
                                    if (reflections.length > 0) {
                                        data[MEMORIES_KEY].push(...reflections);
                                    }
                                    // Reset accumulator after reflection
                                    data.reflection_state[characterName].importance_sum = 0;
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

            // Stage 4.7: Community detection
            const communityInterval = settings.communityDetectionInterval;
            const prevCount = (data.graph_message_count || 0) - messages.length;
            const currCount = data.graph_message_count || 0;
            // Check if we crossed a message boundary for community detection
            if (Math.floor(currCount / communityInterval) > Math.floor(prevCount / communityInterval)) {
                try {
                    // Derive node keys for main characters (user + char) to prune hairball edges
                    const baseKeys = [normalizeKey(characterName), normalizeKey(userName)];
                    const mainCharacterKeys = expandMainCharacterKeys(baseKeys, data.graph.nodes || {});
                    const communityResult = detectCommunities(data.graph, mainCharacterKeys);
                    if (communityResult) {
                        // Consolidate bloated edges before summarization
                        if (data.graph._edgesNeedingConsolidation?.length > 0) {
                            const consolidated = await consolidateEdges(data.graph, settings);
                            if (consolidated > 0) {
                                logDebug(`Consolidated ${consolidated} graph edges before community summarization`);
                            }
                        }

                        const groups = buildCommunityGroups(data.graph, communityResult.communities);
                        const stalenessThreshold = settings.communityStalenessThreshold;
                        const isSingleCommunity = communityResult.count === 1;
                        const communityUpdateResult = await updateCommunitySummaries(
                            data.graph,
                            groups,
                            data.communities || {},
                            currCount,
                            stalenessThreshold,
                            isSingleCommunity
                        );
                        data.communities = communityUpdateResult.communities;
                        if (communityUpdateResult.global_world_state) {
                            data.global_world_state = communityUpdateResult.global_world_state;
                        }
                        logDebug(`Community detection: ${communityResult.count} communities found`);
                    }
                } catch (error) {
                    logError('Community detection error', error);
                }
            }

            // Final save — Phase 2 enrichment persisted
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
        logError('Extraction error', error, { messageCount: messages.length });
        throw error;
    }
}

/**
 * Run Phase 2 enrichment (Reflections & Communities) independently.
 * Used after backfill completes to run comprehensive synthesis once.
 *
 * @param {Object} data - OpenVault data object (modified in-place)
 * @param {Object} settings - Extension settings
 * @param {string} targetChatId - Chat ID for change detection
 * @returns {Promise<void>}
 */
export async function runPhase2Enrichment(data, settings, targetChatId) {
    const memories = data[MEMORIES_KEY] || [];

    // Guard: No memories to enrich
    if (memories.length === 0) {
        logDebug('runPhase2Enrichment: No memories to enrich');
        return;
    }

    logDebug('runPhase2Enrichment: Starting comprehensive Phase 2 synthesis');

    try {
        // ===== REFLECTIONS: Process all characters with accumulated importance =====
        initGraphState(data); // Ensures reflection_state exists
        const characterNames = Object.keys(data.reflection_state || {});
        const reflectionThreshold = settings.reflectionThreshold;

        const ladderQueue = await createLadderQueue(settings.maxConcurrency);
        const reflectionPromises = [];

        for (const characterName of characterNames) {
            if (shouldReflect(data.reflection_state, characterName, reflectionThreshold)) {
                reflectionPromises.push(
                    ladderQueue
                        .add(async () => {
                            const reflections = await generateReflections(
                                characterName,
                                memories,
                                data[CHARACTERS_KEY] || {}
                            );
                            if (reflections.length > 0) {
                                data[MEMORIES_KEY].push(...reflections);
                            }
                            // Reset accumulator after reflection
                            data.reflection_state[characterName].importance_sum = 0;
                        })
                        .catch((error) => {
                            if (error.name === 'AbortError') throw error;
                            logError(`Reflection error for ${characterName}`, error);
                        })
                );
            }
        }

        await Promise.all(reflectionPromises);

        // ===== COMMUNITIES: Force-run unconditionally (skip interval check) =====
        const context = getDeps().getContext();
        const characterName = context.name2;
        const userName = context.name1;

        try {
            const baseKeys = [normalizeKey(characterName), normalizeKey(userName)];
            const mainCharacterKeys = expandMainCharacterKeys(baseKeys, data.graph.nodes || {});
            const communityResult = detectCommunities(data.graph, mainCharacterKeys);
            if (communityResult) {
                // Consolidate bloated edges before summarization
                if (data.graph._edgesNeedingConsolidation?.length > 0) {
                    const consolidated = await consolidateEdges(data.graph, settings);
                    if (consolidated > 0) {
                        logDebug(`Consolidated ${consolidated} graph edges before community summarization`);
                    }
                }

                const groups = buildCommunityGroups(data.graph, communityResult.communities);
                const stalenessThreshold = settings.communityStalenessThreshold;
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
                logDebug(`runPhase2Enrichment: ${communityResult.count} communities processed`);
            }
        } catch (error) {
            logError('Community detection error', error);
        }

        // Final save
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
 * @param {function} updateEventListenersFn - Function to update event listeners after backfill
 */
export async function extractAllMessages(updateEventListenersFn) {
    const context = getDeps().getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
        showToast('warning', 'No chat messages to extract');
        return;
    }

    const settings = getDeps().getExtensionSettings()[extensionName];
    const tokenBudget = settings.extractionTokenBudget;
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat context available');
        return;
    }

    // Get initial estimate for progress display
    const { messageIds: initialMessageIds, batchCount: initialBatchCount } = getBackfillMessageIds(
        chat,
        data,
        tokenBudget
    );
    const alreadyExtractedIds = getExtractedMessageIds(data);

    if (alreadyExtractedIds.size > 0) {
        logDebug(`Backfill: Skipping ${alreadyExtractedIds.size} already-extracted messages`);
    }

    if (initialMessageIds.length === 0) {
        if (alreadyExtractedIds.size > 0) {
            showToast(
                'info',
                `All eligible messages already extracted (${alreadyExtractedIds.size} messages have memories)`
            );
        } else {
            showToast('warning', `Not enough messages for a complete batch (need token budget met)`);
        }
        return;
    }

    // Show persistent progress toast
    setStatus('extracting');
    $(
        toastr?.info(`Backfill: 0/${initialBatchCount} batches (0%)`, 'OpenVault - Extracting', {
            timeOut: 0,
            extendedTimeOut: 0,
            tapToDismiss: false,
            toastClass: 'toast openvault-backfill-toast',
        })
    );

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
        // If we have no current batch or need to get a fresh one (after successful extraction)
        if (!currentBatch) {
            // Re-fetch current state to handle chat mutations (deletions/additions)
            const freshContext = getDeps().getContext();
            const freshChat = freshContext.chat;
            const freshData = getOpenVaultData();

            // Debug: log processed message tracking state
            const processedCount = (freshData?.processed_message_ids || []).length;
            const memoryCount = (freshData?.memories || []).length;
            logDebug(`Backfill state: ${processedCount} processed messages tracked, ${memoryCount} memories stored`);

            if (!freshChat || !freshData) {
                logDebug('Backfill: Lost chat context, stopping');
                break;
            }

            const { messageIds: freshIds, batchCount: remainingBatches } = getBackfillMessageIds(
                freshChat,
                freshData,
                tokenBudget
            );

            logDebug(
                `Backfill check: ${freshIds.length} unextracted messages available, ${remainingBatches} complete batches remaining`
            );

            // Get next batch using token budget
            currentBatch = getNextBatch(freshChat, freshData, tokenBudget);
            if (!currentBatch) {
                logDebug('Backfill: No more complete batches available');
                break;
            }
        }

        // Update progress toast (use initial estimate for display consistency)
        const progress = Math.round((batchesProcessed / initialBatchCount) * 100);
        const retryText =
            retryCount > 0
                ? ` (retry ${retryCount}, backoff ${Math.round(cumulativeBackoffMs / 1000)}s/${Math.round(MAX_BACKOFF_TOTAL_MS / 1000)}s)`
                : '';
        $('.openvault-backfill-toast .toast-message').text(
            `Backfill: ${batchesProcessed}/${initialBatchCount} batches (${Math.min(progress, 100)}%) - Processing...${retryText}`
        );

        try {
            logDebug(`Processing batch ${batchesProcessed + 1}/${initialBatchCount}${retryText}...`);
            const result = await extractMemories(currentBatch, targetChatId, { isBackfill: true, silent: true });
            totalEvents += result?.events_created || 0;
            messagesProcessed += currentBatch?.length || 0;

            // Success - clear current batch and reset retry count
            currentBatch = null;
            retryCount = 0;
            batchesProcessed++;

            await rpmDelay(settings, 'Batch rate limit');
        } catch (error) {
            // AbortError = chat switched (same as existing chat-change detection)
            if (error.name === 'AbortError' || error.message === 'Chat changed during extraction') {
                logDebug('Chat changed during backfill, aborting');
                $('.openvault-backfill-toast').remove();
                showToast('warning', 'Backfill aborted: chat changed', 'OpenVault');
                clearAllLocks();
                setStatus('ready');
                return;
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
                logDebug(
                    `Batch ${batchesProcessed + 1} failed: cumulative backoff reached ${Math.round(cumulativeBackoffMs / 1000)}s (limit: ${Math.round(MAX_BACKOFF_TOTAL_MS / 1000)}s). Stopping extraction.`
                );
                logError('Extraction stopped after exceeding backoff limit', error);
                showToast(
                    'error',
                    `Extraction stopped: API errors persisted for ${Math.round(cumulativeBackoffMs / 1000)}s. Check your API connection and try again.`,
                    'OpenVault'
                );
                break;
            }

            logDebug(
                `Batch ${batchesProcessed + 1} failed with ${errorType}, retrying in ${backoffSeconds}s (attempt ${retryCount}, cumulative backoff: ${Math.round(cumulativeBackoffMs / 1000)}s/${Math.round(MAX_BACKOFF_TOTAL_MS / 1000)}s)...`
            );

            // Update toast to show waiting state
            $('.openvault-backfill-toast .toast-message').text(
                `Backfill: ${batchesProcessed}/${initialBatchCount} batches - Waiting ${backoffSeconds}s before retry ${retryCount}...`
            );

            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            // Do NOT clear currentBatch or increment batchesProcessed - retry the same batch
        }
    }

    // ===== NEW: Run final Phase 2 synthesis =====
    // Update existing progress toast for the final heavy lifting
    logInfo('Backfill Phase 1 complete. Running final Phase 2 synthesis...');
    $('.openvault-backfill-toast .toast-message').text(
        `Backfill: 100% - Synthesizing world state and reflections. This may take a minute...`
    );

    try {
        await runPhase2Enrichment(data, settings, targetChatId);
    } catch (error) {
        logError('Final Phase 2 enrichment failed', error);
        showToast('warning', 'Events saved, but final summarization failed. You can re-run later.', 'OpenVault');
        // Don't throw - Phase 1 data is safe
    }
    // ===== END FINAL PHASE 2 =====

    // Now clear it when everything is truly done
    // Clear progress toast
    $('.openvault-backfill-toast').remove();

    // Reset operation state
    clearAllLocks();

    // Clear injection and save
    safeSetExtensionPrompt('');
    await getDeps().saveChatConditional();

    // Re-register event listeners
    if (updateEventListenersFn) {
        updateEventListenersFn(true);
    }

    showToast('success', `Extracted ${totalEvents} events from ${messagesProcessed} messages`);
    refreshAllUI();
    setStatus('ready');
    logDebug('Backfill complete');
}
