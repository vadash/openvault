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

import { extensionName, REFLECTION_CANDIDATE_LIMIT } from '../constants.js';
import { getDeps } from '../deps.js';
import { enrichEventsWithEmbeddings } from '../embeddings.js';
import { parseUnifiedReflectionResponse } from '../extraction/structured.js';
import { callLLM, LLM_CONFIGS } from '../llm.js';
import { record } from '../perf/store.js';
import { filterMemoriesByPOV } from '../pov.js';
import {
    buildUnifiedReflectionPrompt,
    resolveExtractionPreamble,
    resolveExtractionPrefill,
    resolveOutputLanguage,
} from '../prompts/index.js';
import { cosineSimilarity, tokenize } from '../retrieval/math.js';
import { generateId } from '../utils/data.js';
import { cyrb53, getEmbedding, hasEmbedding } from '../utils/embedding-codec.js';
import { logDebug } from '../utils/logging.js';
import { sortMemoriesBySequence } from '../utils/text.js';

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
    const existingReflections = existingMemories.filter((m) => m.type === 'reflection' && hasEmbedding(m));
    const toAdd = [];
    const toArchiveIds = new Set();

    for (const ref of newReflections) {
        if (!hasEmbedding(ref)) {
            toAdd.push(ref);
            continue;
        }

        const sameCharReflections = existingReflections.filter((m) => m.character === ref.character);
        let bestMatch = null;
        let bestScore = 0;

        for (const existing of sameCharReflections) {
            const sim = cosineSimilarity(getEmbedding(ref), getEmbedding(existing));
            if (sim > bestScore) {
                bestMatch = existing;
                bestScore = sim;
            }
        }

        if (bestMatch && bestScore >= rejectThreshold) {
            // Tier 1: Reject - too similar
            logDebug(
                `Reflection rejected: "${ref.summary}" (${(bestScore * 100).toFixed(1)}% similar to existing "${bestMatch.summary}")`
            );
            continue;
        }

        if (bestMatch && bestScore >= replaceThreshold) {
            // Tier 2: Replace - same theme, newer wording
            logDebug(
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
        .filter((m) => hasEmbedding(m))
        .sort((a, b) => (b.importance || 3) - (a.importance || 3))
        .slice(0, 3);

    if (topRecent.length === 0) {
        return { shouldSkip: false, reason: null };
    }

    // For each top recent memory, check if it aligns with existing reflections
    let alignCount = 0;
    for (const recent of topRecent) {
        for (const reflection of existingReflections) {
            if (!hasEmbedding(reflection)) continue;
            const sim = cosineSimilarity(getEmbedding(recent), getEmbedding(reflection));
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
 * Run the unified reflection pipeline for a single character.
 *
 * Single-call approach: Generate questions and insights together in one LLM call.
 *
 * @param {string} characterName
 * @param {Array} allMemories - Full memory stream
 * @param {Object} characterStates - For POV filtering
 * @returns {Promise<Array>} New reflection memory objects
 */
export async function generateReflections(characterName, allMemories, characterStates) {
    const t0 = performance.now();
    const deps = getDeps();
    const settings = deps.getExtensionSettings()?.[extensionName] || {};
    const preamble = resolveExtractionPreamble(settings);
    const outputLanguage = resolveOutputLanguage(settings);
    const prefill = resolveExtractionPrefill(settings);
    const maxReflections = settings.maxReflectionsPerCharacter;

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
        logDebug(`Reflection: Archived ${toArchive} old reflections for ${characterName} (cap: ${maxReflections})`);
    }

    // Filter memories to what this character knows
    const data = { character_states: characterStates };
    const accessibleMemories = filterMemoriesByPOV(allMemories, [characterName], data);
    const recentMemories = sortMemoriesBySequence(accessibleMemories, false).slice(0, REFLECTION_CANDIDATE_LIMIT);

    // Include old reflections for potential synthesis
    const oldReflections = accessibleMemories.filter((m) => m.type === 'reflection' && (m.level || 1) >= 1);

    // Combine and deduplicate by id (recent memories take precedence if duplicate)
    const candidateSet = Array.from(new Map([...recentMemories, ...oldReflections].map((m) => [m.id, m])).values());

    if (recentMemories.length < 3) {
        logDebug(`Reflection: ${characterName} has too few accessible memories (${recentMemories.length}), skipping`);
        return { reflections: [], stChanges: { toSync: [] } };
    }

    // Get existing reflections for this character
    const existingReflections = accessibleMemories.filter(
        (m) => m.type === 'reflection' && m.character === characterName
    );

    // For pre-flight gate, use only events (not reflections) to check alignment
    const recentEvents = recentMemories.filter((m) => m.type === 'event');

    // Pre-flight similarity gate: check if recent events align with existing insights
    const { shouldSkip, reason: skipReason } = shouldSkipReflectionGeneration(
        recentEvents.slice(0, 10), // Check top 10 most recent
        existingReflections,
        0.85
    );

    if (shouldSkip) {
        logDebug(`Reflection: ${skipReason} for ${characterName}`);
        // Note: Caller should reset importance_sum for this character
        return { reflections: [], stChanges: { toSync: [] } };
    }

    // Single unified reflection call (replaces Step 1 + Step 2)
    const reflectionPrompt = buildUnifiedReflectionPrompt(
        characterName,
        candidateSet,
        preamble,
        outputLanguage,
        prefill
    );
    const reflectionResponse = await callLLM(reflectionPrompt, LLM_CONFIGS.reflection, { structured: true });
    const { reflections } = parseUnifiedReflectionResponse(reflectionResponse);

    logDebug(`Reflection: Generated ${reflections.length} unified reflections for ${characterName}`);

    // Convert unified reflections to memory objects
    const now = deps.Date.now();
    const newReflections = reflections.map(({ insight, evidence_ids }) => {
        // Detect meta-synthesis: if evidence_ids contain reflection IDs (starting with "ref_"),
        // this is a Level 2+ reflection synthesizing existing reflections
        const hasReflectionEvidence = evidence_ids.some((id) => id.startsWith('ref_'));
        const reflectionEvidenceIds = evidence_ids.filter((id) => id.startsWith('ref_'));
        const eventEvidenceIds = evidence_ids.filter((id) => !id.startsWith('ref_'));

        return {
            id: `ref_${generateId()}`,
            type: 'reflection',
            summary: insight,
            tokens: tokenize(insight || ''),
            importance: 4,
            sequence: now,
            characters_involved: [characterName],
            character: characterName,
            source_ids: eventEvidenceIds, // Event IDs used as source
            parent_ids: reflectionEvidenceIds, // Reflection IDs synthesized (empty for level 1)
            level: hasReflectionEvidence ? 2 : 1, // Level 2 if synthesizing reflections, else 1
            witnesses: [characterName],
            location: null,
            is_secret: false,
            emotional_impact: {},
            relationship_impact: {},
            created_at: now,
        };
    });

    // Generate embeddings for reflections
    await enrichEventsWithEmbeddings(newReflections);

    // Dedup: 3-tier filter (reject/replace/add) reflections based on similarity
    const reflectionDedupThreshold = settings.reflectionDedupThreshold;
    const replaceThreshold = reflectionDedupThreshold - 0.1; // 0.80 when default is 0.90
    const { toAdd, toArchiveIds } = filterDuplicateReflections(
        newReflections,
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
        logDebug(`Reflection: Archived ${toArchiveIds.length} replaced reflections for ${characterName}`);
    }

    logDebug(
        `Reflection: Generated ${toAdd.length} reflections for ${characterName} (${newReflections.length - toAdd.length} filtered)`
    );

    const stChanges = { toSync: [] };
    for (const r of toAdd) {
        const text = `[OV_ID:${r.id}] ${r.summary}`;
        stChanges.toSync.push({ hash: cyrb53(text), text, item: r });
    }

    record('llm_reflection', performance.now() - t0);
    return { reflections: toAdd, stChanges };
}
