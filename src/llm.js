/**
 * OpenVault LLM Service
 *
 * Unified LLM communication for extraction and retrieval operations.
 * Prompts must be arrays of message objects with System/User roles.
 */

// @ts-check

import { extensionName } from './constants.js';
import { getDeps } from './deps.js';
import {
    getCommunitySummaryJsonSchema,
    getEdgeConsolidationJsonSchema,
    getEventExtractionJsonSchema,
    getGraphExtractionJsonSchema,
    getSceneStateJsonSchema,
    getUnifiedReflectionJsonSchema,
} from './extraction/structured.js';
import { getSessionSignal } from './state.js';
import { showToast } from './utils/dom.js';
import { logDebug, logError, logRequest } from './utils/logging.js';
import { withTimeout } from './utils/st-helpers.js';

/** @typedef {import('./types.d.ts').LLMConfig} LLMConfig */
/** @typedef {import('./types.d.ts').LLMCallOptions} LLMCallOptions */
/** @typedef {import('./types.d.ts').LLMMessages} LLMMessages */

// @ts-check-ignore -- UsageTracker is function-based, defined in usage-tracker.js
/** @typedef {object} UsageTracker */
/** @property {(usage: { model?: string, promptTokens?: number, completionTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number }) => void} record */
/** @property {() => string} getSummary */

/**
 * Race a promise against an AbortSignal.
 * @template T
 * @param {Promise<T>} promise - The promise to race
 * @param {AbortSignal} signal - The signal to watch
 * @returns {Promise<T>} Resolves/rejects with the first to settle
 */
function raceAbort(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            (val) => {
                signal.removeEventListener('abort', onAbort);
                resolve(val);
            },
            (err) => {
                signal.removeEventListener('abort', onAbort);
                reject(err);
            }
        );
    });
}

/**
 * LLM configuration presets
 */
export const LLM_CONFIGS = {
    extraction_events: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 8000,
        errorContext: 'Event Extraction',
        timeoutMs: 240000,
        getJsonSchema: getEventExtractionJsonSchema,
    },
    extraction_graph: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 8000,
        errorContext: 'Graph Extraction',
        timeoutMs: 180000,
        getJsonSchema: getGraphExtractionJsonSchema,
    },
    reflection: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 8000,
        errorContext: 'Unified Reflection',
        timeoutMs: 180000,
        getJsonSchema: getUnifiedReflectionJsonSchema,
    },
    worldState: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 8000,
        errorContext: 'World state synthesis',
        timeoutMs: 180000,
        getJsonSchema: getCommunitySummaryJsonSchema,
    },
    edge_consolidation: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 1000,
        errorContext: 'Edge consolidation',
        timeoutMs: 60000,
        getJsonSchema: getEdgeConsolidationJsonSchema,
    },
    sceneState: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 4000,
        errorContext: 'Scene state extraction',
        timeoutMs: 120000,
        getJsonSchema: getSceneStateJsonSchema,
    },
};

/**
 * Call LLM with messages array
 * @param {LLMMessages} messages - Array of message objects
 * @param {LLMConfig} config - Request configuration from LLM_CONFIGS
 * @param {LLMCallOptions & { tracker?: UsageTracker }} [options] - Optional parameters
 * @returns {Promise<string>} The LLM response content
 * @throws {Error} If the LLM call fails or no profile is available
 */
