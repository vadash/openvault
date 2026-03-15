/**
 * Phase 2 End-to-End Integration Tests
 *
 * Verifies full pipeline:
 * - Reflections separated into <subconscious_drives>
 * - Global world state generated from communities
 * - Intent routing for macro queries
 * - Backward compatibility
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDeps } from '../../src/deps.js';
import { generateGlobalWorldState } from '../../src/graph/communities.js';
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

            const result = formatContextForInjection(
                memories,
                presentCharacters,
                emotionalInfo,
                'Alice',
                tokenBudget,
                chatLength
            );

            // Should contain scene_memory with events only
            expect(result).toContain('<scene_memory>');
            expect(result).toContain('Alice went to the market');
            expect(result).toContain('Alice met Bob at the fountain');

            // Should contain subconscious_drives with reflections only
            expect(result).toContain('<subconscious_drives>');
            expect(result).toContain('Alice secretly fears abandonment');
            expect(result).toContain('Alice seeks validation');

            // Should include CRITICAL RULE text
            expect(result).toContain('[CRITICAL RULE:');
            expect(result).toContain('NOT consciously aware');

            // Reflections should NOT be in scene_memory
            const sceneMemoryMatch = result.match(/<scene_memory>([\s\S]*?)<\/scene_memory>/);
            const sceneMemoryContent = sceneMemoryMatch ? sceneMemoryMatch[1] : '';
            expect(sceneMemoryContent).not.toContain('Alice secretly fears abandonment');
            expect(sceneMemoryContent).not.toContain('Alice seeks validation');
        });

        it('should omit subconscious_drives block when no reflections exist', () => {
            const memories = [
                { id: 'ev_1', type: 'event', summary: 'Alice walked to the store', importance: 3, sequence: 1000 },
            ];
            const result = formatContextForInjection(memories, [], null, 'Alice', 1000, 100);

            expect(result).toContain('<scene_memory>');
            expect(result).not.toContain('<subconscious_drives>');
        });

        it('should handle backward compatibility (memories without type field)', () => {
            // Old memories without type field should be treated as events
            const memories = [{ id: 'ev_1', summary: 'Old memory without type', importance: 3, sequence: 1000 }];
            const result = formatContextForInjection(memories, [], null, 'Alice', 1000, 100);

            expect(result).toContain('<scene_memory>');
            expect(result).toContain('Old memory without type');
            expect(result).not.toContain('<subconscious_drives>');
        });
    });

    describe('Global World State Generation', () => {
        it('should generate global world state from communities', async () => {
            const communities = [
                {
                    title: 'The Royal Court',
                    summary:
                        'Queen Elena navigates treacherous court politics while hiding her alliance with the northern rebels.',
                    findings: ['The Queen fears betrayal', 'The Guard is loyal'],
                },
                {
                    title: 'Merchant Trade Network',
                    summary:
                        'Eastern merchants have formed an embargo against the kingdom, threatening economic collapse.',
                    findings: ['Trade routes are blocked', 'Prices are rising'],
                },
            ];

            mockCallLLM.mockResolvedValue(
                JSON.stringify({
                    global_summary:
                        'The kingdom faces internal collapse on two fronts. Queen Elena secretly supports northern rebels while maintaining court appearance, creating a powder keg if exposed. Simultaneously, the eastern merchant embargo has begun economic strangulation.',
                })
            );

            const result = await generateGlobalWorldState(communities, 'auto', 'auto', '{');

            expect(result).not.toBeNull();
            expect(result.summary).toContain('The kingdom faces internal collapse');
            expect(result.last_updated).toBe(2000000);
            expect(result.community_count).toBe(2);
            expect(mockCallLLM).toHaveBeenCalledTimes(1);
        });

        it('should return null when no communities exist', async () => {
            const result = await generateGlobalWorldState([], 'auto', 'auto', '{');
            expect(result).toBeNull();
        });

        it('should return null for null input', async () => {
            const result = await generateGlobalWorldState(null, 'auto', 'auto', '{');
            expect(result).toBeNull();
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
            const communities = {};
            const queryEmbedding = new Float32Array([0.1, 0.2]);
            const userMessages = 'Please summarize the story so far';

            const result = retrieveWorldContext(communities, globalState, userMessages, queryEmbedding, 2000);

            expect(result.text).toContain('<world_context>');
            expect(result.text).toContain('The kingdom is on the brink of civil war');
            expect(result.text).toContain('</world_context>');
            expect(result.communityIds).toEqual([]);
        });

        it('should fall back to vector search for local intent', () => {
            const globalState = { summary: 'Global state content' };
            const communities = {
                C0: {
                    title: 'Community A',
                    summary: 'A local community about market encounters',
                    _embedding: 'AQIDBA==', // [0.1, 0.2, 0.3, 0.4] in base64
                },
            };
            const queryEmbedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
            const userMessages = "Let's go to the kitchen";

            const result = retrieveWorldContext(communities, globalState, userMessages, queryEmbedding, 2000);

            // Should NOT use global state for local queries
            expect(result.text).not.toContain('Global state content');
        });

        it('should fall back to vector search when global state is null', () => {
            const userMessages = 'Summarize everything'; // has macro intent
            const globalState = null;

            const result = retrieveWorldContext({}, globalState, userMessages, new Float32Array([0.1]), 2000);

            // No global state available, should return empty
            expect(result.text).toBe('');
        });

        it('should fall back to vector search when global state has no summary', () => {
            const userMessages = 'Summarize everything';
            const globalState = {}; // missing summary

            const result = retrieveWorldContext({}, globalState, userMessages, new Float32Array([0.1]), 2000);

            // Should fall back to empty result (no communities)
            expect(result.text).toBe('');
        });
    });

    describe('Full Pipeline Integration', () => {
        it('should complete full cycle: extraction → communities → global state → retrieval', async () => {
            // 1. Simulate chat growth resulting in reflections and communities
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
            const formatted = formatContextForInjection(memories, ['Bob'], null, 'Alice', 1000, 100);
            expect(formatted).toContain('<subconscious_drives>');
            expect(formatted).toContain('Alice feels guilt but cannot confess');

            // 3. Simulate community detection leading to global state
            const communities = [
                {
                    title: 'The Love Triangle',
                    summary: 'Alice betrayed Bob while secretly loving Charlie.',
                    findings: ['Alice is torn', 'Bob suspects nothing'],
                },
            ];

            mockCallLLM.mockResolvedValue(
                JSON.stringify({
                    global_summary:
                        'A love triangle with betrayal at its core. Alice betrayed Bob while loving Charlie, creating emotional tension that will inevitably explode.',
                })
            );

            const globalState = await generateGlobalWorldState(communities, 'auto', 'auto', '{');
            expect(globalState.summary).toContain('love triangle');

            // 4. Verify macro-intent message retrieves global state
            const macroQuery = 'What is the story so far?';
            const worldContext = retrieveWorldContext({}, globalState, macroQuery, new Float32Array([0.1]), 2000);

            expect(worldContext.text).toContain('<world_context>');
            expect(worldContext.text).toContain('love triangle');
        });
    });

    describe('Backward Compatibility', () => {
        it('should handle chats without global_world_state', () => {
            const oldState = null;
            const communities = {};
            const userMessages = 'Summarize everything';

            const result = retrieveWorldContext(communities, oldState, userMessages, new Float32Array([0.1]), 2000);

            // Should not crash, return empty
            expect(result.text).toBe('');
            expect(result.communityIds).toEqual([]);
        });

        it('should handle memories without type field (legacy data)', () => {
            const legacyMemories = [{ id: 'old_1', summary: 'Old memory', importance: 3, sequence: 1000 }];

            const result = formatContextForInjection(legacyMemories, [], null, 'Alice', 1000, 100);

            // Should treat as events, not reflections
            expect(result).toContain('<scene_memory>');
            expect(result).toContain('Old memory');
            expect(result).not.toContain('<subconscious_drives>');
        });
    });
});
