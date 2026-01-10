/**
 * UI action handlers for OpenVault settings panel.
 * Provides button click handlers that were previously passed via setExternalFunctions.
 */
import { getDeps } from '../deps.js';
import { extractAllMessages } from '../extraction/batch.js';
import { deleteCurrentChatData, deleteCurrentChatEmbeddings } from '../data/actions.js';
import { updateEventListeners } from '../listeners.js';
import { getOpenVaultData, showToast } from '../utils.js';
import { refreshAllUI } from './browser.js';
import { setStatus } from './status.js';
import { isEmbeddingsEnabled, generateEmbeddingsForMemories } from '../embeddings.js';

/**
 * Handle "Extract All Messages" button click.
 * Extracts memories from all chat messages.
 */
export async function handleExtractAll() {
    await extractAllMessages(updateEventListeners);
}

/**
 * Handle "Delete Chat Data" button click.
 * Removes all OpenVault data for current chat after confirmation.
 */
export async function handleDeleteChatData() {
    if (!confirm('Are you sure you want to delete all OpenVault data for this chat?')) {
        return;
    }

    const deleted = await deleteCurrentChatData();
    if (deleted) {
        showToast('success', 'Chat memories deleted');
        refreshAllUI();
    }
}

/**
 * Handle "Delete Embeddings" button click.
 * Removes embeddings only, keeping memory metadata.
 */
export async function handleDeleteEmbeddings() {
    if (!confirm('Are you sure you want to delete all embeddings for this chat?')) {
        return;
    }

    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat data available');
        return;
    }

    const count = await deleteCurrentChatEmbeddings();
    if (count > 0) {
        showToast('success', `Deleted ${count} embeddings`);
        refreshAllUI();
    } else {
        showToast('info', 'No embeddings to delete');
    }
}

/**
 * Generate embeddings for existing memories that don't have them
 */
export async function backfillEmbeddings() {
    if (!isEmbeddingsEnabled()) {
        showToast('warning', 'Configure Ollama URL and embedding model first');
        return;
    }

    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat data available');
        return;
    }

    const { MEMORIES_KEY } = await import('../constants.js');
    const memories = data[MEMORIES_KEY] || [];
    const needsEmbedding = memories.filter(m => !m.embedding);

    if (needsEmbedding.length === 0) {
        showToast('info', 'All memories already have embeddings');
        return;
    }

    showToast('info', `Generating embeddings for ${needsEmbedding.length} memories...`);
    setStatus('extracting');

    try {
        const count = await generateEmbeddingsForMemories(needsEmbedding);

        if (count > 0) {
            await getDeps().saveChatConditional();
            showToast('success', `Generated ${count} embeddings`);
            console.log(`[OpenVault] Backfill complete: generated ${count} embeddings for existing memories`);
        } else {
            showToast('warning', 'No embeddings generated - check Ollama connection');
        }
    } catch (error) {
        console.error('[OpenVault] Backfill embeddings error:', error);
        showToast('error', `Embedding generation failed: ${error.message}`);
    }

    setStatus('ready');
    refreshAllUI();
}
