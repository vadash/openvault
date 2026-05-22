# Stream Disable Implementation Plan

**Goal:** Add Disabled option (position `-2`) to Reflections and World position dropdowns, replacing the two scattered reflection checkboxes with unified per-stream control.
**Testing Conventions:** Unit tests use `vi.mock` for settings, no mocking internal modules. UI structure tests parse HTML via regex. Integration tests use `setupTestContext()`. Orchestrator test files (`extract.test.js`, `retrieve.test.js`) are locked — test toggle behavior in `tests/reflection/toggles.test.js` instead.

---

### Task 1: Constants & Migration

**Objective:** Add the `DISABLED` position constant and create a v5 migration that converts old checkbox settings to position `-2` and removes the deprecated keys.

**Files to modify/create:**
- Modify: `src/constants.js` (Add `DISABLED: -2` to `INJECTION_POSITIONS`, add `{ value: -2, label: 'Disabled', description: 'Skip generation and injection' }` to `POSITION_LABELS`, remove `reflectionGenerationEnabled` and `reflectionInjectionEnabled` from `defaultSettings`)
- Create: `src/store/migrations/v5.js` (Migration: if `settings.reflectionInjectionEnabled === false`, set `injection.reflections.position = -2`; always `delete` both old keys from settings)
- Modify: `src/store/migrations/index.js` (Add `migrateToV5` import, bump `CURRENT_SCHEMA_VERSION` to 5, add `{ version: 5, run: migrateToV5 }` to `MIGRATIONS` array)
- Test: `tests/store/migrations.test.js` (Add v5 migration tests)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/constants.js` lines 25–44 for `INJECTION_POSITIONS`/`POSITION_LABELS` structure, lines 110–115 for the two deprecated settings in `defaultSettings`. Read `src/store/migrations/v4.js` as a template for the v5 migration. Read `src/store/migrations/index.js` for the registration pattern. Read `tests/store/migrations.test.js` lines 103–160 for migration test patterns.
2. **Write Failing Tests:** In `tests/store/migrations.test.js`, add a `describe('v5 migration')` block with tests: (a) converts `reflectionInjectionEnabled: false` to `injection.reflections.position: -2`; (b) deletes both `reflectionGenerationEnabled` and `reflectionInjectionEnabled` keys from settings; (c) does not change `injection.reflections.position` when `reflectionInjectionEnabled` is `true`; (d) is idempotent — running twice produces the same result; (e) handles data with no settings object. Run tests to confirm they fail.
3. **Implement Minimal Code:** In `src/constants.js`, add `DISABLED: -2` to the frozen `INJECTION_POSITIONS` object and add the Disabled entry to `POSITION_LABELS` (after the Custom entry). Remove `reflectionGenerationEnabled: true` and `reflectionInjectionEnabled: true` from `defaultSettings`. Create `v5.js` following the v4 pattern — function `migrateToV5(data, _chat)` that checks `data.settings?.reflectionInjectionEnabled`, sets position to -2 if false, deletes both old keys, returns `true` if changes were made. Update `index.js` to register v5 and bump version.
4. **Verify:** Run `npx vitest run tests/store/migrations.test.js` and confirm all tests pass.
5. **Commit:** `feat(constants): add DISABLED position and v5 migration to replace reflection toggles`

---

### Task 2: Store Utility — deleteMemoriesByType

**Objective:** Add a repository method to delete all memories of a given type (used by the reflection nuke on disable).

**Files to modify/create:**
- Modify: `src/store/chat-data.js` (Add `deleteMemoriesByType(type)` function that filters out all memories matching `type`, returns count deleted, calls `saveOpenVaultData()`)
- Test: `tests/store/chat-data.test.js` (Add tests for the new function)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/store/chat-data.js` — focus on the existing `deleteMemory(id)` function (around line 156) for the save/deps pattern. Read `tests/store/chat-data.test.js` for test setup patterns (especially `beforeEach` with `setupTestContext` and `saveChatConditional`).
2. **Write Failing Tests:** In `tests/store/chat-data.test.js`, add a `describe('deleteMemoriesByType')` block with tests: (a) deletes only memories of the specified type; (b) preserves memories of other types; (c) preserves `reflection_state` accumulators; (d) returns count of deleted memories; (e) returns 0 when no memories of that type exist; (f) handles empty memories array. Run tests to confirm they fail.
3. **Implement Minimal Code:** In `src/store/chat-data.js`, add `deleteMemoriesByType(type)` that gets `data` via `getOpenVaultData()`, filters `data.memories` to exclude `m.type === type`, counts removed, calls `saveOpenVaultData()`, returns count. Follow the same `saveChatConditional` pattern as `deleteMemory()`.
4. **Verify:** Run `npx vitest run tests/store/chat-data.test.js` and confirm all tests pass.
5. **Commit:** `feat(store): add deleteMemoriesByType for reflection nuke on disable`

---

### Task 3: Pipeline Gates — Extraction & Retrieval

**Objective:** Replace `reflectionGenerationEnabled` and `reflectionInjectionEnabled` checks with position-based `-2` checks in the extraction and retrieval pipelines. Add world disable check.

