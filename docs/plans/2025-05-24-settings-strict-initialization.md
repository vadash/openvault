# Settings Strict Initialization Gate - Implementation Plan

**Goal:** Implement fail-fast settings initialization that removes chat-local settings shadowing, validates schema at startup, and eliminates silent `??` fallback bugs.

**Testing Conventions:** Unit tests for `initializeSettings()` and `getSettings()` using `setupTestContext()` for ST boundary mocks. No internal module mocking. Use factories for test data where applicable.

---

### Task 1: Create Settings Initialization Core

**Objective:** Add `initializeSettings()` with validation and modify `getSettings()` to throw if accessed before initialization. Remove auto-init at module load.

**Files to modify:**
- Modify: `src/settings.js` - Add initialization gate, validation, remove module-level `loadSettings()` call

**Instructions for Execution Agent:**
1. Read `src/settings.js` outline to understand current structure
2. Add `settingsInitialized` module-level flag (false by default)
3. Add `REQUIRED_SETTINGS_PATHS` constant with all 48 required dot-paths from design doc
4. Implement `initializeSettings()` function:
   - Check `settingsInitialized` flag, return early if true
   - Get deps, extensionSettings, lodash from context
   - Deep merge: `extensionSettings[extensionName] = lodash.merge(structuredClone(defaultSettings), extensionSettings[extensionName] || {})`
   - Call `validateSettingsStructure()` with the merged settings
   - Set `settingsInitialized = true`
5. Implement `validateSettingsStructure(settings)`:
   - Iterate `REQUIRED_SETTINGS_PATHS`
   - For each path, if `lodash.get(settings, path) === undefined`, throw descriptive error
6. Modify `getSettings(path, defaultValue)`:
   - Add check: if `!settingsInitialized`, throw 'Settings accessed before initialization'
   - Remove `defaultValue` parameter - always throw if path not found
   - Remove `?? defaultValue` fallback
   - Remove DEBUG console.log lines (lines 86-89)
   - If result is `undefined`, throw 'Setting "{path}" is undefined'
7. Remove line 225: `loadSettings();` auto-init at module load
8. Export `initializeSettings` and keep existing exports (`getSettings`, `setSetting`, `hasSettings`, `loadSettings` as deprecated alias)

**Commit:** `feat(settings): add strict initialization gate with validation`

---

### Task 2: Remove Chat-Local Settings Object

**Objective:** Delete the hardcoded `settings` object from `getOpenVaultData()` that shadows global settings.

**Files to modify:**
- Modify: `src/store/chat-data.js` - Remove settings object from initialization
- Modify: `src/store/chat-data.js` - Add migration to delete old settings on load

**Instructions for Execution Agent:**
1. Read `src/store/chat-data.js` outline around line 39-56
2. In `getOpenVaultData()`, delete lines 48-54 (the entire `settings: { injection: {...} }` object)
3. After getting `data` from `context.chatMetadata[METADATA_KEY]` (around line 57-58), add migration check:
   - If `data.settings` exists, log warning: 'Old chat-local settings found and ignored. Using global settings.'
   - Delete `data.settings`
4. Ensure `getOpenVaultData()` still returns `data` at the end
5. Verify no other references to `data.settings` in the file

**Commit:** `fix(chat-data): remove hardcoded settings object that shadowed globals`

---

### Task 3: Update UI Settings Initialization

**Objective:** Rename `loadSettings()` to `initSettingsUI()`, remove shallow merge logic, assume settings already initialized.

**Files to modify:**
- Modify: `src/ui/settings.js` - Rename and simplify initialization

**Instructions for Execution Agent:**
1. Read `src/ui/settings.js` outline around line 556-565
2. Rename `export async function loadSettings()` to `export async function initSettingsUI()`
3. Remove the shallow merge block (lines 561-564):
   ```javascript
   Object.assign(extension_settings[extensionName], {
       ...defaultSettings,
       ...extension_settings[extensionName],
   });
   ```
4. Keep the HTML template loading (line 567-568)
5. Keep `populateDefaultHints()`, `initTabs()`, `initBrowser()` calls
6. Update all internal calls to use `getSettings()` without default parameters
7. Search for `getSettings(` calls in this file and remove second parameter (defaultValue) where present

**Commit:** `refactor(ui): rename loadSettings to initSettingsUI, remove merge logic`

---

### Task 4: Update Main Entry Point

**Objective:** Call `initializeSettings()` before `initSettingsUI()` in index.js.

**Files to modify:**
- Modify: `index.js` - Update initialization order

**Instructions for Execution Agent:**
1. Read `index.js` outline
2. Find the import: `import { loadSettings } from './src/ui/settings.js';`
3. Add import: `import { initializeSettings } from './src/settings.js';`
4. Change import: `import { initSettingsUI } from './src/ui/settings.js';` (rename loadSettings)
5. In APP_READY handler (around line 143), change:
   - FROM: `await loadSettings();`
   - TO: `await initializeSettings(); await initSettingsUI();`
6. Ensure `initializeSettings()` is called BEFORE `initSettingsUI()`

**Commit:** `fix(index): call initializeSettings before UI init`

---

### Task 5: Remove ?? Fallbacks from getSettings Calls

**Objective:** Remove all `?? defaultValue` fallbacks from `getSettings()` calls across the codebase.

