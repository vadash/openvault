/**
 * OpenVault Memory Extraction
 *
 * Main extraction logic for extracting memories from messages.
 */

import { getDeps } from '../deps.js';
import { getOpenVaultData, saveOpenVaultData, showToast, log, sortMemoriesBySequence, sliceToTokenBudget, isExtensionEnabled, estimateTokens, getCurrentChatId } from '../utils.js';
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
 * @param {string} targetChatId - Optional chat ID to verify before saving (prevents saving to wrong chat if user switches)
 * @returns {Promise<{events_created: number, messages_processed: number}|undefined>}
 */
export async function extractMemories(messageIds = null, targetChatId = null) {
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

        // Hybrid selection: 25% recency, 75% importance
        const allMemories = data[MEMORIES_KEY] || [];
        const totalBudget = settings.extractionRearviewTokens || 12000;
        const recencyBudget = Math.floor(totalBudget * 0.25);
        const importanceBudget = totalBudget - recencyBudget;

        // Step A: Recency - most recent memories (sorted desc by sequence)
        const recentSorted = sortMemoriesBySequence(allMemories, false);
        const recencyMemories = sliceToTokenBudget(recentSorted, recencyBudget);
        const selectedIds = new Set(recencyMemories.map(m => m.id));

        // Step B: Importance - from remaining, importance >= 4
        const remaining = allMemories.filter(m => !selectedIds.has(m.id));
        const highImportance = remaining
            .filter(m => (m.importance || 3) >= 4)
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
            const stillRemaining = remaining.filter(m => !selectedIds.has(m.id));
            const recentRemaining = sortMemoriesBySequence(stillRemaining, false);
            fillMemories = sliceToTokenBudget(recentRemaining, fillBudget);
        }

        // Step D: Merge all selected memories
        const mergedMemories = [...recencyMemories, ...importanceMemories, ...fillMemories];

        // Step E: Final sort by sequence ascending (chronological order for LLM)
        const existingMemories = sortMemoriesBySequence(mergedMemories, true);

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

            // Verify chat hasn't changed before saving (prevents saving to wrong chat)
            if (targetChatId && getCurrentChatId() !== targetChatId) {
                log(`Chat changed during extraction (target: ${targetChatId}, current: ${getCurrentChatId()}), aborting save`);
                throw new Error('Chat changed during extraction');
            }

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
