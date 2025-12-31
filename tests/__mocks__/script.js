/**
 * Mock for SillyTavern script.js
 */
export function saveChatConditional() {
    return Promise.resolve();
}

export function setExtensionPrompt() {}

export const extension_prompt_types = {
    IN_CHAT: 1,
    AFTER_SCENARIO: 2,
};

export const eventSource = {
    on: () => {},
    removeListener: () => {},
    emit: () => {},
};

export const event_types = {
    GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
    MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
    CHAT_CHANGED: 'CHAT_CHANGED',
};
