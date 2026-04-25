/**
 * Embedding Batch Operations
 *
 * Batch processing for embeddings with progress tracking and error handling.
 */

import { extensionName, MEMORIES_KEY } from '../constants.js';
import { getDeps } from '../deps.js';
import { record } from '../perf/store.js';
import { getSessionSignal } from '../state.js';
import { getOpenVaultData, saveOpenVaultData } from '../store/chat-data.js';
import { showToast } from '../utils/dom.js';
import { hasEmbedding, setEmbedding } from '../utils/embedding-codec.js';
import { logDebug, logError, logInfo } from '../utils/logging.js';
import { getQueryEmbedding } from './cache.js';
import { getStrategy, isEmbeddingsEnabled } from './registry.js';

/**
 * Process items in batches with parallel execution within each batch
 * @param {Array} items - Items to process
 * @param {number} batchSize - Number of items per batch
 * @param {Function} fn - Async function to apply to each item
 * @returns {Promise<Array>} Results in order
 */
export async function processInBatches(items, batchSize, fn) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);
    }
    return results;
}

/**
 * Generate embeddings for multiple memories that don't have them yet
 * @param {Object[]} memories - Memories to embed
 * @param {Object} options - Options
 * @param {AbortSignal} options.signal - AbortSignal
 * @returns {Promise<number>} Number of memories successfully embedded
 */
export async function generateEmbeddingsForMemories(memories, { signal } = {}) {
    signal ??= getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!isEmbeddingsEnabled()) {
        return 0;
    }

    const validMemories = memories.filter((m) => m.summary && !hasEmbedding(m));

    if (validMemories.length === 0) {
        return 0;
    }

    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);

    const embeddings = await processInBatches(validMemories, 5, async (m) => {
        return strategy.getDocumentEmbedding(m.summary, {
            signal,
            prefix: settings.embeddingDocPrefix,
            url: settings.ollamaUrl,
            model: settings.embeddingModel,
        });
    });

    let count = 0;
    for (let i = 0; i < validMemories.length; i++) {
        if (embeddings[i]) {
            setEmbedding(validMemories[i], embeddings[i]);
            count++;
        }
    }

    return count;
}

/**
 * Enrich events with embeddings (mutates events in place)
 * @param {Object[]} events - Events to enrich with embeddings
 * @param {Object} options - Options
 * @param {AbortSignal} options.signal - AbortSignal
 * @returns {Promise<number>} Number of events successfully embedded
 */
export async function enrichEventsWithEmbeddings(events, { signal } = {}) {
    signal ??= getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!isEmbeddingsEnabled()) {
        return 0;
    }

    const validEvents = events.filter((e) => e.summary && !hasEmbedding(e));

    if (validEvents.length === 0) {
        return 0;
    }

    logDebug(`Generating embeddings for ${validEvents.length} events`);

    const t0 = performance.now();
    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);

    const embeddings = await processInBatches(validEvents, 5, async (e) => {
        if (settings?.debugMode) {
            logDebug(`Embedding doc: "${e.summary}"`);
        }
        return strategy.getDocumentEmbedding(e.summary, {
            signal,
            prefix: settings.embeddingDocPrefix,
            url: settings.ollamaUrl,
            model: settings.embeddingModel,
        });
    });

    let count = 0;
    for (let i = 0; i < validEvents.length; i++) {
        if (embeddings[i]) {
            setEmbedding(validEvents[i], embeddings[i]);
            count++;
        }
    }

    record('embedding_generation', performance.now() - t0, `${validEvents.length} embeddings via ${source}`);
    return count;
}

/**
 * Backfill ALL embedding types: memories, graph nodes, and communities.
 * Used by the UI button and auto-triggered after embedding model invalidation.
 * @param {Object} options - Options
 * @param {AbortSignal} options.signal - AbortSignal
 * @param {boolean} options.silent - If true, suppress toasts (for auto-trigger)
 * @returns {Promise<{memories: number, nodes: number, communities: number, total: number, skipped: boolean}>}
 */
