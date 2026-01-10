import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock deps before importing
vi.mock('../src/deps.js', () => ({
    getDeps: () => ({
        getExtensionSettings: () => ({
            openvault: { enabled: true }
        }),
        eventSource: {
            on: vi.fn(),
            removeListener: vi.fn(),
            makeFirst: vi.fn()
        },
        eventTypes: {
            GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
            GENERATION_ENDED: 'GENERATION_ENDED',
            MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
            CHAT_CHANGED: 'CHAT_CHANGED'
        }
    })
}));

// Mock the events module
vi.mock('../src/events.js', () => ({
    onBeforeGeneration: vi.fn(),
    onGenerationEnded: vi.fn(),
    onMessageReceived: vi.fn(),
    onChatChanged: vi.fn()
}));

vi.mock('../src/constants.js', () => ({
    extensionName: 'openvault'
}));

describe('listeners module', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('exports updateEventListeners function', async () => {
        const { updateEventListeners } = await import('../src/listeners.js');
        expect(typeof updateEventListeners).toBe('function');
    });

    it('exports areListenersRegistered function', async () => {
        const { areListenersRegistered } = await import('../src/listeners.js');
        expect(typeof areListenersRegistered).toBe('function');
    });
});
