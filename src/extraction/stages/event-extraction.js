// @ts-check

/**
 * OpenVault Extraction - Event Extraction Stage
 *
 * Handles Stage 1 of extraction pipeline: LLM event extraction and parsing.
 * Extracts memory events from conversation messages using structured LLM prompts.
 */

/** @typedef {import('../../types').ExtractedEvent} ExtractedEvent */
/** @typedef {import('../../types').ExtractionContextParams} ExtractionContextParams */
/** @typedef {import('../../types').Memory} Memory */

import { MEMORIES_KEY } from '../../constants.js';
import { callLLM, LLM_CONFIGS } from '../../llm.js';
import { buildEventExtractionPrompt } from '../../prompts/index.js';
import { logDebug } from '../../utils/logging.js';
import { sliceToTokenBudget, sortMemoriesBySequence } from '../../utils/text.js';
import { countTokens } from '../../utils/tokens.js';
import { parseEventExtractionResponse } from '../structured.js';

/**
 * Select relevant memories for LLM context during extraction.
 * Balances recency and importance using a token budget.
 *
 * @param {Object} data - OpenVault data object
 * @param {Object} settings - Extension settings
 * @returns {Memory[]} Selected memories for LLM context
 */
export function selectMemoriesForExtraction(data, settings) {
    const allMemories = data[MEMORIES_KEY] || [];
    const totalBudget = settings.extractionRearviewTokens;
    const recencyBudget = Math.floor(totalBudget * 0.25);
    const importanceBudget = totalBudget - recencyBudget;

    // Step A: Recency - most recent memories (sorted desc by sequence)
    const recentSorted = sortMemoriesBySequence(allMemories, false);
    const recencyMemories = sliceToTokenBudget(recentSorted, recencyBudget);
    const selectedIds = new Set(recencyMemories.map((m) => m.id));

    // Step B: Importance - from remaining, importance >= 4
    const remaining = allMemories.filter((m) => !selectedIds.has(m.id));
    const highImportance = remaining
        .filter((m) => (m.importance || 3) >= 4)
        .sort((a, b) => {
            // Sort by importance desc, then sequence desc
            const impDiff = (b.importance || 3) - (a.importance || 3);
            return impDiff !== 0 ? impDiff : (b.sequence || 0) - (a.sequence || 0);
        });
    const importanceMemories = sliceToTokenBudget(highImportance, importanceBudget);

    // Calculate remaining budget after importance selection
    let usedImportanceBudget = 0;
    for (const m of importanceMemories) {
        usedImportanceBudget += countTokens(m.summary);
        selectedIds.add(m.id);
    }

    // Step C: Fill remaining importance budget with more recent memories
    const fillBudget = importanceBudget - usedImportanceBudget;
    let fillMemories = [];
    if (fillBudget > 0) {
        const stillRemaining = remaining.filter((m) => !selectedIds.has(m.id));
        const recentRemaining = sortMemoriesBySequence(stillRemaining, false);
        fillMemories = sliceToTokenBudget(recentRemaining, fillBudget);
    }

    // Step D: Merge all selected memories
    const mergedMemories = [...recencyMemories, ...importanceMemories, ...fillMemories];

    // Step E: Final sort by sequence ascending (chronological order for LLM)
    return sortMemoriesBySequence(mergedMemories, true);
}

/**
 * Fetch events from LLM based on message context.
 *
 * @param {ExtractionContextParams} contextParams - Extraction context parameters
 * @param {Memory[]} existingMemories - Existing memories for context
 * @param {AbortSignal} abortSignal - Abort signal for cancellation
 * @returns {Promise<{events: ExtractedEvent[]}>}
 */
export async function fetchEventsFromLLM(contextParams, existingMemories, abortSignal) {
    const eventPrompt = buildEventExtractionPrompt({
        messages: contextParams.messagesText,
        names: contextParams.names,
        context: {
            memories: existingMemories,
            charDesc: contextParams.charDesc,
            personaDesc: contextParams.personaDesc,
        },
        preamble: contextParams.preamble,
        prefill: contextParams.prefill,
        outputLanguage: contextParams.outputLanguage,
    });

    const eventResponse = await callLLM(eventPrompt, LLM_CONFIGS.EXTRACTION, { signal: abortSignal });

    const { events: rawEvents } = parseEventExtractionResponse(eventResponse);

    logDebug(`LLM extracted ${rawEvents.length} events from context`);

    return { events: rawEvents };
}
