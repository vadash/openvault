/**
 * OpenVault LLM Service
 *
 * Unified LLM communication for extraction and retrieval operations.
 * All prompts are sent as single user messages (role embedded in prompt via XML tags).
 */

import { getDeps } from './deps.js';
import { log, showToast } from './utils.js';
import { extensionName } from './constants.js';
import { getExtractionJsonSchema } from './extraction/structured.js';

/**
 * LLM configuration presets
 */
export const LLM_CONFIGS = {
    extraction: {
        profileSettingKey: 'extractionProfile',
        maxTokens: 4000,
        errorContext: 'Extraction'
    },
    retrieval: {
        profileSettingKey: 'retrievalProfile',
        maxTokens: 4000,
        errorContext: 'Smart retrieval'
    }
};

/**
 * Call LLM with unified request handling
 * @param {string} prompt - The user prompt (includes role via XML tags)
 * @param {Object} config - Request configuration from LLM_CONFIGS
 * @param {Object} options - Optional parameters
 * @param {boolean} options.structured - Enable structured output with jsonSchema
 * @returns {Promise<string>} The LLM response content
 * @throws {Error} If the LLM call fails or no profile is available
 */
export async function callLLM(prompt, config, options = {}) {
    const { profileSettingKey, maxTokens, errorContext } = config;
    const deps = getDeps();
    const extension_settings = deps.getExtensionSettings();
    const settings = extension_settings[extensionName];

    // Get profile ID - use specified profile or fall back to currently selected
    let profileId = settings[profileSettingKey];

    if (!profileId) {
        profileId = extension_settings?.connectionManager?.selectedProfile;
        if (profileId) {
            const profiles = extension_settings?.connectionManager?.profiles || [];
            const profile = profiles.find(p => p.id === profileId);
            log(`No ${profileSettingKey} set, using current profile: ${profile?.name || profileId}`);
        }
    }

    if (!profileId) {
        throw new Error(`No connection profile available for ${errorContext.toLowerCase()}. Please configure a profile in Connection Manager.`);
    }

    try {
        log(`Using ConnectionManagerRequestService with profile: ${profileId}`);

        // Single user message - role is embedded in prompt via <role> XML tag
        const messages = [
            { role: 'user', content: prompt }
        ];

        const jsonSchema = options.structured ? getExtractionJsonSchema() : undefined;

        const result = await deps.connectionManager.sendRequest(
            profileId,
            messages,
            maxTokens,
            {
                includePreset: true,
                includeInstruct: true,
                stream: false
            },
            jsonSchema ? { jsonSchema } : {}  // 5th parameter
        );

        const content = result?.content || result || '';

        // Debug: log LLM response
        log(`LLM response received (${content.length} chars)`);
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
        showToast('error', `${errorContext} failed: ${errorMessage}`);
        throw error;
    }
}

/**
 * Call LLM for memory extraction
 * @param {string} prompt - The extraction prompt
 * @param {Object} options - Optional parameters
 * @returns {Promise<string>} The LLM response content
 */
export function callLLMForExtraction(prompt, options = {}) {
    return callLLM(prompt, LLM_CONFIGS.extraction, options);
}

/**
 * Call LLM for memory retrieval/scoring
 * @param {string} prompt - The retrieval prompt
 * @param {Object} options - Optional parameters
 * @returns {Promise<string>} The LLM response content
 */
export function callLLMForRetrieval(prompt, options = {}) {
    return callLLM(prompt, LLM_CONFIGS.retrieval, options);
}
