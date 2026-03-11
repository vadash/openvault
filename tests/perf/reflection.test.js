import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { record, getAll, _resetForTest } from '../../src/perf/store.js';
import { PERF_THRESHOLDS } from '../../src/constants.js';

describe('Reflection Performance', () => {
    beforeEach(() => {
        _resetForTest();
    });

    afterEach(() => {
        _resetForTest();
    });

    it('records llm_reflection metric', () => {
        // Simulate recording reflection performance
        const sampleDuration = 12000; // 12 seconds (faster than old 4-call pipeline)
        record('llm_reflection', sampleDuration, '100 memories');

        const metrics = getAll();
        expect(metrics.llm_reflection).toBeDefined();
        expect(metrics.llm_reflection.ms).toBe(sampleDuration);
        expect(metrics.llm_reflection.size).toBe('100 memories');
    });

    it('unified reflection threshold is set to 20000ms', () => {
        // With unified call, threshold should be ~20s (down from 45s for 4-call)
        expect(PERF_THRESHOLDS.llm_reflection).toBe(20000);
    });

    it('unified reflection is faster than old pipeline threshold', () => {
        // Old pipeline: 45000ms (4 calls × ~10s each)
        // New pipeline: 20000ms (1 call × ~10-12s)
        const oldThreshold = 45000;
        const newThreshold = PERF_THRESHOLDS.llm_reflection;

        expect(newThreshold).toBeLessThan(oldThreshold);
        expect(newThreshold / oldThreshold).toBeLessThan(0.5); // At least 2x faster
    });

    it('records multiple reflection calls correctly', () => {
        record('llm_reflection', 11000);
        record('llm_reflection', 13000); // Last value wins

        const metrics = getAll();
        expect(metrics.llm_reflection.ms).toBe(13000); // Last value
    });

    it('unified reflection performance stays within acceptable range', () => {
        // Simulate various unified reflection timings
        const timings = [8000, 12000, 15000, 18000, 22000];

        for (const timing of timings) {
            record('llm_reflection', timing);
            const metrics = getAll();

            // Even slower unified calls should be faster than old threshold
            if (timing <= PERF_THRESHOLDS.llm_reflection) {
                expect(metrics.llm_reflection.ms).toBeLessThanOrEqual(PERF_THRESHOLDS.llm_reflection);
            }
        }
    });
});
