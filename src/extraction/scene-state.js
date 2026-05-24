/**
 * Scene state extraction module.
 * Core extraction function, state map management, ledger diffing, backward-scan lookup, pruning.
 */

// @ts-check

import { callLLM, LLM_CONFIGS } from '../llm.js';
import { resolveExtractionPrefill } from '../prompts/index.js';
import { buildSceneStatePrompt } from '../prompts/scene-state/builder.js';
import { getSettings } from '../settings.js';
import { logDebug, logError, logInfo } from '../utils/logging.js';
import { stripThinkingTags } from '../utils/text.js';
import { countTurns, snapToTurnBoundary } from '../utils/tokens.js';
import { getFingerprint } from './scheduler.js';
import { parseSceneStateResponse } from './structured.js';

/** @typedef {import('../types.d.ts').SceneState} SceneState */
/** @typedef {import('../types.d.ts').SceneLedgerEntry} SceneLedgerEntry */

/**
 * Prune a state map to keep only the most recent entries.
 * @param {Record<string, SceneState>} map - The scene state map
 * @param {number} [maxEntries=10] - Maximum entries to retain
 * @returns {Record<string, SceneState>} Pruned map with only last N entries
 */
export function pruneStateMap(map, maxEntries = 10) {
    if (!map || typeof map !== 'object') return {};
    const keys = Object.keys(map);
    if (keys.length <= maxEntries) return { ...map };

    // Sort keys and keep only the last maxEntries
    const sortedKeys = keys.sort();
    const keepKeys = sortedKeys.slice(-maxEntries);

    const result = /** @type {Record<string, SceneState>} */ ({});
    for (const key of keepKeys) {
        result[key] = map[key];
    }
    return result;
}

/**
 * Compute a ledger entry diff between previous and new scene state.
 * @param {SceneState | null} prevState - Previous scene state (may be null)
 * @param {SceneState} newState - New scene state
 * @param {string} lastFp - The fingerprint of the message where the new state was extracted
 * @returns {SceneLedgerEntry | null} Ledger entry if location or time changed, null otherwise
 */
export function diffLedger(prevState, newState, lastFp) {
    if (!prevState) {
        // Cold start: always create entry
        return { fp: lastFp, location: newState.location, time: newState.time };
    }

    const locationChanged = prevState.location !== newState.location;
    const timeChanged = prevState.time !== newState.time;

    if (!locationChanged && !timeChanged) {
        return null;
    }

    return { fp: lastFp, location: newState.location, time: newState.time };
}

/**
 * Get messages since the last scene state extraction.
 * Cold start is limited to sceneStateMaxTurnStart (default 10) to prevent
 * processing entire chat history on first extraction after backfill.
 * @param {Array<{fingerprint: string, is_system?: boolean, mes?: string, name?: string, is_user?: boolean}>} chat - Chat messages array
 * @param {Record<string, SceneState>} sceneStates - Scene state map
 * @param {object} settings - Settings object (for sceneStateMaxTurnStart)
 * @param {boolean} [skipSystem=true] - Skip system messages
 * @returns {Array<{fingerprint: string, is_system?: boolean, mes?: string, name?: string}>} Messages since last extraction
 */
