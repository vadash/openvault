// @ts-check

import {
    CHARACTERS_KEY,
    CONSOLIDATION,
    EMBEDDING_SOURCES,
    GRAPH_JACCARD_DUPLICATE_THRESHOLD,
    MEMORIES_KEY,
    METADATA_KEY,
    PROCESSED_MESSAGES_KEY,
} from '../constants.js';
import { getDeps } from '../deps.js';
import { createEmptyGraph, normalizeKey } from '../graph/graph.js';
import { record } from '../perf/store.js';
import { purgeSTCollection } from '../services/st-vector.js';
import { showToast } from '../utils/dom.js';
import { cyrb53, deleteEmbedding } from '../utils/embedding-codec.js';
import { logDebug, logError, logInfo, logWarn } from '../utils/logging.js';
import { mergeDescriptions } from '../utils/text.js';
import { countTokens } from '../utils/tokens.js';

/** @typedef {import('../types.d.ts').OpenVaultData} OpenVaultData */
/** @typedef {import('../types.d.ts').Memory} Memory */
/** @typedef {import('../types.d.ts').MemoryUpdate} MemoryUpdate */

/**
 * Get OpenVault data from chat metadata.
 * @returns {OpenVaultData | null} Returns null if context is not available
 */
export function getOpenVaultData() {
    const context = getDeps().getContext();
    if (!context) {
        logWarn('getContext() returned null/undefined');
        return null;
    }
    if (!context.chatMetadata) {
        context.chatMetadata = {};
    }
    if (!context.chatMetadata[METADATA_KEY]) {
        context.chatMetadata[METADATA_KEY] = {
            schema_version: 3,
            [MEMORIES_KEY]: [],
            [CHARACTERS_KEY]: {},
            [PROCESSED_MESSAGES_KEY]: [],
            reflection_state: {},
            graph: createEmptyGraph(),
            communities: {},
            graph_message_count: 0,
        };
    }
    const data = context.chatMetadata[METADATA_KEY];

    return data;
}

/**
 * Get current chat ID for tracking across async operations.
 * @returns {string | null} Chat ID or null if unavailable
 */
export function getCurrentChatId() {
    const context = getDeps().getContext();
    return context?.chatId || context?.chat_metadata?.chat_id || null;
}

/**
 * Save OpenVault data to chat metadata.
 * @param {string} [expectedChatId] - If provided, verify chat hasn't changed before saving
 * @returns {Promise<boolean>} True if save succeeded, false otherwise
 */
export async function saveOpenVaultData(expectedChatId = null) {
    const t0 = performance.now();
    if (expectedChatId !== null) {
        const currentId = getCurrentChatId();
        if (currentId !== expectedChatId) {
            logWarn(
                `Chat changed during operation (expected: ${expectedChatId}, current: ${currentId}), aborting save`
            );
            return false;
        }
    }

    try {
        await getDeps().saveChatConditional();
        record('chat_save', performance.now() - t0);
        logDebug('Data saved to chat metadata');
        return true;
    } catch (error) {
        record('chat_save', performance.now() - t0);
        logError('Failed to save data', error);
        showToast('error', `Failed to save data: ${error.message}`);
        return false;
    }
}

/**
 * Generate a unique ID.
 * @returns {string} Unique ID string
 */
