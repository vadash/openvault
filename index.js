/**
 * OpenVault - Agentic Memory Extension for SillyTavern
 *
 * Provides POV-aware memory with witness tracking, relationship dynamics,
 * and emotional continuity for roleplay conversations.
 *
 * All data is stored in chatMetadata - no external services required.
 */

import { getDeps } from './src/deps.js';

// Import from modular structure
import { extensionName, MEMORIES_KEY } from './src/constants.js';
import { getOpenVaultData, showToast, log } from './src/utils.js';
import { setChatLoadingCooldown } from './src/state.js';
import { loadSettings } from './src/ui/settings.js';
import { setStatus } from './src/ui/status.js';
import { refreshAllUI } from './src/ui/render.js';
import { extractMemories } from './src/extraction/extract.js';
import { retrieveAndInjectContext } from './src/retrieval/retrieve.js';
import { updateEventListeners } from './src/events.js';

// Re-export extensionName for external use
export { extensionName };

/**
 * Register slash commands
 */
function registerCommands() {
    const context = getDeps().getContext();
    const parser = context.SlashCommandParser;
    const command = context.SlashCommand;

    // /openvault-extract - Extract memories from recent messages
    parser.addCommandObject(command.fromProps({
        name: 'openvault-extract',
        callback: async () => {
            setStatus('extracting');
            try {
                const result = await extractMemories();
                if (result.status === 'success' && result.events_created > 0) {
                    showToast('success', `Extracted ${result.events_created} memory events`);
                    refreshAllUI();
                } else if (result.status === 'skipped') {
                    showToast('info', result.reason === 'disabled' ? 'OpenVault is disabled' :
                        result.reason === 'no_new_messages' ? 'No new messages to extract' : 'Cannot extract');
                }
            } catch (error) {
                showToast('error', `Extraction failed: ${error.message}`);
            }
            setStatus('ready');
            return '';
        },
        helpString: 'Extract memories from recent messages',
    }));

    // /openvault-retrieve - Retrieve and inject context
    parser.addCommandObject(command.fromProps({
        name: 'openvault-retrieve',
        callback: async () => {
            setStatus('retrieving');
            try {
                const result = await retrieveAndInjectContext();
                if (result) {
                    showToast('success', `Retrieved ${result.memories.length} relevant memories`);
                } else {
                    showToast('info', 'No memories to retrieve');
                }
            } catch (error) {
                showToast('error', `Retrieval failed: ${error.message}`);
            }
            setStatus('ready');
            return '';
        },
        helpString: 'Retrieve relevant context and inject into prompt',
    }));

    // /openvault-status - Show current status
    parser.addCommandObject(command.fromProps({
        name: 'openvault-status',
        callback: async () => {
            const settings = getDeps().getExtensionSettings()[extensionName];
            const data = getOpenVaultData();
            const memoriesCount = data?.[MEMORIES_KEY]?.length || 0;
            const status = `OpenVault: ${settings.enabled ? 'Enabled' : 'Disabled'}, Memories: ${memoriesCount}`;
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
    const { eventSource, eventTypes } = getDeps();
    eventSource.on(eventTypes.APP_READY, async () => {
        // Check SillyTavern version
        try {
            const response = await fetch('/version');
            const version = await response.json();
            const [_major, minor] = version.pkgVersion.split('.').map(Number);

            if (minor < 13) {
                showToast('error', 'OpenVault requires SillyTavern 1.13.0 or later');
                return;
            }
        } catch (error) {
            console.error('[OpenVault] Failed to check SillyTavern version:', error);
            showToast('error', 'OpenVault failed to verify SillyTavern version');
            return;
        }

        await loadSettings();
        registerCommands();

        // Set cooldown during initial load to prevent extraction from MESSAGE_RECEIVED events
        setChatLoadingCooldown(2000, log);

        updateEventListeners();
        setStatus('ready');
        log('Extension initialized');
    });
});
