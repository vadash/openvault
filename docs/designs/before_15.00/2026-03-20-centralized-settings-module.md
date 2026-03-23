# Centralized Settings Module Design

**Date:** 2026-03-20
**Status:** Proposed
**Author:** Claude Code

## Overview

Create a centralized settings module in `src/settings.js` to consolidate scattered settings access patterns and provide a consistent API using `lodash.get` and `lodash.set`.

## Current State Problems

### Inconsistent Access Patterns

| Pattern | Locations | Example |
|---------|-----------|---------|
| `getSettings()` | settings.js only | Local helper function |
| `getDeps().getExtensionSettings()[extensionName]` | 20+ places | Most modules |
| `deps.getExtensionSettings()[extensionName]` | 5+ places | Modules with deps param |
| `extension_settings[extensionName]` | 3 places | Direct global access |

### Specific Issues

1. **No nested path support** - Getting `injection.memory.position` requires verbose optional chaining:
   ```javascript
   const position = settings?.injection?.memory?.position ?? 1;
   ```

2. **Manual parsing in saveSetting** - Recent fix added manual dot-notation parsing that could miss edge cases:
   ```javascript
   function saveSetting(key, value) {
       // Manual split/traverse logic...
   }
   ```

3. **Direct mutation bypasses helper** - `handleResetSettings()` directly modifies:
   ```javascript
   extension_settings[extensionName][key] = defaultSettings[key];
   ```

4. **Lodash underutilized** - `lodash.merge` is used for initialization, but `lodash.get/set` not used for access

## Proposed Solution

### New API

```javascript
// src/settings.js - Public exports
export function getSettings(path?, defaultValue?) → value
export function setSetting(path, value) → void
export function hasSettings(path) → boolean
export function loadSettings() → void  // Existing
```

### Usage Examples

```javascript
import { getSettings, setSetting, hasSettings } from '../settings.js';

// Get entire settings object
const settings = getSettings();

// Get nested value with default
const position = getSettings('injection.memory.position', 1);
const enabled = getSettings('enabled', true);

// Set nested value
setSetting('injection.memory.position', 0);
setSetting('debugMode', true);

// Check if path exists
if (hasSettings('injection.memory')) {
    // Safe to access injection.memory
}
```

### Implementation

```javascript
import { getDeps } from './deps.js';
import { defaultSettings, extensionName } from './constants.js';

/**
 * Get settings object or nested value using lodash.get
 * @param {string} [path] - Optional lodash path (dot notation)
 * @param {*} [defaultValue] - Default value if path not found
 * @returns {Settings|*} Settings object or value at path
 */
export function getSettings(path, defaultValue) {
    const { getContext } = getDeps();
    const lodash = getContext()?.lodash;
    const settings = getContext().getExtensionSettings()[extensionName];

    if (path === undefined) {
        return settings;
    }

    return lodash?.get(settings, path, defaultValue) ?? defaultValue;
}

/**
 * Set settings value using lodash.set
 * @param {string} path - Lodash path (dot notation)
 * @param {*} value - Value to set
 */
export function setSetting(path, value) {
    const { getContext, saveSettingsDebounced } = getDeps();
    const lodash = getContext()?.lodash;
    const settings = getContext().getExtensionSettings()[extensionName];

    if (lodash?.set) {
        lodash.set(settings, path, value);
    } else {
        // Fallback for older ST versions without lodash.set
        setByPath(settings, path, value);
    }

    saveSettingsDebounced();
}

/**
 * Check if path exists in settings
 * @param {string} path - Lodash path (dot notation)
 * @returns {boolean}
 */
export function hasSettings(path) {
    const { getContext } = getDeps();
    const lodash = getContext()?.lodash;
    const settings = getContext().getExtensionSettings()[extensionName];

    return lodash?.has(settings, path) ?? false;
}

/**
 * Fallback path setter when lodash.set is unavailable
 * @private
 */
function setByPath(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current)) {
            current[part] = {};
        }
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
}
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  src/settings.js                    │
│                 (Centralized Module)                │
├─────────────────────────────────────────────────────┤
│  getSettings(path?, defaultValue?) → value         │
│  setSetting(path, value)                            │
│  hasSettings(path) → boolean                        │
│  loadSettings() → void                              │
└─────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
    ┌─────────┐   ┌──────────┐   ┌─────────────┐
    │ lodash  │   │ getDeps()│   │ default     │
    │ .get    │   │          │   │ Settings    │
    │ .set    │   │          │   │             │
    │ .has    │   │          │   │             │
    └─────────┘   └──────────┘   └─────────────┘
```

