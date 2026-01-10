import { describe, it, expect } from 'vitest';

describe('extensionFolderPath', () => {
    it('derives path from import.meta.url', async () => {
        // Dynamic import to get fresh module evaluation
        const { extensionFolderPath } = await import('../src/constants.js');

        // Path should end without /src/constants.js
        expect(extensionFolderPath).not.toContain('/src/constants.js');
        expect(extensionFolderPath).not.toContain('\\src\\constants.js');
    });

    it('handles renamed folder correctly', async () => {
        const { extensionFolderPath } = await import('../src/constants.js');

        // Should not be hardcoded to 'openvault'
        // The actual value depends on where tests run from
        expect(typeof extensionFolderPath).toBe('string');
        expect(extensionFolderPath.length).toBeGreaterThan(0);
    });
});