export function getSceneExtractionWindow(chat, sceneStates, settings, skipSystem = true) {
    if (!chat?.length) return [];
    if (!sceneStates || Object.keys(sceneStates).length === 0) {
        // Cold start: limit to maxTurnStart to prevent processing entire history
        const maxTurns = settings?.sceneStateMaxTurnStart ?? 10;
        const nonSystemIndices = [];
        for (let i = 0; i < chat.length; i++) {
            if (!skipSystem || !chat[i].is_system) {
                nonSystemIndices.push(i);
            }
        }

        // If under limit, return all
        const turnCount = countTurns(chat, nonSystemIndices);
        if (turnCount <= maxTurns) {
            return chat.filter((m) => !skipSystem || !m.is_system);
        }

        // Take last N turns: walk backward to find the cutoff
        // Build indices from end, snap to turn boundary
        const reversedIndices = [...nonSystemIndices].reverse();
        const selectedIndices = [];

        for (const idx of reversedIndices) {
            selectedIndices.unshift(idx);
            // Re-count turns in selected window
            const windowTurns = countTurns(chat, selectedIndices);
            if (windowTurns >= maxTurns) {
                // Snap forward to include full turn (don't orphan user messages)
                const snapped = snapToTurnBoundary(chat, selectedIndices, false);
                return snapped.map((i) => chat[i]).filter((m) => !skipSystem || !m.is_system);
            }
        }

        // Fallback: return what we have
        return selectedIndices.map((i) => chat[i]).filter((m) => !skipSystem || !m.is_system);
    }

    // Find the most recent state's source_fp
    const stateKeys = Object.keys(sceneStates);
    const lastStateKey = stateKeys.sort().slice(-1)[0];
    const lastState = sceneStates[lastStateKey];
    const lastSourceFp = lastState?.source_fp;

    if (!lastSourceFp) {
        // No valid source_fp: treat as cold start with limit
        const maxTurns = settings?.sceneStateMaxTurnStart ?? 10;
        const nonSystemIndices = [];
        for (let i = 0; i < chat.length; i++) {
            if (!skipSystem || !chat[i].is_system) {
                nonSystemIndices.push(i);
            }
        }

        const turnCount = countTurns(chat, nonSystemIndices);
        if (turnCount <= maxTurns) {
            return chat.filter((m) => !skipSystem || !m.is_system);
        }

        const reversedIndices = [...nonSystemIndices].reverse();
        const selectedIndices = [];
        for (const idx of reversedIndices) {
            selectedIndices.unshift(idx);
            if (countTurns(chat, selectedIndices) >= maxTurns) {
                const snapped = snapToTurnBoundary(chat, selectedIndices, false);
                return snapped.map((i) => chat[i]).filter((m) => !skipSystem || !m.is_system);
            }
        }
        return selectedIndices.map((i) => chat[i]).filter((m) => !skipSystem || !m.is_system);
    }

    // Find the index of the lastSourceFp message
    const lastIndex = chat.findIndex((m) => getFingerprint(m) === lastSourceFp);

    if (lastIndex === -1) {
        // Message not found: treat as cold start with limit
        const maxTurns = settings?.sceneStateMaxTurnStart ?? 10;
        const nonSystemIndices = [];
        for (let i = 0; i < chat.length; i++) {
            if (!skipSystem || !chat[i].is_system) {
                nonSystemIndices.push(i);
            }
        }

        const turnCount = countTurns(chat, nonSystemIndices);
        if (turnCount <= maxTurns) {
            return chat.filter((m) => !skipSystem || !m.is_system);
        }

        const reversedIndices = [...nonSystemIndices].reverse();
        const selectedIndices = [];
        for (const idx of reversedIndices) {
            selectedIndices.unshift(idx);
            if (countTurns(chat, selectedIndices) >= maxTurns) {
                const snapped = snapToTurnBoundary(chat, selectedIndices, false);
                return snapped.map((i) => chat[i]).filter((m) => !skipSystem || !m.is_system);
            }
        }
        return selectedIndices.map((i) => chat[i]).filter((m) => !skipSystem || !m.is_system);
    }

    // Return messages after the lastSourceFp
    const afterMessages = chat.slice(lastIndex + 1);
    return afterMessages.filter((m) => !skipSystem || !m.is_system);
}

/**
 * Compute dynamic injection depth from the state's source_fp position.
 * Depth is calculated as: chat.length - sourceIndex (messages from bottom).
 * Minimum depth is clamped to 2 to ensure scene state injects after the last
 * complete User+Bot pair, never at the very bottom where it could interfere
 * with generation context.
 * @param {SceneState | null} state - The scene state (must have source_fp)
 * @param {number} chatLength - Current chat length
 * @param {Map<string, number>} fpMap - Fingerprint to index map
 * @returns {number} Computed depth (fallback to 4 if state invalid, min clamp to 2)
 */
