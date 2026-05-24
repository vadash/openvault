/**
 * Scene state extraction module.
 * Core extraction function, state map management, ledger diffing, backward-scan lookup, pruning.
 */

// @ts-check

import { callLLM, LLM_CONFIGS } from '../llm.js';
import { buildSceneStatePrompt } from '../prompts/scene-state/builder.js';
import { getSettings } from '../settings.js';
import { logDebug, logError, logInfo } from '../utils/logging.js';
import { stripThinkingTags } from '../utils/text.js';
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
 * @param {Array<{fingerprint: string, is_system?: boolean, mes?: string, name?: string}>} chat - Chat messages array
 * @param {Record<string, SceneState>} sceneStates - Scene state map
 * @param {boolean} [skipSystem=true] - Skip system messages
 * @returns {Array<{fingerprint: string, is_system?: boolean, mes?: string, name?: string}>} Messages since last extraction
 */
export function getSceneExtractionWindow(chat, sceneStates, skipSystem = true) {
    if (!chat?.length) return [];
    if (!sceneStates || Object.keys(sceneStates).length === 0) {
        // Cold start: return all messages (respecting skipSystem)
        return chat.filter((m) => !skipSystem || !m.is_system);
    }

    // Find the most recent state's source_fp
    const stateKeys = Object.keys(sceneStates);
    const lastStateKey = stateKeys.sort().slice(-1)[0];
    const lastState = sceneStates[lastStateKey];
    const lastSourceFp = lastState?.source_fp;

    if (!lastSourceFp) {
        // No valid source_fp: return all messages
        return chat.filter((m) => !skipSystem || !m.is_system);
    }

    // Find the index of the lastSourceFp message
    const lastIndex = chat.findIndex((m) => m.fingerprint === lastSourceFp);

    if (lastIndex === -1) {
        // Message not found: return all messages
        return chat.filter((m) => !skipSystem || !m.is_system);
    }

    // Return messages after the lastSourceFp
    const afterMessages = chat.slice(lastIndex + 1);
    return afterMessages.filter((m) => !skipSystem || !m.is_system);
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
        const fp = chat[i].fingerprint;
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
        const indices = batchFps.map((fp) => chat.findIndex((m) => m.fingerprint === fp)).filter((i) => i >= 0);
        if (indices.length === 0) return [];
        return [{ startIdx: Math.min(...indices), endIdx: Math.max(...indices), location: null, time: null }];
    }

    // Build fingerprint→index map for O(1) resolution
    const fpToIndex = new Map();
    for (let i = 0; i < chat.length; i++) {
        fpToIndex.set(chat[i].fingerprint, i);
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

    // Get extraction window
    const window = getSceneExtractionWindow(chat, data.scene_states || {}, true);
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
                `<message fingerprint="${m.fingerprint}" sender="${m.name || 'Unknown'}">\n${m.mes || ''}\n</message>`
        )
        .join('\n');

    // Get output language and prefill from settings
    const outputLanguage = settings?.outputLanguage ?? getSettings('outputLanguage');
    const prefill = settings?.extractionPrefill ?? getSettings('extractionPrefill');
    const prefillText = prefill === 'cn_compliance' ? '<think>\n' : prefill || '';

    // Build prompt
    const prompt = buildSceneStatePrompt(prevState, messagesText, outputLanguage, prefillText);

    // Get fingerprint of last message in window
    const lastFp = window[window.length - 1].fingerprint;

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
