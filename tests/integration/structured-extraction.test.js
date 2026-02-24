import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setDeps, resetDeps } from '../../src/deps.js';
import { extensionName } from '../../src/constants.js';
import { extractMemories } from '../../src/extraction/extract.js';

describe('Structured extraction integration', () => {
    beforeEach(() => {
        setDeps({
            getContext: () => ({
                name2: 'Alice',
                name1: 'User',
                chat: [
                    { id: 1, mes: 'Hello Alice!', name: 'User' },
                    { id: 2, mes: 'Hi there!', name: 'Alice' },
                ],
            }),
            connectionManager: {
                sendRequest: vi.fn().mockResolvedValue({
                    content: JSON.stringify({
                        events: [
                            {
                                summary: 'User greeted Alice',
                                importance: 2,
                                characters_involved: ['User', 'Alice'],
                                witnesses: ['Alice'],
                            }
                        ],
                        reasoning: 'Initial greeting established',
                    })
                }),
            },
            getExtensionSettings: () => ({
                [extensionName]: {
                    enabled: true,
                    extractionProfile: 'test-profile',
                },
                connectionManager: {
                    profiles: [{ id: 'test-profile' }],
                },
            }),
            console: {
                log: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
        });
    });

    afterEach(() => {
        resetDeps();
    });

    it('extracts memories using structured output', async () => {
        const result = await extractMemories();

        expect(result.status).toBe('success');
        expect(result.events_created).toBe(1);
    });

    it('handles markdown-wrapped responses', async () => {
        const { connectionManager } = await import('../../src/deps.js').then(m => m.getDeps());

        connectionManager.sendRequest.mockResolvedValue({
            content: '```json\n{"events": [{"summary": "Test", "importance": 3, "characters_involved": []}], "reasoning": null}\n```'
        });

        const result = await extractMemories();
        expect(result.status).toBe('success');
    });
});
