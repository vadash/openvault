// tests/ui/scene-settings.test.js

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('Scene Position UI structure', () => {
    const html = readFileSync(resolve(process.cwd(), 'templates/settings_panel.html'), 'utf-8');

    describe('Scene Position dropdown', () => {
        it('has scene position dropdown with correct id', () => {
            expect(html).toContain('id="openvault_scene_position"');
        });

        it('has scene depth input with correct id', () => {
            expect(html).toContain('id="openvault_scene_depth"');
        });

        it('has scene depth container for conditional visibility', () => {
            expect(html).toContain('id="openvault_scene_depth_container"');
        });

        it('has scene macro container for custom position', () => {
            expect(html).toContain('id="openvault_scene_macro_container"');
        });

        it('has scene copy macro button', () => {
            expect(html).toContain('id="openvault_copy_scene_macro"');
        });

        it('has scene macro display with correct macro text', () => {
            expect(html).toContain('{{openvault_scene}}');
        });

        it('scene dropdown has only the three effective options', () => {
            const sceneMatch = html.match(/<select id="openvault_scene_position"[^>]*>([\s\S]*?)<\/select>/i);
            expect(sceneMatch).toBeTruthy();
            const sceneOptions = sceneMatch[1];

            // Scene position only supports 3 options:
            // - In-chat (position 4) - leverages recency bias, most effective
            // - Custom (-1) - macro-only for advanced users
            // - Disabled (-2) - turns off extraction and injection
            // Positions 0-3 are intentionally excluded to prevent suboptimal configurations
            expect(sceneOptions).not.toContain('value="0"');
            expect(sceneOptions).not.toContain('value="1"');
            expect(sceneOptions).not.toContain('value="2"');
            expect(sceneOptions).not.toContain('value="3"');
            expect(sceneOptions).toContain('value="4"'); // In-chat
            expect(sceneOptions).toContain('value="-1"'); // Custom
            expect(sceneOptions).toContain('value="-2"'); // Disabled
        });

        it('scene dropdown has In-chat option as default (position 4)', () => {
            const sceneMatch = html.match(/<select id="openvault_scene_position"[^>]*>([\s\S]*?)<\/select>/i);
            expect(sceneMatch).toBeTruthy();
            const sceneOptions = sceneMatch[1];

            // Position 4 should be selected by default for scene
            expect(sceneOptions).toContain('value="4" selected');
        });
    });

    describe('Scene Position appears after World Position', () => {
        it('scene position section comes after world position section', () => {
            const worldIndex = html.indexOf('id="openvault_world_position"');
            const sceneIndex = html.indexOf('id="openvault_scene_position"');

            expect(worldIndex).toBeGreaterThan(-1);
            expect(sceneIndex).toBeGreaterThan(-1);
            expect(sceneIndex).toBeGreaterThan(worldIndex);
        });
    });

    describe('Scene State Interval slider', () => {
        it('has scene state interval slider with correct id', () => {
            expect(html).toContain('id="openvault_scene_state_interval"');
        });

        it('has scene state interval value span', () => {
            expect(html).toContain('id="openvault_scene_state_interval_value"');
        });

        it('has scene state interval default hint', () => {
            expect(html).toContain('data-default-key="sceneStateInterval"');
        });

        it('slider has correct range (min 2, max 10, step 1)', () => {
            const sliderMatch = html.match(/<input[^>]*id="openvault_scene_state_interval"[^>]*>/i);
            expect(sliderMatch).toBeTruthy();
            const sliderHtml = sliderMatch[0];

            expect(sliderHtml).toContain('min="2"');
            expect(sliderHtml).toContain('max="10"');
            expect(sliderHtml).toContain('step="1"');
        });

        it('slider has default value of 3', () => {
            const sliderMatch = html.match(/<input[^>]*id="openvault_scene_state_interval"[^>]*>/i);
            expect(sliderMatch).toBeTruthy();
            const sliderHtml = sliderMatch[0];

            expect(sliderHtml).toContain('value="3"');
        });

        it('has descriptive hint for scene state interval', () => {
            const sliderIndex = html.indexOf('id="openvault_scene_state_interval"');
            // Check that hint appears after slider
            const hintIndex = html.indexOf('scene state', sliderIndex);
            expect(hintIndex).toBeGreaterThan(sliderIndex);
        });
    });
});
