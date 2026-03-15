/**
 * OpenVault Debug Export
 *
 * Assembles and exports full system state + last retrieval debug data to clipboard.
 */

import { CHARACTERS_KEY, defaultSettings, extensionName, MEMORIES_KEY, PERF_METRICS } from '../constants.js';
import { getDeps } from '../deps.js';
import { isEmbeddingsEnabled } from '../embeddings.js';
import { getAll as getPerfMetrics } from '../perf/store.js';
import { getCachedScoringDetails, getLastRetrievalDebug } from '../retrieval/debug-cache.js';
import { getOpenVaultData } from '../utils/data.js';
import { showToast } from '../utils/dom.js';
import { deleteEmbedding } from '../utils/embedding-codec.js';

/**
 * Round number to 2 decimal places.
 * @param {number} n
 * @returns {number}
 */
function r2(n) {
    return Math.round(n * 100) / 100;
}

/**
 * Truncate string to limit with '...' suffix.
 * @param {string} text
 * @param {number} limit
 * @returns {string}
 */
function truncateSummary(text, limit) {
    if (!text || text.length <= limit) return text || '';
    return text.slice(0, limit - 3) + '...';
}

/**
 * Return only settings that differ from defaults.
 * @param {Object} current - Current settings
 * @param {Object} defaults - Default settings
 * @returns {Object} Diff object (may be empty)
 */
function diffSettings(current, defaults) {
    const diff = {};
    for (const [key, defaultVal] of Object.entries(defaults)) {
        const currentVal = current[key];
        if (currentVal !== defaultVal) {
            diff[key === 'enabled' ? 'autoMode' : key] = currentVal;
        }
    }
    return diff;
}

/**
 * Build compact score entry with zero-suppression and rounding.
 * @param {Object} detail - Cached scoring detail entry
 * @param {number} summaryLimit - Max summary length
 * @returns {Object} Compact entry
 */
function compactScores(detail, summaryLimit) {
    const {
        scores,
        memoryId,
        type,
        level,
        parent_ids,
        summary,
        distance,
        importance,
        retrieval_hits,
        mentions,
        characters_involved,
    } = detail;
    const base = r2(scores.base);
    const entry = {
        id: memoryId,
        type,
        summary: truncateSummary(summary, summaryLimit),
        total: r2(scores.total),
        base,
        decayPct: importance > 0 ? r2(scores.base / importance) : 0,
        distance,
        importance,
        retrieval_hits: retrieval_hits ?? 0,
        mentions: mentions ?? 1,
        characters_involved: characters_involved || [],
    };

    // Include level and parent_ids for reflections
    if (type === 'reflection') {
        entry.level = level || 1;
        if (parent_ids && parent_ids.length > 0) {
            entry.parent_ids = parent_ids;
        }
    }

    // Optional fields — only include when non-default
    if (scores.baseAfterFloor !== scores.base) entry.baseAfterFloor = r2(scores.baseAfterFloor);
    if (scores.recencyPenalty) entry.recencyPenalty = r2(scores.recencyPenalty);
    if (scores.vectorSimilarity) entry.vectorSimilarity = r2(scores.vectorSimilarity);
    if (scores.vectorBonus) entry.vectorBonus = r2(scores.vectorBonus);
    if (scores.bm25Score) entry.bm25Score = r2(scores.bm25Score);
    if (scores.bm25Bonus) entry.bm25Bonus = r2(scores.bm25Bonus);
    if (scores.hitDamping !== 1) entry.hitDamping = r2(scores.hitDamping);
    if (scores.frequencyFactor !== 1) entry.frequencyFactor = r2(scores.frequencyFactor);

    return entry;
}

/**
 * Build scoring statistics from cached scoring details.
 * @param {Array<Object>|null} scoringDetails
 * @returns {Object}
 */
function buildScoringStats(scoringDetails) {
    if (!scoringDetails || scoringDetails.length === 0) {
        return null;
    }

    const totalScored = scoringDetails.length;
    let reflectionsScored = 0,
        reflectionsSelected = 0;
    let eventsScored = 0,
        eventsSelected = 0;
    let totalReflectionScore = 0,
        totalEventScore = 0;
    let topScore = 0,
        cutoffScore = null,
        selectedCount = 0;

    for (const detail of scoringDetails) {
        const { scores, type, selected } = detail;
        if (scores.total > topScore) topScore = scores.total;
        if (selected) {
            selectedCount++;
            if (cutoffScore === null || scores.total < cutoffScore) {
                cutoffScore = scores.total;
            }
        }
        if (type === 'reflection') {
            reflectionsScored++;
            totalReflectionScore += scores.total;
            if (selected) reflectionsSelected++;
        } else {
            eventsScored++;
            totalEventScore += scores.total;
            if (selected) eventsSelected++;
        }
    }

    return {
        totalScored,
        selected: selectedCount,
        reflections: {
            scored: reflectionsScored,
            selected: reflectionsSelected,
            avgScore: reflectionsScored > 0 ? r2(totalReflectionScore / reflectionsScored) : 0,
        },
        events: {
            scored: eventsScored,
            selected: eventsSelected,
            avgScore: eventsScored > 0 ? r2(totalEventScore / eventsScored) : 0,
        },
        topScore: r2(topScore),
        cutoffScore: cutoffScore !== null ? r2(cutoffScore) : null,
    };
}

