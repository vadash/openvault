# Three-Stream Injection Split Implementation Plan

**Goal:** Split the current bundled memory+reflections injection into three independent streams (memory, reflections, world) with separate slots, macros, and position/depth settings.
**Testing Conventions:** Unit tests use factories (`buildMockMemory()` from `tests/factories.js`) and zero mocks for internal modules. Orchestrator tests (`retrieve.test.js`) are locked — test formatting/structural logic in dedicated test files instead. Integration tests use `setupTestContext()`. Migration tests cover fresh, already-migrated, and partial data.

---

### Task 1: Split `formatContextForInjection()` Return Type

**Objective:** Change `formatContextForInjection()` to return `{ memoryText, reflectionText }` instead of a single concatenated string, separating `<scene_memory>` and `<subconscious_drives>` into two independent outputs.

**Files to modify/create:**
- Modify: `src/retrieval/formatting.js` (Purpose: Return object with separate memory and reflection strings)
- Modify: `tests/retrieval/formatting.test.js` (Purpose: Update assertions to match new return shape)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/retrieval/formatting.js` fully — this is the core formatting change. Read `tests/retrieval/formatting.test.js` to understand existing test structure.
2. **Write Failing Test:** In `formatting.test.js`, add tests that assert `formatContextForInjection()` returns an object with `memoryText` (string) and `reflectionText` (string). Test cases:
   - When reflections exist: `memoryText` contains `<scene_memory>...</scene_memory>` only (no `<subconscious_drives>`); `reflectionText` contains `<subconscious_drives>...</subconscious_drives>` only.
   - When no reflections: `reflectionText` is empty string; `memoryText` still contains `<scene_memory>`.
   - The existing `<scene_memory>` content structure (timeline buckets, star ratings, gap separators) must be unchanged in `memoryText`.
3. **Implement Minimal Code:** In `formatting.js`, modify `formatContextForInjection()` to:
   - Build `<scene_memory>` block as `memoryText` exactly as before.
   - Build `<subconscious_drives>` block as `reflectionText` separately (was previously appended to the memory string).
   - Return `{ memoryText, reflectionText }` instead of a single string.
4. **Update Existing Tests:** Update all call sites in `formatting.test.js` that previously asserted on a single returned string — they must now destructure into `memoryText`/`reflectionText` and assert separately.
5. **Verify:** Run `npx vitest run tests/retrieval/formatting.test.js` and ensure all tests pass.
6. **Commit:** Commit with message: `feat(formatting): split formatContextForInjection into memory and reflection streams`

---

### Task 2: Update Injection Layer for 3-Stream Architecture

**Objective:** Update `injectContext()` to accept 3 separate text arguments and call `safeSetExtensionPrompt()` 3 times. Update `selectFormatAndInject()` to destructure the new `{ memoryText, reflectionText }` return and pass both to `injectContext()`.

**Depends on:** Task 1

**Files to modify/create:**
- Modify: `src/retrieval/retrieve.js` (Purpose: Update `injectContext()` signature and `selectFormatAndInject()` flow)
- Modify: `tests/retrieval/retrieve.test.js` (Purpose: Verify 3-stream injection calls — keep changes minimal per locked-test rules)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/retrieval/retrieve.js` fully. Focus on `injectContext()` and `selectFormatAndInject()`. Read `tests/retrieval/retrieve.test.js` to understand existing test structure.
2. **Write Failing Test:** In `retrieve.test.js`, add minimal test cases:
   - `injectContext()` calls `safeSetExtensionPrompt` 3 times with slots `'openvault'`, `'openvault_reflections'`, `'openvault_world'`.
   - When `reflectionText` is empty, the `'openvault_reflections'` slot is set to empty string (cleared).
   - `selectFormatAndInject()` passes both `memoryText` and `reflectionText` from `formatContextForInjection` result to `injectContext`.
3. **Implement Minimal Code:** In `retrieve.js`:
   - Change `injectContext(contextText, worldText = '')` to `injectContext(memoryText, reflectionText = '', worldText = '')`.
   - Add a third `safeSetExtensionPrompt()` call for `'openvault_reflections'` with `reflectionText`, reading position/depth from `injection.reflections` settings (use `injection.memory` settings as fallback for now — Task 3 adds the settings).
   - Update `selectFormatAndInject()` to destructure `const { memoryText, reflectionText } = formatContextForInjection(...)` and pass both to `injectContext(memoryText, reflectionText, worldText)`.
   - Update any call site that previously passed the old single-string return to use the destructured form.
