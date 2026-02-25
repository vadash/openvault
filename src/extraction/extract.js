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
 * Maximum number of retry attempts for a failed extraction batch
 */
const MAX_BATCH_RETRIES = 3;
import { getDeps } from '../deps.js';
import { enrichEventsWithEmbeddings } from '../embeddings.js';
import { callLLMForExtraction } from '../llm.js';
import { buildExtractionPrompt } from '../prompts.js';
import { cosineSimilarity } from '../retrieval/math.js';
import { clearAllLocks } from '../state.js';
import { refreshAllUI } from '../ui/render.js';
import { setStatus } from '../ui/status.js';
import {
    estimateTokens,
    getCurrentChatId,
    getOpenVaultData,
    isExtensionEnabled,
    log,
    safeSetExtensionPrompt,
    saveOpenVaultData,
    showToast,
    sliceToTokenBudget,
    sortMemoriesBySequence,
} from '../utils.js';
import { getBackfillMessageIds, getExtractedMessageIds } from './scheduler.js';
import { parseExtractionResponse } from './structured.js';

/**
 * Update character states based on extracted events
 * @param {Array} events - Extracted events
 * @param {Object} data - OpenVault data object
 */
function updateCharacterStatesFromEvents(events, data) {
    data[CHARACTERS_KEY] = data[CHARACTERS_KEY] || {};

    for (const event of events) {
        // Get message range for this event
        const messageIds = event.message_ids || [];
        const messageRange =
            messageIds.length > 0 ? { min: Math.min(...messageIds), max: Math.max(...messageIds) } : null;

        // Update emotional impact
        if (event.emotional_impact) {
            for (const [charName, emotion] of Object.entries(event.emotional_impact)) {
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
        usedImportanceBudget += estimateTokens(m.summary);
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
 * Filter out events that are too similar to existing memories
 */
function filterSimilarEvents(newEvents, existingMemories, threshold = 0.85) {
    if (!existingMemories?.length) return newEvents;

    return newEvents.filter((event) => {
        if (!event.embedding) return true;

        for (const memory of existingMemories) {
            if (!memory.embedding) continue;

            const similarity = cosineSimilarity(event.embedding, memory.embedding);
            if (similarity >= threshold) {
                log(`Dedup: Skipping "${event.summary}..." (${(similarity * 100).toFixed(1)}% similar to existing)`);
                return false;
            }
        }
        return true;
    });
}

/**
 * Extract events from chat messages
 *
 * @param {number[]} [messageIds=null] - Optional specific message IDs for targeted extraction
 * @param {string} [targetChatId=null] - Optional chat ID to verify before saving
 * @returns {Promise<{status: string, events_created?: number, messages_processed?: number, reason?: string}>}
 */
export async function extractMemories(messageIds = null, targetChatId = null) {
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
        // Incremental mode: Extract last few unprocessed messages
        const lastProcessedId = data[LAST_PROCESSED_KEY] || -1;
        const messageCount = settings.messagesPerExtraction || 5;

        messagesToExtract = chat
            .map((m, idx) => ({ id: idx, ...m }))
            .filter((m) => !m.is_system && m.id > lastProcessedId)
            .slice(-messageCount);
    }

    if (messagesToExtract.length === 0) {
        return { status: 'skipped', reason: 'no_new_messages' };
    }

    const messages = messagesToExtract;
    const batchId = `batch_${deps.Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

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

        const prompt = buildExtractionPrompt({
            messages: messagesText,
            names: { char: characterName, user: userName },
            context: {
                memories: existingMemories,
                charDesc: characterDescription,
                personaDesc: personaDescription,
            },
        });

        // Stage 3: LLM Execution
        const extractedJson = await callLLMForExtraction(prompt, { structured: true });
        const validated = parseExtractionResponse(extractedJson);
        let events = validated.events;

        // Enrich with metadata
        const messageIdsArray = messages.map((m) => m.id);
        const minMessageId = Math.min(...messageIdsArray);

        events = events.map((event, index) => ({
            id: `event_${Date.now()}_${index}`,
            ...event,
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

        // Track processed message IDs
        const processedIds = messages.map((m) => m.id);
        data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
        data[PROCESSED_MESSAGES_KEY].push(...processedIds);
        log(`Marked ${processedIds.length} messages as processed (total: ${data[PROCESSED_MESSAGES_KEY].length})`);

        // Stage 4: Event Processing (embedding + deduplication)
        if (events.length > 0) {
            await enrichEventsWithEmbeddings(events);

            const dedupThreshold = settings.dedupSimilarityThreshold ?? 0.85;
            const existingMemoriesList = data.memories || [];
            events = filterSimilarEvents(events, existingMemoriesList, dedupThreshold);

            if (events.length < validated.events.length) {
                log(`Dedup: Filtered ${validated.events.length - events.length} similar events`);
            }
        }

        // Stage 5: Result Committing
        const maxId = processedIds.length > 0 ? Math.max(...processedIds) : 0;

        if (events.length > 0) {
            data[MEMORIES_KEY] = data[MEMORIES_KEY] || [];
            data[MEMORIES_KEY].push(...events);

            updateCharacterStatesFromEvents(events, data);
        }

        data[LAST_PROCESSED_KEY] = Math.max(data[LAST_PROCESSED_KEY] || -1, maxId);

        const saved = await saveOpenVaultData(targetChatId);
        if (!saved && targetChatId) {
            throw new Error('Chat changed during extraction');
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
 * Processes in batches determined by messagesPerExtraction setting
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
    const messageCount = settings.messagesPerExtraction || 5;
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat context available');
        return;
    }

    // Get initial estimate for progress display
    const { messageIds: initialMessageIds, batchCount: initialBatchCount } = getBackfillMessageIds(
        chat,
        data,
        messageCount
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
            showToast('warning', `Not enough messages for a complete batch (need ${messageCount})`);
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
    let currentBatch = null;
    let retryCount = 0;

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
                messageCount
            );

            log(
                `Backfill check: ${freshIds.length} unextracted messages available, ${remainingBatches} complete batches remaining`
            );

            // No more complete batches available
            if (freshIds.length < messageCount) {
                log(`Backfill: No more complete batches available (need ${messageCount}, have ${freshIds.length})`);
                break;
            }

            // Take first batch from fresh list (oldest unextracted messages)
            currentBatch = freshIds.slice(0, messageCount);
        }

        // Update progress toast (use initial estimate for display consistency)
        const progress = Math.round((batchesProcessed / initialBatchCount) * 100);
        const retryText = retryCount > 0 ? ` (retry ${retryCount}/${MAX_BATCH_RETRIES})` : '';
        $('.openvault-backfill-toast .toast-message').text(
            `Backfill: ${batchesProcessed}/${initialBatchCount} batches (${Math.min(progress, 100)}%) - Processing...${retryText}`
        );

        try {
            log(`Processing batch ${batchesProcessed + 1}/${initialBatchCount}${retryText}...`);
            const result = await extractMemories(currentBatch, targetChatId);
            totalEvents += result?.events_created || 0;

            // Success - clear current batch and reset retry count
            currentBatch = null;
            retryCount = 0;
            batchesProcessed++;

            // Delay between batches based on rate limit setting
            const rpm = settings.backfillMaxRPM || 30;
            const delayMs = Math.ceil(60000 / rpm);
            log(`Rate limiting: waiting ${delayMs}ms (${rpm} RPM)`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
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

            if (retryCount < MAX_BATCH_RETRIES) {
                log(`Batch ${batchesProcessed + 1} failed with ${errorType}, retrying (${retryCount}/${MAX_BATCH_RETRIES})...`);
            } else {
                log(`Batch ${batchesProcessed + 1} failed after ${MAX_BATCH_RETRIES} retries, skipping...`);
                console.error('[OpenVault] Batch extraction error:', error);
                // Move to next batch
                currentBatch = null;
                retryCount = 0;
                batchesProcessed++; // Still count as processed (even if failed)
            }
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

    showToast('success', `Extracted ${totalEvents} events from ${batchesProcessed * messageCount} messages`);
    refreshAllUI();
    setStatus('ready');
    log('Backfill complete');
}