## Migration Plan

### Phase 1: Add New Module (No Breaking Changes)

- [ ] Add `getSettings(path, defaultValue)` export
- [ ] Add `setSetting(path, value)` export
- [ ] Add `hasSettings(path)` export
- [ ] Add `setByPath()` fallback helper
- [ ] Keep existing internal `getSettings()` for backward compatibility

### Phase 2: Migrate settings.js

- [ ] Replace internal `getSettings()` with new export
- [ ] Replace internal `saveSetting()` with `setSetting()`
- [ ] Update `bindInjectionSettings()` to use new API
- [ ] Update `handleResetSettings()` to use `setSetting()`
- [ ] Update all 30+ `saveSetting()` calls in same file

### Phase 3: Migrate Other Modules

Incremental migration, one file at a time:

| File | Current Pattern | New Pattern |
|------|-----------------|-------------|
| `src/retrieval/scoring.js` | `getDeps().getExtensionSettings()[extensionName]` | `getSettings()` |
| `src/embeddings.js` | `getDeps().getExtensionSettings()[extensionName]` | `getSettings()` |
| `src/events.js` | `deps.getExtensionSettings()[extensionName]` | `getSettings()` |
| `src/graph/communities.js` | `deps.getExtensionSettings()?.[extensionName]` | `getSettings()` |

- [ ] Create tracking issue or TODO list
- [ ] Migrate 2-3 files per PR
- [ ] Run tests after each batch

### Phase 4: Cleanup

- [ ] Remove `setByPath()` fallback (once lodash.set confirmed available)
- [ ] Update documentation
- [ ] Search for any remaining direct `extension_settings` access

## Edge Cases

| Case | Behavior | Implementation |
|------|----------|----------------|
| Missing lodash | Fallback to manual parsing | `setByPath()` helper |
| Undefined path | Returns entire settings object | `if (path === undefined)` check |
| Missing nested path | Returns defaultValue | `lodash.get(obj, path, defaultValue)` |
| Missing intermediate object | Created automatically | `lodash.set` creates parents |
| Null/undefined settings | Returns defaultValue | `?? defaultValue` coalescing |

## Testing Strategy

```javascript
describe('settings module', () => {
    describe('getSettings', () => {
        it('should return entire object when no path provided')
        it('should get nested values with dot notation')
        it('should return default value for missing paths')
        it('should handle deep nesting (3+ levels)')
        it('should work with array notation (injection.memory[0])')
    })

    describe('setSetting', () => {
        it('should set nested values with dot notation')
        it('should create intermediate objects')
        it('should call saveSettingsDebounced')
        it('should overwrite existing values')
        it('should work with array notation')
    })

    describe('hasSettings', () => {
        it('should return true for existing paths')
        it('should return false for missing paths')
        it('should work with nested paths')
    })

    describe('fallback (no lodash)', () => {
        it('setByPath should work without lodash')
        it('should create intermediate objects manually')
    })
})
```

## Benefits

1. **Consistency** - One pattern for all settings access
2. **Safety** - lodash.get handles undefined paths gracefully
3. **Less code** - `getSettings('injection.memory.position', 1)` vs optional chaining
4. **Testability** - Single module to mock for tests
5. **Maintainability** - Settings logic in one place

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Lodash.set not available in old ST versions | Fallback to manual parsing |
| Large migration surface | Incremental migration, no rush |
| Breaking existing code | Additive changes first, migrate incrementally |
| Performance regression | Lodash.get/set are O(n) same as manual |

## References

- Lodash docs: https://lodash.com/docs/4.17.15#get
- Current settings implementation: `src/settings.js`, `src/ui/settings.js`
- Injection positioning fix: commit `7560d4e`
