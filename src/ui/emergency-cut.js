/**
 * Emergency Cut Modal UI
 *
 * Modal show/hide/progress/disable logic for the Emergency Cut feature.
 * Handles the progress display during the extraction process.
 */

import { executeEmergencyCut } from '../extraction/extract.js';
import { showToast } from '../utils/dom.js';
import { logError } from '../utils/logging.js';
import { refreshAllUI } from './render.js';

let emergencyCutModalAppended = false;
let emergencyCutAbortController = null;

/**
 * Show the Emergency Cut progress modal.
 * Appends to body to avoid stacking context issues with ST's extension panel.
 */
export function showEmergencyCutModal() {
    const $modal = $('#openvault_emergency_cut_modal');
    if (!emergencyCutModalAppended) {
        $modal.appendTo('body');
        emergencyCutModalAppended = true;
    }
    $modal.removeClass('hidden');

    // Keyboard trap with modal accessibility
    $(document).on('keydown.emergencyCut', (e) => {
        // Escape - always check first (handles focus loss on overlay click)
        if (e.key === 'Escape') {
            e.preventDefault();
            const $cancelBtn = $('#openvault_emergency_cancel');
            if (!$cancelBtn.prop('disabled')) {
                $cancelBtn.click();
            }
            return;
        }

        // Allow Tab/Enter inside modal
        if ($(e.target).closest('#openvault_emergency_cut_modal').length) {
            return;
        }

        // Block ST hotkeys outside
        e.preventDefault();
        e.stopPropagation();
    });

    // Bind cancel button click to abort controller
    $('#openvault_emergency_cancel')
        .off('click')
        .on('click', () => {
            if (emergencyCutAbortController) {
                emergencyCutAbortController.abort();
            }
        });
}

/**
 * Hide the Emergency Cut progress modal.
 */
export function hideEmergencyCutModal() {
    $('#openvault_emergency_cut_modal').addClass('hidden');
    $(document).off('keydown.emergencyCut');
    $('#openvault_emergency_cancel').off('click');
}

/**
 * Update progress display during Emergency Cut.
 * @param {number} batchNum - Current batch number (1-indexed)
 * @param {number} totalBatches - Total number of batches
 * @param {number} eventsCreated - Number of memories created so far
 */
export function updateEmergencyCutProgress(batchNum, totalBatches, eventsCreated) {
    const progress = Math.round((batchNum / totalBatches) * 100);
    $('#openvault_emergency_fill').css('width', `${progress}%`);
    $('#openvault_emergency_label').text(`Batch ${batchNum}/${totalBatches} - ${eventsCreated} memories created`);
}

/**
 * Disable the cancel button when entering Phase 2 (uncancellable).
 */
export function disableEmergencyCutCancel() {
    $('#openvault_emergency_cancel').prop('disabled', true).text('Synthesizing...');
    $('#openvault_emergency_phase').text('Running final synthesis...');
}

/**
 * Handle Emergency Cut button click — thin UI wrapper around domain function.
 */
export async function handleEmergencyCutClick() {
    emergencyCutAbortController = new AbortController();

    await executeEmergencyCut({
        onWarning: (msg) => showToast('warning', msg),
        onConfirmPrompt: (msg) => confirm(msg),
        onStart: () => {
            $('#send_textarea').prop('disabled', true);
            showEmergencyCutModal();
        },
        onProgress: (batch, total, events) => updateEmergencyCutProgress(batch, total, events),
        onPhase2Start: () => disableEmergencyCutCancel(),
        onComplete: ({ messagesProcessed, eventsCreated, hiddenCount }) => {
            if (messagesProcessed > 0) {
                showToast(
                    'success',
                    `Emergency Cut complete. ${messagesProcessed} messages processed, ` +
                        `${eventsCreated} memories created. Chat history hidden.`
                );
            } else {
                showToast('success', `Emergency Cut complete. ${hiddenCount} messages hidden from context.`);
            }
            $('#send_textarea').prop('disabled', false);
            hideEmergencyCutModal();
            emergencyCutAbortController = null;
            refreshAllUI();
        },
        onError: (err, isCancel) => {
            const message = isCancel
                ? 'Emergency Cut cancelled. No messages were hidden.'
                : `Emergency Cut failed: ${err.message}. No messages were hidden.`;
            showToast(isCancel ? 'info' : 'error', message);
            logError('Emergency Cut failed', err);
            $('#send_textarea').prop('disabled', false);
            hideEmergencyCutModal();
            emergencyCutAbortController = null;
        },
        abortSignal: emergencyCutAbortController.signal,
    });
}
