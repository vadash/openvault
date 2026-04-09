/**
 * CDN Import with Retry + Mirror Fallback
 *
 * Tries multiple ESM CDNs in sequence: esm.sh → skypack → esm.run → unpkg.
 * Retries the full mirror cycle up to MAX_ROUNDS times before giving up.
 * Uses an application-level cache so the same package spec is never fetched twice.
 *
 * This handles transient network failures (ERR_CONNECTION_RESET) by automatically
 * falling back to alternative CDNs. If all public CDNs fail, consider adding a
 * self-hosted vendor copy as the final fallback.
 *
 * Mirror list for CDN fallback.
 * Ordered by preference: fastest/most reliable first.
 *
 * - esm.sh: Primary, fast, supports pinning via @version syntax
 * - skypack: ESM-first CDN, reliable fallback
 * - esm.run: jsDelivr's ESM wrapper, good global coverage
 * - unpkg: Raw files as final public fallback
 *
 * To add a self-hosted fallback (e.g., for critical packages):
 * 1. Create a /public/vendor/ directory
 * 2. Download the module: cp node_modules/package/dist/index.mjs public/vendor/package.mjs
 * 3. Add mirror: (pkg) => pkg === 'package-name' ? '/vendor/package.mjs' : null
 * 4. Filter out nulls in the import loop
 */

// @ts-check

/** @typedef {(pkg: string) => string | null} CdnMirrorFn */

/**
 * Pinned CDN package versions.
 * Keeps browser runtime imports in sync with package.json versions.
 * When updating package.json, update this map too.
 *
 * @type {Record<string, string>}
 */
const CDN_VERSIONS = Object.freeze({
    '@huggingface/transformers': '4.0.1',
    graphology: '0.26.0',
    'graphology-communities-louvain': '2.0.2',
    'graphology-operators': '1.6.1',
    zod: '4.3.6',
    'cyrillic-to-translit-js': '3.2.1',
    'p-queue': '8.0.0',
    stopword: '3.1.5',
    'snowball-stemmers': '0.6.0',
    jsonrepair: '3.13.2',
    'gpt-tokenizer': '3.4.0',
});

/**
 * Resolve a bare package spec to a pinned spec (e.g. 'zod' → 'zod@4.3.6').
 * Sub-path imports (e.g. 'gpt-tokenizer/encoding/o200k_base') pin the base package.
 * @param {string} packageSpec
 * @returns {string}
 */
function resolveVersion(packageSpec) {
    const base = packageSpec.split('/')[0];
    const version = CDN_VERSIONS[base];
    if (!version) return packageSpec;
    return packageSpec === base ? `${base}@${version}` : `${base}@${version}/${packageSpec.slice(base.length + 1)}`;
}

/** @type {CdnMirrorFn[]} */
const MIRRORS = [
    (pkg) => `https://esm.sh/${pkg}`,
    (pkg) => `https://cdn.skypack.dev/${pkg}`,
    (pkg) => `https://esm.run/${pkg}`,
    (pkg) => `https://unpkg.com/${pkg}?module`, // ?module forces ESM mode
];

/** Full mirror cycle repeated this many times before giving up. */
const MAX_ROUNDS = 2;

/** @type {Map<string, object>} Package spec → resolved module */
const cache = new Map();

/**
 * Test-only override map. Stored on globalThis to survive vi.resetModules().
 * @type {() => Map<string, object>}
 */
const getTestOverrides = () => {
    if (!globalThis.__openvault_cdn_test_overrides) {
        globalThis.__openvault_cdn_test_overrides = new Map();
    }
    return globalThis.__openvault_cdn_test_overrides;
};

/**
 * Register a local module for a package spec (test-only).
 * Must be called from vitest setupFiles BEFORE source modules are imported.
 * @param {string} packageSpec
 * @param {object} mod - The module namespace object
 * @returns {void}
 */
export function _setTestOverride(packageSpec, mod) {
    getTestOverrides().set(packageSpec, mod);
}

/**
 * Import an npm package from CDN with retry and mirror fallback.
 *
 * @param {string} packageSpec - Package specifier (e.g. 'zod', 'gpt-tokenizer/encoding/o200k_base')
 * @returns {Promise<object>} The resolved ES module namespace
 * @throws {Error} If all mirrors and retries are exhausted
 */
export async function cdnImport(packageSpec) {
    // Test override — instant, no network
    const testOverrides = getTestOverrides();
    if (testOverrides.has(packageSpec)) return testOverrides.get(packageSpec);

    // Application-level cache — same package spec never fetched twice
    if (cache.has(packageSpec)) return cache.get(packageSpec);

    // Resolve pinned version for CDN URL, but cache/test-lookup uses bare spec
    const pinnedSpec = resolveVersion(packageSpec);

    let lastError;

    for (let round = 0; round < MAX_ROUNDS; round++) {
        for (const mirror of MIRRORS) {
            const url = mirror(pinnedSpec);
            try {
                const mod = await import(/* webpackIgnore: true */ url);
                cache.set(packageSpec, mod);
                return mod;
            } catch (err) {
                lastError = err;
                console.warn(`[OpenVault CDN] ${url} failed (round ${round + 1}/${MAX_ROUNDS}): ${err.message}`);
            }
        }
    }

    throw new Error(
        `CDN import failed for "${packageSpec}" after ${MAX_ROUNDS} rounds ` +
            `across ${MIRRORS.length} mirrors: ${lastError?.message}`
    );
}
