/**
 * OpenVault Extraction - Simplified Procedural Interface
 *
 * Consolidates the 5-stage extraction process into a single module.
 * Previously: ExtractionPipeline class + 5 separate stage files.
 */

import { getDeps } from '../deps.js';
import { getOpenVaultData, log, saveOpenVaultData, isExtensionEnabled } from '../utils.js';
import { MEMORIES_KEY, LAST_PROCESSED_KEY, PROCESSED_MESSAGES_KEY, extensionName } from '../constants.js';
import { buildExtractionPrompt } from '../prompts.js';
import { selectMemoriesForExtraction } from './context-builder.js';
import { callLLMForExtraction } from '../llm.js';
import { parseExtractionResponse } from './structured.js';
import { enrichEventsWithEmbeddings } from '../embeddings.js';
import { cosineSimilarity } from '../retrieval/math.js';
import { updateCharacterStatesFromEvents } from './parser.js';

/**
 * Filter out events that are too similar to existing memories
 */
function filterSimilarEvents(newEvents, existingMemories, threshold = 0.85) {
    if (!existingMemories?.length) return newEvents;

    return newEvents.filter(event => {
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
        messagesToExtract = messageIds
            .map(id => ({ id, ...chat[id] }))
            .filter(m => m != null);
    } else {
        // Incremental mode: Extract last few unprocessed messages
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

    const messages = messagesToExtract;
    const batchId = `batch_${deps.Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    log(`Extracting ${messages.length} messages`);

    try {
        // Stage 2: Prompt Building
        const characterName = context.name2;
        const userName = context.name1;

        const messagesText = messages.map(m => {
            const speaker = m.is_user ? userName : (m.name || characterName);
            return `[${speaker}]: ${m.mes}`;
        }).join('\n\n');

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
        const messageIdsArray = messages.map(m => m.id);
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
        const processedIds = messages.map(m => m.id);
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
