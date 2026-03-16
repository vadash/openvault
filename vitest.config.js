import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['tests/**/*.test.js'],
        setupFiles: ['./tests/setup.js'],
        // Watch mode optimizations
        watch: !process.env.CI,
        watchExclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/docs/**',
            '**/.git/**',
            '**/repomix-*.md',
        ],
        // Fail fast during development (CI runs all)
        bail: process.env.CI ? 0 : 3,
        // Reporter: verbose locally, dot in CI
        reporter: process.env.CI ? 'dot' : 'verbose',
        // Thread pool for parallel execution (Vitest 4+ top-level options)
        pool: 'threads',
        maxThreads: 4,
        minThreads: 1,
        // Test timeout (generous for JSDOM + LLM mocks)
        testTimeout: 10000,
    },
    resolve: {
        alias: {
            '../../../../extensions.js': path.resolve(__dirname, 'tests/stubs/extensions.js'),
            '../../../../../extensions.js': path.resolve(__dirname, 'tests/stubs/extensions.js'),
            '../../../../../../extensions.js': path.resolve(__dirname, 'tests/stubs/extensions.js'),
            '../../../../../script.js': path.resolve(__dirname, 'tests/stubs/extensions.js'),
            '../../../../../../script.js': path.resolve(__dirname, 'tests/stubs/extensions.js'),
            '../../../shared.js': path.resolve(__dirname, 'tests/stubs/shared.js'),
        },
    },
});
