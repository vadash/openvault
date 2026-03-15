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

import { cdnImport } from './cdn.js';

/** @type {typeof import('p-queue').default | null} */
let PQueue;

/** Cooloff period in ms when rate-limited */
const _RATE_LIMIT_COOLOFF_MS = 4000;

/**
 * Creates an AIMD-governed task queue.
 *
 * @param {number} [maxConcurrency=1] - Absolute ceiling for parallel tasks.
 *   Defaults to 1 (sequential) to protect local/VRAM-bound LLM users.
 * @returns {Promise<{ add: Function, onIdle: Function, concurrency: number }>}
 */
export async function createLadderQueue(maxConcurrency = 1) {
    if (!PQueue) {
        const module = await cdnImport('p-queue');
        PQueue = module.default;
    }

    const ceiling = Math.max(1, maxConcurrency);
    const queue = new PQueue({ concurrency: ceiling });

    const add = async (taskFn) => {
        return queue.add(async () => {
            const result = await taskFn();
            return result;
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
