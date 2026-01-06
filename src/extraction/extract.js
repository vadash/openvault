/**
 * OpenVault Memory Extraction
 *
 * Main extraction logic for extracting memories from messages.
 */

import { getDeps } from '../deps.js';
import { getOpenVaultData, saveOpenVaultData, showToast, log, sortMemoriesBySequence, sliceToTokenBudget, isExtensionEnabled } from '../utils.js';
import { extensionName, MEMORIES_KEY, LAST_PROCESSED_KEY } from '../constants.js';
import { callLLMForExtraction } from '../llm.js';
import { setStatus } from '../ui/status.js';
import { refreshAllUI } from '../ui/browser.js';
import { buildExtractionPrompt } from '../prompts.js';
import { parseExtractionResult, updateCharacterStatesFromEvents, updateRelationshipsFromEvents, applyRelationshipDecay } from './parser.js';
import { getEmbedding, isEmbeddingsEnabled } from '../embeddings.js';

/**
 * Extract memories from messages using LLM
 * @param {number[]} messageIds - Optional specific message IDs to extract
 * @returns {Promise<{events_created: number, messages_processed: number}|undefined>}
 */
export async function extractMemories(messageIds = null) {
    if (!isExtensionEnabled()) {
        showToast('warning', 'OpenVault is disabled');
        return;
    }

    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    const context = deps.getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
        showToast('warning', 'No chat messages to extract');
        return;
    }

    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat context available');
        return;
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
        showToast('info', 'No new messages to extract');
        return;
    }

    log(`Extracting ${messagesToExtract.length} messages`);
    setStatus('extracting');

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

        // Get existing memories for context using token budget (sorted newest first)
        const allMemories = data[MEMORIES_KEY] || [];
        const sortedMemories = sortMemoriesBySequence(allMemories, false);
        const existingMemories = sliceToTokenBudget(sortedMemories, settings.extractionRearviewTokens);

        const extractionPrompt = buildExtractionPrompt(messagesText, characterName, userName, existingMemories, characterDescription, personaDescription);

        // Call LLM for extraction (throws on error)
        const extractedJson = await callLLMForExtraction(extractionPrompt);

        // Parse and store extracted events
        const events = parseExtractionResult(extractedJson, messagesToExtract, characterName, userName, batchId);

        if (events.length > 0) {
            // Generate embeddings for new events if Ollama is configured
            if (isEmbeddingsEnabled()) {
                log(`Generating embeddings for ${events.length} new events`);
                for (const event of events) {
                    if (event.summary) {
                        const embedding = await getEmbedding(event.summary);
                        if (embedding) {
                            event.embedding = embedding;
                        }
                    }
                }
            }

            // Add events to storage
            data[MEMORIES_KEY] = data[MEMORIES_KEY] || [];
            data[MEMORIES_KEY].push(...events);

            // Update character states and relationships
            updateCharacterStatesFromEvents(events, data);
            updateRelationshipsFromEvents(events, data);

            // Update last processed message ID
            const maxId = Math.max(...messagesToExtract.map(m => m.id));

            // Apply relationship decay based on message intervals
            applyRelationshipDecay(data, maxId);

            data[LAST_PROCESSED_KEY] = Math.max(data[LAST_PROCESSED_KEY] || -1, maxId);

            await saveOpenVaultData();

            log(`Extracted ${events.length} events`);
            showToast('success', `Extracted ${events.length} memory events`);
        } else {
            showToast('info', 'No significant events found in messages');
        }

        setStatus('ready');
        refreshAllUI();

        return { events_created: events.length, messages_processed: messagesToExtract.length };
    } catch (error) {
        getDeps().console.error('[OpenVault] Extraction error:', error);
        showToast('error', `Extraction failed: ${error.message}`);
        setStatus('error');
        throw error;
    }
}
