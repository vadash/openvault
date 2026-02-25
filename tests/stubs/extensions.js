/**
 * Stub for SillyTavern extensions.js
 * Used by vitest tests to resolve extension dependencies.
 */

export const getContext = () => ({
    chat: [],
    name1: 'User',
    name2: 'Assistant',
    characterId: 'test-char',
    characters: {},
    powerUserSettings: {},
});

export const extension_settings = {
    openvault: {
        enabled: true,
        debugMode: false,
    },
};

export const saveChatConditional = async () => true;
export const setExtensionPrompt = () => true;
export const extension_prompt_toggles = {};

// Script-wide globals
export const eventSource = {
    on: () => {},
    removeListener: () => {},
};

export const eventTypes = {
    APP_READY: 'APP_READY',
    MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
    CHAT_CHANGED: 'CHAT_CHANGED',
    GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
    GENERATION_ENDED: 'GENERATION_ENDED',
};

export const SlashCommandParser = {
    addCommandObject: () => {},
};

export const SlashCommand = {
    fromProps: (props) => props,
};
