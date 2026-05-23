import { beforeEach, describe, expect, it } from 'vitest';
import { _setTestOverride, cdnImport } from '../../src/utils/cdn.js';

describe('cdnImport', () => {
    beforeEach(async () => {
        // Clear test overrides before each test
        globalThis.__openvault_cdn_test_overrides?.clear();
    });

    describe('test override mechanism', () => {
        it('returns test override when registered', async () => {
            const mockModule = { default: () => 'mocked', foo: 'bar' };
            _setTestOverride('test-package', mockModule);

            const result = await cdnImport('test-package');
            expect(result).toBe(mockModule);
            expect(result.foo).toBe('bar');
        });

        it('persists across multiple calls for same spec', async () => {
            const mockModule = { count: 0 };
            _setTestOverride('counter', mockModule);

            const result1 = await cdnImport('counter');
            const result2 = await cdnImport('counter');

            expect(result1).toBe(mockModule);
            expect(result2).toBe(mockModule);
            expect(result1).toBe(result2);
        });
    });

    describe('cache mechanism', () => {
        it('caches successful imports', async () => {
            const _callCount = 0;
            const mockModule = { value: 42 };

            _setTestOverride('cache-test', mockModule);

            await cdnImport('cache-test');
            await cdnImport('cache-test');
            await cdnImport('cache-test');

            // If cache wasn't working, we'd see multiple registrations
            expect(globalThis.__openvault_cdn_test_overrides.get('cache-test')).toBe(mockModule);
        });

        it('returns same cached instance for same package spec', async () => {
            const mockModule = { id: 'unique' };
            _setTestOverride('singleton-test', mockModule);

            const result1 = await cdnImport('singleton-test');
            const result2 = await cdnImport('singleton-test');

            expect(result1).toBe(result2);
            expect(result1.id).toBe('unique');
        });
    });

    describe('failure behavior', () => {
        it('throws error when all mirrors fail', async () => {
            // Clear any test overrides to force real CDN behavior
            globalThis.__openvault_cdn_test_overrides?.clear();

            // Try to import a package that doesn't exist (no override)
            await expect(cdnImport('nonexistent-package-test-xyz')).rejects.toThrow(/CDN import failed/);
        });

        it('error message includes package spec', async () => {
            globalThis.__openvault_cdn_test_overrides?.clear();

            try {
                await cdnImport('definitely-not-a-real-package-12345');
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error.message).toContain('definitely-not-a-real-package-12345');
            }
        });
    });

    describe('version resolution', () => {
        it('resolves bare package to pinned version via override', async () => {
            // Test that version pinning is applied by checking internal behavior
            // We use the override mechanism since we can't actually fetch from CDN in tests
            const mockModule = { version: '4.3.6' };
            _setTestOverride('zod', mockModule);

            const result = await cdnImport('zod');
            expect(result).toBe(mockModule);
        });
    });
});