export async function callLLM(messages, config, options = {}) {
    const { profileSettingKey, maxTokens, errorContext, timeoutMs, getJsonSchema } = config;
    const signal = options.signal ?? getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const deps = getDeps();
    const extension_settings = deps.getExtensionSettings();
    const settings = extension_settings[extensionName];

    // Get profile ID - use specified profile or fall back to currently selected
    let profileId = options.profileId ?? settings[profileSettingKey];

    if (!profileId) {
        profileId = extension_settings?.connectionManager?.selectedProfile;
        if (profileId) {
            const profiles = extension_settings?.connectionManager?.profiles || [];
            const profile = profiles.find((p) => p.id === profileId);
            logDebug(`No ${profileSettingKey} set, using current profile: ${profile?.name || profileId}`);
        }
    }

    if (!profileId) {
        throw new Error(
            `No connection profile available for ${errorContext.toLowerCase()}. Please configure a profile in Connection Manager.`
        );
    }

    // --- Helper: execute a single LLM request against a given profile ---
    async function executeRequest(targetProfileId) {
        const requestPromise = deps.connectionManager.sendRequest(
            targetProfileId,
            messages,
            maxTokens,
            {
                includePreset: true,
                includeInstruct: true,
                stream: false,
                extractData: false,
            },
            jsonSchema ? { jsonSchema } : {}
        );

        const result = await raceAbort(withTimeout(requestPromise, timeoutMs || 120000, `${errorContext} API`), signal);

        // Extract content from full API response (choices[0].message.content)
        let content;
        let reasoningContent;
        if (result && typeof result === 'object' && 'choices' in result && result.choices?.[0]?.message) {
            content = result.choices[0].message.content;
            reasoningContent = result.choices[0].message.reasoning_content ?? result.choices[0].message.reasoning ?? '';

            // Record usage if tracker provided
            if (options.tracker && typeof options.tracker.record === 'function') {
                const usage = {
                    model: result.model,
                    promptTokens: result.usage?.prompt_tokens,
                    completionTokens: result.usage?.completion_tokens,
                    cacheReadTokens: result.usage?.cache_read_tokens,
                    cacheWriteTokens: result.usage?.cache_write_tokens,
                };
                options.tracker.record(usage);
            }
        } else {
            // Fallback for legacy response format or malformed response
            content = result && typeof result === 'object' && 'content' in result ? result.content : result || '';
            reasoningContent = '';
        }

        logDebug(`LLM response received (${content.length} chars)`);
        logRequest(errorContext, {
            messages,
            maxTokens,
            profileId: targetProfileId,
            response: content,
            reasoning: reasoningContent,
        });

        if (content.length === 0) {
            logDebug(`ERROR: Empty LLM response! Full result: ${JSON.stringify(result).substring(0, 200)}`);
        }

        if (!content) {
            throw new Error('Empty response from LLM');
        }

        const context = deps.getContext();
        if (context.parseReasoningFromString) {
            const parsed = context.parseReasoningFromString(content);
            return parsed ? parsed.content : content;
        }

        return content;
    }

    const jsonSchema = options.structured && getJsonSchema ? await getJsonSchema() : undefined;

    // --- Main request with backup failover ---
    try {
        logDebug(`Using ConnectionManagerRequestService with profile: ${profileId}`);
        return await executeRequest(profileId);
    } catch (mainError) {
        if (mainError.name === 'AbortError') throw mainError;

        // Attempt backup profile if configured and different from main
        const backupProfileId = options.backupProfileId ?? settings.backupProfile;
        if (backupProfileId && backupProfileId !== profileId) {
            const profiles = extension_settings?.connectionManager?.profiles || [];
            const backupName = profiles.find((p) => p.id === backupProfileId)?.name || backupProfileId;
            logDebug(`${errorContext} failed on main profile, trying backup: ${backupName}`);
            try {
                const backupResult = await executeRequest(backupProfileId);
                // Backup succeeded - return the result
                return backupResult;
            } catch (backupError) {
                // Backup failed (including empty response) - fall through to main error handling
                logDebug(`${errorContext} backup also failed: ${backupError.message}`);
            }
        }

        // Original error handling — toast + re-throw main error
        const errorMessage = mainError.message || 'Unknown error';
        logError(`${errorContext} LLM call failed`, mainError, {
            profileId,
            maxTokens,
        });
        if (!errorMessage.includes('timed out')) {
            showToast('error', `${errorContext} failed: ${errorMessage}`);
        }
        logRequest(errorContext, { messages, maxTokens, profileId, error: mainError });
        throw mainError;
    }
}
