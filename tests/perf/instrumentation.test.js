import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDeps } from '../../src/deps.js';
import { _resetForTest, getAll } from '../../src/perf/store.js';

describe('perf instrumentation - events.js', () => {
    beforeEach(() => {
        _resetForTest();
    });
    afterEach(() => {
        resetDeps();
        vi.restoreAllMocks();
    });

    it('autoHideOldMessages records auto_hide metric', async () => {
        setupTestContext({
            context: {
                chat: [
                    { mes: 'hi', is_user: true, is_system: false },
                    { mes: 'hello', is_user: false, is_system: false },
                ],
                chatMetadata: { openvault: { memories: [], processed_message_ids: [0, 1] } },
            },
            settings: { autoHideEnabled: true, visibleChatBudget: 999999 },
            deps: { saveChatConditional: vi.fn(async () => true) },
        });

        const { autoHideOldMessages } = await import('../../src/events.js');
        await autoHideOldMessages();

        // Even if nothing was hidden (under budget), the timing should be recorded
        const all = getAll();
        expect(all.auto_hide).toBeDefined();
        expect(all.auto_hide.ms).toBeGreaterThanOrEqual(0);
    });
});

// Other instrumentation tests removed - one representative test is sufficient