4. **Update Existing Tests:** Update existing test assertions in `retrieve.test.js` that reference the old 2-argument `injectContext` or single-string `formatContextForInjection` return.
5. **Verify:** Run `npx vitest run tests/retrieval/retrieve.test.js` and ensure all tests pass.
6. **Commit:** Commit with message: `feat(injection): 3-stream injectContext with separate reflection slot`

---

### Task 3: Add Reflections Settings and Constants

**Objective:** Add `injection.reflections` to the default settings object in `src/constants.js` with `{ position: 1, depth: 4 }` defaults, matching the previous bundled behavior.

**Depends on:** Task 2

**Files to modify/create:**
- Modify: `src/constants.js` (Purpose: Add `reflections` to `defaultSettings.injection`)
- Modify: `src/retrieval/retrieve.js` (Purpose: Replace the fallback with proper `injection.reflections` settings read)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/constants.js` and find the `defaultSettings.injection` object. Read the current `injectContext` in `src/retrieval/retrieve.js` to see how memory/world position/depth are read.
2. **Write Failing Test:** No dedicated test file — the constants change is verified through the integration tests in Task 2 and the migration tests in Task 4. Verify the default value is correct by checking `defaultSettings.injection.reflections` equals `{ position: 1, depth: 4 }` in a quick assertion within `tests/retrieval/retrieve.test.js` or a constants test.
3. **Implement Minimal Code:**
   - In `src/constants.js`, add `reflections: { position: 1, depth: 4 }` to `defaultSettings.injection`.
   - In `src/retrieval/retrieve.js`, update the reflections `safeSetExtensionPrompt` call to read position/depth from `getSettings('injection.reflections.position', defaultSettings.injection.reflections.position)` and `getSettings('injection.reflections.depth', defaultSettings.injection.reflections.depth)` — matching the existing pattern for memory and world.
4. **Verify:** Run `npx vitest run tests/retrieval/` and ensure all tests pass.
5. **Commit:** Commit with message: `feat(constants): add injection.reflections default settings`

---

### Task 4: Schema Migration for Reflections Settings

**Objective:** Create a v4 migration that adds `injection.reflections` with defaults to existing chat data that lacks it.

**Depends on:** Task 3

**Files to modify/create:**
- Create: `src/store/migrations/v4.js` (Purpose: Add `injection.reflections` to existing settings)
- Modify: `src/store/migrations/index.js` (Purpose: Register v4 migration and bump `CURRENT_SCHEMA_VERSION` to 4)
- Modify: `tests/store/migrations.test.js` (Purpose: Add v4 migration test cases)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/store/migrations/v3.js` for the migration pattern. Read `src/store/migrations/index.js` for registration. Read `tests/store/migrations.test.js` for test patterns.
2. **Write Failing Test:** In `migrations.test.js`, add tests for the v4 migration:
   - Fresh data (schema_version < 4, no `injection.reflections`): After migration, `injection.reflections` equals `{ position: 1, depth: 4 }`.
   - Already-migrated data (schema_version === 4): Migration is a no-op, existing `injection.reflections` values are preserved unchanged.
   - Partial data (has `injection` but missing `reflections`): Migration adds `reflections` without touching `memory` or `world` settings.
3. **Implement Minimal Code:**
   - Create `src/store/migrations/v4.js` following the v3 pattern:
     ```
     export function migrateToV4(data, chat) {
         let changed = false;
         if (!data.settings?.injection?.reflections) {
             data.settings.injection.reflections = { position: 1, depth: 4 };
             changed = true;
         }
         return changed;
     }
     ```
   - In `index.js`: Import `migrateToV4`, add `{ version: 4, run: migrateToV4 }` to `MIGRATIONS` array, set `CURRENT_SCHEMA_VERSION = 4`.
4. **Verify:** Run `npx vitest run tests/store/migrations.test.js` and ensure all tests pass.
5. **Commit:** Commit with message: `feat(migration): v4 adds injection.reflections settings`

---

### Task 5: Reflections Macro Registration

