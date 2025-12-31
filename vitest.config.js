import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['tests/**/*.test.js'],
    },
    resolve: {
        alias: {
            '../../../../extensions.js': path.resolve(__dirname, 'tests/__mocks__/extensions.js'),
            '../../../../../script.js': path.resolve(__dirname, 'tests/__mocks__/script.js'),
            '../../../shared.js': path.resolve(__dirname, 'tests/__mocks__/shared.js'),
        },
    },
});