export function computeDynamicDepth(state, chatLength, fpMap) {
    // Fallback depth when state is missing or invalid
    const fallbackDepth = 4;
    // Minimum depth: 2 messages from bottom (after last complete pair)
    const minDepth = 2;

    if (!state || !state.source_fp) {
        return fallbackDepth;
    }

    // Resolve source_fp to index
    const sourceIndex = fpMap.get(state.source_fp);

    if (sourceIndex === undefined) {
        // Message was deleted, use fallback
        return fallbackDepth;
    }

    // Compute depth (messages from bottom)
    const depth = chatLength - sourceIndex;

    // Clamp to minDepth (never inject at very bottom)
    return Math.max(minDepth, depth);
}

/**
 * Find the current scene state by backward-scan lookup.
 * Walks backward from the last message and returns the first state whose fingerprint key matches a message fingerprint.
 * @param {Array<{fingerprint: string}>} chat - Chat messages array
 * @param {Record<string, SceneState>} sceneStates - Scene state map
 * @returns {SceneState | null} The most recent scene state, or null if none found
 */
export function findCurrentSceneState(chat, sceneStates) {
    if (!chat?.length) return null;
    if (!sceneStates || Object.keys(sceneStates).length === 0) return null;

    // Build a Set of state map keys for O(1) membership checks
    const stateKeys = new Set(Object.keys(sceneStates));

    // Walk backward from the last message
    for (let i = chat.length - 1; i >= 0; i--) {
        const fp = getFingerprint(chat[i]);
        if (stateKeys.has(fp)) {
            return sceneStates[fp];
        }
    }

    return null;
}

/**
 * Check if scene extraction should trigger based on counter and interval.
 * @param {number} sceneCounter - Number of messages since last extraction
 * @param {number} interval - Extraction interval
 * @returns {boolean} True if extraction should trigger
 */
export function shouldTriggerSceneExtraction(sceneCounter, interval) {
    return sceneCounter >= interval;
}

/**
 * Resolve scene ledger entries to sub-batches for a given message batch.
 * Implements backward-scan lookup: for each message, finds the most recent
 * ledger entry whose fp corresponds to a message at or before its position.
 *
 * @param {SceneLedgerEntry[]} ledger - Scene ledger entries
 * @param {Array<{fingerprint: string}>} chat - Full chat array
 * @param {string[]} batchFps - Fingerprints of messages in the current batch
 * @returns {Array<{startIdx: number, endIdx: number, location: string | null, time: string | null}>}
 *   Sub-batch descriptors with scene context
 */
export function resolveLedgerForBatch(ledger, chat, batchFps) {
    if (!batchFps?.length) return [];

    // Empty ledger: single batch with null context
    if (!ledger?.length) {
        const indices = batchFps.map((fp) => chat.findIndex((m) => getFingerprint(m) === fp)).filter((i) => i >= 0);
        if (indices.length === 0) return [];
        return [{ startIdx: Math.min(...indices), endIdx: Math.max(...indices), location: null, time: null }];
    }

    // Build fingerprint→index map for O(1) resolution
    const fpToIndex = new Map();
    for (let i = 0; i < chat.length; i++) {
        fpToIndex.set(getFingerprint(chat[i]), i);
    }

    // Resolve ledger fps to positions, filter out invalid entries
    const resolvedLedger = ledger
        .map((entry) => ({
            ...entry,
            pos: fpToIndex.get(entry.fp) ?? -1,
        }))
        .filter((entry) => entry.pos >= 0)
        .sort((a, b) => b.pos - a.pos); // Sort by position descending (newest first)

    // Resolve batch fingerprints to indices
    const batchIndices = batchFps
        .map((fp) => {
            const idx = fpToIndex.get(fp);
            return idx !== undefined ? idx : -1;
        })
        .filter((i) => i >= 0)
        .sort((a, b) => a - b); // Sort ascending for sub-batch grouping

    if (batchIndices.length === 0) return [];

    // For each batch index, find the applicable scene context via backward scan
    const subBatches = [];
    let currentBatch = null;

    for (const msgIdx of batchIndices) {
        // Backward scan: find first ledger entry with pos <= msgIdx
        const applicableEntry = resolvedLedger.find((entry) => entry.pos <= msgIdx);

        const sceneContext = applicableEntry
            ? { location: applicableEntry.location, time: applicableEntry.time }
            : { location: null, time: null };

        // Check if we can extend the current sub-batch
        if (
            currentBatch &&
            currentBatch.location === sceneContext.location &&
            currentBatch.time === sceneContext.time
        ) {
            currentBatch.endIdx = msgIdx;
        } else {
            // Start a new sub-batch
            if (currentBatch) subBatches.push(currentBatch);
            currentBatch = { startIdx: msgIdx, endIdx: msgIdx, ...sceneContext };
        }
    }

    // Push the final sub-batch
    if (currentBatch) subBatches.push(currentBatch);

    return subBatches;
}

