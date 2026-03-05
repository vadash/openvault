/**
 * OpenVault Reflection Engine
 *
 * Per-character reflection system inspired by the Smallville paper.
 * Synthesizes raw events into high-level insights.
 *
 * REFLECTION BUDGET MECHANISM:
 * - Primary: 3-Tier Replacement (filterDuplicateReflections) prevents accumulation
 *   by replacing similar reflections (80-89% similarity) rather than adding.
 * - Secondary: Hard cap (maxReflectionsPerCharacter: 50) archives oldest reflections
 *   when exceeded.
 * - Tertiary: Pre-Flight Similarity Gate skips generation when recent events
 *   align with existing insights (>85%).
 */

import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { enrichEventsWithEmbeddings, getQueryEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { parseInsightExtractionResponse, parseSalientQuestionsResponse } from '../extraction/structured.js';
import { callLLM, LLM_CONFIGS } from '../llm.js';
import { filterMemoriesByPOV } from '../pov.js';
import { buildInsightExtractionPrompt, buildSalientQuestionsPrompt } from '../prompts.js';
import { cosineSimilarity } from '../retrieval/math.js';
import { generateId, log, sortMemoriesBySequence } from '../utils.js';

const REFLECTION_THRESHOLD = 40;

/**
 * Check if a character has accumulated enough importance to trigger reflection.
 * @param {Object} reflectionState - Per-character accumulators
 * @param {string} characterName
 * @param {number} threshold - Importance threshold (default: 30)
 * @returns {boolean}
 */
export function shouldReflect(reflectionState, characterName, threshold = REFLECTION_THRESHOLD) {
    const charState = reflectionState[characterName];
    if (!charState) return false;
    return charState.importance_sum >= threshold;
}

/**
 * Accumulate importance scores from newly extracted events for each involved character.
 * Includes both characters_involved and witnesses.
 * @param {Object} reflectionState - Mutated in place
 * @param {Array} newEvents - Newly extracted event memories
 */
export function accumulateImportance(reflectionState, newEvents) {
    for (const event of newEvents) {
        const importance = event.importance || 3;
        const allCharacters = new Set([...(event.characters_involved || []), ...(event.witnesses || [])]);

        for (const charName of allCharacters) {
            if (!reflectionState[charName]) {
                reflectionState[charName] = { importance_sum: 0 };
            }
            reflectionState[charName].importance_sum += importance;
        }
    }
}

/**
 * Filter out reflections that are too similar to existing reflections for the same character.
 * Uses a 3-tier similarity threshold:
 * - >= 90% (Reject): Too similar, discard new reflection
 * - 80% - 89% (Replace): Similar theme with newer wording, replace old with new
 * - < 80% (Add): Genuinely new insight, add to collection
 *
 * @param {Array} newReflections - Newly generated reflections
 * @param {Array} existingMemories - All existing memories
 * @param {number} rejectThreshold - Cosine similarity threshold for rejection (default: 0.90)
 * @param {number} replaceThreshold - Cosine similarity threshold for replacement (default: 0.80)
 * @returns {{toAdd: Array, toArchiveIds: string[]}} Reflections to add and IDs to archive
 */
export function filterDuplicateReflections(
    newReflections,
    existingMemories,
    rejectThreshold = 0.9,
    replaceThreshold = 0.8
) {
    const existingReflections = existingMemories.filter((m) => m.type === 'reflection' && m.embedding);
    const toAdd = [];
    const toArchiveIds = new Set();

    for (const ref of newReflections) {
        if (!ref.embedding) {
            toAdd.push(ref);
            continue;
        }

        const sameCharReflections = existingReflections.filter((m) => m.character === ref.character);
        let bestMatch = null;
        let bestScore = 0;

        for (const existing of sameCharReflections) {
            const sim = cosineSimilarity(ref.embedding, existing.embedding);
            if (sim > bestScore) {
                bestMatch = existing;
                bestScore = sim;
            }
        }

        if (bestMatch && bestScore >= rejectThreshold) {
            // Tier 1: Reject - too similar
            log(
                `Reflection rejected: "${ref.summary}" (${(bestScore * 100).toFixed(1)}% similar to existing "${bestMatch.summary}")`
            );
            continue;
        }

        if (bestMatch && bestScore >= replaceThreshold) {
            // Tier 2: Replace - same theme, newer wording
            log(
                `Reflection replaced: OLD "${bestMatch.summary}" -> NEW "${ref.summary}" (${(bestScore * 100).toFixed(1)}% correlation)`
            );
            toArchiveIds.add(bestMatch.id);
            toAdd.push(ref);
            continue;
        }

        // Tier 3: Add - genuinely new
        toAdd.push(ref);
    }

    return { toAdd, toArchiveIds: Array.from(toArchiveIds) };
}

/**
 * Check if reflection generation should be skipped due to high alignment
 * between recent events and existing reflections.
 *
 * @param {Array} recentMemories - Recent memories that triggered reflection threshold
 * @param {Array} existingReflections - Existing reflections for the character
 * @param {number} threshold - Similarity threshold for skipping (default: 0.85)
 * @returns {{shouldSkip: boolean, reason: string|null}}
 */
export function shouldSkipReflectionGeneration(recentMemories, existingReflections, threshold = 0.85) {
    if (!recentMemories.length || !existingReflections.length) {
        return { shouldSkip: false, reason: null };
    }

    // Calculate average embedding of recent memories (or use top 3 most important)
    const topRecent = recentMemories
        .filter((m) => m.embedding)
        .sort((a, b) => (b.importance || 3) - (a.importance || 3))
        .slice(0, 3);

    if (topRecent.length === 0) {
        return { shouldSkip: false, reason: null };
    }

    // For each top recent memory, check if it aligns with existing reflections
    let alignCount = 0;
    for (const recent of topRecent) {
        for (const reflection of existingReflections) {
            if (!reflection.embedding) continue;
            const sim = cosineSimilarity(recent.embedding, reflection.embedding);
            if (sim >= threshold) {
                alignCount++;
                break;
            }
        }
    }

    // If majority of recent events align with existing insights, skip generation
    if (alignCount >= Math.ceil(topRecent.length / 2)) {
        return {
            shouldSkip: true,
            reason: `Reflection skipped: ${alignCount}/${topRecent.length} recent events align with existing insights (>${(threshold * 100).toFixed(0)}%)`,
        };
    }

    return { shouldSkip: false, reason: null };
}

/**
 * Run the 3-step reflection pipeline for a single character.
 *
 * Step 1: Generate 3 salient questions from recent memories
 * Step 2: For each question, retrieve relevant memories and extract insights (3 calls via Promise.all)
 * Step 3: Store reflections as memory objects with embeddings
 *
 * @param {string} characterName
 * @param {Array} allMemories - Full memory stream
 * @param {Object} characterStates - For POV filtering
 * @returns {Promise<Array>} New reflection memory objects
 */
export async function generateReflections(characterName, allMemories, characterStates) {
    const deps = getDeps();
    const settings = deps.getExtensionSettings()?.[extensionName] || {};
    const maxReflections = settings.maxReflectionsPerCharacter ?? 50;

    // Archive old reflections if cap is reached
    const characterReflections = allMemories.filter(
        (m) => m.type === 'reflection' && m.character === characterName && !m.archived
    );
    if (characterReflections.length >= maxReflections) {
        const toArchive = characterReflections.length - maxReflections + 1; // +1 to make room for new ones
        const sortedBySequence = [...characterReflections].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        for (let i = 0; i < toArchive && i < sortedBySequence.length; i++) {
            sortedBySequence[i].archived = true;
        }
        log(`Reflection: Archived ${toArchive} old reflections for ${characterName} (cap: ${maxReflections})`);
    }

    // Filter memories to what this character knows
    const data = { character_states: characterStates };
    const accessibleMemories = filterMemoriesByPOV(allMemories, [characterName], data);
    const recentMemories = sortMemoriesBySequence(accessibleMemories, false).slice(0, 100);

    if (recentMemories.length < 3) {
        log(`Reflection: ${characterName} has too few accessible memories (${recentMemories.length}), skipping`);
        return [];
    }

    // Get existing reflections for this character
    const existingReflections = accessibleMemories.filter(
        (m) => m.type === 'reflection' && m.character === characterName
    );

    // Pre-flight similarity gate: check if recent events align with existing insights
    const { shouldSkip, reason: skipReason } = shouldSkipReflectionGeneration(
        recentMemories.slice(0, 10), // Check top 10 most recent
        existingReflections,
        0.85
    );

    if (shouldSkip) {
        log(`Reflection: ${skipReason} for ${characterName}`);
        // Note: Caller should reset importance_sum for this character
        return [];
    }

    // Step 1: Generate salient questions
    const questionsPrompt = buildSalientQuestionsPrompt(characterName, recentMemories);
    const questionsResponse = await callLLM(questionsPrompt, LLM_CONFIGS.reflection_questions, { structured: true });
    const { questions } = parseSalientQuestionsResponse(questionsResponse);

    log(`Reflection: Generated ${questions.length} salient questions for ${characterName}`);

    // Step 2: For each question, retrieve relevant memories and extract insights (in parallel)
    const insightPromises = questions.map(async (question) => {
        // Retrieve memories relevant to this question via embedding similarity
        let relevantMemories = accessibleMemories;
        if (isEmbeddingsEnabled()) {
            const queryEmb = await getQueryEmbedding(question);
            if (queryEmb) {
                const scored = accessibleMemories
                    .filter((m) => m.embedding)
                    .map((m) => ({ memory: m, score: cosineSimilarity(queryEmb, m.embedding) }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 20);
                relevantMemories = scored.map((s) => s.memory);
            }
        } else {
            relevantMemories = recentMemories.slice(0, 20);
        }

        const insightPrompt = buildInsightExtractionPrompt(characterName, question, relevantMemories);
        const insightResponse = await callLLM(insightPrompt, LLM_CONFIGS.reflection_insights, { structured: true });
        const parsed = parseInsightExtractionResponse(insightResponse);
        // Cap insights per question
        const maxInsights = settings.maxInsightsPerReflection ?? 3;
        parsed.insights = parsed.insights.slice(0, maxInsights);
        return parsed;
    });

    const insightResults = await Promise.all(insightPromises);

    // Step 3: Convert insights into reflection memory objects
    const reflections = [];
    const now = deps.Date.now();

    for (const result of insightResults) {
        for (const { insight, evidence_ids } of result.insights) {
            reflections.push({
                id: `ref_${generateId()}`,
                type: 'reflection',
                summary: insight,
                importance: 4,
                sequence: now,
                characters_involved: [characterName],
                character: characterName,
                source_ids: evidence_ids,
                witnesses: [characterName],
                location: null,
                is_secret: false,
                emotional_impact: {},
                relationship_impact: {},
                created_at: now,
            });
        }
    }

    // Generate embeddings for reflections
    await enrichEventsWithEmbeddings(reflections);

    // Dedup: 3-tier filter (reject/replace/add) reflections based on similarity
    const reflectionDedupThreshold = settings.reflectionDedupThreshold ?? 0.9;
    const replaceThreshold = reflectionDedupThreshold - 0.1; // 0.80 when default is 0.90
    const { toAdd, toArchiveIds } = filterDuplicateReflections(
        reflections,
        allMemories,
        reflectionDedupThreshold,
        replaceThreshold
    );

    // Archive replaced reflections
    if (toArchiveIds.length > 0) {
        for (const memory of allMemories) {
            if (toArchiveIds.includes(memory.id)) {
                memory.archived = true;
            }
        }
        log(`Reflection: Archived ${toArchiveIds.length} replaced reflections for ${characterName}`);
    }

    log(
        `Reflection: Generated ${toAdd.length} reflections for ${characterName} (${reflections.length - toAdd.length} filtered)`
    );
    return toAdd;
}
