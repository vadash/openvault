/**
 * OpenVault Background Worker
 *
 * Processes extraction batches in the background without blocking the chat UI.
 * Single-instance: only one worker loop runs at a time.
 * Uses a wakeGeneration counter to reset backoff when new messages arrive.
 */

import { extensionName } from '../constants.js';
import { getDeps } from '../deps.js';
import { getSessionSignal, operationState } from '../state.js';
import { setStatus } from '../ui/status.js';
import { getCurrentChatId, getOpenVaultData } from '../utils/data.js';
import { log } from '../utils/logging.js';
import { isExtensionEnabled } from '../utils/st-helpers.js';
import { extractMemories } from './extract.js';
import { getNextBatch } from './scheduler.js';

let isRunning = false;
let wakeGeneration = 0;

const BACKOFF_SCHEDULE_SECONDS = [1, 2, 3, 10, 20, 30, 30, 60, 60];
const MAX_BACKOFF_TOTAL_MS = 15 * 60 * 1000;

/**
 * Wake up the background worker. Fire-and-forget.
 * Safe to call multiple times — only one instance runs.
 * If worker is already running, increments wake generation
 * so it resets backoff and re-checks for work.
 */
export function wakeUpBackgroundWorker() {
    wakeGeneration++;
    if (isRunning) return;
    isRunning = true;
    runWorkerLoop().finally(() => {
        isRunning = false;
    });
}

/**
 * Check if the background worker is currently processing.
 */
export function isWorkerRunning() {
    return isRunning;
}

/**
 * Get current wake generation (for testing).
 */
export function getWakeGeneration() {
    return wakeGeneration;
}

/**
 * Increment wake generation (for testing).
 */
export function incrementWakeGeneration() {
    wakeGeneration++;
}

/**
 * Interruptible sleep that checks wakeGeneration every 500ms.
 * Resolves early if a new message arrives (generation changes).
 * @param {number} totalMs - Total sleep duration
 * @param {number} generationAtStart - The wakeGeneration value when sleep started
 */
export async function interruptibleSleep(totalMs, generationAtStart) {
    const chunkMs = 500;
    let elapsed = 0;
    while (elapsed < totalMs) {
        await new Promise((r) => setTimeout(r, Math.min(chunkMs, totalMs - elapsed)));
        elapsed += chunkMs;
        if (wakeGeneration !== generationAtStart) return;
    }
}

/**
 * Main worker loop. Processes extraction batches in the background.
 */
async function runWorkerLoop() {
    const targetChatId = getCurrentChatId();
    let retryCount = 0;
    let cumulativeBackoffMs = 0;
    let lastSeenGeneration = wakeGeneration;

    try {
        while (true) {
            // Guard: Chat switched or session aborted?
            if (getSessionSignal().aborted || getCurrentChatId() !== targetChatId) {
                log('Worker: Session aborted or chat switched, stopping.');
                break;
            }

            // Guard: Extension disabled?
            if (!isExtensionEnabled()) {
                log('Worker: Extension disabled, stopping.');
                break;
            }

            // Guard: Manual backfill took over?
            if (operationState.extractionInProgress) {
                log('Worker: Manual backfill took over, yielding.');
                break;
            }

            // Check for new wake signal (reset backoff)
            if (wakeGeneration !== lastSeenGeneration) {
                retryCount = 0;
                cumulativeBackoffMs = 0;
                lastSeenGeneration = wakeGeneration;
            }

            // Get fresh state each iteration
            const deps = getDeps();
            const context = deps.getContext();
            const chat = context.chat || [];
            const data = getOpenVaultData();
            const settings = deps.getExtensionSettings()[extensionName];

            if (!data || !settings?.enabled) break;

            const tokenBudget = settings.extractionTokenBudget;

            // Get next batch
            const batch = getNextBatch(chat, data, tokenBudget);
            if (!batch) break; // No complete batches, go to sleep

            // Process
            setStatus('extracting');
            log(`Worker: Processing batch [${batch[0]}..${batch[batch.length - 1]}]`);

            try {
                await extractMemories(batch, targetChatId, { silent: true });
                retryCount = 0;
                cumulativeBackoffMs = 0;
            } catch (err) {
                // Fast-fail on abort or chat switch — don't retry, just stop
                if (err.name === 'AbortError' || err.message === 'Chat changed during extraction') {
                    log('Worker: Aborted or chat changed during extraction. Halting immediately.');
                    break;
                }

                retryCount++;
                const scheduleIndex = Math.min(retryCount - 1, BACKOFF_SCHEDULE_SECONDS.length - 1);
                const backoffMs = BACKOFF_SCHEDULE_SECONDS[scheduleIndex] * 1000;
                cumulativeBackoffMs += backoffMs;

                if (cumulativeBackoffMs >= MAX_BACKOFF_TOTAL_MS) {
                    log(`Worker: Backoff limit exceeded (${Math.round(cumulativeBackoffMs / 1000)}s), stopping.`);
                    break;
                }

                log(
                    `Worker: Batch failed (attempt ${retryCount}), retrying in ${BACKOFF_SCHEDULE_SECONDS[scheduleIndex]}s`
                );
                await interruptibleSleep(backoffMs, lastSeenGeneration);
                continue; // Retry same batch
            }

            // Yield to browser between batches
            await new Promise((r) => setTimeout(r, 2000));
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            log('Worker: Aborted (chat switch). Clean exit.');
        } else {
            getDeps().console.error('[OpenVault] Background worker error:', err);
        }
    } finally {
        setStatus('ready');
    }
}