**Objective:** Add `cachedContent.reflections` property and register the `{{openvault_reflections}}` macro in SillyTavern's macro system.

**Depends on:** Task 2

**Files to modify/create:**
- Modify: `src/injection/macros.js` (Purpose: Add `reflections` to `cachedContent` and register the macro)
- Create: `tests/injection/macros.test.js` (Purpose: Verify macro registration and cached content structure)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/injection/macros.js` fully to understand the `cachedContent` object and `initMacros()` registration pattern.
2. **Write Failing Test:** Create `tests/injection/macros.test.js`:
   - Assert `cachedContent` has 3 properties: `memory`, `reflections`, `world`.
   - Assert `initMacros()` registers a macro named `openvault_reflections` (mock the ST macro registration API via `setupTestContext` or `global` overrides).
   - Assert the `openvault_reflections` macro handler returns `cachedContent.reflections`.
3. **Implement Minimal Code:** In `macros.js`:
   - Add `reflections: ''` to `cachedContent`.
   - In `initMacros()`, register `openvault_reflections` macro following the exact pattern of `openvault_memory` and `openvault_world`.
4. **Verify:** Run `npx vitest run tests/injection/macros.test.js` and ensure all tests pass.
5. **Commit:** Commit with message: `feat(macros): add openvault_reflections macro and cachedContent property`

---

### Task 6: Wire Reflections Content Through the Pipeline

**Objective:** Update `selectFormatAndInject()` to populate `cachedContent.reflections` from the `reflectionText` output, completing the macro data flow.

**Depends on:** Task 2, Task 5

**Files to modify/create:**
- Modify: `src/retrieval/retrieve.js` (Purpose: Set `cachedContent.reflections = reflectionText` alongside existing `cachedContent.memory` and `cachedContent.world` assignments)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/retrieval/retrieve.js` — find where `cachedContent.memory` and `cachedContent.world` are assigned in `selectFormatAndInject()`.
2. **Write Failing Test:** No new test file needed — verify in `tests/retrieval/retrieve.test.js` that after `selectFormatAndInject` runs, `cachedContent.reflections` is populated with the expected string (or empty string when no reflections).
3. **Implement Minimal Code:** In `retrieve.js`, in `selectFormatAndInject()`:
   - After destructuring `{ memoryText, reflectionText }` from `formatContextForInjection()`, add `cachedContent.reflections = reflectionText`.
   - This should be placed right next to the existing `cachedContent.memory = memoryText` assignment.
4. **Verify:** Run `npx vitest run tests/retrieval/` and ensure all tests pass.
5. **Commit:** Commit with message: `feat(retrieval): wire reflections through cachedContent pipeline`

---

### Task 7: Add Framing Comment to World Context XML Block

**Objective:** Add the plain-text bracket comment inside the `<world_context>` tag as specified in the design: `[This is background knowledge about the world, its communities, and broader context the character is aware of]`.

**Depends on:** Nothing (independent)

