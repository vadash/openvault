import { migrateToV2 } from './v2.js';
import { migrateToV3 } from './v3.js';
import { migrateToV4 } from './v4.js';
import { migrateToV5 } from './v5.js';
import { migrateToV6 } from './v6.js';

export const CURRENT_SCHEMA_VERSION = 6;

const MIGRATIONS = [
    { version: 2, run: migrateToV2 },
    { version: 3, run: migrateToV3 },
    { version: 4, run: migrateToV4 },
    { version: 5, run: migrateToV5 },
    { version: 6, run: migrateToV6 },
];

/**
 * Run required schema migrations on OpenVault data.
 * @param {Object} data - OpenVault data object (mutated in place)
 * @param {Array} chat - Chat messages array (for fingerprint migration)
 * @returns {boolean} True if any migration was applied
 */
export function runSchemaMigrations(data, chat) {
    const currentVersion = data.schema_version || 1;

    // No migration needed
    if (currentVersion >= CURRENT_SCHEMA_VERSION) {
        return false;
    }

    let migrated = false;
    for (const migration of MIGRATIONS) {
        if (currentVersion < migration.version) {
            if (migration.run(data, chat)) {
                migrated = true;
            }
            data.schema_version = migration.version;
        }
    }

    return migrated;
}
