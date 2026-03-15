import * as en from './en.js';
import * as ru from './ru.js';

/** @typedef {'QUESTIONS'|'REFLECTIONS'|'INSIGHTS'} ExampleType */

/**
 * Get examples for a specific sub-type and language.
 * @param {ExampleType} type - Example sub-type
 * @param {'auto'|'en'|'ru'} [language='auto'] - Language filter
 * @returns {Array} Filtered examples
 */
function getEnExamples(/** @type {ExampleType} */ type) {
    if (type === 'QUESTIONS') return en.QUESTIONS;
    if (type === 'REFLECTIONS') return en.REFLECTIONS;
    return en.INSIGHTS;
}

function getRuExamples(/** @type {ExampleType} */ type) {
    if (type === 'QUESTIONS') return ru.QUESTIONS;
    if (type === 'REFLECTIONS') return ru.REFLECTIONS;
    return ru.INSIGHTS;
}

export function getExamples(type, language = 'auto') {
    if (language !== 'auto') {
        if (language === 'en') return getEnExamples(type) || [];
        if (language === 'ru') return getRuExamples(type) || [];
        return [];
    }
    // Auto: merge both languages
    return [...(getEnExamples(type) || []), ...(getRuExamples(type) || [])];
}
