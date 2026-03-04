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
    getExtractionJsonSchema,
    getInsightExtractionJsonSchema,
    getSalientQuestionsJsonSchema,
} from './extraction/structured.js';
import { log, logRequest, showToast, withTimeout } from './utils.js';

/**
 * LLM configuration presets
 */
export const LLM_CONFIGS = {
    extraction: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 4000,
        errorContext: 'Extraction',
        timeoutMs: 120000, // 2 minutes max for extraction
        getJsonSchema: getExtractionJsonSchema,
    },
    reflection_questions: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 2000,
        errorContext: 'Reflection (questions)',
        timeoutMs: 90000,
        getJsonSchema: getSalientQuestionsJsonSchema,
    },
    reflection_insights: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 2000,
        errorContext: 'Reflection (insights)',
        timeoutMs: 90000,
        getJsonSchema: getInsightExtractionJsonSchema,
    },
    community: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 2000,
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

    try {
        log(`Using ConnectionManagerRequestService with profile: ${profileId}`);

        const jsonSchema = options.structured && getJsonSchema ? getJsonSchema() : undefined;

        // Separate the promise so we can wrap it
        const requestPromise = deps.connectionManager.sendRequest(
            profileId,
            messages,
            maxTokens,
            {
                includePreset: true,
                includeInstruct: true,
                stream: false,
            },
            jsonSchema ? { jsonSchema } : {} // 5th parameter
        );

        // Wrap the network request in our timeout utility
        const result = await withTimeout(requestPromise, timeoutMs || 120000, `${errorContext} API`);

        const content = result?.content || result || '';

        // Debug: log LLM response
        log(`LLM response received (${content.length} chars)`);
        logRequest(errorContext, { messages, maxTokens, profileId, response: content });
        if (content.length === 0) {
            log(`ERROR: Empty LLM response! Full result: ${JSON.stringify(result).substring(0, 200)}`);
        }

        if (!content) {
            throw new Error('Empty response from LLM');
        }

        // Parse reasoning if present (some models return thinking tags)
        const context = deps.getContext();
        if (context.parseReasoningFromString) {
            const parsed = context.parseReasoningFromString(content);
            return parsed ? parsed.content : content;
        }

        return content;
    } catch (error) {
        const errorMessage = error.message || 'Unknown error';
        log(`${errorContext} LLM call error: ${errorMessage}`);
        // Only show toast if it's NOT a timeout to prevent toast spam during retries
        if (!errorMessage.includes('timed out')) {
            showToast('error', `${errorContext} failed: ${errorMessage}`);
        }
        logRequest(errorContext, { messages, maxTokens, profileId, error });
        throw error;
    }
}

/**
 * Call LLM for memory extraction
 * @param {Array<{role: string, content: string}>} messages - Array of message objects
 * @param {Object} options - Optional parameters
 * @returns {Promise<string>} The LLM response content
 */
export function callLLMForExtraction(messages, options = {}) {
    return callLLM(messages, LLM_CONFIGS.extraction, options);
}
