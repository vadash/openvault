/**
 * Formats an array of few-shot examples into numbered XML blocks for prompt injection.
 *
 * @param {Array<{input: string, thinking?: string, output: string}>} examples
 * @returns {string} Formatted XML string
 */
export function formatExamples(examples) {
    return examples
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
