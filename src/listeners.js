/**
 * Event listener management for OpenVault.
 * Handles registration/deregistration of SillyTavern event handlers.
 */
import { getDeps } from './deps.js';
import { extensionName } from './constants.js';
import {
    onBeforeGeneration,
    onGenerationEnded,
    onMessageReceived,
    onChatChanged
} from './events.js';

let listenersRegistered = false;

/**
 * Updates event listeners based on extension enabled state.
 * Registers listeners when enabled, removes them when disabled.
 */
export function updateEventListeners() {
    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName];
    const eventSource = deps.eventSource;
    const eventTypes = deps.eventTypes;

    if (settings?.enabled && !listenersRegistered) {
        // Register listeners
        eventSource.on(eventTypes.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
        eventSource.makeFirst(eventTypes.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
        eventSource.on(eventTypes.GENERATION_ENDED, onGenerationEnded);
        eventSource.on(eventTypes.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
        listenersRegistered = true;
        console.log('[OpenVault] Event listeners registered');
    } else if (!settings?.enabled && listenersRegistered) {
        // Remove listeners
        eventSource.removeListener(eventTypes.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
        eventSource.removeListener(eventTypes.GENERATION_ENDED, onGenerationEnded);
        eventSource.removeListener(eventTypes.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.removeListener(eventTypes.CHAT_CHANGED, onChatChanged);
        listenersRegistered = false;
        console.log('[OpenVault] Event listeners removed');
    }
}

/**
 * Check if listeners are currently registered.
 * @returns {boolean}
 */
export function areListenersRegistered() {
    return listenersRegistered;
}