export function generateId() {
    return `${getDeps().Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Update a memory by ID.
 * @param {string} id - Memory ID to update
 * @param {MemoryUpdate} updates - Fields to update
 * @returns {Promise<{success: boolean, stChanges?: {toSync?: {hash: number, text: string, item: Memory}[]}}>} Result with success flag and optional ST Vector changes
 */
export async function updateMemory(id, updates) {
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat loaded');
        return { success: false };
    }

    const memory = data[MEMORIES_KEY]?.find((/** @type {Memory} */ m) => m.id === id);
    if (!memory) {
        logDebug(`Memory ${id} not found`);
        return { success: false };
    }

    // Track if summary changed (requires re-embedding)
    const summaryChanged = updates.summary !== undefined && updates.summary !== memory.summary;

    // Apply allowed updates
    const allowedFields = ['summary', 'importance', 'tags', 'is_secret', 'temporal_anchor', 'is_transient'];
    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            memory[field] = updates[field];
        }
    }

    const stChanges = {};

    // If summary changed, invalidate embedding and queue for re-sync
    if (summaryChanged) {
        deleteEmbedding(memory);
        const text = memory.summary || '';
        stChanges.toSync = [{ hash: cyrb53(text), text, item: memory }];
    }

    await getDeps().saveChatConditional();
    logDebug(`Updated memory ${id}${summaryChanged ? ' (embedding invalidated)' : ''}`);
    return {
        success: true,
        stChanges: Object.keys(stChanges).length > 0 ? stChanges : undefined,
    };
}

/**
 * Delete a memory by ID.
 * @param {string} id - Memory ID to delete
 * @returns {Promise<{success: boolean, stChanges?: {toDelete: {hash: number}[]}}>} Result with success flag and optional ST Vector changes
 */
export async function deleteMemory(id) {
    const data = getOpenVaultData();
    if (!data) {
        showToast('warning', 'No chat loaded');
        return { success: false };
    }

    const idx = data[MEMORIES_KEY]?.findIndex((/** @type {Memory} */ m) => m.id === id);
    if (idx === -1) {
        logDebug(`Memory ${id} not found`);
        return { success: false };
    }

    const memory = data[MEMORIES_KEY][idx];
    const stChanges = {};

    // Queue for ST Vector deletion if previously synced
    if (memory._st_synced) {
        const text = memory.summary || '';
        stChanges.toDelete = [{ hash: cyrb53(text) }];
    }

    data[MEMORIES_KEY].splice(idx, 1);
    await getDeps().saveChatConditional();
    logDebug(`Deleted memory ${id}`);
    return {
        success: true,
        stChanges: Object.keys(stChanges).length > 0 ? stChanges : undefined,
    };
}

/**
 * Update an entity's fields. Handles rename by rewriting edges and merge redirects.
 * @param {string} key - Current normalized entity key
 * @param {Object} updates - { name?, type?, description?, aliases? }
 * @returns {Promise<{key: string, stChanges?: {toDelete?: {hash: number}[], toSync?: {hash: number, text: string, item: any}[]}}|null>} Result with new key and optional ST Vector changes, null on failure
 */
export async function updateEntity(key, updates) {
    const { saveChatConditional } = getDeps();
    const graph = getOpenVaultData().graph;
    const node = graph.nodes[key];

    if (!node) {
        logWarn(`Cannot update entity: ${key} not found`);
        return null;
    }

    // Determine if renaming
    const newName = updates.name ?? node.name;
    const newKey = normalizeKey(newName);

    // If renaming, check for collision
    if (newKey !== key) {
        if (graph.nodes[newKey]) {
            logWarn(`Cannot rename to '${newName}': entity already exists`);
            return null;
        }
    }

    if (newKey !== key) {
        // Track old hash for ST Vector deletion if synced
        const toDelete = [];
        if (node._st_synced) {
            // Calculate hash using same format as insertion in graph.js:486:
            // [OV_ID:key] description (no fallback to name)
            const text = `[OV_ID:${key}] ${node.description}`;
            toDelete.push({ hash: cyrb53(text) });
        }

        // Create new node with updated fields
        graph.nodes[newKey] = {
            ...node,
            name: newName,
            type: updates.type ?? node.type,
            description: updates.description ?? node.description,
            aliases: updates.aliases ?? node.aliases ?? [],
        };

        // Delete old node
        delete graph.nodes[key];

        // Rewrite edges
        for (const [edgeKey, edge] of Object.entries(graph.edges)) {
            let needsRewrite = false;
            let newSource = edge.source;
            let newTarget = edge.target;

            if (edge.source === key) {
                newSource = newKey;
                needsRewrite = true;
            }
            if (edge.target === key) {
                newTarget = newKey;
                needsRewrite = true;
            }

            if (needsRewrite) {
                const newEdgeKey = `${newSource}__${newTarget}`;

                // Queue old edge for ST Vector deletion if synced
                if (edge._st_synced) {
                    toDelete.push({ hash: cyrb53(`[OV_ID:edge_${edge.source}_${edge.target}] ${edge.description}`) });
                }

                delete graph.edges[edgeKey];
                const newEdge = {
                    ...edge,
                    source: newSource,
                    target: newTarget,
                };
                deleteEmbedding(newEdge);
                graph.edges[newEdgeKey] = newEdge;
            }
        }

        // Guard _mergeRedirects (matches pattern in graph.js:272)
        if (!graph._mergeRedirects) graph._mergeRedirects = {};
        graph._mergeRedirects[key] = newKey;

        // Fix any existing redirects that still point to oldKey.
        // _resolveKey() is non-recursive, so chained redirects
        // (A → oldKey → newKey) would resolve A to a deleted node.
        for (const [rk, rv] of Object.entries(graph._mergeRedirects)) {
            if (rv === key && rk !== key) {
                graph._mergeRedirects[rk] = newKey;
            }
        }

        // Invalidate embedding on new node
        deleteEmbedding(graph.nodes[newKey]);

        await saveChatConditional();
        return {
            key: newKey,
            stChanges: toDelete.length > 0 ? { toDelete } : undefined,
        };
    } else {
        // Simple field update, no rename
        Object.assign(node, {
            type: updates.type ?? node.type,
            description: updates.description ?? node.description,
            aliases: updates.aliases ?? node.aliases ?? [],
        });

        // Invalidate embedding on description change
        if (updates.description !== undefined) {
            deleteEmbedding(node);
        }

        await saveChatConditional();

        // Return stChanges for ST Vector sync if description changed
        const toSync = [];
        if (updates.description !== undefined) {
            const text = `[OV_ID:${key}] ${node.description}`;
            toSync.push({ hash: cyrb53(text), text, item: node });
        }

        return { key, stChanges: toSync.length > 0 ? { toSync } : undefined };
    }
}

/**
 * Delete an entity and all its edges and merge redirects.
 * Also deletes from ST Vector storage if _st_synced to prevent orphan embeddings.
 * @param {string} key - Normalized entity key
 * @returns {Promise<{success: boolean, stChanges?: {toDelete: {hash: number}[]}}>}
 */
export async function deleteEntity(key) {
    const { saveChatConditional } = getDeps();
    const graph = getOpenVaultData().graph;

    const node = graph.nodes[key];
    if (!node) {
        logWarn(`Cannot delete entity: ${key} not found`);
        return { success: false };
    }

    // Track ST Vector items to delete (prevent orphan embeddings)
    const toDelete = [];
    if (node._st_synced) {
        // Calculate hash using same format as insertion in graph.js:486:
        // [OV_ID:key] description (no fallback to name)
        const text = `[OV_ID:${key}] ${node.description}`;
        toDelete.push({ hash: cyrb53(text) });
    }

    // Delete the node
    delete graph.nodes[key];

    // Remove all edges connected to this entity
    for (const [edgeKey, edge] of Object.entries(graph.edges)) {
        if (edge.source === key || edge.target === key) {
            delete graph.edges[edgeKey];
        }
    }

    // Guard _mergeRedirects before iterating (matches graph.js:272)
    if (graph._mergeRedirects) {
        for (const [redirectKey, redirectValue] of Object.entries(graph._mergeRedirects)) {
            if (redirectKey === key || redirectValue === key) {
                delete graph._mergeRedirects[redirectKey];
            }
        }
    }

    await saveChatConditional();

    return {
        success: true,
        stChanges: toDelete.length > 0 ? { toDelete } : undefined,
    };
}

/**
 * Delete all OpenVault data for the current chat.
 * @returns {Promise<boolean>} True if deleted, false otherwise
 */
export async function deleteCurrentChatData() {
    const context = getDeps().getContext();

    if (!context.chatMetadata) {
        logDebug('No chat metadata found');
        return false;
    }

    // Unhide all messages that were hidden by auto-hide
    // is_system flags persist even when memories are cleared, which would
    // leave those messages permanently unextractable
    const chat = context.chat || [];
    let unhiddenCount = 0;
    for (const msg of chat) {
        if (msg.openvault_hidden && msg.is_system) {
            msg.is_system = false;
            delete msg.openvault_hidden;
            unhiddenCount++;
        }
    }
    if (unhiddenCount > 0) {
        logDebug(`Unhid ${unhiddenCount} messages after memory clear`);
    }

    // Purge ST Vector Storage if using st_vector
    const settings = getDeps().getExtensionSettings()?.openvault;
    if (settings?.embeddingSource === EMBEDDING_SOURCES.ST_VECTOR) {
        const chatId = getCurrentChatId();
        if (chatId) {
            try {
                const purged = await purgeSTCollection(chatId);
                if (!purged) {
                    logWarn('Failed to purge ST collection during chat data deletion', new Error('Purge failed'));
                } else {
                    logInfo(`Purged ST Vector collection for cleared chat: ${chatId}`);
                }
            } catch (err) {
                logWarn('Failed to purge ST collection during chat data deletion', err);
                // Don't fail the whole operation - OpenVault data is already cleared
            }
        }
    }

    delete context.chatMetadata[METADATA_KEY];
    await getDeps().saveChatConditional();
    logDebug('Deleted all chat data');
    return true;
}

/**
 * Append new memories to the store.
 * @param {Memory[]} newMemories - Memory objects to add
 * @returns {void}
 */
export function addMemories(newMemories) {
    const data = getOpenVaultData();
    if (!data || newMemories.length === 0) return;
    data[MEMORIES_KEY] = data[MEMORIES_KEY] || [];
    data[MEMORIES_KEY].push(...newMemories);
}

/**
 * Record message fingerprints as processed.
 * @param {string[]} fingerprints - Message fingerprints to mark
 * @returns {void}
 */
export function markMessagesProcessed(fingerprints) {
    const data = getOpenVaultData();
    if (!data || fingerprints.length === 0) return;
    data[PROCESSED_MESSAGES_KEY] = data[PROCESSED_MESSAGES_KEY] || [];
    data[PROCESSED_MESSAGES_KEY].push(...fingerprints);
}

/**
 * Increment the graph message count.
 * @param {number} count - Number of messages to add
 * @returns {void}
 */
export function incrementGraphMessageCount(count) {
    const data = getOpenVaultData();
    if (!data) return;
    data.graph_message_count = (data.graph_message_count || 0) + count;
}

/**
 * Merge source entity into target entity. Source is deleted.
 * @param {string} sourceKey - Entity to absorb (will be deleted)
 * @param {string} targetKey - Entity that survives
 * @param {Object} graph - The graph object (defaults to current graph from deps)
 * @returns {Promise<{ success: boolean, stChanges?: { toDelete: { hash: number }[], toSync?: { hash: number, text: string, item: any }[] } }>}
 */
export async function mergeEntities(sourceKey, targetKey, graph = null) {
    const { saveChatConditional } = getDeps();
    const ctx = getDeps().getContext();
    const g = graph || ctx.chatMetadata?.openvault?.graph;

    if (!g) {
        return { success: false };
    }

    // Validation
    if (sourceKey === targetKey) {
        return { success: false };
    }

    const sourceNode = g.nodes[sourceKey];
    const targetNode = g.nodes[targetKey];

    if (!sourceNode || !targetNode) {
        return { success: false };
    }

    const toDelete = [];
    const toSync = [];

    // 1. Combine node data onto target
    targetNode.mentions += sourceNode.mentions;

    // Merge aliases (source name becomes an alias)
    const allAliases = [...(targetNode.aliases || []), ...(sourceNode.aliases || []), sourceNode.name];
    targetNode.aliases = [...new Set(allAliases)];

    // Merge descriptions using segmented Jaccard dedup
    targetNode.description = mergeDescriptions(
        targetNode.description,
        sourceNode.description,
        GRAPH_JACCARD_DUPLICATE_THRESHOLD
    );

    // 2. Set merge redirect and cascade
    if (!g._mergeRedirects) {
        g._mergeRedirects = {};
    }
    g._mergeRedirects[sourceKey] = targetKey;

    // Cascade: update any redirects pointing to source
    for (const [key, value] of Object.entries(g._mergeRedirects)) {
        if (value === sourceKey && key !== sourceKey) {
            g._mergeRedirects[key] = targetKey;
        }
    }

    // 3. Rewrite and combine edges
    const edgesToProcess = Object.entries(g.edges).filter(
        ([_, edge]) => edge.source === sourceKey || edge.target === sourceKey
    );

    for (const [oldKey, edge] of edgesToProcess) {
        const newSource = edge.source === sourceKey ? targetKey : edge.source;
        const newTarget = edge.target === sourceKey ? targetKey : edge.target;
        const newKey = `${newSource}__${newTarget}`;

        // Self-loop check: delete if would be target->target
        if (newSource === newTarget) {
            if (edge._st_synced) {
                toDelete.push({ hash: cyrb53(`[OV_ID:edge_${edge.source}_${edge.target}] ${edge.description}`) });
            }
            delete g.edges[oldKey];
            continue;
        }

        // Collision check: target edge already exists
        if (g.edges[newKey] && newKey !== oldKey) {
            const existingEdge = g.edges[newKey];
            existingEdge.weight += edge.weight;

            // Merge descriptions
            existingEdge.description = mergeDescriptions(
                existingEdge.description,
                edge.description,
                GRAPH_JACCARD_DUPLICATE_THRESHOLD
            );

            // Recalculate tokens using proper token counter
            if (existingEdge._descriptionTokens !== undefined) {
                existingEdge._descriptionTokens = countTokens(existingEdge.description);
            }

            // Check consolidation threshold
            if (existingEdge._descriptionTokens > CONSOLIDATION.TOKEN_THRESHOLD) {
                if (!g._edgesNeedingConsolidation) {
                    g._edgesNeedingConsolidation = [];
                }
                if (!g._edgesNeedingConsolidation.includes(newKey)) {
                    g._edgesNeedingConsolidation.push(newKey);
                }
            }

            // Invalidate embedding since description changed
            deleteEmbedding(existingEdge);

            // Collect hash for old edge deletion
            if (edge._st_synced) {
                toDelete.push({ hash: cyrb53(`[OV_ID:edge_${edge.source}_${edge.target}] ${edge.description}`) });
            }

            // Queue merged edge for re-sync
            const mergedEdgeId = `edge_${newSource}_${newTarget}`;
            const mergedEdgeText = `[OV_ID:${mergedEdgeId}] ${existingEdge.description}`;
            toSync.push({ hash: cyrb53(mergedEdgeText), text: mergedEdgeText, item: existingEdge });

            delete g.edges[oldKey];
        } else if (newKey !== oldKey) {
            // No collision: rewrite edge
            if (edge._st_synced) {
                toDelete.push({ hash: cyrb53(`[OV_ID:edge_${edge.source}_${edge.target}] ${edge.description}`) });
            }
            edge.source = newSource;
            edge.target = newTarget;
            deleteEmbedding(edge);
            g.edges[newKey] = edge;
            delete g.edges[oldKey];

            // Queue rewritten edge for re-sync
            const rewrittenEdgeId = `edge_${newSource}_${newTarget}`;
            const rewrittenEdgeText = `[OV_ID:${rewrittenEdgeId}] ${edge.description}`;
            toSync.push({ hash: cyrb53(rewrittenEdgeText), text: rewrittenEdgeText, item: edge });
        }
    }

    // 4. Cleanup
    // Collect hash for source node deletion
    if (sourceNode._st_synced) {
        toDelete.push({ hash: cyrb53(`[OV_ID:${sourceKey}] ${sourceNode.description}`) });
    }

    delete g.nodes[sourceKey];

    // Invalidate target embedding since description changed
    deleteEmbedding(targetNode);

    // If source or target was synced, queue target for sync
    // (absorbing a synced entity or updating an already-synced one)
    if (sourceNode._st_synced || targetNode._st_synced) {
        const text = `[OV_ID:${targetKey}] ${targetNode.description}`;
        toSync.push({ hash: cyrb53(text), text, item: targetNode });
    }

    // 5. Save
    await saveChatConditional();

    return {
        success: true,
        stChanges: { toDelete, toSync },
    };
}
