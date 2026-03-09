/**
 * OpenVault LLM Service
 *
 * Unified LLM communication for extraction and retrieval operations.
 * Prompts must be arrays of message objects with System/User roles.
 */

import { extensionName } from './constants.js';
import { getDeps } from './deps.js';
import {
    getCommunitySummaryJsonSchema,
    getEventExtractionJsonSchema,
    getGraphExtractionJsonSchema,
    getInsightExtractionJsonSchema,
    getSalientQuestionsJsonSchema,
} from './extraction/structured.js';
import { showToast } from './utils/dom.js';
import { log, logRequest } from './utils/logging.js';
import { withTimeout } from './utils/st-helpers.js';

/**
 * LLM configuration presets
 */
export const LLM_CONFIGS = {
    extraction_events: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 8000,
        errorContext: 'Event Extraction',
        timeoutMs: 120000,
        getJsonSchema: getEventExtractionJsonSchema,
    },
    extraction_graph: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 8000,
        errorContext: 'Graph Extraction',
        timeoutMs: 90000,
        getJsonSchema: getGraphExtractionJsonSchema,
    },
    reflection_questions: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 8000,
        errorContext: 'Reflection (questions)',
        timeoutMs: 90000,
        getJsonSchema: getSalientQuestionsJsonSchema,
    },
    reflection_insights: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 8000,
        errorContext: 'Reflection (insights)',
        timeoutMs: 90000,
        getJsonSchema: getInsightExtractionJsonSchema,
    },
    community: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 8000,
        errorContext: 'Community summarization',
        timeoutMs: 90000,
        getJsonSchema: getCommunitySummaryJsonSchema,
    },
};

/**
 * Call LLM with messages array
 * @param {Array<{role: string, content: string}>} messages - Array of message objects
 * @param {Object} config - Request configuration from LLM_CONFIGS
 * @param {Object} options - Optional parameters
 * @param {boolean} options.structured - Enable structured output with jsonSchema
 * @returns {Promise<string>} The LLM response content
 * @throws {Error} If the LLM call fails or no profile is available
 */
export async function callLLM(messages, config, options = {}) {
    const { profileSettingKey, maxTokens, errorContext, timeoutMs, getJsonSchema } = config;
    const deps = getDeps();
    const extension_settings = deps.getExtensionSettings();
    const settings = extension_settings[extensionName];

    // Get profile ID - use specified profile or fall back to currently selected
    let profileId = settings[profileSettingKey];

    if (!profileId) {
        profileId = extension_settings?.connectionManager?.selectedProfile;
        if (profileId) {
            const profiles = extension_settings?.connectionManager?.profiles || [];
            const profile = profiles.find((p) => p.id === profileId);
            log(`No ${profileSettingKey} set, using current profile: ${profile?.name || profileId}`);
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
            },
            jsonSchema ? { jsonSchema } : {}
        );

        const result = await withTimeout(requestPromise, timeoutMs || 120000, `${errorContext} API`);
        // Extract content from result object, preserving empty strings as valid (not falsy)
        const content = result && typeof result === 'object' && 'content' in result ? result.content : result || '';

        log(`LLM response received (${content.length} chars)`);
        logRequest(errorContext, { messages, maxTokens, profileId: targetProfileId, response: content });

        if (content.length === 0) {
            log(`ERROR: Empty LLM response! Full result: ${JSON.stringify(result).substring(0, 200)}`);
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

    const jsonSchema = options.structured && getJsonSchema ? getJsonSchema() : undefined;

    // --- Main request with backup failover ---
    try {
        log(`Using ConnectionManagerRequestService with profile: ${profileId}`);
        return await executeRequest(profileId);
    } catch (mainError) {
        // Attempt backup profile if configured and different from main
        const backupProfileId = settings.backupProfile;
        if (backupProfileId && backupProfileId !== profileId) {
            const profiles = extension_settings?.connectionManager?.profiles || [];
            const backupName = profiles.find((p) => p.id === backupProfileId)?.name || backupProfileId;
            log(`${errorContext} failed on main profile, trying backup: ${backupName}`);
            try {
                const backupResult = await executeRequest(backupProfileId);
                // Backup succeeded - return the result
                return backupResult;
            } catch (backupError) {
                // Backup failed (including empty response) - fall through to main error handling
                log(`${errorContext} backup also failed: ${backupError.message}`);
            }
        }

        // Original error handling — toast + re-throw main error
        const errorMessage = mainError.message || 'Unknown error';
        log(`${errorContext} LLM call error: ${errorMessage}`);
        if (!errorMessage.includes('timed out')) {
            showToast('error', `${errorContext} failed: ${errorMessage}`);
        }
        logRequest(errorContext, { messages, maxTokens, profileId, error: mainError });
        throw mainError;
    }
}
