import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldSkipReflectionGeneration } from '../../src/reflection/reflect.js';
import { setDeps } from '../../src/deps.js';
import { extensionName } from '../../src/constants.js';

describe('shouldSkipReflectionGeneration', () => {
    beforeEach(() => {
        setDeps({
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            getExtensionSettings: () => ({
                [extensionName]: { debugMode: true },
            }),
        });
    });

    it('should return { shouldSkip: false, reason: null } when recentMemories is empty', () => {
        const result = shouldSkipReflectionGeneration([], [], 0.85);
        expect(result.shouldSkip).toBe(false);
        expect(result.reason).toBe(null);
    });

    it('should return { shouldSkip: false, reason: null } when existingReflections is empty', () => {
        const recentMemories = [
            { summary: 'Alice trusted Bob', embedding: [0.1, 0.2, 0.3] },
        ];
        const result = shouldSkipReflectionGeneration(recentMemories, [], 0.85);
        expect(result.shouldSkip).toBe(false);
        expect(result.reason).toBe(null);
    });

    it('should return true when recent events align with existing reflections (>85%)', () => {
        const recentMemories = [
            { summary: 'Alice trusted Bob with her secret', embedding: [1, 0, 0], importance: 5 },
            { summary: 'Alice showed vulnerability to Bob', embedding: [0.9, 0.1, 0], importance: 4 },
        ];

        const existingReflections = [
            { summary: 'Alice is learning to trust Bob', embedding: [1, 0, 0] }, // 100% similar to first
        ];

        const result = shouldSkipReflectionGeneration(recentMemories, existingReflections, 0.85);

        expect(result.shouldSkip).toBe(true);
        expect(result.reason).toContain('align with existing insights');
    });

    it('should return false when recent events are novel (<85% similarity)', () => {
        const recentMemories = [
            { summary: 'Alice met a new character Carol', embedding: [0, 0, 1], importance: 5 },
        ];

        const existingReflections = [
            { summary: 'Alice trusts Bob', embedding: [1, 0, 0] }, // 0% similar
        ];

        const result = shouldSkipReflectionGeneration(recentMemories, existingReflections, 0.85);

        expect(result.shouldSkip).toBe(false);
        expect(result.reason).toBe(null);
    });

    it('should handle memories without embeddings gracefully', () => {
        const recentMemories = [
            { summary: 'Event without embedding' }, // No embedding
        ];
        const existingReflections = [
            { summary: 'Existing reflection', embedding: [1, 0, 0] },
        ];

        const result = shouldSkipReflectionGeneration(recentMemories, existingReflections, 0.85);

        expect(result.shouldSkip).toBe(false);
        expect(result.reason).toBe(null);
    });

    it('should use default threshold of 0.85 when not provided', () => {
        const recentMemories = [
            { summary: 'Alice trusted Bob', embedding: [0.9, 0.1, 0], importance: 5 },
        ];
        const existingReflections = [
            { summary: 'Alice trusts Bob', embedding: [1, 0, 0] }, // ~90% similar
        ];

        // Should skip with default threshold (0.85)
        const result = shouldSkipReflectionGeneration(recentMemories, existingReflections);
        expect(result.shouldSkip).toBe(true);
    });
});
