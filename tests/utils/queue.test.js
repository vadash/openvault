import { describe, expect, it } from 'vitest';
import { createLadderQueue } from '../../src/utils/queue.js';

describe('createLadderQueue', () => {
    describe('basic execution', () => {
        it('should execute a single task and return its result', async () => {
            const queue = await createLadderQueue(1);
            const result = await queue.add(async () => 42);
            expect(result).toBe(42);
        });

        it('should execute multiple tasks', async () => {
            const queue = await createLadderQueue(2);
            const results = [];
            const promises = [
                queue.add(async () => {
                    results.push('a');
                    return 'a';
                }),
                queue.add(async () => {
                    results.push('b');
                    return 'b';
                }),
                queue.add(async () => {
                    results.push('c');
                    return 'c';
                }),
            ];
            await Promise.all(promises);
            expect(results).toHaveLength(3);
            expect(results).toContain('a');
            expect(results).toContain('b');
            expect(results).toContain('c');
        });

        it('should report concurrency via getter', async () => {
            const queue = await createLadderQueue(3);
            expect(queue.concurrency).toBe(3);
        });

        it('should resolve onIdle when queue is empty', async () => {
            const queue = await createLadderQueue(1);
            await queue.add(async () => 'done');
            await queue.onIdle();
            // If we reach here without hanging, the test passes
            expect(true).toBe(true);
        });

        it('should default maxConcurrency to 1 when undefined', async () => {
            const queue = await createLadderQueue(undefined);
            expect(queue.concurrency).toBe(1);
        });
    });

    describe('AIMD behavior', () => {
        it('should halve concurrency on rate-limit error (multiplicative decrease)', async () => {
            const queue = await createLadderQueue(4);
            expect(queue.concurrency).toBe(4);

            // Task that throws a 429 error
            try {
                await queue.add(async () => {
                    throw new Error('429 Too Many Requests');
                });
            } catch {
                // Expected to throw
            }

            // Concurrency should have halved: floor(4/2) = 2
            expect(queue.concurrency).toBe(2);
        });

        it('should halve concurrency on timeout error', async () => {
            const queue = await createLadderQueue(4);

            try {
                await queue.add(async () => {
                    throw new Error('Request timeout after 60000ms');
                });
            } catch {
                // Expected
            }

            expect(queue.concurrency).toBe(2);
        });

        it('should not drop below concurrency 1', async () => {
            const queue = await createLadderQueue(2);

            // First 429: 2 -> 1
            try {
                await queue.add(async () => {
                    throw new Error('429');
                });
            } catch {}
            expect(queue.concurrency).toBe(1);

            // Second 429: stays at 1
            try {
                await queue.add(async () => {
                    throw new Error('429');
                });
            } catch {}
            expect(queue.concurrency).toBe(1);
        });

        it('should increase concurrency on success (additive increase)', async () => {
            const queue = await createLadderQueue(4);

            // Drop to 2 first
            try {
                await queue.add(async () => {
                    throw new Error('429');
                });
            } catch {}
            expect(queue.concurrency).toBe(2);

            // Each success adds 0.5 to the internal limit (floor rounds down)
            // currentLimit starts at 2.0
            await queue.add(async () => 'ok'); // 2.0 + 0.5 = 2.5, floor = 2
            expect(queue.concurrency).toBe(2);

            await queue.add(async () => 'ok'); // 2.5 + 0.5 = 3.0, floor = 3
            expect(queue.concurrency).toBe(3);

            await queue.add(async () => 'ok'); // 3.0 + 0.5 = 3.5, floor = 3
            expect(queue.concurrency).toBe(3);

            await queue.add(async () => 'ok'); // 3.5 + 0.5 = 4.0, floor = 4
            expect(queue.concurrency).toBe(4);
        });

        it('should never exceed maxConcurrency ceiling', async () => {
            const queue = await createLadderQueue(3);

            // Many successes should not push above 3
            for (let i = 0; i < 10; i++) {
                await queue.add(async () => 'ok');
            }
            expect(queue.concurrency).toBe(3);
        });

        it('should not apply AIMD to non-rate-limit errors', async () => {
            const queue = await createLadderQueue(4);

            try {
                await queue.add(async () => {
                    throw new Error('Some random LLM parsing error');
                });
            } catch {
                // Expected
            }

            // Concurrency unchanged — only 429/timeout triggers AIMD
            expect(queue.concurrency).toBe(4);
        });

        it('should re-throw errors from tasks', async () => {
            const queue = await createLadderQueue(1);

            await expect(
                queue.add(async () => {
                    throw new Error('task failed');
                })
            ).rejects.toThrow('task failed');
        });
    });
});