export async function backfillAllEmbeddings({ signal, silent = false } = {}) {
    signal ??= getSessionSignal();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const { setStatus } = await import('../ui/status.js');

    if (!isEmbeddingsEnabled()) {
        if (!silent) showToast('warning', 'Configure embedding source first');
        return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: false };
    }

    const data = getOpenVaultData();
    if (!data) {
        if (!silent) showToast('warning', 'No chat data available');
        return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: false };
    }

    const settings = getDeps().getExtensionSettings()[extensionName];
    const source = settings.embeddingSource;
    const strategy = getStrategy(source);

    // ST Vector Storage branch: sync items instead of generating local embeddings
    if (strategy.usesExternalStorage()) {
        const { cyrb53, isStSynced, markStSynced } = await import('../utils/embedding-codec.js');
        const BATCH_SIZE = 100;

        const allItems = [];

        // Collect unsynced memories
        for (const m of data[MEMORIES_KEY] || []) {
            if (m.summary && !isStSynced(m)) {
                allItems.push({ item: m, text: `[OV_ID:${m.id}] ${m.summary}` });
            }
        }

        // Collect unsynced graph nodes
        for (const [name, node] of Object.entries(data.graph?.nodes || {})) {
            if (!isStSynced(node)) {
                allItems.push({ item: node, text: `[OV_ID:${name}] ${node.description}` });
            }
        }

        // Collect unsynced communities
        for (const [id, community] of Object.entries(data.communities || {})) {
            if (community.summary && !isStSynced(community)) {
                allItems.push({ item: community, text: `[OV_ID:${id}] ${community.summary}` });
            }
        }

        if (allItems.length === 0) {
            return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: true };
        }

        if (!silent) showToast('info', `Syncing ${allItems.length} items to ST Vector Storage...`);

        let synced = 0;
        for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
            const batch = allItems.slice(i, i + BATCH_SIZE);
            const stItems = batch.map(({ text }) => ({
                hash: cyrb53(text),
                text,
                index: 0,
            }));
            const success = await strategy.insertItems(stItems);
            if (success) {
                for (const { item } of batch) {
                    markStSynced(item);
                    synced++;
                }
            }
        }

        if (synced > 0) {
            // Stamp ST fingerprint so mismatch detection works on next load
            const { stampStVectorFingerprint } = await import('./migration.js');
            stampStVectorFingerprint(data);

            await saveOpenVaultData();
        }

        return { memories: synced, nodes: 0, communities: 0, total: synced, skipped: false };
    }

    // Count what needs embedding
    const memories = (data[MEMORIES_KEY] || []).filter((m) => m.summary && !hasEmbedding(m));
    const nodes = Object.values(data.graph?.nodes || {}).filter((n) => !hasEmbedding(n));
    const communities = Object.values(data.communities || {}).filter((c) => c.summary && !hasEmbedding(c));
    const totalNeeded = memories.length + nodes.length + communities.length;

    if (totalNeeded === 0) {
        return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: true };
    }

    if (!silent) showToast('info', `Generating ${totalNeeded} embeddings...`);
    setStatus('extracting');

    try {
        // 1. Memory embeddings
        const memoryCount = await generateEmbeddingsForMemories(memories, { signal });

        // 2. Graph node embeddings
        let nodeCount = 0;
        if (nodes.length > 0) {
            const nodeEmbeddings = await processInBatches(nodes, 5, async (n) => {
                return strategy.getDocumentEmbedding(`${n.type}: ${n.name} - ${n.description}`, {
                    signal,
                    prefix: settings.embeddingDocPrefix,
                    url: settings.ollamaUrl,
                    model: settings.embeddingModel,
                });
            });
            for (let i = 0; i < nodes.length; i++) {
                if (nodeEmbeddings[i]) {
                    setEmbedding(nodes[i], nodeEmbeddings[i]);
                    nodeCount++;
                }
            }
        }

        // 3. Community embeddings
        let communityCount = 0;
        if (communities.length > 0) {
            const communityEmbeddings = await processInBatches(communities, 5, async (c) => {
                return getQueryEmbedding(c.summary, { signal });
            });
            for (let i = 0; i < communities.length; i++) {
                if (communityEmbeddings[i]) {
                    setEmbedding(communities[i], communityEmbeddings[i]);
                    communityCount++;
                }
            }
        }

        const total = memoryCount + nodeCount + communityCount;
        if (total > 0) {
            await saveOpenVaultData();
            logInfo(`Backfill complete: ${memoryCount} memories, ${nodeCount} nodes, ${communityCount} communities`);
        }

        return { memories: memoryCount, nodes: nodeCount, communities: communityCount, total, skipped: false };
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        logError('Backfill embeddings error', error);
        if (!silent) showToast('error', `Embedding generation failed: ${error.message}`);
        return { memories: 0, nodes: 0, communities: 0, total: 0, skipped: false };
    } finally {
        setStatus('ready');
    }
}
