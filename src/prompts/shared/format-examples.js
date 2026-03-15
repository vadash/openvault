/**
 * Formats an array of few-shot examples into numbered XML blocks for prompt injection.
 * When language is 'en' or 'ru', only examples whose label contains that language tag are included.
 *
 * @param {Array<{input: string, thinking?: string, output: string, label?: string}>} examples
 * @param {'auto'|'en'|'ru'} [language='auto'] - Filter examples by language tag
 * @returns {string} Formatted XML string
 */
export function formatExamples(examples, language = 'auto') {
    const filtered =
        language !== 'auto' ? examples.filter((ex) => ex.label?.includes(`(${language.toUpperCase()}/`)) : examples;
    return filtered
        .map((ex, i) => {
            const parts = [`<example_${i + 1}>`];
            parts.push(`<input>\n${ex.input}\n</input>`);
            if (ex.thinking) {
                parts.push(`<ideal_output>\n<think>\n${ex.thinking}\n</think>\n${ex.output}\n</ideal_output>`);
            } else {
                parts.push(`<ideal_output>\n${ex.output}\n</ideal_output>`);
            }
            parts.push(`</example_${i + 1}>`);
            return parts.join('\n');
        })
        .join('\n\n');
}