**Files to modify/create:**
- Modify: `src/extraction/extract.js` (Replace `getSettings('reflectionGenerationEnabled', true)` in `synthesizeReflections()` with `getSettings('injection.reflections.position', defaultSettings.injection.reflections.position) === -2`)
- Modify: `src/retrieval/retrieve.js` (Replace two `getSettings('reflectionInjectionEnabled', true)` checks with `getSettings('injection.reflections.position', defaultSettings.injection.reflections.position) === -2`; add world disable check: `getSettings('injection.world.position', defaultSettings.injection.world.position) === -2` — skip world context retrieval when true)
- Modify: `tests/reflection/toggles.test.js` (Rewrite entirely: replace checkbox-based tests with position-based tests)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/extraction/extract.js` line 591 for the current `reflectionGenerationEnabled` guard. Read `src/retrieval/retrieve.js` lines 368–369 and 485–486 for the two `reflectionInjectionEnabled` checks, and the world context retrieval block (search for `retrieveWorldContext` call) for where to add the world disable guard. Read the full `tests/reflection/toggles.test.js` to understand the current test structure.
2. **Write Failing Tests:** Rewrite `tests/reflection/toggles.test.js` completely. Remove all checkbox-based tests. Replace with position-based tests: (a) `synthesizeReflections` skips when `injection.reflections.position === -2`; (b) `synthesizeReflections` proceeds when position is any other value (0, 1, -1); (c) `retrieveAndInjectContext` excludes reflections when `injection.reflections.position === -2`; (d) `retrieveAndInjectContext` excludes world when `injection.world.position === -2`; (e) integration: reflections excluded + world excluded simultaneously works. Use `vi.hoisted` + `_mockSettingsValues` pattern from the existing file to override `getSettings` return values for the `injection.reflections.position` and `injection.world.position` paths.
3. **Implement Minimal Code:** In `src/extraction/extract.js`, replace the `reflectionGenerationEnabled` guard in `synthesizeReflections()` with a check against `getSettings('injection.reflections.position', defaultSettings.injection.reflections.position) === -2`. Import `defaultSettings` if not already imported. In `src/retrieval/retrieve.js`, replace both `reflectionInjectionEnabled` checks with the same position-based check. Add a `worldDisabled` boolean using `getSettings('injection.world.position', ...)` and gate the world context retrieval block with it.
4. **Verify:** Run `npx vitest run tests/reflection/toggles.test.js` and confirm all tests pass. Also run `npx vitest run tests/store/migrations.test.js` to confirm no regressions.
5. **Commit:** `feat(pipeline): replace checkbox toggles with position-based stream disable`

---

### Task 4: UI — HTML, Bindings & Popup

**Objective:** Remove both reflection checkboxes from the UI, add Disabled option to Reflections and World dropdowns, wire the confirmation popup for reflections disable.

**Files to modify/create:**
- Modify: `templates/settings_panel.html` (Remove "Reflection Engine" `<details>` section from Advanced tab; remove "Inject reflections into context" checkbox from Memories tab; add `<option value="-2">Disabled</option>` to reflections and world position `<select>` elements, after the Custom option)
- Modify: `src/ui/settings.js` (Remove `bindSetting('reflection_generation', 'reflectionGenerationEnabled', 'bool')` and `bindSetting('reflection_injection', 'reflectionInjectionEnabled', 'bool')` from `bindUIElements()`. Remove `$('#openvault_reflection_generation')` and `$('#openvault_reflection_injection')` prop assignments from `updateUI()`. Add confirmation popup handler in the reflections position dropdown change handler: when value is `-2`, revert dropdown, show confirmation, on confirm call `deleteMemoriesByType('reflection')` from chat-data and set position to `-2`. Update `updateInjectionUI` to hide depth and macro containers when position is `-2`.)
- Modify: `tests/ui/structure.test.js` (Update: verify Disabled option exists in reflections and world dropdowns, verify it does NOT exist in memory dropdown, verify reflection_generation and reflection_injection checkboxes are removed)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `templates/settings_panel.html` lines 670–680 for the "Reflection Engine" section in Advanced, lines 420–427 for the injection checkbox in Memories, lines 605–632 and 634–661 for the reflections and world dropdown structures. Read `src/ui/settings.js` lines 775–778 for the checkbox bindings, lines 1036–1037 for the updateUI prop assignments, lines 847–900 for the injection settings binding pattern and `updateInjectionUI`. Read `tests/ui/structure.test.js` lines 198–204 for existing dropdown structure test patterns.
2. **Write Failing Tests:** In `tests/ui/structure.test.js`, update the injection section tests: (a) verify reflections dropdown contains `<option value="-2">Disabled</option>`; (b) verify world dropdown contains `<option value="-2">Disabled</option>`; (c) verify memory dropdown does NOT contain `value="-2"`; (d) verify `id="openvault_reflection_generation"` does not exist in HTML; (e) verify `id="openvault_reflection_injection"` does not exist in HTML. Run tests to confirm they fail.
3. **Implement Minimal Code:** In `templates/settings_panel.html`: (a) Delete the entire `<details>` block with `summary` "Reflection Engine" from the Advanced tab (lines ~670–680); (b) Delete the `<div>` containing the "Inject reflections into context" checkbox (lines ~421–427); (c) Add `<option value="-2">Disabled</option>` after the Custom option in both reflections and world `<select>` elements. In `src/ui/settings.js`: (a) Remove the two `bindSetting()` calls for reflection checkboxes; (b) Remove the two `$('#openvault_reflection_...').prop('checked', ...)` lines from updateUI; (c) In the reflections position change handler, add a guard: if `parseInt($(this).val()) === -2`, revert to previous value, show popup via SillyTavern's popup utility (check `getDeps()` for available popup methods — if none, use `window.confirm` as a fallback), on confirm call the imported `deleteMemoriesByType('reflection')` from `src/store/chat-data.js` and set the position; (d) Update `updateInjectionUI` to treat position `-2` like positions 0–3 (hide depth and macro containers).
4. **Verify:** Run `npx vitest run tests/ui/structure.test.js` and confirm all tests pass. Run `npx vitest run` to confirm no regressions across the full suite.
5. **Commit:** `feat(ui): replace reflection checkboxes with Disabled dropdown option and confirmation popup`
