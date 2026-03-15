import { EXAMPLES as EN } from './en.js';
import { EXAMPLES as RU } from './ru.js';

export function getExamples(language = 'auto') {
    if (language === 'en') return EN;
    if (language === 'ru') return RU;
    return [...EN, ...RU];
}
