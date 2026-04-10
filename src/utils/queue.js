/**
 * AIMD Ladder Queue
 *
 * Wraps p-queue with Additive Increase / Multiplicative Decrease concurrency control.
 * On success: slowly climbs concurrency back toward the user-set ceiling.
 * On 429/timeout: halves concurrency and pauses the queue for a cooloff period.
 *
 * Used by Phase 2 enrichment loops (communities, reflections, edge consolidation).
 * Phase 1 (event → graph extraction) is always sequential — do NOT use this there.
 */

// @ts-check

import { cdnImport } from './cdn.js';

/** @typedef {{ add: (fn: () => Promise<unknown>) => Promise<unknown>, onIdle: () => Promise<void>, concurrency: number }} LadderQueue */

/** @type {typeof import('p-queue').default | null} */
let PQueue;

/** Cooloff period in ms when rate-limited */
const _RATE_LIMIT_COOLOFF_MS = 4000;

/**
 * Detect rate-limit or timeout errors.
 * @param {Error & {status?: number}} error
 * @returns {boolean}
 */
function isRateLimitError(error) {
    return (
        error.status === 429 ||
        error.status === 502 ||
        error.message?.includes('429') ||
        error.message?.includes('502') ||
        error.message?.includes('Bad Gateway') ||
        error.message?.includes('timeout')
    );
}

/**
 * Creates an AIMD-governed task queue.
 *
 * @param {number} [maxConcurrency=1] - Absolute ceiling for parallel tasks.
 *   Defaults to 1 (sequential) to protect local/VRAM-bound LLM users.
 * @returns {Promise<LadderQueue>}
 */
export async function createLadderQueue(maxConcurrency = 1) {
    if (!PQueue) {
        const module = await cdnImport('p-queue');
        PQueue = module.default;
    }

    const ceiling = Math.max(1, maxConcurrency);
    const queue = new PQueue({ concurrency: ceiling });
    let currentLimit = ceiling;

    const add = async (taskFn) => {
        return queue.add(async () => {
            try {
                const result = await taskFn();

                // Additive Increase: slowly climb back up on success
                if (currentLimit < ceiling) {
                    currentLimit = Math.min(ceiling, currentLimit + 0.5);
                    queue.concurrency = Math.floor(currentLimit);
                }

                return result;
            } catch (error) {
                if (isRateLimitError(error)) {
                    // Multiplicative Decrease: drop the ladder
                    currentLimit = Math.max(1, Math.floor(currentLimit / 2));
                    queue.concurrency = Math.floor(currentLimit);
                    console.warn(`[LadderQueue] Rate limit hit. Dropping concurrency to ${queue.concurrency}`);

                    // Pause queue to let the API breathe
                    if (!queue.isPaused) {
                        queue.pause();
                        setTimeout(() => {
                            console.debug('[LadderQueue] Resuming ladder queue after cooloff');
                            queue.start();
                        }, _RATE_LIMIT_COOLOFF_MS);
                    }
                }

                throw error;
            }
        });
    };

    return {
        add,
        onIdle: () => queue.onIdle(),
        get concurrency() {
            return queue.concurrency;
        },
    };
}
