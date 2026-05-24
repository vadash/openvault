import * as en from './en.js';
import * as ru from './ru.js';

/**
 * Get examples for the scene state prompt.
 * @param {'auto'|'en'|'ru'} [language='auto'] - Language filter
 * @returns {Array} Filtered examples
 */
export function getSceneStateExamples(language = 'auto') {
    if (language !== 'auto') {
        if (language === 'en') {
            return en.SCENE_STATE;
        }
        if (language === 'ru') {
            return ru.SCENE_STATE;
        }
        return [];
    }
    // Auto: merge both languages
    return [...(en.SCENE_STATE || []), ...(ru.SCENE_STATE || [])];
}
