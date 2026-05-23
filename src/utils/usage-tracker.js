/**
 * Creates a session-scoped usage tracker for accumulating LLM call statistics.
 * @returns {UsageTracker} A tracker instance with record() and getSummary() methods.
 */
export function createUsageTracker() {
    /** @type {Set<string>} */
    const models = new Set();

    /** @type {number} */
    let calls = 0;
    /** @type {number} */
    let promptTokens = 0;
    /** @type {number} */
    let completionTokens = 0;
    /** @type {number} */
    let cacheReadTokens = 0;
    /** @type {number} */
    let cacheWriteTokens = 0;
    /** @type {boolean} */
    let hasCacheData = false;

    /**
     * Formats a token count for display.
     * @param {number|undefined} n
     * @returns {string}
     */
    const formatTokens = (n) => {
        if (n === undefined || n === null) return 'N/A';
        if (n < 1000) return String(n);
        if (n < 10000) return `${(n / 1000).toFixed(1)}K`;
        return `${Math.floor(n / 1000)}K`;
    };

    return {
        /**
         * Records usage from a single LLM call.
         * @param {object} usage
         * @param {string} [usage.model]
         * @param {number} [usage.promptTokens]
         * @param {number} [usage.completionTokens]
         * @param {number} [usage.cacheReadTokens]
         * @param {number} [usage.cacheWriteTokens]
         */
        record(usage) {
            calls++;
            models.add(usage.model || 'unknown');
            promptTokens += usage.promptTokens ?? 0;
            completionTokens += usage.completionTokens ?? 0;
            cacheReadTokens += usage.cacheReadTokens ?? 0;
            cacheWriteTokens += usage.cacheWriteTokens ?? 0;
            if (usage.cacheReadTokens !== undefined || usage.cacheWriteTokens !== undefined) {
                hasCacheData = true;
            }
        },

        /**
         * Returns a formatted summary string of tracked usage.
         * @returns {string}
         */
        getSummary() {
            if (calls === 0) {
                return 'No LLM calls tracked';
            }

            const totalTokens = promptTokens + completionTokens;
            const modelsStr = Array.from(models).sort().join(', ');

            let summary = `${calls} call${calls === 1 ? '' : 's'}, ${formatTokens(totalTokens)} tokens`;
            summary += `\nmodels: ${modelsStr}`;

            if (hasCacheData) {
                summary += `\ncache: ${formatTokens(cacheReadTokens)} read / ${formatTokens(cacheWriteTokens)} write`;
            } else {
                summary += `\ncache: N/A`;
            }

            return summary;
        },
    };
}

/**
 * @typedef {object} UsageTracker
 * @property {(usage: {
 *   model?: string,
 *   promptTokens?: number,
 *   completionTokens?: number,
 *   cacheReadTokens?: number,
 *   cacheWriteTokens?: number
 * }) => void} record
 * @property {() => string} getSummary
 */
