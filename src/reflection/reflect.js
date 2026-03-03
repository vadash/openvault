/**
 * OpenVault Reflection Engine
 *
 * Per-character reflection system inspired by the Smallville paper.
 * Synthesizes raw events into high-level insights.
 */

import { getDeps } from '../deps.js';
import { enrichEventsWithEmbeddings, getQueryEmbedding, isEmbeddingsEnabled } from '../embeddings.js';
import { callLLM, LLM_CONFIGS } from '../llm.js';
import { filterMemoriesByPOV } from '../pov.js';
import { buildSalientQuestionsPrompt, buildInsightExtractionPrompt } from '../prompts.js';
import { parseSalientQuestionsResponse, parseInsightExtractionResponse } from '../extraction/structured.js';
import { cosineSimilarity } from '../retrieval/math.js';
import { log, sortMemoriesBySequence, generateId } from '../utils.js';

const REFLECTION_THRESHOLD = 30;

/**
 * Check if a character has accumulated enough importance to trigger reflection.
 * @param {Object} reflectionState - Per-character accumulators
 * @param {string} characterName
 * @returns {boolean}
 */
export function shouldReflect(reflectionState, characterName) {
    const charState = reflectionState[characterName];
    if (!charState) return false;
    return charState.importance_sum >= REFLECTION_THRESHOLD;
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
        const allCharacters = new Set([
            ...(event.characters_involved || []),
            ...(event.witnesses || []),
        ]);

        for (const charName of allCharacters) {
            if (!reflectionState[charName]) {
                reflectionState[charName] = { importance_sum: 0 };
            }
            reflectionState[charName].importance_sum += importance;
        }
    }
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

    // Filter memories to what this character knows
    const data = { character_states: characterStates };
    const accessibleMemories = filterMemoriesByPOV(allMemories, [characterName], data);
    const recentMemories = sortMemoriesBySequence(accessibleMemories, false).slice(0, 100);

    if (recentMemories.length < 3) {
        log(`Reflection: ${characterName} has too few accessible memories (${recentMemories.length}), skipping`);
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
                    .filter(m => m.embedding)
                    .map(m => ({ memory: m, score: cosineSimilarity(queryEmb, m.embedding) }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 20);
                relevantMemories = scored.map(s => s.memory);
            }
        } else {
            relevantMemories = recentMemories.slice(0, 20);
        }

        const insightPrompt = buildInsightExtractionPrompt(characterName, question, relevantMemories);
        const insightResponse = await callLLM(insightPrompt, LLM_CONFIGS.reflection_insights, { structured: true });
        return parseInsightExtractionResponse(insightResponse);
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

    log(`Reflection: Generated ${reflections.length} reflections for ${characterName}`);
    return reflections;
}
