/**
 * Prefill Selector UI Component
 *
 * Custom dropdown with hover preview for extraction prefill presets.
 */

import { PREFILL_PRESETS } from '../prompts/index.js';
import { getSettings, setSetting } from '../settings.js';

/**
 * Initialize the prefill selector dropdown.
 */
export function initPrefillSelector() {
    const $container = $('#openvault_prefill_selector');
    if (!$container.length) return;

    const settings = getSettings();
    const currentKey = settings.extractionPrefill || 'pure_think';
    const currentPreset = PREFILL_PRESETS[currentKey] || PREFILL_PRESETS.pure_think;

    // Trigger button
    const $trigger = $('<div class="openvault-prefill-trigger" tabindex="0"></div>').text(currentPreset.label);

    // Dropdown panel
    const $dropdown = $('<div class="openvault-prefill-dropdown"></div>');
    const $options = $('<div class="openvault-prefill-options"></div>');
    const $preview = $('<div class="openvault-prefill-preview"></div>');
    const $previewLabel = $('<div class="openvault-prefill-preview-label">Preview</div>');
    const $previewCode = $('<pre></pre>');
    $preview.append($previewLabel, $previewCode);

    renderPrefillPreview($previewCode, currentPreset.value);

    for (const [key, preset] of Object.entries(PREFILL_PRESETS)) {
        const $opt = $('<div class="openvault-prefill-option"></div>').attr('data-value', key).text(preset.label);

        if (key === currentKey) $opt.addClass('selected');

        $opt.on('mouseenter', () => renderPrefillPreview($previewCode, preset.value));

        $opt.on('click', () => {
            setSetting('extractionPrefill', key);
            $trigger.text(preset.label);
            $options.find('.selected').removeClass('selected');
            $opt.addClass('selected');
            $container.removeClass('open');
            renderPrefillPreview($previewCode, preset.value);
        });

        $options.append($opt);
    }

    // Revert preview when mouse leaves options area
    $options.on('mouseleave', () => {
        const selKey = $options.find('.selected').data('value');
        renderPrefillPreview($previewCode, PREFILL_PRESETS[selKey]?.value);
    });

    $dropdown.append($options, $preview);
    $container.append($trigger, $dropdown);

    // Toggle dropdown
    $trigger.on('click', (e) => {
        e.stopPropagation();
        $container.toggleClass('open');
    });

    // Close on outside click
    $(document).on('click.prefillSelector', (e) => {
        if (!$container[0].contains(e.target)) {
            $container.removeClass('open');
        }
    });

    // Close on Escape
    $(document).on('keydown.prefillSelector', (e) => {
        if (e.key === 'Escape' && $container.hasClass('open')) {
            $container.removeClass('open');
            $trigger.trigger('focus');
        }
    });
}

/**
 * Sync the prefill selector to current settings.
 */
export function syncPrefillSelector() {
    const settings = getSettings();
    const key = settings.extractionPrefill || 'pure_think';
    const preset = PREFILL_PRESETS[key];
    if (!preset) return;

    const $container = $('#openvault_prefill_selector');
    $container.find('.openvault-prefill-trigger').text(preset.label);
    $container.find('.openvault-prefill-option').removeClass('selected');
    $container.find(`.openvault-prefill-option[data-value="${key}"]`).addClass('selected');
    renderPrefillPreview($container.find('.openvault-prefill-preview pre'), preset.value);
}

/**
 * Render prefill preview in the given element.
 * @param {jQuery} $pre - The <pre> element to render into
 * @param {string} value - The prefill value to render
 */
function renderPrefillPreview($pre, value) {
    if (value === '' || value === undefined) {
        $pre.html('<span class="openvault-prefill-preview-empty">(empty — no prefill)</span>');
    } else {
        $pre.text(value);
    }
}
