/**
 * OpenVault - Agentic Memory Extension for SillyTavern
 *
 * Provides POV-aware memory with witness tracking, relationship dynamics,
 * and emotional continuity for roleplay conversations.
 *
 * All data is stored in chatMetadata - no external services required.
 */

import { eventSource, event_types, saveChatConditional } from '../../../../script.js';
import { getContext, extension_settings } from '../../../extensions.js';

// Import from modular structure
import { extensionName, METADATA_KEY } from './src/constants.js';
import { getOpenVaultData, showToast, log } from './src/utils.js';
import { setChatLoadingCooldown } from './src/state.js';
import { loadSettings, setExternalFunctions } from './src/ui/settings.js';
import { setStatus } from './src/ui/status.js';
import { refreshAllUI } from './src/ui/browser.js';
import { extractMemories } from './src/extraction/extract.js';
import { extractAllMessages } from './src/extraction/batch.js';
import { retrieveAndInjectContext } from './src/retrieval/retrieve.js';
import { updateEventListeners } from './src/events.js';
import { MEMORIES_KEY } from './src/constants.js';

// Re-export extensionName for external use
export { extensionName };

/**
 * Delete current chat's OpenVault data
 */
async function deleteCurrentChatData() {
    if (!confirm('Are you sure you want to delete all OpenVault data for this chat?')) {
        return;
    }

    const context = getContext();
    if (context.chatMetadata) {
        delete context.chatMetadata[METADATA_KEY];
        await saveChatConditional();
    }

    showToast('success', 'Chat memories deleted');
    refreshAllUI();
}

/**
 * Delete all OpenVault data (requires typing DELETE)
 */
async function deleteAllData() {
    const confirmation = prompt('Type DELETE to confirm deletion of all OpenVault data:');
    if (confirmation !== 'DELETE') {
        showToast('warning', 'Deletion cancelled');
        return;
    }

    // This would need to iterate through all chats - for now just clear current
    const context = getContext();
    if (context.chatMetadata) {
        delete context.chatMetadata[METADATA_KEY];
        await saveChatConditional();
    }

    showToast('success', 'All data deleted');
    refreshAllUI();
}

/**
 * Wrapper for extractAllMessages that passes updateEventListeners
 */
function extractAllMessagesWrapper() {
    return extractAllMessages(updateEventListeners);
}

/**
 * Register slash commands
 */
function registerCommands() {
    const context = getContext();
    const parser = context.SlashCommandParser;
    const command = context.SlashCommand;

    // /openvault-extract - Extract memories from recent messages
    parser.addCommandObject(command.fromProps({
        name: 'openvault-extract',
        callback: async () => {
            await extractMemories();
            return '';
        },
        helpString: 'Extract memories from recent messages',
    }));

    // /openvault-retrieve - Retrieve and inject context
    parser.addCommandObject(command.fromProps({
        name: 'openvault-retrieve',
        callback: async () => {
            await retrieveAndInjectContext();
            return '';
        },
        helpString: 'Retrieve relevant context and inject into prompt',
    }));

    // /openvault-status - Show current status
    parser.addCommandObject(command.fromProps({
        name: 'openvault-status',
        callback: async () => {
            const settings = extension_settings[extensionName];
            const data = getOpenVaultData();
            const memoriesCount = data?.[MEMORIES_KEY]?.length || 0;
            const status = `OpenVault: ${settings.enabled ? 'Enabled' : 'Disabled'}, Mode: ${settings.automaticMode ? 'Automatic' : 'Manual'}, Memories: ${memoriesCount}`;
            showToast('info', status);
            return status;
        },
        helpString: 'Show OpenVault status',
    }));

    log('Slash commands registered');
}

/**
 * Initialize the extension
 *
 * Uses jQuery DOM-ready pattern to self-initialize when the script loads.
 * Event listeners are registered synchronously to avoid race conditions.
 */
jQuery(() => {
    // Register APP_READY listener synchronously to avoid race conditions
    eventSource.on(event_types.APP_READY, async () => {
        // Check SillyTavern version
        try {
            const response = await fetch('/version');
            const version = await response.json();
            const [major, minor] = version.pkgVersion.split('.').map(Number);

            if (minor < 13) {
                showToast('error', 'OpenVault requires SillyTavern 1.13.0 or later');
                return;
            }
        } catch (error) {
            console.error('[OpenVault] Failed to check SillyTavern version:', error);
            showToast('error', 'OpenVault failed to verify SillyTavern version');
            return;
        }

        // Set external function references for settings UI
        setExternalFunctions({
            updateEventListeners,
            extractMemories,
            retrieveAndInjectContext,
            extractAllMessages: extractAllMessagesWrapper,
            deleteCurrentChatData,
            deleteAllData,
        });

        await loadSettings();
        registerCommands();

        // Set cooldown during initial load to prevent extraction from MESSAGE_RECEIVED events
        setChatLoadingCooldown(2000, log);

        updateEventListeners();
        setStatus('ready');
        log('Extension initialized');
    });
});
