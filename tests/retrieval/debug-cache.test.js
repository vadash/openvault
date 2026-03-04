import { describe, expect, it, beforeEach } from 'vitest';
import { cacheRetrievalDebug, getLastRetrievalDebug, clearRetrievalDebug } from '../../src/retrieval/debug-cache.js';

describe('debug-cache', () => {
    beforeEach(() => {
        clearRetrievalDebug();
    });

    it('returns null when no data cached', () => {
        expect(getLastRetrievalDebug()).toBeNull();
    });

    it('caches and retrieves data with timestamp', () => {
        const data = { filters: { total: 10 } };
        cacheRetrievalDebug(data);
        const result = getLastRetrievalDebug();
        expect(result.filters.total).toBe(10);
        expect(result.timestamp).toBeTypeOf('number');
    });

    it('merges successive cache calls', () => {
        cacheRetrievalDebug({ filters: { total: 10 } });
        cacheRetrievalDebug({ queryContext: { entities: ['Alice'] } });
        const result = getLastRetrievalDebug();
        expect(result.filters.total).toBe(10);
        expect(result.queryContext.entities).toEqual(['Alice']);
    });

    it('clears cache', () => {
        cacheRetrievalDebug({ filters: { total: 10 } });
        clearRetrievalDebug();
        expect(getLastRetrievalDebug()).toBeNull();
    });
});
