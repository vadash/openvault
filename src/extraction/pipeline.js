/**
 * OpenVault Extraction Pipeline
 *
 * Main pipeline orchestration for memory extraction.
 * Decomposes the extraction process into discrete stages.
 */

import { getDeps } from '../deps.js';
import { getOpenVaultData, log } from '../utils.js';
import { extensionName } from '../constants.js';
import { selectMessagesToExtract } from './stages/message-selector.js';
import { buildPrompt } from './stages/prompt-builder.js';
import { executeLLM } from './stages/llm-executor.js';
import { processEvents } from './stages/event-processor.js';
import { commitResults } from './stages/result-committer.js';

/**
 * ExtractionPipeline - Orchestrates the 5-stage extraction process
 */
export class ExtractionPipeline {
    /**
     * @param {Object} settings - Extension settings
     */
    constructor(settings) {
        this.settings = settings;
    }

    /**
     * Run the full extraction pipeline
     * @param {number[]} [messageIds=null] - Optional specific message IDs for targeted extraction
     * @param {string} [targetChatId=null] - Optional chat ID to verify before saving
     * @returns {Promise<{status: string, events_created?: number, messages_processed?: number, reason?: string}>}
     */
    async run(messageIds = null, targetChatId = null) {
        const deps = getDeps();
        const context = deps.getContext();
        const chat = context.chat;

        if (!chat || chat.length === 0) {
            return { status: 'skipped', reason: 'no_messages' };
        }

        const data = getOpenVaultData();
        if (!data) {
            return { status: 'skipped', reason: 'no_context' };
        }

        // Stage 1: Message Selection
        const selectionResult = selectMessagesToExtract(chat, data, this.settings, messageIds);
        if (selectionResult.status === 'skipped') {
            return selectionResult;
        }
        const { messages, batchId } = selectionResult;

        log(`Extracting ${messages.length} messages`);

        try {
            // Stage 2: Prompt Building
            const prompt = buildPrompt(messages, context, data, this.settings);

            // Stage 3: LLM Execution
            const events = await executeLLM(prompt, messages, context, batchId, data);

            // Stage 4: Event Processing
            const finalEvents = await processEvents(events, data, this.settings);

            // Stage 5: Result Committing
            await commitResults(finalEvents, messages, data, targetChatId);

            return {
                status: 'success',
                events_created: finalEvents.length,
                messages_processed: messages.length,
            };
        } catch (error) {
            deps.console.error('[OpenVault] Extraction error:', error);
            throw error;
        }
    }
}
