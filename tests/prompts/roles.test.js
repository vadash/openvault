import { describe, expect, it } from 'vitest';
import { COMMUNITIES_ROLE, GLOBAL_SYNTHESIS_ROLE } from '../../src/prompts/communities/role.js';
import { EVENT_ROLE } from '../../src/prompts/events/role.js';
import { EDGE_CONSOLIDATION_ROLE, GRAPH_ROLE } from '../../src/prompts/graph/role.js';
import { INSIGHTS_ROLE, QUESTIONS_ROLE, UNIFIED_REFLECTION_ROLE } from '../../src/prompts/reflection/role.js';

const ALL_ROLES = {
    EVENT_ROLE,
    GRAPH_ROLE,
    EDGE_CONSOLIDATION_ROLE,
    UNIFIED_REFLECTION_ROLE,
    QUESTIONS_ROLE,
    INSIGHTS_ROLE,
    COMMUNITIES_ROLE,
    GLOBAL_SYNTHESIS_ROLE,
};

describe('Role exports — Mechanical framing', () => {
    it('exports all 8 roles as non-empty strings', () => {
        for (const [name, role] of Object.entries(ALL_ROLES)) {
            expect(typeof role, `${name} should be a string`).toBe('string');
            expect(role.length, `${name} should be non-empty`).toBeGreaterThan(30);
        }
    });

    it('all roles use automated/pipeline framing', () => {
        for (const [name, role] of Object.entries(ALL_ROLES)) {
            expect(
                /automated|pipeline|consolidator/i.test(role),
                `${name} must use mechanical framing (automated/pipeline/consolidator)`
            ).toBe(true);
        }
    });

    it('all roles include a Function: line', () => {
        for (const [name, role] of Object.entries(ALL_ROLES)) {
            expect(role, `${name} must have Function: descriptor`).toContain('Function:');
        }
    });

    it('no role uses human persona framing', () => {
        for (const [name, role] of Object.entries(ALL_ROLES)) {
            expect(role, `${name} must not use "expert"`).not.toMatch(/\bexpert\b/i);
            expect(role, `${name} must not use "psychologist"`).not.toMatch(/\bpsychologist\b/i);
        }
    });

    it('GRAPH_ROLE preserves nominative-case normalization rule', () => {
        expect(GRAPH_ROLE).toContain('Nominative');
        expect(GRAPH_ROLE).toContain('base dictionary form');
        expect(GRAPH_ROLE).toContain('ошейник');
    });

    it('EVENT_ROLE contains extraction framing', () => {
        expect(EVENT_ROLE).toContain('event extraction');
        expect(EVENT_ROLE).toContain('read-only');
    });

    it('no role enforces a specific output language', () => {
        for (const [name, role] of Object.entries(ALL_ROLES)) {
            expect(role, `${name} must not enforce English`).not.toContain('Write in ENGLISH');
            expect(role, `${name} must not enforce English output`).not.toContain('in English');
        }
    });
});