/**
 * Extract scene state from messages.
 * @param {object} data - OpenVault data object (will be mutated: scene_states, scene_ledger)
 * @param {Array<{fingerprint: string, is_system?: boolean, mes?: string, name?: string}>} chat - Chat messages array
 * @param {object} settings - Settings object (used for outputLanguage, prefill)
 * @param {object} options - Options
 * @param {AbortSignal} [options.abortSignal] - Abort signal
 * @returns {Promise<SceneState | null>} Extracted scene state, or null on failure
 */
export async function extractSceneState(data, chat, settings, { abortSignal } = {}) {
    if (abortSignal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    // Get extraction window (pass settings for cold start limit)
    const window = getSceneExtractionWindow(chat, data.scene_states || {}, settings, true);
    if (!window?.length) {
        logDebug('[SceneState] No messages in extraction window');
        return null;
    }

    // Find previous state for context
    const prevState = findCurrentSceneState(chat, data.scene_states || {});

    // Build messages text for prompt
    const messagesText = window
        .map(
            (m) =>
                `<message fingerprint="${getFingerprint(m)}" sender="${m.name || 'Unknown'}">\n${m.mes || ''}\n</message>`
        )
        .join('\n');

    // Get output language and prefill from settings
    const outputLanguage = settings?.outputLanguage ?? getSettings('outputLanguage');
    const prefillText = resolveExtractionPrefill(settings);

    // Build prompt
    const prompt = buildSceneStatePrompt(prevState, messagesText, outputLanguage, prefillText);

    // Get fingerprint of last message in window
    const lastFp = getFingerprint(window[window.length - 1]);

    try {
        logDebug(`[SceneState] Extracting from ${window.length} messages, last fp: ${lastFp}`);

        // Call LLM
        const rawContent = await callLLM(prompt, LLM_CONFIGS.sceneState, {
            signal: abortSignal,
            structured: true,
        });

        // Parse and validate response
        const strippedContent = stripThinkingTags(rawContent);
        const sceneState = await parseSceneStateResponse(strippedContent);

        // Ensure source_fp matches our last message
        sceneState.source_fp = lastFp;

        // Store in data.scene_states
        if (!data.scene_states) data.scene_states = {};
        data.scene_states[lastFp] = sceneState;

        // Diff ledger and append if changed
        const ledgerEntry = diffLedger(prevState, sceneState, lastFp);
        if (ledgerEntry) {
            if (!data.scene_ledger) data.scene_ledger = [];
            data.scene_ledger.push(ledgerEntry);
            logInfo(`[SceneState] Ledger updated: ${ledgerEntry.location}, ${ledgerEntry.time}`);
        }

        // Prune state map
        const pruned = pruneStateMap(data.scene_states, 10);
        data.scene_states = pruned;

        logInfo(`[SceneState] Extraction complete: ${sceneState.location}, ${sceneState.time}`);
        return sceneState;
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        logError('[SceneState] Extraction failed', error);
        return null;
    }
}
