import * as en from './en.js';
import * as ru from './ru.js';

/**
 * Get examples for a specific sub-type and language.
 * @param {'COMMUNITIES'|'GLOBAL_SYNTHESIS'} type - Example sub-type
 * @param {'auto'|'en'|'ru'} [language='auto'] - Language filter
 * @returns {Array} Filtered examples
 */
export function getExamples(type, language = 'auto') {
    if (language !== 'auto') {
        if (language === 'en') {
            return type === 'COMMUNITIES' ? en.COMMUNITIES : en.GLOBAL_SYNTHESIS;
        }
        if (language === 'ru') {
            return type === 'COMMUNITIES' ? ru.COMMUNITIES : ru.GLOBAL_SYNTHESIS;
        }
        return [];
    }
    // Auto: merge both languages
    const enExamples = type === 'COMMUNITIES' ? en.COMMUNITIES : en.GLOBAL_SYNTHESIS;
    const ruExamples = type === 'COMMUNITIES' ? ru.COMMUNITIES : ru.GLOBAL_SYNTHESIS;
    return [...(enExamples || []), ...(ruExamples || [])];
}
