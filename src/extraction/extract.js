/**
 * OpenVault Memory Extraction
 *
 * Thin wrapper that creates ExtractionPipeline and runs it.
 * All extraction logic has been moved to pipeline.js and stages/.
 * Returns result objects; callers handle UI feedback (toasts, status).
 */

import { getDeps } from '../deps.js';
import { isExtensionEnabled } from '../utils.js';
import { extensionName } from '../constants.js';
import { ExtractionPipeline } from './pipeline.js';

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

    const pipeline = new ExtractionPipeline(settings);
    return pipeline.run(messageIds, targetChatId);
}
