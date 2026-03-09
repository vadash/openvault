import { describe, expect, it } from 'vitest';
import { PERF_METRICS, PERF_THRESHOLDS } from '../../src/constants.js';

describe('PERF constants', () => {
    const EXPECTED_METRIC_IDS = [
        'retrieval_injection',
        'auto_hide',
        'memory_scoring',
        'event_dedup',
        'llm_events',
        'llm_graph',
        'llm_reflection',
        'llm_communities',
        'embedding_generation',
        'louvain_detection',
        'entity_merge',
        'chat_save',
    ];

    it('PERF_THRESHOLDS has all 12 metric IDs with positive numbers', () => {
        for (const id of EXPECTED_METRIC_IDS) {
            expect(PERF_THRESHOLDS[id], `missing threshold for ${id}`).toBeGreaterThan(0);
        }
        expect(Object.keys(PERF_THRESHOLDS)).toHaveLength(12);
    });

    it('PERF_METRICS has label, icon, and sync flag for every metric', () => {
        for (const id of EXPECTED_METRIC_IDS) {
            const meta = PERF_METRICS[id];
            expect(meta, `missing metadata for ${id}`).toBeDefined();
            expect(meta.label).toBeTypeOf('string');
            expect(meta.icon).toBeTypeOf('string');
            expect(meta.sync).toBeTypeOf('boolean');
        }
        expect(Object.keys(PERF_METRICS)).toHaveLength(12);
    });

    it('sync metrics are only retrieval_injection and auto_hide', () => {
        const syncIds = Object.entries(PERF_METRICS)
            .filter(([_, m]) => m.sync)
            .map(([id]) => id);
        expect(syncIds.sort()).toEqual(['auto_hide', 'retrieval_injection']);
    });
});
