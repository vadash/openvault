/**
 * Tests for src/retrieval/formatting.js - scene state formatting
 */
import { describe, expect, it } from 'vitest';
import { formatSceneStateForInjection } from '../../src/retrieval/formatting.js';

describe('formatSceneStateForInjection', () => {
    const FULL_SCENE_STATE = {
        location: 'Abandoned warehouse',
        time: 'Night, around 11 PM',
        environment: 'Dimly lit, smell of rust and oil',
        characters: {
            Alice: {
                clothing: ['dark leather jacket', 'black jeans', 'combat boots'],
                posture: 'Leaning against a rusty pillar',
                physical_status: ['slightly bruised', 'alert'],
                mental_status: 'focused',
            },
            Bob: {
                clothing: ['tattered hoodie', 'worn sneakers'],
                posture: 'Sitting on a crate',
                physical_status: ['exhausted'],
                mental_status: 'anxious',
            },
        },
        active_props: ['a half-empty whiskey bottle', 'a flickering lantern'],
    };

    const SCENE_WITHOUT_ENVIRONMENT = {
        location: 'Forest clearing',
        time: 'Dawn',
        characters: {
            Alice: {
                clothing: ['travel cloak', 'leather armor'],
                posture: 'Standing near the stream',
                physical_status: ['refreshed'],
                mental_status: 'calm',
            },
        },
        active_props: ['a fishing rod'],
    };

    const SCENE_WITH_SINGLE_CHARACTER = {
        location: 'Small tavern room',
        time: 'Late afternoon',
        environment: 'Warm, smell of ale and wood smoke',
        characters: {
            Hero: {
                clothing: ['simple traveler clothes', 'a worn sword belt'],
                posture: 'Sitting at a corner table',
                physical_status: ['tired', 'hungry'],
                mental_status: 'brooding',
            },
        },
        active_props: [],
    };

    const SCENE_WITH_EMPTY_CHARACTERS = {
        location: 'Empty meadow',
        time: 'Midday',
        environment: 'Bright sunlight, gentle breeze',
        characters: {},
        active_props: [],
    };

    const SCENE_WITHOUT_PROPS = {
        location: 'City street',
        time: 'Busy morning',
        characters: {
            Merchant: {
                clothing: ['fine silk robe'],
                posture: 'Walking briskly',
                physical_status: ['energetic'],
                mental_status: 'hurried',
            },
        },
        active_props: [],
    };

    const FORMATTING_CASES = [
        {
            desc: 'full scene state with 2 characters and props',
            state: FULL_SCENE_STATE,
            expectedParts: [
                '<scene_status>',
                '[Location]: Abandoned warehouse',
                '[Time]: Night, around 11 PM',
                'Dimly lit, smell of rust and oil',
                '[Alice]: Leaning against a rusty pillar. Wearing: dark leather jacket, black jeans, combat boots. Status: slightly bruised, alert.',
                '[Bob]: Sitting on a crate. Wearing: tattered hoodie, worn sneakers. Status: exhausted.',
                '[Props]: a half-empty whiskey bottle, a flickering lantern',
                '</scene_status>',
            ],
        },
        {
            desc: 'scene without environment omits environment line',
            state: SCENE_WITHOUT_ENVIRONMENT,
            expectedParts: [
                '<scene_status>',
                '[Location]: Forest clearing',
                '[Time]: Dawn',
                '[Alice]: Standing near the stream. Wearing: travel cloak, leather armor. Status: refreshed.',
                '[Props]: a fishing rod',
                '</scene_status>',
            ],
            notExpected: ['Dimly lit', 'environment'],
        },
        {
            desc: 'scene with single character',
            state: SCENE_WITH_SINGLE_CHARACTER,
            expectedParts: [
                '<scene_status>',
                '[Location]: Small tavern room',
                '[Time]: Late afternoon',
                'Warm, smell of ale and wood smoke',
                '[Hero]: Sitting at a corner table. Wearing: simple traveler clothes, a worn sword belt. Status: tired, hungry.',
                '</scene_status>',
            ],
            notExpected: ['[Props]:'],
        },
        {
            desc: 'scene with empty characters map (only location/time)',
            state: SCENE_WITH_EMPTY_CHARACTERS,
            expectedParts: [
                '<scene_status>',
                '[Location]: Empty meadow',
                '[Time]: Midday',
                'Bright sunlight, gentle breeze',
                '</scene_status>',
            ],
            notExpected: ['[Props]:', '[Alice]:', '[Bob]:'],
        },
        {
            desc: 'scene without props omits props line',
            state: SCENE_WITHOUT_PROPS,
            expectedParts: [
                '<scene_status>',
                '[Location]: City street',
                '[Time]: Busy morning',
                '[Merchant]: Walking briskly. Wearing: fine silk robe. Status: energetic.',
                '</scene_status>',
            ],
            notExpected: ['[Props]:'],
        },
    ];

    it.each(FORMATTING_CASES)('$desc', ({ state, expectedParts, notExpected }) => {
        const result = formatSceneStateForInjection(state);

        for (const part of expectedParts) {
            expect(result).toContain(part);
        }

        if (notExpected) {
            for (const part of notExpected) {
                expect(result).not.toContain(part);
            }
        }
    });

    it('returns empty string for null state', () => {
        const result = formatSceneStateForInjection(null);
        expect(result).toBe('');
    });

    it('returns empty string for undefined state', () => {
        const result = formatSceneStateForInjection(undefined);
        expect(result).toBe('');
    });

    it('returns empty string for empty object', () => {
        const result = formatSceneStateForInjection({});
        expect(result).toBe('');
    });

    it('handles character without clothing array', () => {
        const state = {
            location: 'Test location',
            time: 'Test time',
            characters: {
                Alice: {
                    clothing: [],
                    posture: 'Standing',
                    physical_status: ['okay'],
                    mental_status: 'neutral',
                },
            },
        };
        const result = formatSceneStateForInjection(state);
        expect(result).toContain('[Alice]: Standing.');
        expect(result).not.toContain('Wearing:');
    });

    it('handles character without physical_status array', () => {
        const state = {
            location: 'Test location',
            time: 'Test time',
            characters: {
                Alice: {
                    clothing: ['robe'],
                    posture: 'Standing',
                    physical_status: [],
                    mental_status: 'calm',
                },
            },
        };
        const result = formatSceneStateForInjection(state);
        expect(result).toContain('[Alice]: Standing. Wearing: robe.');
        expect(result).not.toContain('Status:');
    });

    it('handles character with missing mental_status', () => {
        const state = {
            location: 'Test location',
            time: 'Test time',
            characters: {
                Alice: {
                    clothing: ['dress'],
                    posture: 'Sitting',
                    physical_status: ['healthy'],
                },
            },
        };
        const result = formatSceneStateForInjection(state);
        expect(result).toContain('[Alice]: Sitting. Wearing: dress. Status: healthy.');
    });
});
