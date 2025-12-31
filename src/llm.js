/**
 * OpenVault LLM Service
 *
 * Unified LLM communication for extraction and retrieval operations.
 */

import { getDeps } from './deps.js';
import { log, showToast } from './utils.js';
import { extensionName } from './constants.js';
import { SYSTEM_PROMPTS } from './prompts.js';

/**
 * LLM configuration presets
 */
export const LLM_CONFIGS = {
    extraction: {
        profileSettingKey: 'extractionProfile',
        systemPrompt: SYSTEM_PROMPTS.extraction,
        maxTokens: 2000,
        errorContext: 'Extraction'
    },
    retrieval: {
        profileSettingKey: 'retrievalProfile',
        systemPrompt: SYSTEM_PROMPTS.retrieval,
        maxTokens: 1000,
        errorContext: 'Smart retrieval'
    }
};

/**
 * Call LLM with unified request handling
 * @param {string} prompt - The user prompt
 * @param {Object} config - Request configuration from LLM_CONFIGS
 * @returns {Promise<string>} The LLM response content
 * @throws {Error} If the LLM call fails or no profile is available
 */
export async function callLLM(prompt, config) {
    const { profileSettingKey, systemPrompt, maxTokens, errorContext } = config;
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

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
        ];

        const result = await deps.connectionManager.sendRequest(
            profileId,
            messages,
            maxTokens,
            {
                includePreset: true,
                includeInstruct: true,
                stream: false
            },
            {}
        );

        const content = result?.content || result || '';

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
 * @returns {Promise<string>} The LLM response content
 */
export function callLLMForExtraction(prompt) {
    return callLLM(prompt, LLM_CONFIGS.extraction);
}

/**
 * Call LLM for memory retrieval/scoring
 * @param {string} prompt - The retrieval prompt
 * @returns {Promise<string>} The LLM response content
 */
export function callLLMForRetrieval(prompt) {
    return callLLM(prompt, LLM_CONFIGS.retrieval);
}
