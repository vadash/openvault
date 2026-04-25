// @ts-check

/**
 * OpenVault Extraction - Simplified Orchestrator
 *
 * Thin orchestrator that coordinates the 6-stage extraction pipeline through focused stage modules.
 * Previously: ~1400 lines of mixed concerns. Now: clear delegation to specialized modules.
 */

/** @typedef {import('../types').Memory} Memory */
/** @typedef {import('../types').Entity} Entity */
/** @typedef {import('../types').Relationship} Relationship */
/** @typedef {import('../types').ExtractedEvent} ExtractedEvent */
/** @typedef {import('../types').GraphExtraction} GraphExtraction */
/** @typedef {import('../types').StSyncChanges} StSyncChanges */
/** @typedef {import('../types').ExtractionOptions} ExtractionOptions */

import { EMBEDDING_SOURCES, extensionName, MEMORIES_KEY } from '../constants.js';
import { getDeps } from '../deps.js';
import {
    addMemories,
    getOpenVaultData,
    incrementGraphMessageCount,
    markMessagesProcessed,
    saveOpenVaultData,
} from '../store/chat-data.js';
import { cyrb53, hasEmbedding, isStSynced } from '../utils/embedding-codec.js';
import { logDebug, logError, logInfo } from '../utils/logging.js';
import { isExtensionEnabled } from '../utils/st-helpers.js';
import { getFingerprint } from './scheduler.js';
import {
    enrichAndDedupEvents,
    synthesizeCommunities,
    synthesizeReflections,
    updateIDFCache,
} from './stages/enrichment.js';
// Import stage modules
import { fetchEventsFromLLM, selectMemoriesForExtraction } from './stages/event-extraction.js';
import {
    canonicalizeEventCharNames,
    fetchGraphFromLLM,
    processGraphUpdates,
    updateCharacterStatesFromEvents,
} from './stages/graph-update.js';

/**
 * Main extraction function - orchestrates the 6-stage pipeline
 *
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
        const { getNextBatch } = await import('./scheduler.js');
        const batch = getNextBatch(
            chat,
            data,
            settings?.extractionTokenBudget || 2000,
            false,
            settings?.extractionMaxTurns || Infinity
        );
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

        // Disabled: passing char card / persona descriptions to extraction prompts causes the LLM
        // to extract static traits from the character sheet instead of actual conversation events.
        const characterDescription = '';
        const personaDescription = '';

        const { resolveExtractionPreamble, resolveExtractionPrefill, resolveOutputLanguage } = await import(
            '../prompts/index.js'
        );

        const contextParams = {
            messagesText,
            names: { char: characterName, user: userName },
            charDesc: characterDescription,
            personaDesc: personaDescription,
            preamble: resolveExtractionPreamble(settings),
            prefill: resolveExtractionPrefill(settings),
            outputLanguage: resolveOutputLanguage(settings),
        };

        // Rate limiting delay between LLM calls
        await rpmDelay(settings, 'Inter-call rate limit');

        // Stage 1: Event extraction (LLM call)
        const existingMemories = selectMemoriesForExtraction(data, settings);
        const { events: rawEvents } = await fetchEventsFromLLM(contextParams, existingMemories, abortSignal);

        // Stage 2: Graph extraction (LLM call)
        const graphResult = await fetchGraphFromLLM(contextParams, rawEvents, abortSignal);

        // Stage 3: Enrich & dedup events
        const messageIdsArray = messages.map((m) => m.id);
        const messageFingerprintsArray = messages.map((m) => getFingerprint(m));
        logDebug(`LLM returned ${rawEvents.length} events from ${messages.length} messages`);

        // Canonicalize cross-script character names before enrichment
        canonicalizeEventCharNames(rawEvents, [characterName, userName], data.graph?.nodes);

        const { events } = await enrichAndDedupEvents(
            rawEvents,
            messageIdsArray,
            messageFingerprintsArray,
            data,
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
        const { stChanges: graphStChanges } = await processGraphUpdates(graphResult, data, settings);
        incrementGraphMessageCount(messages.length);

        // ===== PHASE 1 COMMIT: Events + Graph are done =====
        if (events.length > 0) {
            addMemories(events);
            // Note: updateCharacterStatesFromEvents needs to be called with raw events, not memories
            // so we call it before enrichment
            updateCharacterStatesFromEvents(rawEvents, data, [characterName, userName]);
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
        const { applySyncChanges } = await import('./backfill.js');
        const eventSyncChanges = { toSync: [], toDelete: [] };
        for (const e of events.filter((e) => !isStSynced(e))) {
            const text = `[OV_ID:${e.id}] ${e.summary}`;
            eventSyncChanges.toSync.push({ hash: cyrb53(text), text, item: e });
        }
        await applySyncChanges({
            toSync: [...eventSyncChanges.toSync, ...graphStChanges.toSync],
            toDelete: [...graphStChanges.toDelete],
        });

        // ===== PHASE 2: Enrichment (non-critical) =====
        try {
            // Stage 5: Reflection check (per character in new events)
            if (events.length > 0) {
                const { accumulateImportance } = await import('../reflection/reflect.js');
                accumulateImportance(data.reflection_state, events);

                // ===== Backfill guard: skip Phase 2 LLM synthesis =====
                if (options.isBackfill) {
                    logDebug('Backfill mode: skipping Phase 2 LLM synthesis for this batch');
                    return { status: 'success', events_created: events.length, messages_processed: messages.length };
                }
                // ===== END BACKFILL GUARD =====

                // Collect unique characters from new events
                const characters = new Set();
                for (const event of rawEvents) {
                    for (const c of event.characters_involved || []) characters.add(c);
                    for (const w of event.witnesses || []) characters.add(w);
                }

                await synthesizeReflections(data, [...characters], settings, { abortSignal });
            }

            // Stage 6: Community detection (interval check)
            const communityInterval = settings.communityDetectionInterval;
            const prevCount = (data.graph_message_count || 0) - messages.length;
            const currCount = data.graph_message_count || 0;
            if (Math.floor(currCount / communityInterval) > Math.floor(prevCount / communityInterval)) {
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

/**
 * Rate limiting delay for API calls
 * @param {Object} settings - Extension settings
 * @param {string} label - Log label
 * @returns {Promise<void>}
 */
