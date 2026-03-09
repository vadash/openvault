/**
 * Vitest setup file
 * Runs before all tests to configure the test environment.
 */

// Mock scheduler API (browser-only, not available in Node/vitest)
global.scheduler = {
    yield: () => Promise.resolve(),
};

// Mock fetch API globally for tests that need it
global.fetch = vi.fn(() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
    })
);

// Mock jQuery/toastr if needed
global.$ = (selector) => ({
    on: () => {},
    off: () => {},
    val: () => '',
    prop: () => {},
    text: () => {},
    html: () => '',
    append: () => {},
    remove: () => {},
    empty: () => {},
    show: () => {},
    hide: () => {},
    toggle: () => {},
    toggleClass: () => global.$(selector),
    each: () => {},
    find: () => global.$(selector),
    parent: () => global.$(selector),
    closest: () => global.$(selector),
    data: () => ({}),
    attr: () => '',
    addClass: () => global.$(selector),
    removeClass: () => global.$(selector),
    hasClass: () => false,
});

global.toastr = {
    info: () => ({ remove: () => {} }),
    success: () => ({}),
    warning: () => ({}),
    error: () => ({}),
};

import { defaultSettings, extensionName } from '../src/constants.js';
// ── Shared test context helper ──
import { setDeps } from '../src/deps.js';

/**
 * Standard test context setup. Replaces per-file setDeps boilerplate.
 *
 * @param {Object} [overrides]
 * @param {Object} [overrides.context]  - Merged into getContext() return
 * @param {Object} [overrides.settings] - Merged into openvault extension settings
 * @param {Object} [overrides.deps]     - Merged directly into deps (Date, saveChatConditional, etc.)
 */
global.setupTestContext = (overrides = {}) => {
    setDeps({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        getContext: () => ({
            chat: [],
            name1: 'User',
            name2: 'Alice',
            chatId: 'test-chat-123',
            chatMetadata: { openvault: {} },
            ...overrides.context,
        }),
        getExtensionSettings: () => ({
            [extensionName]: {
                ...defaultSettings,
                enabled: true,
                debugMode: false,
                ...overrides.settings,
            },
        }),
        Date: { now: () => 1000000 },
        ...overrides.deps,
    });
};
