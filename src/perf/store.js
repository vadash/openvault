import { PERF_METRICS } from '../constants.js';
import { getOpenVaultData } from '../utils/data.js';
import { logDebug } from '../utils/logging.js';

/** @type {Object<string, {ms: number, size: string|null, ts: number}>} */
let _store = {};

/**
 * Record a performance metric (last-value-wins).
 * Also persists to chatMetadata.openvault.perf.
 * @param {string} metricId - Key from PERF_METRICS
 * @param {number} durationMs - performance.now() delta
 * @param {string|null} [size=null] - Human-readable scale context
 */
export function record(metricId, durationMs, size = null) {
    if (!PERF_METRICS[metricId]) return; // ignore unknown

    const entry = { ms: durationMs, size, ts: Date.now() };
    _store[metricId] = entry;

    // Persist to chat metadata
    const data = getOpenVaultData();
    if (data) {
        if (!data.perf) data.perf = {};
        data.perf[metricId] = entry;
    }

    logDebug(`⏱️ [${PERF_METRICS[metricId].label}] ${durationMs.toFixed(2)}ms${size ? ` (${size})` : ''}`);
}

/**
 * Get all recorded metrics.
 * @returns {Object<string, {ms: number, size: string|null, ts: number}>}
 */
export function getAll() {
    return { ..._store };
}

/**
 * Load persisted perf data from chatMetadata on chat switch.
 */
export function loadFromChat() {
    _store = {};
    const data = getOpenVaultData();
    if (data?.perf) {
        for (const [id, entry] of Object.entries(data.perf)) {
            if (PERF_METRICS[id]) {
                _store[id] = { ...entry };
            }
        }
    }
}

/**
 * Format all metrics as copyable plain text.
 * @returns {string}
 */
export function formatForClipboard() {
    const entries = Object.entries(_store);
    if (entries.length === 0) return 'No perf data recorded yet.';

    const lines = ['OpenVault Performance Report', '═'.repeat(50)];
    for (const [id, entry] of entries) {
        const meta = PERF_METRICS[id];
        if (!meta) continue;
        const sizeStr = entry.size ? ` | ${entry.size}` : '';
        lines.push(`${meta.label.padEnd(22)} ${entry.ms.toFixed(2)}ms${sizeStr}`);
    }
    return lines.join('\n');
}

/** @internal Test-only reset */
export function _resetForTest() {
    _store = {};
}
