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
    const rpm = settings.backfillMaxRPM || 30;
    const delayMs = Math.ceil(60000 / rpm);
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCallTime;

    if (timeSinceLastCall < delayMs) {
        const sleepTime = delayMs - timeSinceLastCall;
        log(`${label}: waiting ${sleepTime}ms (${rpm} RPM)`);
        await new Promise((r) => setTimeout(r, sleepTime));
    }
    lastApiCallTime = Date.now();
}

import { getDeps } from '../deps.js';
import { enrichEventsWithEmbeddings } from '../embeddings.js';
import { buildCommunityGroups, detectCommunities, updateCommunitySummaries } from '../graph/communities.js';
import {
    expandMainCharacterKeys,
    initGraphState,
    mergeOrInsertEntity,
    normalizeKey,
    upsertRelationship,
} from '../graph/graph.js';
import { callLLM, LLM_CONFIGS } from '../llm.js';
import { buildEventExtractionPrompt, buildGraphExtractionPrompt } from '../prompts.js';
import { accumulateImportance, generateReflections, shouldReflect } from '../reflection/reflect.js';
import { cosineSimilarity, tokenize } from '../retrieval/math.js';
import { clearAllLocks } from '../state.js';
import { refreshAllUI } from '../ui/render.js';
import { setStatus } from '../ui/status.js';
import { getCurrentChatId, getOpenVaultData, saveOpenVaultData } from '../utils/data.js';
import { showToast } from '../utils/dom.js';
import { log } from '../utils/logging.js';
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
                    log(`Skipping invalid character name "${charName}" in emotional_impact`);
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
                log(`Skipping invalid character name "${witness}" in witnesses`);
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
        log(`Cleaned up ${removedEntries.length} invalid character states: ${removedEntries.join(', ')}`);
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
    const totalBudget = settings.extractionRearviewTokens || 12000;
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
    // Phase 1: Filter against existing memories (cosine)
    let filtered = newEvents;
    if (existingMemories?.length) {
        const results = [];
        let idx = 0;
        for (const event of newEvents) {
            if (idx % 10 === 0) await yieldToMain();
            idx++;
            if (!event.embedding) {
                results.push(event);
                continue;
            }
            let isDuplicate = false;
            for (const memory of existingMemories) {
                if (!memory.embedding) continue;
                const similarity = cosineSimilarity(event.embedding, memory.embedding);
                if (similarity >= cosineThreshold) {
                    log(
                        `Dedup: Skipping "${event.summary}..." (${(similarity * 100).toFixed(1)}% similar to existing)`
                    );
                    isDuplicate = true;
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
                log(
                    `Dedup: Skipping "${event.summary.slice(0, 60)}..." (Jaccard ${(jaccard * 100).toFixed(1)}% with "${keptEvent.summary.slice(0, 60)}...")`
                );
                isDuplicate = true;
                break;
            }
        }
        if (!isDuplicate) kept.push(event);
    }
    return kept;
}

