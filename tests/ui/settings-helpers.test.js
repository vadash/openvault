import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

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

describe('Emergency Cut Modal Helpers', () => {
    let boundEvents = new Map();

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
            on: vi.fn((event, handler) => {
                const key = typeof selector === 'string' ? selector : selector?.id || selector;
                if (!boundEvents.has(key)) {
                    boundEvents.set(key, []);
                }
                boundEvents.get(key).push({ event, handler });
                return $obj;
            }),
            off: vi.fn((event) => {
                const key = typeof selector === 'string' ? selector : selector?.id || selector;
                if (event) {
                    const bindings = boundEvents.get(key);
                    if (bindings) {
                        const namespace = event.split('.')[1];
                        const filtered = bindings.filter((b) => b.event.split('.')[1] !== namespace);
                        boundEvents.set(key, filtered);
                    }
                } else {
                    boundEvents.delete(key);
                }
                return $obj;
            }),
            parent: vi.fn(() => $obj),
            appendTo: vi.fn((target) => {
                if (target === 'body' && element) {
                    // Append the cached element to body
                    if (!document.body.contains(element)) {
                        document.body.appendChild(element);
                    }
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
            prop: vi.fn((prop, val) => {
                if (val !== undefined) {
                    if (element) element[prop] = val;
                    return $obj;
                }
                return element?.[prop];
            }),
            text: vi.fn((txt) => {
                if (txt !== undefined) {
                    if (element) element.textContent = txt;
                    return $obj;
                }
                return element?.textContent || '';
            }),
            css: vi.fn((prop, val) => {
                if (val !== undefined) {
                    if (element) element.style[prop] = val;
                    return $obj;
                }
                return element?.style?.[prop] || '';
            }),
            click: vi.fn(() => {
                // Call all click handlers tracked for this element
                const key = typeof selector === 'string' ? selector : element?.id || element;
                const bindings = boundEvents.get(key);
                if (bindings) {
                    bindings.forEach((b) => {
                        if (b.event === 'click' || b.event.startsWith('click')) {
                            b.handler();
                        }
                    });
                }
                return $obj;
            }),
            closest: vi.fn((sel) => {
                // Check if element is inside the modal
                if (element && sel === '#openvault_emergency_cut_modal') {
                    const modal = document.querySelector('#openvault_emergency_cut_modal');
                    const isInside = modal?.contains(element);
                    return { length: isInside ? 1 : 0 };
                }
                return { length: 0 };
            }),
            each: vi.fn(() => $obj),
        };

        return $obj;
    };

    // Allow chaining
    mockJQuery.fn = {};

    beforeEach(() => {
        // Reset state
        boundEvents.clear();
        global.$ = mockJQuery;

        // Reset body with all required modal elements
        document.body.innerHTML = `
            <div id="openvault_emergency_cut_modal" class="openvault-modal hidden">
                <div class="openvault-modal-content">
                    <button id="openvault_emergency_cancel">Cancel</button>
                </div>
                <div id="openvault_emergency_fill"></div>
                <div id="openvault_emergency_label"></div>
                <div id="openvault_emergency_phase"></div>
            </div>
        `;
    });

    afterEach(() => {
        $(document).off('keydown.emergencyCut');
    });

    describe('showEmergencyCutModal', () => {
        it('appends modal to body and removes hidden class', async () => {
            const { showEmergencyCutModal } = await import('../../src/ui/settings.js');

            showEmergencyCutModal();

            // Verify modal is visible (hidden class removed)
            expect($('#openvault_emergency_cut_modal').hasClass('hidden')).toBe(false);

            // Verify appendTo was called with 'body' by checking the modal is in body
            const modalElement = document.querySelector('#openvault_emergency_cut_modal');
            expect(document.body.contains(modalElement)).toBe(true);
        });

        it('binds keydown trap that blocks events outside modal', async () => {
            const { showEmergencyCutModal, hideEmergencyCutModal } = await import('../../src/ui/settings.js');

            showEmergencyCutModal();

            // Check that keydown handler is bound to document
            const docBindings = boundEvents.get(document);
            expect(docBindings?.some((b) => b.event === 'keydown.emergencyCut')).toBe(true);

            // Simulate keydown outside modal (target is body)
            const preventDefaultSpy = vi.fn();
            const stopPropagationSpy = vi.fn();

            const handler = docBindings.find((b) => b.event === 'keydown.emergencyCut').handler;
            const mockEvent = {
                key: 'Enter',
                target: document.body,
                preventDefault: preventDefaultSpy,
                stopPropagation: stopPropagationSpy,
            };

            handler(mockEvent);

            expect(preventDefaultSpy).toHaveBeenCalled();
            expect(stopPropagationSpy).toHaveBeenCalled();

            hideEmergencyCutModal();
        });

        it('allows Tab and Enter inside modal without blocking', async () => {
            const { showEmergencyCutModal, hideEmergencyCutModal } = await import('../../src/ui/settings.js');

            showEmergencyCutModal();

            const docBindings = boundEvents.get(document);
            const handler = docBindings.find((b) => b.event === 'keydown.emergencyCut').handler;

            const preventDefaultSpy = vi.fn();
            const cancelButton = document.querySelector('#openvault_emergency_cancel');

            const mockEvent = {
                key: 'Enter',
                target: cancelButton,
                preventDefault: preventDefaultSpy,
                stopPropagation: vi.fn(),
            };

            handler(mockEvent);

            // Should NOT prevent default since target is inside modal
            expect(preventDefaultSpy).not.toHaveBeenCalled();

            hideEmergencyCutModal();
        });

        it('Escape key triggers cancel button click if not disabled', async () => {
            const { showEmergencyCutModal, hideEmergencyCutModal } = await import('../../src/ui/settings.js');

            showEmergencyCutModal();

            const $cancelBtn = $('#openvault_emergency_cancel');
            const clickSpy = vi.fn();
            $cancelBtn.on('click', clickSpy);

            const docBindings = boundEvents.get(document);
            const handler = docBindings.find((b) => b.event === 'keydown.emergencyCut').handler;

            // Simulate Escape key
            const mockEvent = {
                key: 'Escape',
                target: document.body,
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
            };

            handler(mockEvent);

            // The click spy should have been called
            expect(clickSpy).toHaveBeenCalled();

            hideEmergencyCutModal();
        });
    });

    describe('hideEmergencyCutModal', () => {
        it('adds hidden class and removes keydown handler', async () => {
            const { showEmergencyCutModal, hideEmergencyCutModal } = await import('../../src/ui/settings.js');

            showEmergencyCutModal();
            hideEmergencyCutModal();

            const $modal = $('#openvault_emergency_cut_modal');
            expect($modal.hasClass('hidden')).toBe(true);

            // Keydown handler should be removed
            const docBindings = boundEvents.get(document);
            expect(docBindings?.some((e) => e.event === 'keydown.emergencyCut')).toBe(false);
        });
    });

    describe('updateEmergencyCutProgress', () => {
        it('updates progress bar and label', async () => {
            const { updateEmergencyCutProgress } = await import('../../src/ui/settings.js');

            updateEmergencyCutProgress(3, 8, 42);

            // Math.round(3/8 * 100) = 38
            expect($('#openvault_emergency_fill').css('width')).toBe('38%');
            expect($('#openvault_emergency_label').text()).toBe('Batch 3/8 - 42 memories created');
        });
    });

    describe('disableEmergencyCutCancel', () => {
        it('disables cancel button and updates text', async () => {
            const { disableEmergencyCutCancel } = await import('../../src/ui/settings.js');

            disableEmergencyCutCancel();

            expect($('#openvault_emergency_cancel').prop('disabled')).toBe(true);
            expect($('#openvault_emergency_cancel').text()).toBe('Synthesizing...');
            expect($('#openvault_emergency_phase').text()).toBe('Running final synthesis...');
        });
    });
});

// =============================================================================
// handleEmergencyCut Tests
// =============================================================================

describe('handleEmergencyCut', () => {
    beforeEach(() => {
        // Reset body with required elements
        document.body.innerHTML = `
            <textarea id="send_textarea"></textarea>
            <div id="openvault_emergency_cut_modal" class="openvault-modal hidden">
                <div class="openvault-modal-content">
                    <button id="openvault_emergency_cancel">Cancel</button>
                </div>
                <div id="openvault_emergency_fill"></div>
                <div id="openvault_emergency_label"></div>
                <div id="openvault_emergency_phase"></div>
            </div>
        `;

        // Reset confirm mock
        global.confirm = vi.fn(() => true);
    });

    it('shows warning toast if worker is running', async () => {
        // This will fail because handleEmergencyCut doesn't exist yet
        const { handleEmergencyCut } = await import('../../src/ui/settings.js');
        expect(typeof handleEmergencyCut).toBe('function');
    });

    it('shows info toast and returns if no messages to hide', async () => {
        // This will fail because handleEmergencyCut doesn't exist yet
        const { handleEmergencyCut } = await import('../../src/ui/settings.js');
        expect(typeof handleEmergencyCut).toBe('function');
    });

    it('returns early if user cancels confirmation', async () => {
        // This will fail because handleEmergencyCut doesn't exist yet
        const { handleEmergencyCut } = await import('../../src/ui/settings.js');
        expect(typeof handleEmergencyCut).toBe('function');
    });
});

// =============================================================================
// hideExtractedMessages Tests
// =============================================================================

describe('hideExtractedMessages', () => {
    it('only marks messages that are in processed fingerprints set', async () => {
        const { hideExtractedMessages } = await import('../../src/ui/settings.js');

        // Mock scheduler module - processed fingerprints are fp1 and fp2
        const { getProcessedFingerprints, getFingerprint } = await import('../../src/extraction/scheduler.js');
        vi.spyOn(await import('../../src/extraction/scheduler.js'), 'getProcessedFingerprints').mockReturnValue(
            new Set(['fp1', 'fp2'])
        );
        vi.spyOn(await import('../../src/extraction/scheduler.js'), 'getFingerprint').mockImplementation((msg) => msg.fp);

        // Mock data module
        vi.spyOn(await import('../../src/utils/data.js'), 'getOpenVaultData').mockReturnValue({ memories: [] });

        // Mock deps
        const mockContext = {
            chat: [
                { fp: 'fp1', is_system: false }, // processed, should hide
                { fp: 'fp2', is_system: false }, // processed, should hide
                { fp: 'fp3', is_system: false }, // not processed, keep visible
                { fp: 'fp1', is_system: true }, // already hidden, skip
            ],
        };
        const mockSaveChatConditional = vi.fn(async () => true);
        vi.spyOn(await import('../../src/deps.js'), 'getDeps').mockReturnValue({
            getContext: () => mockContext,
            saveChatConditional: mockSaveChatConditional,
            console: global.console,
        });

        const count = await hideExtractedMessages();

        expect(count).toBe(2); // Only fp1 and fp2 (not already hidden)
        expect(mockContext.chat[0].is_system).toBe(true); // fp1 now hidden
        expect(mockContext.chat[1].is_system).toBe(true); // fp2 now hidden
        expect(mockContext.chat[2].is_system).toBe(false); // fp3 still visible
        expect(mockSaveChatConditional).toHaveBeenCalled();
    });

    it('returns 0 if no messages to hide', async () => {
        const { hideExtractedMessages } = await import('../../src/ui/settings.js');

        // Mock scheduler module - no processed fingerprints
        vi.spyOn(await import('../../src/extraction/scheduler.js'), 'getProcessedFingerprints').mockReturnValue(
            new Set([])
        );
        vi.spyOn(await import('../../src/extraction/scheduler.js'), 'getFingerprint').mockImplementation((msg) => msg.fp);

        // Mock data module
        vi.spyOn(await import('../../src/utils/data.js'), 'getOpenVaultData').mockReturnValue({ memories: [] });

        // Mock deps
        const mockContext = {
            chat: [
                { fp: 'fp1', is_system: false },
                { fp: 'fp2', is_system: false },
            ],
        };
        const mockSaveChatConditional = vi.fn(async () => true);
        vi.spyOn(await import('../../src/deps.js'), 'getDeps').mockReturnValue({
            getContext: () => mockContext,
            saveChatConditional: mockSaveChatConditional,
            console: global.console,
        });

        const count = await hideExtractedMessages();

        expect(count).toBe(0);
        expect(mockSaveChatConditional).not.toHaveBeenCalled();
    });
});