**Files to modify:**
- Modify: `src/retrieval/retrieve.js` - Lines 199-207, 282, 381, 503
- Modify: `src/extraction/extract.js` - Lines 607, 673, 1043, 1079, 1110, 1433, 1436
- Modify: `src/ui/render.js` - Lines 824-825
- Modify: `src/ui/settings.js` - Lines 873, 903, 969-970
- Modify: `src/ui/helpers.js` - Line 255
- Modify: `src/graph/graph.js` - Line 569
- Modify: `src/utils/logging.js` - Line 82

**Instructions for Execution Agent:**
1. Search for pattern `getSettings\([^)]+\)[^;]*\?\?` across src/
2. For each match, remove the `?? defaultValue` part:
   - `getSettings('injection.memory.position', defaultSettings.injection.memory.position)`
   - Becomes: `getSettings('injection.memory.position')`
3. Keep the paths exactly as they are - only remove the fallback
4. If any call uses `??` with something OTHER than a defaultSettings reference, still remove it - the new getSettings will throw if missing

**Commit:** `refactor: remove ?? fallbacks from getSettings calls`

---

### Task 6: Write Settings Initialization Tests

**Objective:** Add unit tests for `initializeSettings()` and the new `getSettings()` behavior.

**Files to create/modify:**
- Modify: `tests/settings.test.js` - Add new test cases

**Instructions for Execution Agent:**
1. Read `tests/settings.test.js` to understand existing test patterns
2. Add test: `initializeSettings() with empty extension_settings → validates with defaults`
   - Setup: `extension_settings[extensionName] = {}`
   - Call `initializeSettings()`
   - Assert: `getSettings('enabled')` returns `true` (default)
   - Assert: `getSettings('injection.world.position')` returns `1` (default)
3. Add test: `initializeSettings() twice → no-op second time`
   - Setup: Initialize once with custom value
   - Call `initializeSettings()` again with different value
   - Assert: Settings remain unchanged from first init
4. Add test: `getSettings() before init → throws`
   - Reset modules or use fresh import
   - Do NOT call `initializeSettings()`
   - Assert: `getSettings('any.path')` throws 'Settings accessed before initialization'
5. Add test: `getSettings('bogus.path') → throws`
   - Setup: Call `initializeSettings()`
   - Assert: `getSettings('this.does.not.exist')` throws 'Setting "this.does.not.exist" is undefined'
6. Add test: `initializeSettings() preserves user values over defaults`
   - Setup: `extension_settings[extensionName] = { injection: { world: { position: -2 } } }`
   - Call `initializeSettings()`
   - Assert: `getSettings('injection.world.position')` returns `-2` (not default `1`)

**Commit:** `test(settings): add initialization gate tests`

---

### Task 7: Remove Debug Logging from Previous Commits

**Objective:** Clean up the diagnostic logging added in the last 2 commits for debugging settings persistence.

**Files to modify:**
- Modify: `src/settings.js` - Remove DEBUG console.log statements from setSetting and getSettings

**Instructions for Execution Agent:**
1. Read `src/settings.js` outline
2. Find and remove all lines containing `[OpenVault DEBUG]`:
   - Line ~169: `console.log('[OpenVault DEBUG] setSetting: settings.injection exists?', ...)`
   - Line ~170: `console.log('[OpenVault DEBUG] setSetting: settings object keys:', ...)`
   - Line ~173-174: `const oldValue = ... console.log(...)` with `[OpenVault DEBUG] setSetting(${path})`
   - Line ~199: `console.log('[OpenVault DEBUG] setSetting(${path}): verified value is now ${newValue}`
   - Line ~202-203: `const viaGetSettings = ... console.log(...)`
   - Lines 86-89 in getSettings (already noted in Task 1, but verify)
3. Ensure setSetting() still works correctly after removing logs
4. Ensure no other DEBUG logs remain in the file

**Commit:** `chore(settings): remove diagnostic debug logging`

---

## Task Dependencies

```
Task 1 (Core Init) → Task 3 (UI uses new init) → Task 4 (Index wires it up)
Task 1 (Core Init) → Task 5 (Remove fallbacks)
Task 1 (Core Init) → Task 6 (Tests for new behavior)
Task 2 (Chat-data) → Task 4 (Index init order)
Task 7 (Debug logs) → Can be done anytime, but logically after Task 1
```

## Execution Order

**Recommended order for minimal thrash:**

1. Task 1: Create Settings Initialization Core
2. Task 2: Remove Chat-Local Settings Object
3. Task 3: Update UI Settings Initialization
4. Task 4: Update Main Entry Point
5. Task 5: Remove ?? Fallbacks
6. Task 7: Remove Debug Logging (or do parallel with 5)
7. Task 6: Write Tests (can be done anytime after Task 1)

**Parallelizable:**
- Task 2 can be done in parallel with Task 1 (no dependencies)
- Task 6 can be done anytime after Task 1
- Task 7 can be done anytime

## Verification Checklist

After all tasks complete:
- [ ] `npm run check` passes (lint, typecheck, tests)
- [ ] Extension loads without errors
- [ ] Settings UI shows correct values
- [ ] Changing injection position saves and persists
- [ ] Retrieval uses correct position (not always 1)
- [ ] No `[OpenVault DEBUG]` logs in console
