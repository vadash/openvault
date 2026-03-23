import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('Dashboard Tab Structure', () => {
    const html = readFileSync(resolve(process.cwd(), 'templates/settings_panel.html'), 'utf-8');

    // Extract dashboard tab content
    const dashboardMatch = html.match(
        /<div class="openvault-tab-content[^"]*" data-tab="dashboard-connections">([\s\S]*?)<div class="openvault-tab-content"/i
    );
    const dashboardHtml = dashboardMatch ? dashboardMatch[1] : html;

    it('has Quick Toggles before Connection Settings', () => {
        const quickTogglesIndex = dashboardHtml.indexOf('Quick Toggles');
        const connectionSettingsIndex = dashboardHtml.indexOf('Connection Settings');

        expect(quickTogglesIndex).toBeGreaterThan(-1);
        expect(connectionSettingsIndex).toBeGreaterThan(-1);
        expect(quickTogglesIndex).toBeLessThan(connectionSettingsIndex);
    });

    it('has Status Card visible (not in details)', () => {
        const statusCardMatch = dashboardHtml.match(/openvault-status-card/);
        expect(statusCardMatch).toBeTruthy();

        // Status card should not be inside a details element
        const beforeStatus = dashboardHtml.split('openvault-status-card')[0];
        const detailsOpenCount = (beforeStatus.match(/<details/g) || []).length;
        const detailsCloseCount = (beforeStatus.match(/<\/details>/g) || []).length;
        expect(detailsOpenCount).toBe(detailsCloseCount);
    });

    it('has API Limits section in dashboard', () => {
        expect(dashboardHtml).toContain('API Limits');
        expect(dashboardHtml).toContain('Cloud API Concurrency');
        expect(dashboardHtml).toContain('Backfill RPM');
    });

    it('has collapsible details for Connection Settings', () => {
        expect(dashboardHtml).toContain('<details');
        expect(dashboardHtml).toContain('Connection Settings');
    });

    it('has Emergency Cut button in Extraction Progress card', () => {
        const progressMatch = dashboardHtml.match(
            /Extraction Progress[\s\S]*?<div class="openvault-button-row[^"]*">([\s\S]*?)<\/div>\s*<\/div>/
        );
        expect(progressMatch).toBeTruthy();

        const buttonHtml = progressMatch[1];

        // Emergency Cut button exists
        expect(buttonHtml).toContain('id="openvault_emergency_cut_btn"');
        expect(buttonHtml).toContain('fa-scissors');
        expect(buttonHtml).toContain('Emergency Cut');

        // Has danger styling
        expect(buttonHtml).toContain('danger');

        // Has tooltip explaining purpose
        expect(buttonHtml).toContain('title=');
        expect(buttonHtml).toContain('repetition');
    });

    it('has Emergency Cut modal at correct location', () => {
        // Modal should exist in the HTML
        expect(html).toContain('id="openvault_emergency_cut_modal"');
        expect(html).toContain('openvault-modal-content');
        expect(html).toContain('id="openvault_emergency_cancel"');
    });
});
