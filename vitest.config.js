import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['tests/**/*.test.js'],
    },
    resolve: {
        alias: {
            // Mock extension dependencies
            '../../../../extensions.js': path.resolve(__dirname, 'tests/__mocks__/extensions.js'),
            '../../../../../extensions.js': path.resolve(__dirname, 'tests/__mocks__/extensions.js'),
            '../../../../../script.js': path.resolve(__dirname, 'tests/__mocks__/script.js'),
            '../../../../../../script.js': path.resolve(__dirname, 'tests/__mocks__/script.js'),
            '../../../shared.js': path.resolve(__dirname, 'tests/__mocks__/shared.js'),
            // Map https://esm.sh/zod@4 to local zod package for tests
            'https://esm.sh/zod@4': path.resolve(__dirname, 'node_modules/zod'),
            // Map https://esm.sh/snowball-stemmers@0.6.0 to local package for tests
            'https://esm.sh/snowball-stemmers@0.6.0': path.resolve(__dirname, 'node_modules/snowball-stemmers'),
        },
    },
});