async function rpmDelay(settings, label = 'Rate limit') {
    const rpm = settings.backfillMaxRPM;
    const delayMs = Math.ceil(60000 / rpm);
    const now = Date.now();
    /** @type {{ lastCallTime?: number }} */ (rpmDelay).lastCallTime =
        /** @type {{ lastCallTime?: number }} */ (rpmDelay).lastCallTime || 0;
    const timeSinceLastCall = now - /** @type {{ lastCallTime?: number }} */ (rpmDelay).lastCallTime;

    if (timeSinceLastCall < delayMs) {
        const sleepTime = delayMs - timeSinceLastCall;
        logDebug(`${label}: waiting ${sleepTime}ms (${rpm} RPM)`);
        await new Promise((r) => setTimeout(r, sleepTime));
    }
    /** @type {{ lastCallTime?: number }} */ (rpmDelay).lastCallTime = Date.now();
}

/**
 * Run Phase 2 enrichment (reflections and communities) on existing data
 *
 * @param {Object} data - OpenVault data object
 * @param {Object} settings - Extension settings
 * @param {string} targetChatId - Chat ID for save verification
 * @param {Object} [options={}] - Options
 * @param {AbortSignal} [options.abortSignal=null] - Abort signal
 * @returns {Promise<void>}
 */
export async function runPhase2Enrichment(data, settings, targetChatId, options = {}) {
    const { abortSignal = null } = options;

    // Guard: No memories to enrich
    if (!data[MEMORIES_KEY]?.length) {
        logDebug('runPhase2Enrichment: No memories to enrich');
        return;
    }

    logDebug('runPhase2Enrichment: Starting comprehensive Phase 2 synthesis');

    try {
        const characterNames = Object.keys(data.reflection_state || {});
        await synthesizeReflections(data, characterNames, settings, { abortSignal });

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

// Re-export backfill functions for external consumers
export { executeEmergencyCut, extractAllMessages, hideExtractedMessages } from './backfill.js';
