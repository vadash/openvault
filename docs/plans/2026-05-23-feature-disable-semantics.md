# Feature Disable Semantics Implementation Plan

**Goal:** Implement true disable semantics for World Info and Reflections: no generation + wipe existing data + clear accumulators when position is `-2`, with lazy catch-up on re-enable.
**Testing Conventions:** Unit tests for pure logic, integration tests via `setupTestContext()`. Orchestrator tests (`extract.test.js`) are locked — do not add permutations. Use factory builders from `tests/factories.js`.

---

### Task 1: Add Setting Change Side Effects Handler

**Objective:** Create `handleSettingChangeSideEffects()` in settings.js that wipes data and clears accumulators when a feature is disabled, and call it from `setSetting`.

**Files to modify/create:**
- Modify: `src/settings.js` (add `handleSettingChangeSideEffects`, update `setSetting`)
- Test: `tests/settings.test.js` (new file)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/settings.js` lines 92-120 to understand `setSetting` structure. Read `src/constants.js` lines 19-20 for `MEMORIES_KEY`. Read `src/store/chat-data.js` lines 30, 76 for `getOpenVaultData`/`saveOpenVaultData`. Read `src/ui/render.js` line 792 for `refreshAllUI`.
2. **Write Failing Test:** In `tests/settings.test.js`, test that:
   - Setting `injection.reflections.position` to `-2` wipes reflection memories and clears `reflection_state`
   - Setting `injection.world.position` to `-2` deletes `global_world_state`, clears `_edgesNeedingConsolidation`, and resets `graph_message_count` to 0
   - Non-disable values (e.g., `0`) do NOT trigger wipes
3. **Implement Minimal Code:** In `src/settings.js`:
   - Add async function `handleSettingChangeSideEffects(path, value)` that:
     - Imports `getOpenVaultData`, `saveOpenVaultData` from `./store/chat-data.js`
     - Imports `refreshAllUI` from `./ui/render.js`
     - For `injection.reflections.position === -2`: filter `data[MEMORIES_KEY]` for non-reflection types, set `data.reflection_state = {}`
     - For `injection.world.position === -2`: delete `data.global_world_state`, set `data.graph._edgesNeedingConsolidation = []`, set `data.graph_message_count = 0`
     - If changes made, call `saveOpenVaultData()` and `refreshAllUI()`
   - Call `handleSettingChangeSideEffects(path, value)` at the end of `setSetting`
4. **Verify:** Run tests and ensure they pass.
5. **Commit:** Commit with message: `feat(settings): add side effects handler to wipe data on disable`

---

### Task 2: Enforce Disabled Settings on Chat Load

**Objective:** In `onChatChanged`, enforce global disabled settings on loaded chat metadata to prevent legacy data leakage.

**Files to modify/create:**
- Modify: `src/events.js` (add enforcement block after schema migration)
- Test: Modify `tests/extraction/events.test.js` (add new test block)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/events.js` lines 248-275 (schema migration block location). Read `src/settings.js` for `getSettings` import pattern.
2. **Write Failing Test:** In `tests/extraction/events.test.js`, add a new `describe` block testing `onChatChanged` enforcement:
   - Test that loading a chat with legacy reflections while global reflections disabled wipes them
   - Test that loading a chat with legacy `global_world_state` while world disabled wipes it
   - Use `setupTestContext` to mock global settings with `injection.reflections.position = -2` and `injection.world.position = -2`
3. **Implement Minimal Code:** In `src/events.js`, after the schema migration block (around line 270), add enforcement logic:
   - Get global settings via `getDeps().getExtensionSettings()[extensionName]`
   - If `globalSettings.injection?.reflections?.position === -2`: filter `data[MEMORIES_KEY]` for non-reflection types, set `data.reflection_state = {}`
   - If `globalSettings.injection?.world?.position === -2`: delete `data.global_world_state`, set `data.graph._edgesNeedingConsolidation = []`, set `data.graph_message_count = 0`
   - If changes made, call `saveOpenVaultData()`
4. **Verify:** Run tests and ensure they pass.
5. **Commit:** Commit with message: `feat(events): enforce disabled settings on chat load`

---

### Task 3: Add Early-Exit Guard to World State Synthesis

**Objective:** Add early-exit guard at the start of `synthesizeWorldState()` to skip generation when world info is disabled.

**Files to modify/create:**
- Modify: `src/extraction/extract.js` (add guard at start of `synthesizeWorldState`)
- Test: No new test file needed — `synthesizeReflections` already has the same guard pattern (lines 603-611), and extract.test.js is locked. Guard behavior verified by integration tests.

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/extraction/extract.js` lines 600-612 to see existing guard in `synthesizeReflections`. Read lines 663-671 for `synthesizeWorldState` start.
2. **No New Test:** Skip test writing per locked orchestrator test rules. Guard is a simple early-return matching existing pattern.
3. **Implement Minimal Code:** In `src/extraction/extract.js`, at the start of `synthesizeWorldState` (after line 664 `try {`), add:
   ```javascript
   const worldPosition = getSettings('injection.world.position', defaultSettings.injection.world.position);
   if (worldPosition === -2) {
       logDebug('[Extraction] World state synthesis disabled (position=-2), skipping generation');
       return;
   }
   ```
4. **Verify:** Run `npm run typecheck` and `npm run lint` to ensure no errors.
5. **Commit:** Commit with message: `feat(extract): add early-exit guard to synthesizeWorldState`