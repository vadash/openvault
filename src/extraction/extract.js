/**
 * OpenVault Memory Extraction
 *
 * Main extraction logic for extracting memories from messages.
 * Returns result objects; callers handle UI feedback (toasts, status).
 */

import { getDeps } from '../deps.js';
import { getOpenVaultData, saveOpenVaultData, log, isExtensionEnabled } from '../utils.js';
import { extensionName, MEMORIES_KEY, LAST_PROCESSED_KEY, PROCESSED_MESSAGES_KEY } from '../constants.js';
import { callLLMForExtraction } from '../llm.js';
import { buildExtractionPrompt } from '../prompts.js';
import { parseExtractionResult, updateCharacterStatesFromEvents, updateRelationshipsFromEvents } from './parser.js';
import { applyRelationshipDecay } from '../simulation.js';
import { selectMemoriesForExtraction } from './context-builder.js';
import { enrichEventsWithEmbeddings } from '../embeddings.js';
import { cosineSimilarity } from '../retrieval/math.js';

/**
 * Filter out events that are too similar to existing memories
 * @param {Object[]} newEvents - Newly extracted events with embeddings
 * @param {Object[]} existingMemories - Existing memories with embeddings
 * @param {number} threshold - Similarity threshold (0-1, default 0.85)
 * @returns {Object[]} Filtered events that are sufficiently unique
 */
function filterSimilarEvents(newEvents, existingMemories, threshold = 0.85) {
    if (!existingMemories?.length) return newEvents;

    return newEvents.filter(event => {
        if (!event.embedding) return true; // Keep if no embedding

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
 * Extract memories from messages using LLM
 * @param {number[]} messageIds - Optional specific message IDs to extract
 * @param {string} targetChatId - Optional chat ID to verify before saving (prevents saving to wrong chat if user switches)
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

    if (!chat || chat.length === 0) {
        return { status: 'skipped', reason: 'no_messages' };
    }

    const data = getOpenVaultData();
    if (!data) {
        return { status: 'skipped', reason: 'no_context' };
    }

    // Get messages to extract
    let messagesToExtract = [];
    if (messageIds && messageIds.length > 0) {
        // When specific IDs are provided (e.g., backfill), include hidden messages
        messagesToExtract = messageIds
            .map(id => ({ id, ...chat[id] }))
            .filter(m => m);
    } else {
        // Extract last few unprocessed messages (configurable count)
        const lastProcessedId = data[LAST_PROCESSED_KEY] || -1;
        const messageCount = settings.messagesPerExtraction || 5;
        messagesToExtract = chat
            .map((m, idx) => ({ id: idx, ...m }))
            .filter(m => !m.is_system && m.id > lastProcessedId)
            .slice(-messageCount);
    }

    if (messagesToExtract.length === 0) {
        return { status: 'skipped', reason: 'no_new_messages' };
    }

    log(`Extracting ${messagesToExtract.length} messages`);

    // Generate a unique batch ID for this extraction run
    const batchId = `batch_${deps.Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
        const characterName = context.name2;
        const userName = context.name1;

        // Get character description from character card
        const characterDescription = context.characters?.[context.characterId]?.description || '';

        // Get persona description
        const personaDescription = context.powerUserSettings?.persona_description || '';

        // Build extraction prompt
        const messagesText = messagesToExtract.map(m => {
            const speaker = m.is_user ? userName : (m.name || characterName);
            return `[${speaker}]: ${m.mes}`;
        }).join('\n\n');

        // Select relevant memories using hybrid recency/importance strategy
        const existingMemories = selectMemoriesForExtraction(data, settings);

        const extractionPrompt = buildExtractionPrompt({
            messages: messagesText,
            names: { char: characterName, user: userName },
            context: {
                memories: existingMemories,
                charDesc: characterDescription,
                personaDesc: personaDescription,
            },
        });

        // Call LLM for extraction (throws on error)
        const extractedJson = await callLLMForExtraction(extractionPrompt);

        // Parse and store extracted events
        const events = parseExtractionResult(extractedJson, messagesToExtract, characterName, userName, batchId);

        // Track processed message IDs (prevents re-extraction on backfill)
        const processedIds = messagesToExtract.map(m => m.id);
        data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
        data[PROCESSED_MESSAGES_KEY].push(...processedIds);

        if (events.length > 0) {
            // Generate embeddings for new events
            await enrichEventsWithEmbeddings(events);

            // Filter out events too similar to existing memories
            const dedupThreshold = settings.dedupSimilarityThreshold ?? 0.85;
            const existingMemories = data[MEMORIES_KEY] || [];
            const uniqueEvents = filterSimilarEvents(events, existingMemories, dedupThreshold);

            if (uniqueEvents.length < events.length) {
                log(`Dedup: Filtered ${events.length - uniqueEvents.length} similar events`);
            }

            if (uniqueEvents.length > 0) {
                // Add events to storage
                data[MEMORIES_KEY] = data[MEMORIES_KEY] || [];
                data[MEMORIES_KEY].push(...uniqueEvents);

                // Update character states and relationships
                updateCharacterStatesFromEvents(uniqueEvents, data);
                updateRelationshipsFromEvents(uniqueEvents, data);
            }

            // Update last processed message ID
            const maxId = Math.max(...processedIds);

            // Apply relationship decay based on message intervals
            applyRelationshipDecay(data, maxId);

            data[LAST_PROCESSED_KEY] = Math.max(data[LAST_PROCESSED_KEY] || -1, maxId);

            log(`Extracted ${uniqueEvents.length} events (${events.length - uniqueEvents.length} filtered as duplicates)`);
        } else {
            log('No significant events found in messages');
        }

        // Save with chat ID verification to prevent saving to wrong chat
        const saved = await saveOpenVaultData(targetChatId);
        if (!saved && targetChatId) {
            throw new Error('Chat changed during extraction');
        }

        return { status: 'success', events_created: events.length, messages_processed: messagesToExtract.length };
    } catch (error) {
        getDeps().console.error('[OpenVault] Extraction error:', error);
        throw error;
    }
}
