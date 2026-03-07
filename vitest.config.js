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
    },
    resolve: {
        alias: {
            // Map SillyTavern extension dependencies to test stubs
            '../../../../extensions.js': path.resolve(__dirname, 'tests/stubs/extensions.js'),
            '../../../../../extensions.js': path.resolve(__dirname, 'tests/stubs/extensions.js'),
            '../../../../../../extensions.js': path.resolve(__dirname, 'tests/stubs/extensions.js'),
            '../../../../../script.js': path.resolve(__dirname, 'tests/stubs/extensions.js'),
            '../../../../../../script.js': path.resolve(__dirname, 'tests/stubs/extensions.js'),
            '../../../shared.js': path.resolve(__dirname, 'tests/stubs/shared.js'),
            // Map https://esm.sh/zod to local zod package for tests
            'https://esm.sh/zod': path.resolve(__dirname, 'node_modules/zod'),
            // Map https://esm.sh/snowball-stemmers to local package for tests
            'https://esm.sh/snowball-stemmers': path.resolve(__dirname, 'node_modules/snowball-stemmers'),
            // Map https://esm.sh/stopword to local package for tests
            'https://esm.sh/stopword': path.resolve(__dirname, 'node_modules/stopword'),
            // Map https://esm.sh/jsonrepair to local package for tests
            'https://esm.sh/jsonrepair': path.resolve(__dirname, 'node_modules/jsonrepair'),
            // Map https://esm.sh/graphology to local package for tests
            'https://esm.sh/graphology': path.resolve(__dirname, 'node_modules/graphology'),
            'https://esm.sh/graphology-communities-louvain': path.resolve(
                __dirname,
                'node_modules/graphology-communities-louvain'
            ),
            'https://esm.sh/graphology-operators': path.resolve(__dirname, 'node_modules/graphology-operators'),
            // Map https://esm.sh/gpt-tokenizer/encoding/o200k_base to local package for tests
            'https://esm.sh/gpt-tokenizer/encoding/o200k_base': path.resolve(
                __dirname,
                'node_modules/gpt-tokenizer/esm/encoding/o200k_base.js'
            ),
        },
    },
});
