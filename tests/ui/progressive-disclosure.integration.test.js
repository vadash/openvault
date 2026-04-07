// tests/ui/progressive-disclosure.integration.test.js
// Integration test verifying the complete progressive disclosure structure.
// This test reads the actual HTML template file to verify structure.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('Progressive Disclosure Integration', () => {
    const html = readFileSync(resolve(process.cwd(), 'templates/settings_panel.html'), 'utf-8');

    // Helper to extract tab content
    function extractTabContent(tabName) {
        const match = html.match(
            new RegExp(
                `<div class="openvault-tab-content[^"]*" data-tab="${tabName}">([\\s\\S]*?)(?=<div class="openvault-tab-content|</div>\\s*$)`,
                'i'
            )
        );
        return match ? match[1] : '';
    }

    it('has all 6 tabs', () => {
        const tabBtnMatches = html.matchAll(/<button class="openvault-tab-btn/g);
        const tabCount = [...tabBtnMatches].length;
        expect(tabCount).toBe(6);
    });

    it('Dashboard has Quick Toggles before collapsible sections', () => {
        const dashboardHtml = extractTabContent('dashboard-connections');
        const quickTogglesIndex = dashboardHtml.indexOf('Quick Toggles');
        const detailsIndex = dashboardHtml.indexOf('<details');

        expect(quickTogglesIndex).toBeGreaterThan(-1);
        expect(detailsIndex).toBeGreaterThan(-1);
        expect(quickTogglesIndex).toBeLessThan(detailsIndex);
    });

    it('Memories has browser before settings', () => {
        const memoriesHtml = extractTabContent('memory-bank');
        const searchIndex = memoriesHtml.indexOf('memory_search');
        const detailsIndex = memoriesHtml.indexOf('<details');

        expect(searchIndex).toBeGreaterThan(-1);
        expect(detailsIndex).toBeGreaterThan(-1);
        expect(searchIndex).toBeLessThan(detailsIndex);
    });

    it('Entities has no visible range inputs', () => {
        const worldHtml = extractTabContent('entities');
        // Check for range inputs that are NOT inside details elements
        const nonDetailsRanges = [];
        const lines = worldHtml.split('\n');
        let inDetails = false;

        for (const line of lines) {
            if (line.includes('<details')) {
                inDetails = true;
                continue;
            }
            if (line.includes('</details>')) {
                inDetails = false;
                continue;
            }
            if (!inDetails && line.includes('type="range"') && !line.includes('<details')) {
                nonDetailsRanges.push(line);
            }
        }

        expect(nonDetailsRanges.length).toBe(0);
    });

    it('Advanced has warning banner', () => {
        const advancedHtml = extractTabContent('advanced');
        expect(advancedHtml).toContain('Expert Tuning');
        expect(advancedHtml).toContain('openvault-warning-banner');
    });
});
