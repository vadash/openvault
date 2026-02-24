/**
 * OpenVault Extraction Pipeline - Stage 3: LLM Execution
 *
 * Calls the LLM for extraction and parses the result into structured events.
 * Also tracks processed message IDs for backfill deduplication.
 */

import { callLLMForExtraction } from '../../llm.js';
import { parseExtractionResult } from '../parser.js';
import { parseExtractionResponse } from '../structured.js';
import { PROCESSED_MESSAGES_KEY } from '../../constants.js';
import { log } from '../../utils.js';

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
    // Call LLM for extraction with structured output enabled
    const extractedJson = await callLLMForExtraction(prompt, { structured: true });

    const characterName = context.name2;
    const userName = context.name1;

    let events;

    try {
        // Parse with Zod validation
        const validated = parseExtractionResponse(extractedJson);
        events = validated.events;
    } catch (error) {
        // Fallback to old parser if validation fails
        console.warn('[OpenVault] Structured validation failed, falling back to legacy parser:', error.message);

        // Try to parse as structured format first (events array wrapper)
        const parsed = JSON.parse(extractedJson);
        const eventsToParse = parsed.events || parsed;  // Handle both {events: [...]} and direct array

        // Convert back to string for parseExtractionResult
        const fallbackJson = Array.isArray(eventsToParse) ? JSON.stringify(eventsToParse) : extractedJson;
        events = parseExtractionResult(fallbackJson, messages, characterName, userName, batchId);

        // Return early since parseExtractionResult already handles enrichment
        const processedIds = messages.map(m => m.id);
        data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
        data[PROCESSED_MESSAGES_KEY].push(...processedIds);
        return events;
    }

    // Enrich validated events with metadata
    const messageIds = messages.map(m => m.id);
    const minMessageId = Math.min(...messageIds);

    const enrichedEvents = events.map((event, index) => ({
        id: `event_${Date.now()}_${index}`,
        ...event,
        message_ids: messageIds,
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

    log(`LLM returned ${enrichedEvents.length} events from ${messages.length} messages`);

    // Track processed message IDs (prevents re-extraction on backfill)
    const processedIds = messages.map(m => m.id);
    data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
    data[PROCESSED_MESSAGES_KEY].push(...processedIds);
    log(`Marked ${processedIds.length} messages as processed (total: ${data[PROCESSED_MESSAGES_KEY].length})`);

    return enrichedEvents;
}