/**
 * Extract events from chat messages
 *
 * @param {number[]} [messageIds=null] - Optional specific message IDs for targeted extraction
 * @param {string} [targetChatId=null] - Optional chat ID to verify before saving
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
        const tokenBudget = settings.extractionTokenBudget || 16000;
        const candidates = chat
            .map((m, idx) => ({ id: idx, ...m }))
            .filter((m) => !m.is_system && m.id > lastProcessedId);

        // Take from the end (newest), accumulate until budget
        let accumulated = 0;
        let startIdx = candidates.length;
        for (let i = candidates.length - 1; i >= 0; i--) {
            const tokens = getMessageTokenCount(chat, candidates[i].id, data);
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

    log(`Extracting ${messages.length} messages`);

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

        const prompt = buildEventExtractionPrompt({
            messages: messagesText,
            names: { char: characterName, user: userName },
            context: {
                memories: existingMemories,
                charDesc: characterDescription,
                personaDesc: personaDescription,
            },
        });

        // Stage 3A: Event Extraction (LLM Call 1)
        const eventJson = await callLLM(prompt, LLM_CONFIGS.extraction_events, { structured: true });
        const eventResult = parseEventExtractionResponse(eventJson);
        let events = eventResult.events;

        // Stage 3B: Graph Extraction (LLM Call 2) — skip if no events
        let graphResult = { entities: [], relationships: [] };
        if (events.length > 0) {
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
            });

            const graphJson = await callLLM(graphPrompt, LLM_CONFIGS.extraction_graph, { structured: true });
            graphResult = parseGraphExtractionResponse(graphJson);
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

        log(`LLM returned ${events.length} events from ${messages.length} messages`);

        // Track processed message IDs (will be committed in Phase 1)
        const processedIds = messages.map((m) => m.id);

        // Stage 4: Event Processing (embedding + deduplication)
        if (events.length > 0) {
            await enrichEventsWithEmbeddings(events);

            const dedupThreshold = settings.dedupSimilarityThreshold ?? 0.92;
            const jaccardThreshold = settings.dedupJaccardThreshold ?? 0.6;
            const existingMemoriesList = data.memories || [];
            events = await filterSimilarEvents(events, existingMemoriesList, dedupThreshold, jaccardThreshold);

            if (events.length < validated.events.length) {
                log(`Dedup: Filtered ${validated.events.length - events.length} similar events`);
            }
        }

        // Stage 4.5: Graph Update — upsert entities and relationships
        initGraphState(data);
        const entityCap = settings.entityDescriptionCap ?? 3;
        if (validated.entities) {
            for (const entity of validated.entities) {
                await mergeOrInsertEntity(
                    data.graph,
                    entity.name,
                    entity.type,
                    entity.description,
                    entityCap,
                    settings
                );
            }
        }
        const edgeCap = settings.edgeDescriptionCap ?? 5;
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
        log(`Phase 1 complete: ${events.length} events, ${processedIds.length} messages processed`);

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

                // Check each character for reflection trigger
                const reflectionThreshold = settings.reflectionThreshold ?? 30;
                for (const characterName of characters) {
                    if (shouldReflect(data.reflection_state, characterName, reflectionThreshold)) {
                        try {
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
                        } catch (error) {
                            deps.console.error(`[OpenVault] Reflection error for ${characterName}:`, error);
                        }
                    }
                }
            }

            // Stage 4.7: Community detection
            const communityInterval = settings.communityDetectionInterval ?? 50;
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
                        const groups = buildCommunityGroups(data.graph, communityResult.communities);
                        const stalenessThreshold = settings.communityStalenessThreshold ?? 100;
                        const isSingleCommunity = communityResult.count === 1;
                        data.communities = await updateCommunitySummaries(
                            data.graph,
                            groups,
                            data.communities || {},
                            currCount,
                            stalenessThreshold,
                            isSingleCommunity
                        );
                        log(`Community detection: ${communityResult.count} communities found`);
                    }
                } catch (error) {
                    deps.console.error('[OpenVault] Community detection error:', error);
                }
            }

            // Final save — Phase 2 enrichment persisted
            await saveOpenVaultData(targetChatId);
        } catch (phase2Error) {
            deps.console.error('[OpenVault] Phase 2 (reflection/community) error:', phase2Error);
            log(`Phase 2 failed but Phase 1 data is safe: ${phase2Error.message}`);
            // Do NOT re-throw. Phase 1 data is already saved.
        }

        if (events.length > 0) {
            log(`Extracted ${events.length} events`);
        } else {
            log('No significant events found in messages');
        }

        return {
            status: 'success',
            events_created: events.length,
            messages_processed: messages.length,
        };
    } catch (error) {
        deps.console.error('[OpenVault] Extraction error:', error);
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
    const tokenBudget = settings.extractionTokenBudget || 16000;
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
        log(`Backfill: Skipping ${alreadyExtractedIds.size} already-extracted messages`);
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
            log(`Backfill state: ${processedCount} processed messages tracked, ${memoryCount} memories stored`);

            if (!freshChat || !freshData) {
                log('Backfill: Lost chat context, stopping');
                break;
            }

            const { messageIds: freshIds, batchCount: remainingBatches } = getBackfillMessageIds(
                freshChat,
                freshData,
                tokenBudget
            );

            log(
                `Backfill check: ${freshIds.length} unextracted messages available, ${remainingBatches} complete batches remaining`
            );

            // Get next batch using token budget
            currentBatch = getNextBatch(freshChat, freshData, tokenBudget);
            if (!currentBatch) {
                log('Backfill: No more complete batches available');
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
            log(`Processing batch ${batchesProcessed + 1}/${initialBatchCount}${retryText}...`);
            const result = await extractMemories(currentBatch, targetChatId);
            totalEvents += result?.events_created || 0;
            messagesProcessed += currentBatch?.length || 0;

            // Success - clear current batch and reset retry count
            currentBatch = null;
            retryCount = 0;
            batchesProcessed++;

            await rpmDelay(settings, 'Batch rate limit');
        } catch (error) {
            // If chat changed, stop backfill entirely
            if (error.message === 'Chat changed during extraction') {
                log('Chat changed during backfill, aborting');
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
                log(
                    `Batch ${batchesProcessed + 1} failed: cumulative backoff reached ${Math.round(cumulativeBackoffMs / 1000)}s (limit: ${Math.round(MAX_BACKOFF_TOTAL_MS / 1000)}s). Stopping extraction.`
                );
                console.error('[OpenVault] Extraction stopped after exceeding backoff limit:', error);
                showToast(
                    'error',
                    `Extraction stopped: API errors persisted for ${Math.round(cumulativeBackoffMs / 1000)}s. Check your API connection and try again.`,
                    'OpenVault'
                );
                break;
            }

            log(
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
    log('Backfill complete');
}