**Files to modify/create:**
- Modify: `src/retrieval/world-context.js` (Purpose: Add framing comment after `<world_context>` opening tag)
- Modify: `tests/retrieval/world-context.test.js` (Purpose: Assert framing comment appears in output)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/retrieval/world-context.js` to find where `<world_context>` XML blocks are constructed (both the macro-intent path and local-mode path).
2. **Write Failing Test:** In `world-context.test.js`, add assertions:
   - Output text from `retrieveWorldContext()` contains the framing bracket comment `[This is background knowledge about the world, its communities, and broader context the character is aware of]` immediately after `<world_context>` opening tag.
   - Test both the macro-intent code path and the local-mode code path.
3. **Implement Minimal Code:** In `world-context.js`, add the framing comment string on the line after `<world_context>\n` in both code paths (macro intent and local mode). Use a constant for the comment string if desired, or inline it directly.
4. **Verify:** Run `npx vitest run tests/retrieval/world-context.test.js` and ensure all tests pass.
5. **Commit:** Commit with message: `feat(world-context): add framing bracket comment inside XML block`

---

### Task 8: Settings UI — Reflections Injection Position Row

**Objective:** Add a reflections injection position row to the settings panel HTML with position dropdown, depth input, and macro display, and bind the controls in `settings.js`.

**Depends on:** Task 3 (settings must exist in constants)

**Files to modify/create:**
- Modify: `templates/settings_panel.html` (Purpose: Add reflections injection position UI row)
- Modify: `src/ui/settings.js` (Purpose: Bind new reflections position/depth controls)
- Modify: `tests/ui/structure.test.js` (Purpose: Verify HTML structure of new row)

**Instructions for Execution Agent:**
1. **Context Setup:** Read the injection positions section of `templates/settings_panel.html` (search for `openvault_memory_position` and `openvault_world_position` to understand the row pattern). Read the `bindInjectionSettings()` function in `src/ui/settings.js`. Read `tests/ui/structure.test.js` for HTML structure test patterns.
2. **Write Failing Test:** In `structure.test.js`, add assertions:
   - The settings panel contains a `<select>` with `id="openvault_reflections_position"`.
   - It contains an `<input>` with `id="openvault_reflections_depth"`.
   - It contains a macro display with `{{openvault_reflections}}`.
   - The reflections row has a `<label>` containing the text "Reflections" (or similar, matching the pattern of the existing Memory and World labels).
3. **Implement Minimal Code:**
   - In `templates/settings_panel.html`, add a new injection position row between the memory and world rows (or after world — follow the design doc's stream order: Memory, Reflections, World). Copy the exact HTML structure of the memory position row but change all IDs and references from `memory` to `reflections`. Include the label "Reflections" and macro `{{openvault_reflections}}`.
   - In `src/ui/settings.js`, in `bindInjectionSettings()`, add change/input handlers for `#openvault_reflections_position` and `#openvault_reflections_depth` following the exact pattern of the memory handlers. Use `setSetting('injection.reflections.position', ...)` and `setSetting('injection.reflections.depth', ...)`.
   - In `updateInjectionUI()`, add a `'reflections'` case (or extend the existing logic) to show/hide the depth container and macro container based on the reflections position value.
4. **Verify:** Run `npx vitest run tests/ui/structure.test.js` and ensure all tests pass.
5. **Commit:** Commit with message: `feat(ui): add reflections injection position settings row`

---

### Task 9: Update `getOpenVaultData()` for New Chat Defaults

**Objective:** Ensure the `getOpenVaultData()` function (which initializes data for new chats) includes the `injection.reflections` default, completing the three-point update (defaults + migration + schema).

**Depends on:** Task 3, Task 4

**Files to modify/create:**
- Modify: `src/store/chat-data.js` (Purpose: Ensure new chats get `injection.reflections` in their initial settings)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/store/chat-data.js` — find `getOpenVaultData()` and how it initializes settings (it likely spreads `defaultSettings` or constructs settings inline).
2. **Write Failing Test:** Verify in `tests/store/chat-data.test.js` that a new data object from `getOpenVaultData()` has `settings.injection.reflections` with `{ position: 1, depth: 4 }`. Add an assertion if one doesn't already exist.
3. **Implement Minimal Code:** If `getOpenVaultData()` uses `structuredClone(defaultSettings)` or spreads defaults, no change may be needed — the new `reflections` field added in Task 3 to `defaultSettings` will be included automatically. If settings are constructed inline, add `reflections: { position: 1, depth: 4 }` to the inline object.
4. **Verify:** Run `npx vitest run tests/store/chat-data.test.js` and ensure all tests pass.
5. **Commit:** Commit with message: `feat(store): ensure new chats include injection.reflections defaults`

---

### Task 10: End-to-End Verification

**Objective:** Run the full test suite and verify all tests pass with the three-stream injection changes. Fix any regressions.

**Depends on:** All previous tasks

**Files to modify/create:**
- No new files — fix any failures discovered.

**Instructions for Execution Agent:**
1. **Run Full Suite:** Execute `npx vitest run` across the entire project.
2. **Fix Failures:** If any tests fail, read the failing test and the relevant source file, identify the root cause, and fix it. Common issues may include:
   - Tests that still expect `formatContextForInjection` to return a string (not an object).
   - Tests that expect 2 `safeSetExtensionPrompt` calls instead of 3.
   - Tests checking migration version numbers.
3. **Final Check:** Run `npm run check` to verify lint, typecheck, and all quality gates pass.
4. **Commit:** Commit with message: `test: fix regressions from three-stream injection split`
