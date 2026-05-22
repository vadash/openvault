import * as en from './en.js';
import * as ru from './ru.js';

/**
 * Get examples for the world state prompt.
 * @param {'auto'|'en'|'ru'} [language='auto'] - Language filter
 * @returns {Array} Filtered examples
 */
export function getWorldStateExamples(language = 'auto') {
    if (language !== 'auto') {
        if (language === 'en') {
            return en.WORLD_STATE;
        }
        if (language === 'ru') {
            return ru.WORLD_STATE;
        }
        return [];
    }
    // Auto: merge both languages
    return [...(en.WORLD_STATE || []), ...(ru.WORLD_STATE || [])];
}
