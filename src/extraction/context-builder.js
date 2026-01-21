/**
 * OpenVault Memory Context Builder
 *
 * Builds the memory context for extraction by selecting relevant memories
 * based on a hybrid of recency and importance scoring.
 */

import { sortMemoriesBySequence, sliceToTokenBudget, estimateTokens } from '../utils.js';
import { MEMORIES_KEY } from '../constants.js';

/**
 * Select relevant memories for extraction context using hybrid recency/importance
 * @param {Object} data - OpenVault data object
 * @param {Object} settings - Extension settings
 * @returns {Object[]} Selected memories sorted chronologically
 */
export function selectMemoriesForExtraction(data, settings) {
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
    const sortedMemories = sortMemoriesBySequence(mergedMemories, true);

    // DIAGNOSTIC: Log token budget details
    const estimatedTokens = mergedMemories.reduce((sum, m) => sum + estimateTokens(m.summary), 0);
    const formattedText = sortedMemories
        .map((m, i) => `${i + 1}. [${m.event_type || 'event'}] ${m.summary}`)
        .join('\n');
    const actualFormattedTokens = estimateTokens(formattedText);
    console.error(`[OpenVault DIAGNOSTIC] Token budget check:`);
    console.error(`  Budget: ${totalBudget}, Selected: ${sortedMemories.length} memories`);
    console.error(`  Estimated tokens (summary only): ${estimatedTokens}`);
    console.error(`  Actual formatted tokens (with prefix): ${actualFormattedTokens}`);
    console.error(`  Undercount: ${actualFormattedTokens - estimatedTokens} tokens`);
    console.error(`  Over budget by: ${Math.max(0, actualFormattedTokens - totalBudget)} tokens`);

    return sortedMemories;
}
