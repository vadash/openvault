/**
 * OpenVault Memory Extraction
 *
 * Main extraction logic for extracting memories from messages.
 */

import { getContext, extension_settings } from '../../../../../extensions.js';
import { getOpenVaultData, saveOpenVaultData, showToast, log } from '../utils.js';
import { extensionName, MEMORIES_KEY, LAST_PROCESSED_KEY, LAST_BATCH_KEY } from '../constants.js';
import { callLLMForExtraction } from '../llm.js';
import { setStatus } from '../ui/status.js';
import { refreshAllUI } from '../ui/browser.js';
import { buildExtractionPrompt } from './prompts.js';
import { parseExtractionResult, updateCharacterStatesFromEvents, updateRelationshipsFromEvents } from './parser.js';

/**
 * Get recent memories for context during extraction
 * @param {number} count - Number of recent memories to retrieve (-1 = all, 0 = none)
 * @returns {Object[]} - Array of recent memory objects
 */
export function getRecentMemoriesForContext(count) {
    if (count === 0) return [];

    const data = getOpenVaultData();
    if (!data) return [];
    const memories = data[MEMORIES_KEY] || [];

    // Sort by sequence/creation time (newest first)
    const sorted = [...memories].sort((a, b) => {
        const seqA = a.sequence ?? a.created_at ?? 0;
        const seqB = b.sequence ?? b.created_at ?? 0;
        return seqB - seqA;
    });

    // Return all if count is -1, otherwise slice to count
    return count < 0 ? sorted : sorted.slice(0, count);
}

/**
 * Extract memories from messages using LLM
 * @param {number[]} messageIds - Optional specific message IDs to extract
 * @returns {Promise<{events_created: number, messages_processed: number}|undefined>}
 */
export async function extractMemories(messageIds = null) {
    const settings = extension_settings[extensionName];
    if (!settings.enabled) {
        showToast('warning', 'OpenVault is disabled');
        return;
    }

    const context = getContext();
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
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

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

        // Get existing memories for context (to avoid duplicates and maintain consistency)
        const memoryContextCount = settings.memoryContextCount || 0;
        const existingMemories = getRecentMemoriesForContext(memoryContextCount);

        const extractionPrompt = buildExtractionPrompt(messagesText, characterName, userName, existingMemories, characterDescription, personaDescription);

        // Call LLM for extraction (throws on error)
        const extractedJson = await callLLMForExtraction(extractionPrompt);

        // Parse and store extracted events
        const events = parseExtractionResult(extractedJson, messagesToExtract, characterName, userName, batchId);

        if (events.length > 0) {
            // Add events to storage
            data[MEMORIES_KEY] = data[MEMORIES_KEY] || [];
            data[MEMORIES_KEY].push(...events);

            // Update character states and relationships
            updateCharacterStatesFromEvents(events, data);
            updateRelationshipsFromEvents(events, data);

            // Update last processed message ID
            const maxId = Math.max(...messagesToExtract.map(m => m.id));
            data[LAST_PROCESSED_KEY] = Math.max(data[LAST_PROCESSED_KEY] || -1, maxId);

            // Store this batch ID as the most recent (for exclusion during retrieval)
            data[LAST_BATCH_KEY] = batchId;

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
        console.error('[OpenVault] Extraction error:', error);
        showToast('error', `Extraction failed: ${error.message}`);
        setStatus('error');
        throw error;
    }
}
