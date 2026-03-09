import { describe, expect, it } from 'vitest';
import { deleteEmbedding, getEmbedding, hasEmbedding, setEmbedding } from '../../src/utils/embedding-codec.js';

describe('setEmbedding + getEmbedding roundtrip', () => {
    it('encodes to Base64 and decodes back to number[]', () => {
        const vec = [0.1234, -0.5678, 0.9012, -0.3456];
        const obj = {};
        setEmbedding(obj, vec);

        expect(obj.embedding_b64).toBeTypeOf('string');
        expect(obj.embedding).toBeUndefined();

        const decoded = getEmbedding(obj);
        expect(decoded).toHaveLength(4);
        // Float32 precision: ~7 significant digits
        for (let i = 0; i < vec.length; i++) {
            expect(decoded[i]).toBeCloseTo(vec[i], 5);
        }
    });

    it('roundtrips a realistic 384-dim normalized vector', () => {
        const raw = Array.from({ length: 384 }, () => Math.random() * 2 - 1);
        const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
        const vec = raw.map((v) => v / norm);

        const obj = {};
        setEmbedding(obj, vec);
        const decoded = getEmbedding(obj);

        expect(decoded).toHaveLength(384);
        for (let i = 0; i < vec.length; i++) {
            expect(decoded[i]).toBeCloseTo(vec[i], 5);
        }
    });
});

describe('getEmbedding (lazy migration)', () => {
    it('reads legacy number[] from obj.embedding', () => {
        const obj = { embedding: [0.1, 0.2, 0.3] };
        expect(getEmbedding(obj)).toEqual([0.1, 0.2, 0.3]);
    });

    it('prefers embedding_b64 over legacy embedding', () => {
        const obj = { embedding: [999, 999] };
        setEmbedding(obj, [0.1, 0.2]);
        // Manually add back legacy key to simulate mixed state
        obj.embedding = [999, 999];
        const result = getEmbedding(obj);
        expect(result[0]).toBeCloseTo(0.1, 5);
    });

    it('returns null for empty object', () => {
        expect(getEmbedding({})).toBeNull();
    });

    it('returns null for null/undefined input', () => {
        expect(getEmbedding(null)).toBeNull();
        expect(getEmbedding(undefined)).toBeNull();
    });

    it('returns null for embedding: null', () => {
        expect(getEmbedding({ embedding: null })).toBeNull();
    });

    it('returns null for embedding: []', () => {
        expect(getEmbedding({ embedding: [] })).toBeNull();
    });
});

describe('setEmbedding', () => {
    it('deletes legacy embedding key', () => {
        const obj = { embedding: [1, 2, 3] };
        setEmbedding(obj, [0.5, 0.6]);
        expect(obj.embedding).toBeUndefined();
        expect(obj.embedding_b64).toBeTypeOf('string');
    });

    it('accepts Float32Array input', () => {
        const obj = {};
        setEmbedding(obj, new Float32Array([0.1, 0.2, 0.3]));
        const decoded = getEmbedding(obj);
        expect(decoded).toHaveLength(3);
        expect(decoded[0]).toBeCloseTo(0.1, 5);
    });
});

describe('hasEmbedding', () => {
    it('returns true for embedding_b64', () => {
        const obj = {};
        setEmbedding(obj, [0.1]);
        expect(hasEmbedding(obj)).toBe(true);
    });

    it('returns true for legacy embedding', () => {
        expect(hasEmbedding({ embedding: [0.1] })).toBe(true);
    });

    it('returns false for empty object', () => {
        expect(hasEmbedding({})).toBe(false);
    });

    it('returns false for null/undefined', () => {
        expect(hasEmbedding(null)).toBe(false);
        expect(hasEmbedding(undefined)).toBe(false);
    });

    it('returns false for embedding: null', () => {
        expect(hasEmbedding({ embedding: null })).toBe(false);
    });

    it('returns false for embedding: []', () => {
        expect(hasEmbedding({ embedding: [] })).toBe(false);
    });
});

describe('deleteEmbedding', () => {
    it('removes both embedding_b64 and embedding', () => {
        const obj = { embedding: [1], embedding_b64: 'abc' };
        deleteEmbedding(obj);
        expect(obj.embedding).toBeUndefined();
        expect(obj.embedding_b64).toBeUndefined();
    });

    it('handles object with only legacy key', () => {
        const obj = { embedding: [1, 2] };
        deleteEmbedding(obj);
        expect(obj.embedding).toBeUndefined();
    });

    it('no-ops on empty object', () => {
        const obj = {};
        deleteEmbedding(obj);
        expect(Object.keys(obj)).toHaveLength(0);
    });

    it('no-ops on null/undefined', () => {
        expect(() => deleteEmbedding(null)).not.toThrow();
        expect(() => deleteEmbedding(undefined)).not.toThrow();
    });
});
