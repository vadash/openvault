/**
 * Vitest setup file
 * Runs before all tests to configure the test environment.
 */

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
