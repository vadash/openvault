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
});
