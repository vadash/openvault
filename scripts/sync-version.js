#!/usr/bin/env node
/**
 * Sync version from package.json to manifest.json
 *
 * Usage: node scripts/sync-version.js
 */

import { readFileSync, writeFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const manifestPath = 'manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.version !== packageJson.version) {
    manifest.version = packageJson.version;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n');
    console.log(`Updated manifest.json version to ${packageJson.version}`);
} else {
    console.log(`Version already in sync: ${packageJson.version}`);
}
