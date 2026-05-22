/**
 * Phase 2 End-to-End Integration Tests
 *
 * Verifies full pipeline:
 * - Reflections separated into <subconscious_drives>
 * - Global world state generated from top entities
 * - Intent routing for macro queries
 * - Backward compatibility
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDeps } from '../../src/deps.js';
import { generateWorldState, selectTopEntities } from '../../src/graph/world-state.js';
import { formatContextForInjection } from '../../src/retrieval/formatting.js';
import { detectMacroIntent, retrieveWorldContext } from '../../src/retrieval/world-context.js';

// Mock LLM
const mockCallLLM = vi.fn();
vi.mock('../../src/llm.js', () => ({
    callLLM: (...args) => mockCallLLM(...args),
    LLM_CONFIGS: {
        community: { profileSettingKey: 'extractionProfile' },
    },
}));

describe('Phase 2 End-to-End Integration', () => {
    beforeEach(() => {
        setupTestContext({
            deps: { Date: { now: () => 2000000 } },
        });
        mockCallLLM.mockReset();
    });

    afterEach(() => {
        resetDeps();
        vi.clearAllMocks();
    });

    describe('Subconscious Drives Formatting', () => {
        it('should separate reflections into <subconscious_drives> block', () => {
            const memories = [
                { id: 'ev_1', type: 'event', summary: 'Alice went to the market', importance: 3, sequence: 1000 },
                { id: 'ev_2', type: 'event', summary: 'Alice met Bob at the fountain', importance: 3, sequence: 2000 },
                {
                    id: 'ref_1',
                    type: 'reflection',
                    summary: 'Alice secretly fears abandonment due to childhood trauma',
                    importance: 4,
                    sequence: 1500,
                },
                {
                    id: 'ref_2',
                    type: 'reflection',
                    summary: 'Alice seeks validation through romantic relationships',
                    importance: 3,
                    sequence: 2500,
                },
            ];
            const presentCharacters = ['Bob'];
            const emotionalInfo = null;
            const tokenBudget = 1000;
            const chatLength = 100;

            const { memoryText, reflectionText } = formatContextForInjection(
                memories,
                presentCharacters,
                emotionalInfo,
                'Alice',
                tokenBudget,
                chatLength
            );

            // Should contain scene_memory with events only
            expect(memoryText).toContain('<scene_memory>');
            expect(memoryText).toContain('Alice went to the market');
            expect(memoryText).toContain('Alice met Bob at the fountain');

            // Should contain subconscious_drives with reflections only
            expect(reflectionText).toContain('<subconscious_drives>');
            expect(reflectionText).toContain('Alice secretly fears abandonment');
            expect(reflectionText).toContain('Alice seeks validation');

            // Should include CRITICAL RULE text
            expect(reflectionText).toContain('[CRITICAL RULE:');
            expect(reflectionText).toContain('NOT consciously aware');

            // Reflections should NOT be in scene_memory
            const sceneMemoryMatch = memoryText.match(/<scene_memory>([\s\S]*?)<\/scene_memory>/);
            const sceneMemoryContent = sceneMemoryMatch ? sceneMemoryMatch[1] : '';
            expect(sceneMemoryContent).not.toContain('Alice secretly fears abandonment');
            expect(sceneMemoryContent).not.toContain('Alice seeks validation');
        });

        it('should omit subconscious_drives block when no reflections exist', () => {
            const memories = [
                { id: 'ev_1', type: 'event', summary: 'Alice walked to the store', importance: 3, sequence: 1000 },
            ];
            const { memoryText, reflectionText } = formatContextForInjection(memories, [], null, 'Alice', 1000, 100);

            expect(memoryText).toContain('<scene_memory>');
            expect(reflectionText).not.toContain('<subconscious_drives>');
        });

        it('should handle backward compatibility (memories without type field)', () => {
            // Old memories without type field should be treated as events
            const memories = [{ id: 'ev_1', summary: 'Old memory without type', importance: 3, sequence: 1000 }];
            const { memoryText, reflectionText } = formatContextForInjection(memories, [], null, 'Alice', 1000, 100);

            expect(memoryText).toContain('<scene_memory>');
            expect(memoryText).toContain('Old memory without type');
            expect(reflectionText).not.toContain('<subconscious_drives>');
        });
    });

    describe('World State Generation', () => {
        it('should generate world state from top entities', async () => {
            const entities = [
                { name: 'Queen Elena', type: 'PERSON', description: 'Ruler of the kingdom', mentions: 10 },
                { name: 'The Royal Court', type: 'PLACE', description: 'Center of power', mentions: 8 },
            ];
            const edges = [{ source: 'Queen Elena', target: 'The Royal Court', description: 'Rules from', weight: 5 }];

            mockCallLLM.mockResolvedValue(
                JSON.stringify({
                    global_summary:
                        'The kingdom faces internal collapse. Queen Elena secretly supports northern rebels while maintaining court appearance.',
                })
            );

            const result = await generateWorldState(entities, edges, 'auto', 'auto', '{');

            expect(result).not.toBeNull();
            expect(result.summary).toContain('The kingdom faces internal collapse');
            expect(result.last_updated).toBe(2000000);
            expect(mockCallLLM).toHaveBeenCalledTimes(1);
        });

        it('should select top entities by mentions', () => {
            const graphData = {
                nodes: {
                    alice: { name: 'Alice', type: 'PERSON', description: 'Main character', mentions: 15 },
                    bob: { name: 'Bob', type: 'PERSON', description: 'Supporting character', mentions: 5 },
                    tavern: { name: 'The Tavern', type: 'PLACE', description: 'Meeting place', mentions: 10 },
                },
                edges: {
                    alice__tavern: { source: 'alice', target: 'tavern', description: 'Visits often', weight: 3 },
                },
            };

            const { entities, edges: selectedEdges } = selectTopEntities(graphData, 2);

            expect(entities).toHaveLength(2);
            expect(entities[0].name).toBe('Alice');
            expect(entities[1].name).toBe('The Tavern');
            expect(selectedEdges).toHaveLength(1);
            expect(selectedEdges[0].source).toBe('Alice');
            expect(selectedEdges[0].target).toBe('The Tavern');
        });
    });

    describe('Intent Detection & Routing', () => {
        it('should detect English macro intent keywords', () => {
            expect(detectMacroIntent('Can you summarize what happened so far?')).toBe(true);
            expect(detectMacroIntent('Give me a recap of the story')).toBe(true);
            expect(detectMacroIntent('What is the overall dynamic?')).toBe(true);
            expect(detectMacroIntent('Tell me about what has happened lately')).toBe(true);
            expect(detectMacroIntent('Is there a time skip coming?')).toBe(true);
        });

        it('should detect Russian macro intent keywords', () => {
            expect(detectMacroIntent('Расскажи вкратце, что было')).toBe(true);
            expect(detectMacroIntent('Какой итог нашей истории?')).toBe(true);
            expect(detectMacroIntent('Наполни контекст о происходящем')).toBe(true);
            expect(detectMacroIntent('Напомни, как всё началось')).toBe(true);
        });

        it('should return false for local queries', () => {
            expect(detectMacroIntent("Let's go to the kitchen")).toBe(false);
            expect(detectMacroIntent('I kiss her gently')).toBe(false);
            expect(detectMacroIntent('Пойдём в спальню')).toBe(false);
            expect(detectMacroIntent('She smiles at me')).toBe(false);
        });

        it('should handle empty input gracefully', () => {
            expect(detectMacroIntent('')).toBe(false);
            expect(detectMacroIntent(null)).toBe(false);
            expect(detectMacroIntent(undefined)).toBe(false);
        });

        it('should route to global state for macro intent', () => {
            const globalState = { summary: 'The kingdom is on the brink of civil war.' };
            const graphData = { nodes: {}, edges: {} };
            const queryEmbedding = new Float32Array([0.1, 0.2]);
            const userMessages = 'Please summarize the story so far';

            const result = retrieveWorldContext(graphData, globalState, userMessages, queryEmbedding, 2000);

            expect(result.text).toContain('<world_context>');
            expect(result.text).toContain('The kingdom is on the brink of civil war');
            expect(result.text).toContain('</world_context>');
            expect(result.entityKeys).toEqual([]);
            expect(result.isMacroIntent).toBe(true);
        });

        it('should fall back to vector search for local intent', () => {
            const globalState = { summary: 'Global state content' };
            const graphData = { nodes: {}, edges: {} };
            const queryEmbedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
            const userMessages = "Let's go to the kitchen";

            const result = retrieveWorldContext(graphData, globalState, userMessages, queryEmbedding, 2000);

            // Should NOT use global state for local queries
            expect(result.text).not.toContain('Global state content');
            expect(result.isMacroIntent).toBe(false);
        });

        it('should fall back to empty when global state is null and no entities', () => {
            const userMessages = 'Summarize everything'; // has macro intent
            const globalState = null;

            const result = retrieveWorldContext({}, globalState, userMessages, new Float32Array([0.1]), 2000);

            // No global state available, should return empty
            expect(result.text).toBe('');
        });

        it('should fall back to empty when global state has no summary', () => {
            const userMessages = 'Summarize everything';
            const globalState = {}; // missing summary

            const result = retrieveWorldContext({}, globalState, userMessages, new Float32Array([0.1]), 2000);

            // Should fall back to empty result (no entities with embeddings)
            expect(result.text).toBe('');
        });
    });

    describe('Full Pipeline Integration', () => {
        it('should complete full cycle: extraction → selectTopEntities → world state → retrieval', async () => {
            // 1. Simulate chat growth resulting in reflections
            const memories = [
                { id: 'ev_1', type: 'event', summary: 'Alice betrayed Bob', importance: 4, sequence: 1000 },
                {
                    id: 'ref_1',
                    type: 'reflection',
                    summary: 'Alice feels guilt but cannot confess',
                    importance: 4,
                    sequence: 1500,
                },
            ];

            // 2. Verify formatting separates reflections
            const { reflectionText } = formatContextForInjection(memories, ['Bob'], null, 'Alice', 1000, 100);
            expect(reflectionText).toContain('<subconscious_drives>');
            expect(reflectionText).toContain('Alice feels guilt but cannot confess');

            // 3. Simulate top entity selection leading to world state
            const graphData = {
                nodes: {
                    alice: { name: 'Alice', type: 'PERSON', description: 'Main character', mentions: 15 },
                    bob: { name: 'Bob', type: 'PERSON', description: 'Supporting character', mentions: 10 },
                    charlie: { name: 'Charlie', type: 'PERSON', description: 'Love interest', mentions: 8 },
                },
                edges: {
                    alice__bob: { source: 'alice', target: 'bob', description: 'Betrayed', weight: 5 },
                    alice__charlie: { source: 'alice', target: 'charlie', description: 'Loves secretly', weight: 4 },
                },
            };

            const { entities, edges } = selectTopEntities(graphData, 3);

            mockCallLLM.mockResolvedValue(
                JSON.stringify({
                    global_summary:
                        'A love triangle with betrayal at its core. Alice betrayed Bob while loving Charlie, creating emotional tension.',
                })
            );

            const globalState = await generateWorldState(entities, edges, 'auto', 'auto', '{');
            expect(globalState.summary).toContain('love triangle');

            // 4. Verify macro-intent message retrieves global state
            const macroQuery = 'What is the story so far?';
            const worldContext = retrieveWorldContext(
                graphData,
                globalState,
                macroQuery,
                new Float32Array([0.1]),
                2000
            );

            expect(worldContext.text).toContain('<world_context>');
            expect(worldContext.text).toContain('love triangle');
        });
    });

    describe('Backward Compatibility', () => {
        it('should handle chats without global_world_state', () => {
            const oldState = null;
            const graphData = {};
            const userMessages = 'Summarize everything';

            const result = retrieveWorldContext(graphData, oldState, userMessages, new Float32Array([0.1]), 2000);

            // Should not crash, return empty
            expect(result.text).toBe('');
            expect(result.entityKeys).toEqual([]);
        });

        it('should handle memories without type field (legacy data)', () => {
            const legacyMemories = [{ id: 'old_1', summary: 'Old memory', importance: 3, sequence: 1000 }];

            const { memoryText, reflectionText } = formatContextForInjection(
                legacyMemories,
                [],
                null,
                'Alice',
                1000,
                100
            );

            // Should treat as events, not reflections
            expect(memoryText).toContain('<scene_memory>');
            expect(memoryText).toContain('Old memory');
            expect(reflectionText).not.toContain('<subconscious_drives>');
        });
    });
});
