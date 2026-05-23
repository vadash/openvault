import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Set up JSDOM
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;

// Mock console for logging
global.console = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
};

// Mock jQuery
const mockJQuery = (selector) => {
    let element;
    if (typeof selector === 'string') {
        element = document.querySelector(selector);
    } else if (selector instanceof HTMLElement) {
        element = selector;
    } else {
        element = selector;
    }

    const $obj = {
        on: vi.fn(() => $obj),
        off: vi.fn(() => $obj),
        parent: vi.fn(() => $obj),
        appendTo: vi.fn((target) => {
            if (target === 'body' && element && !document.body.contains(element)) {
                document.body.appendChild(element);
            }
            return $obj;
        }),
        removeClass: vi.fn((cls) => {
            if (element) element.classList.remove(cls);
            return $obj;
        }),
        addClass: vi.fn((cls) => {
            if (element) element.classList.add(cls);
            return $obj;
        }),
        hasClass: vi.fn((cls) => element?.classList.contains(cls) || false),
        prop: vi.fn(() => $obj),
        text: vi.fn(() => $obj),
        remove: vi.fn(() => $obj),
    };

    return $obj;
};

mockJQuery.fn = {};
global.$ = mockJQuery;

// Mock toastr
global.toastr = {
    info: vi.fn(() => ({ remove: vi.fn() })),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
};

describe('Emergency Cut Modal Helpers', () => {
    beforeEach(() => {
        // Reset body with modal elements
        document.body.innerHTML = `
            <div id="openvault_emergency_cut_modal" class="openvault-modal hidden">
                <div class="openvault-modal-content">
                    <button id="openvault_emergency_cancel">Cancel</button>
                </div>
            </div>
        `;
    });

    describe('showEmergencyCutModal', () => {
        it('appends modal to body and removes hidden class', async () => {
            const { showEmergencyCutModal } = await import('../../src/ui/settings.js');

            showEmergencyCutModal();

            // Verify modal is visible (hidden class removed)
            expect($('#openvault_emergency_cut_modal').hasClass('hidden')).toBe(false);

            // Verify modal is in body
            const modalElement = document.querySelector('#openvault_emergency_cut_modal');
            expect(document.body.contains(modalElement)).toBe(true);
        });
    });

    describe('hideEmergencyCutModal', () => {
        it('adds hidden class to modal', async () => {
            const { showEmergencyCutModal, hideEmergencyCutModal } = await import('../../src/ui/settings.js');

            showEmergencyCutModal();
            hideEmergencyCutModal();

            expect($('#openvault_emergency_cut_modal').hasClass('hidden')).toBe(true);
        });
    });
});

describe('Usage Tracker Integration in UI Handlers', () => {
    beforeEach(() => {
        // Reset body with modal elements
        document.body.innerHTML = `
            <div id="openvault_emergency_cut_modal" class="openvault-modal hidden">
                <div class="openvault-modal-content">
                    <button id="openvault_emergency_cancel">Cancel</button>
                </div>
            </div>
            <textarea id="send_textarea"></textarea>
        `;
    });

    describe('handleExtractAll', () => {
        it('passes tracker option to extractAllMessages', async () => {
            const { handleExtractAll } = await import('../../src/ui/settings.js');
            const extractModule = await import('../../src/extraction/extract.js');

            // Spy on extractAllMessages
            const spy = vi.spyOn(extractModule, 'extractAllMessages').mockResolvedValueOnce({
                messagesProcessed: 0,
                eventsCreated: 0,
            });

            await handleExtractAll();

            expect(spy).toHaveBeenCalled();
            const options = spy.mock.calls[0][0];
            expect(options.tracker).toBeDefined();
            expect(typeof options.tracker.record).toBe('function');
            expect(typeof options.tracker.getSummary).toBe('function');

            spy.mockRestore();
        });
    });

    describe('handleEmergencyCutClick', () => {
        it('passes tracker option to executeEmergencyCut', async () => {
            const { handleEmergencyCutClick } = await import('../../src/ui/settings.js');
            const extractModule = await import('../../src/extraction/extract.js');

            // Spy on executeEmergencyCut
            const spy = vi.spyOn(extractModule, 'executeEmergencyCut').mockResolvedValueOnce(undefined);

            await handleEmergencyCutClick();

            expect(spy).toHaveBeenCalled();
            const options = spy.mock.calls[0][0];
            expect(options.tracker).toBeDefined();
            expect(typeof options.tracker.record).toBe('function');
            expect(typeof options.tracker.getSummary).toBe('function');

            spy.mockRestore();
        });
    });
});