/**
 * Filter graph to nodes/edges relevant to query entities.
 * @param {Object} graph - Full graph with nodes and edges
 * @param {string[]} entities - Query entity names from retrieval
 * @returns {{matchedEntities: string[], nodes: Object, edges: Object}|null}
 */
function filterGraphByEntities(graph, entities) {
    if (!entities || entities.length === 0 || !graph) return null;

    const nodes = graph.nodes || {};
    const edges = graph.edges || {};

    // Build set of matching node keys (case-insensitive)
    const entityLower = new Set(entities.map((e) => e.toLowerCase()));
    const matchedKeys = new Set();

    for (const [key, node] of Object.entries(nodes)) {
        if (entityLower.has(key.toLowerCase()) || entityLower.has((node.name || '').toLowerCase())) {
            matchedKeys.add(key);
        }
    }

    // Filter nodes
    const filteredNodes = {};
    for (const key of matchedKeys) {
        filteredNodes[key] = stripEmbedding(nodes[key]);
    }

    // Filter edges where source OR target is a matched node
    const filteredEdges = {};
    for (const [key, edge] of Object.entries(edges)) {
        if (matchedKeys.has(edge.source) || matchedKeys.has(edge.target)) {
            filteredEdges[key] = { ...edge };
        }
    }

    return { matchedEntities: entities, nodes: filteredNodes, edges: filteredEdges };
}

/**
 * @param {Object} obj
 * @returns {Object} Clone without 'embedding' key
 */
function stripEmbedding(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const clone = { ...obj };
    deleteEmbedding(clone);
    return clone;
}

/**
 * Build memory statistics from memories array.
 * @param {Object[]} memories
 * @returns {Object}
 */
function buildMemoryStats(memories) {
    const byType = {};
    const byImportance = {};
    let importanceSum = 0;

    for (const m of memories) {
        const type = m.type || 'unknown';
        byType[type] = (byType[type] || 0) + 1;
        const imp = String(m.importance || 0);
        byImportance[imp] = (byImportance[imp] || 0) + 1;
        importanceSum += m.importance || 0;
    }

    return {
        total: memories.length,
        byType,
        byImportance,
        averageImportance: memories.length > 0 ? Math.round((importanceSum / memories.length) * 100) / 100 : 0,
    };
}

/**
 * Build character state summary (counts instead of arrays).
 * @param {Object} characterStates
 * @returns {Object}
 */
function buildCharacterSummary(characterStates) {
    if (!characterStates) return {};
    const result = {};
    for (const [name, state] of Object.entries(characterStates)) {
        result[name] = {
            emotion: state.current_emotion || 'neutral',
            intensity: state.emotion_intensity || 0,
            knownEvents: state.known_events?.length || 0,
        };
    }
    return result;
}

/**
 * Build graph summary + relevant subgraph filtered by entities.
 * @param {Object} graph
 * @param {string[]} entities - Query entity names for filtering
 * @returns {Object}
 */
function buildGraphExport(graph, entities) {
    if (!graph)
        return {
            summary: { nodeCount: 0, edgeCount: 0, typeBreakdown: {}, topEntitiesByMentions: [] },
        };

    const nodes = graph.nodes || {};
    const edges = graph.edges || {};
    const nodeEntries = Object.values(nodes);

    // Type breakdown
    const typeBreakdown = {};
    for (const node of nodeEntries) {
        const t = node.type || 'UNKNOWN';
        typeBreakdown[t] = (typeBreakdown[t] || 0) + 1;
    }

    // Top entities by mentions
    const topEntities = nodeEntries
        .slice()
        .sort((a, b) => (b.mentions || 0) - (a.mentions || 0))
        .slice(0, 10)
        .map((n) => ({ name: n.name, type: n.type, mentions: n.mentions || 0 }));

    const result = {
        summary: {
            nodeCount: nodeEntries.length,
            edgeCount: Object.keys(edges).length,
            typeBreakdown,
            topEntitiesByMentions: topEntities,
        },
    };

    // Add relevant subgraph if entities available
    const relevant = filterGraphByEntities(graph, entities);
    if (relevant) {
        result.relevant = relevant;
    }

    return result;
}

