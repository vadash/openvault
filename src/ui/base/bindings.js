/**
 * DOM Binding Utilities
 *
 * Generic utilities for binding UI elements to settings.
 * Extracted from settings.js for reuse across UI components.
 */

import { getDeps } from '../../deps.js';
import { extensionName } from '../../constants.js';

/**
 * Convert tokens to approximate word count
 * @param {number} tokens - Token count
 * @returns {number} Approximate word count
 */
function tokensToWords(tokens) {
    return Math.round(tokens * 0.75);
}

/**
 * Update word count display for a token slider
 * @param {number} tokens - Token value
 * @param {string} wordsElementId - ID of the words span element
 */
export function updateWordsDisplay(tokens, wordsElementId) {
    $(`#${wordsElementId}`).text(tokensToWords(tokens));
}

/**
 * Bind a checkbox to a boolean setting
 * @param {string} elementId - jQuery selector for the checkbox
 * @param {string} settingKey - Key in settings object
 * @param {Function} onChange - Optional callback after value change
 */
export function bindCheckbox(elementId, settingKey, onChange) {
    $(`#${elementId}`).on('change', function() {
        getDeps().getExtensionSettings()[extensionName][settingKey] = $(this).is(':checked');
        getDeps().saveSettingsDebounced();
        if (onChange) onChange();
    });
}

/**
 * Bind a slider (range input) to a numeric setting
 * @param {string} elementId - jQuery selector for the slider
 * @param {string} settingKey - Key in settings object
 * @param {string} displayId - Element ID to show the value (optional)
 * @param {Function} onChange - Optional callback after value change
 * @param {string} wordsId - Element ID to show word count (optional)
 * @param {boolean} isFloat - Use parseFloat instead of parseInt (optional)
 */
export function bindSlider(elementId, settingKey, displayId, onChange, wordsId, isFloat = false) {
    $(`#${elementId}`).on('input', function() {
        const value = isFloat ? parseFloat($(this).val()) : parseInt($(this).val());
        getDeps().getExtensionSettings()[extensionName][settingKey] = value;
        if (displayId) {
            $(`#${displayId}`).text(value);
        }
        if (wordsId) {
            updateWordsDisplay(value, wordsId);
        }
        getDeps().saveSettingsDebounced();
        if (onChange) onChange(value);
    });
}

/**
 * Bind a text input to a string setting
 * @param {string} elementId - jQuery selector for the input
 * @param {string} settingKey - Key in settings object
 * @param {Function} transform - Optional transform function (e.g., trim)
 */
export function bindTextInput(elementId, settingKey, transform = (v) => v) {
    $(`#${elementId}`).on('change', function() {
        getDeps().getExtensionSettings()[extensionName][settingKey] = transform($(this).val());
        getDeps().saveSettingsDebounced();
    });
}

/**
 * Bind a number input to a numeric setting
 * @param {string} elementId - jQuery selector for the input
 * @param {string} settingKey - Key in settings object
 * @param {Function} validator - Optional validator function that returns the validated value
 */
export function bindNumberInput(elementId, settingKey, validator) {
    $(`#${elementId}`).on('change', function() {
        let value = $(this).val();
        if (validator) value = validator(value);
        getDeps().getExtensionSettings()[extensionName][settingKey] = value;
        $(this).val(value); // Update UI in case validator changed it
        getDeps().saveSettingsDebounced();
    });
}

/**
 * Bind a select dropdown to a setting
 * @param {string} elementId - jQuery selector for the select
 * @param {string} settingKey - Key in settings object
 * @param {Function} onChange - Optional callback after value change
 */
export function bindSelect(elementId, settingKey, onChange) {
    $(`#${elementId}`).on('change', function() {
        getDeps().getExtensionSettings()[extensionName][settingKey] = $(this).val();
        getDeps().saveSettingsDebounced();
        if (onChange) onChange($(this).val());
    });
}

/**
 * Bind a button click handler
 * @param {string} elementId - jQuery selector for the button
 * @param {Function} handler - Click handler function
 */
export function bindButton(elementId, handler) {
    $(`#${elementId}`).on('click', handler);
}
