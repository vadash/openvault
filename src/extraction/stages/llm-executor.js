/**
 * OpenVault Extraction Pipeline - Stage 3: LLM Execution
 *
 * Calls the LLM for extraction and parses the result into structured events.
 * Also tracks processed message IDs for backfill deduplication.
 */

import { callLLMForExtraction } from '../../llm.js';
import { parseExtractionResult } from '../parser.js';
import { PROCESSED_MESSAGES_KEY } from '../../constants.js';

/**
 * Execute LLM extraction and parse results
 * @param {string} prompt - The extraction prompt
 * @param {Array} messages - Source messages (for metadata)
 * @param {Object} context - Deps context
 * @param {string} batchId - Unique batch ID
 * @param {Object} data - OpenVault data object (mutated with processed IDs)
 * @returns {Promise<Array>} Parsed event objects
 */
export async function executeLLM(prompt, messages, context, batchId, data) {
    // Call LLM for extraction (throws on error)
    const extractedJson = await callLLMForExtraction(prompt);

    const characterName = context.name2;
    const userName = context.name1;

    // Parse and store extracted events
    const events = parseExtractionResult(extractedJson, messages, characterName, userName, batchId);

    // Track processed message IDs (prevents re-extraction on backfill)
    const processedIds = messages.map(m => m.id);
    data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
    data[PROCESSED_MESSAGES_KEY].push(...processedIds);

    return events;
}