/**
 * Build communities export (embeddings stripped).
 * @param {Object} communities
 * @returns {Object}
 */
function buildCommunitiesExport(communities) {
    if (!communities) return { count: 0, details: {} };
    const details = {};
    for (const [id, comm] of Object.entries(communities)) {
        details[id] = {
            title: comm.title,
            summary: comm.summary,
            findings: comm.findings,
            nodeCount: comm.nodes?.length || 0,
        };
    }
    return { count: Object.keys(communities).length, details };
}

/**
 * Build perf metrics export with rounded values.
 * @returns {Object}
 */
function buildPerfExport() {
    const metrics = getPerfMetrics();
    const result = {};
    for (const [id, entry] of Object.entries(metrics)) {
        const label = PERF_METRICS[id]?.label || id;
        result[label] = { ms: r2(entry.ms) };
        if (entry.size) result[label].size = entry.size;
    }
    return result;
}

/**
 * Build the full export payload.
 * @returns {Object} JSON-serializable payload
 */
export function buildExportPayload() {
    const deps = getDeps();
    const settings = deps.getExtensionSettings()[extensionName] || {};
    const data = getOpenVaultData() || {};
    const memories = data[MEMORIES_KEY] || [];
    const characterStates = data[CHARACTERS_KEY] || {};
    const graph = data.graph || {};
    const communities = data.communities || {};

    // Cached retrieval debug data
    const cached = getLastRetrievalDebug();

    // Truncate recentContext in cached data if present
    let lastRetrieval = null;
    if (cached) {
        lastRetrieval = { ...cached };
        if (lastRetrieval.retrievalContext?.userMessages) {
            // userMessages is already capped at 1000 by buildRetrievalContext, keep as-is
        }
    }

    // Get scoring details and stats
    const scoringDetails = getCachedScoringDetails();
    const scoringStats = buildScoringStats(scoringDetails);

    // Extract entities from last retrieval for graph filtering
    const queryEntities = cached?.queryContext?.entities || [];

    // Build selected + top-15-rejected scoring details
    let scoringSection = null;
    if (scoringStats && scoringDetails) {
        const REJECTED_LIMIT = 15;
        const SELECTED_SUMMARY_LIMIT = 200;
        const REJECTED_SUMMARY_LIMIT = 150;

        const selectedEntries = scoringDetails
            .filter((d) => d.selected)
            .map((d) => compactScores(d, SELECTED_SUMMARY_LIMIT));

        const rejectedEntries = scoringDetails
            .filter((d) => !d.selected)
            .sort((a, b) => b.scores.total - a.scores.total)
            .slice(0, REJECTED_LIMIT)
            .map((d) => compactScores(d, REJECTED_SUMMARY_LIMIT));

        scoringSection = {
            _note: 'Default-value fields omitted from entries. Defaults: recencyPenalty=0, hitDamping=1, frequencyFactor=1, vector/bm25 fields=0',
            stats: scoringStats,
            selected: selectedEntries,
            rejected: rejectedEntries,
        };
    }

    return {
        openvault_debug_export: true,
        exportedAt: new Date().toISOString(),

        lastRetrieval,

        scoring: scoringSection,

        state: {
            memories: buildMemoryStats(memories),
            characterStates: buildCharacterSummary(characterStates),
            graph: buildGraphExport(graph, queryEntities),
            communities: buildCommunitiesExport(communities),
        },

        // Settings: only values that differ from defaults
        settings: diffSettings(settings, defaultSettings),
        // Runtime-computed values (not in defaultSettings)
        runtime: {
            embeddingsEnabled: isEmbeddingsEnabled(),
            embeddingModelId: data.embedding_model_id || null,
            extractionProgress: {
                processed: (data.processed_message_ids || []).length,
                chatLength: deps.getContext()?.chat?.length || 0,
            },
            reflectionState: data.reflection_state || {},
            globalWorldState: data.global_world_state || null,
            edgesNeedingConsolidation: data.graph?._edgesNeedingConsolidation || null,
        },
        perf: buildPerfExport(),
    };
}

/**
 * Export debug data to clipboard. Shows toast on success/failure.
 */
export async function exportToClipboard() {
    try {
        const payload = buildExportPayload();
        const json = JSON.stringify(payload, null, 2);
        await navigator.clipboard.writeText(json);
        showToast('success', `Copied ${(json.length / 1024).toFixed(1)}KB to clipboard`);
    } catch (_err) {
        // Fallback for clipboard API failure
        try {
            const textarea = document.createElement('textarea');
            textarea.value = JSON.stringify(buildExportPayload(), null, 2);
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showToast('success', 'Copied to clipboard (fallback)');
        } catch (_fallbackErr) {
            showToast('error', 'Failed to copy to clipboard');
        }
    }
}
