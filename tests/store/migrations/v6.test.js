import { describe, expect, it } from 'vitest';
import { migrateToV6 } from '../../../src/store/migrations/v6.js';

describe('v6 migration', () => {
    it('should delete communities, remove community_count from global_world_state, and rename communityDetectionInterval to worldStateInterval', () => {
        const v5Data = {
            schema_version: 5,
            communities: {
                community_1: { id: 'community_1', title: 'Test Community', summary: 'Test summary' },
                community_2: { id: 'community_2', title: 'Another Community', summary: 'Another summary' },
            },
            global_world_state: {
                summary: 'World state summary',
                last_updated: 1234567890,
                community_count: 5,
            },
            settings: {
                communityDetectionInterval: 50,
                otherSetting: 'unchanged',
            },
        };

        const changed = migrateToV6(v5Data, []);

        expect(changed).toBe(true);
        expect(v5Data.communities).toBeUndefined();
        expect(v5Data.global_world_state.community_count).toBeUndefined();
        expect(v5Data.global_world_state.summary).toBe('World state summary');
        expect(v5Data.global_world_state.last_updated).toBe(1234567890);
        expect(v5Data.settings.communityDetectionInterval).toBeUndefined();
        expect(v5Data.settings.worldStateInterval).toBe(50);
        expect(v5Data.settings.otherSetting).toBe('unchanged');
    });

    it('should be no-op for data without communities, but still rename setting if it exists', () => {
        const dataWithoutCommunities = {
            schema_version: 5,
            global_world_state: {
                summary: 'World state summary',
                last_updated: 1234567890,
                community_count: 3,
            },
            settings: {
                communityDetectionInterval: 75,
            },
        };

        const changed = migrateToV6(dataWithoutCommunities, []);

        expect(changed).toBe(true);
        expect(dataWithoutCommunities.communities).toBeUndefined();
        expect(dataWithoutCommunities.global_world_state.community_count).toBeUndefined();
        expect(dataWithoutCommunities.settings.communityDetectionInterval).toBeUndefined();
        expect(dataWithoutCommunities.settings.worldStateInterval).toBe(75);
    });

    it('should be no-op for already-migrated v6 data', () => {
        const v6Data = {
            schema_version: 6,
            global_world_state: {
                summary: 'World state summary',
                last_updated: 1234567890,
            },
            settings: {
                worldStateInterval: 100,
            },
        };

        const changed = migrateToV6(v6Data, []);

        expect(changed).toBe(false);
        expect(v6Data.global_world_state.community_count).toBeUndefined();
        expect(v6Data.settings.communityDetectionInterval).toBeUndefined();
        expect(v6Data.settings.worldStateInterval).toBe(100);
    });

    it('should handle missing global_world_state gracefully', () => {
        const dataWithoutWorldState = {
            schema_version: 5,
            communities: {
                community_1: { id: 'community_1', title: 'Test', summary: 'Test summary' },
            },
            settings: {
                communityDetectionInterval: 50,
            },
        };

        const changed = migrateToV6(dataWithoutWorldState, []);

        expect(changed).toBe(true);
        expect(dataWithoutWorldState.communities).toBeUndefined();
        expect(dataWithoutWorldState.global_world_state).toBeUndefined();
        expect(dataWithoutWorldState.settings.communityDetectionInterval).toBeUndefined();
        expect(dataWithoutWorldState.settings.worldStateInterval).toBe(50);
    });

    it('should handle missing settings gracefully', () => {
        const dataWithoutSettings = {
            schema_version: 5,
            communities: {
                community_1: { id: 'community_1', title: 'Test', summary: 'Test summary' },
            },
            global_world_state: {
                summary: 'World state summary',
                last_updated: 1234567890,
                community_count: 2,
            },
        };

        const changed = migrateToV6(dataWithoutSettings, []);

        expect(changed).toBe(true);
        expect(dataWithoutSettings.communities).toBeUndefined();
        expect(dataWithoutSettings.global_world_state.community_count).toBeUndefined();
    });

    it('should handle data with neither communities nor community_count nor the old setting', () => {
        const minimalData = {
            schema_version: 5,
            global_world_state: {
                summary: 'World state summary',
                last_updated: 1234567890,
            },
            settings: {
                otherSetting: 'value',
            },
        };

        const changed = migrateToV6(minimalData, []);

        expect(changed).toBe(false);
        expect(minimalData.global_world_state.community_count).toBeUndefined();
        expect(minimalData.settings.otherSetting).toBe('value');
    });
});
