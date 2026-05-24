# Scene State v6 Implementation Plan

**Goal:** Add a Scene State subsystem that periodically extracts physical scene continuity (location, time, clothing, posture, props) and injects it as a dense XML block into the prompt, eliminating hallucinated clothing/teleportation issues during extended roleplay.
**Testing Conventions:** Unit tests use direct object passing with zero `vi.mock()`. Use `it.each()` for parameterized tests with `[desc, input, expected]` tuples. Integration tests use `setupTestContext()`. Tests mirror `src/` structure under `tests/{module}/`. Use factories from `tests/factories.js` for complex objects. Locked orchestrator tests (`extract.test.js`, `retrieve.test.js`) get at most 3-5 permutations.

---

### Task 1: Zod Schema and Data Layer

**Objective:** Define the scene state Zod schemas, add default fields to `getOpenVaultData()`, create the v8 migration, and register new settings paths.

**Depends on:** Nothing (foundation layer).

**Files to modify/create:**
- Modify: `src/store/schemas.js` (Purpose: Add `SceneStateSchema`, `SceneCharacterSchema`, `SceneLedgerEntrySchema`, include them in `getSchemas()` export)
- Modify: `src/store/chat-data.js` (Purpose: Add `scene_states: {}`, `scene_ledger: []`, `scene_counter: 0` to default fields in `getOpenVaultData()`)
- Create: `src/store/migrations/v8.js` (Purpose: Backfill new fields on existing chats — set `scene_states` to `{}`, `scene_ledger` to `[]`, `scene_counter` to `0`)
- Modify: `src/store/migrations/index.js` (Purpose: Register v8 migration, bump `CURRENT_SCHEMA_VERSION` to 8)
- Modify: `src/constants.js` (Purpose: Add `sceneStateInterval: 3` to `defaultSettings`, add `scene: { position: 4 }` to `injection` defaults — depth is hardcoded, not user-configurable)
- Modify: `src/settings.js` (Purpose: Add `'injection.scene.position'` and `'sceneStateInterval'` to `REQUIRED_SETTINGS_PATHS` — NO depth path)
- Modify: `include/DATA_SCHEMA.md` (Purpose: Document `scene_states`, `scene_ledger`, `scene_counter` schemas)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/store/schemas.js` to understand existing schema patterns (e.g., `MemorySchema`, `GlobalWorldStateSchema`). Read `src/store/chat-data.js` for `getOpenVaultData()` defaults. Read `src/store/migrations/v7.js` and `src/store/migrations/index.js` for migration registration pattern. Read `src/constants.js` for `defaultSettings` structure. Read `src/settings.js` for `REQUIRED_SETTINGS_PATHS` array.
2. **Write Failing Tests:** Create `tests/store/schemas-scene.test.js`. Test that `SceneStateSchema` validates a full scene state object with `location`, `time`, `environment`, `characters` (map of `SceneCharacterSchema` with `clothing`, `posture`, `physical_status`, `mental_status`), `active_props`, and `source_fp`. Test that it rejects missing required fields. Test `SceneLedgerEntrySchema` validates `{ fp, location, time }`. Test that `SceneCharacterSchema` accepts arrays for `clothing` and `physical_status`. Create `tests/store/migrations/v8.test.js` — test fresh data (no existing fields), already-migrated data (fields exist with values), and partial migration recovery. Run tests to ensure they fail.
3. **Implement Minimal Code:**
   - In `src/store/schemas.js`: Define `SceneCharacterSchema` with `clothing` (string array), `posture` (string), `physical_status` (string array), `mental_status` (string). Define `SceneStateSchema` with `location` (string), `time` (string), `environment` (string optional), `characters` (record of string→`SceneCharacterSchema`), `active_props` (string array, default `[]`), `source_fp` (string). Define `SceneLedgerEntrySchema` with `fp` (string), `location` (string), `time` (string). Add all three to the `_schemas` object in `getSchemas()`.
   - In `src/store/chat-data.js`: Add `scene_states: {}`, `scene_ledger: []`, `scene_counter: 0` to the defaults in `getOpenVaultData()`.
   - Create `src/store/migrations/v8.js`: Export `migrateToV8(data, _chat)` that backfills `scene_states` to `{}` if missing, `scene_ledger` to `[]` if missing, `scene_counter` to `0` if missing. Return whether any change was made.
   - In `src/store/migrations/index.js`: Import `migrateToV8`, add to `MIGRATIONS` array, bump `CURRENT_SCHEMA_VERSION` to 8.
   - In `src/constants.js`: Add `sceneStateInterval: 3` to `defaultSettings`. Add `scene: { position: 4 }` to the `injection` object in `defaultSettings`. Scene depth is NOT a user setting — it's computed dynamically from the state's `source_fp` position: `depth = chat.length - source_index`.
   - In `src/settings.js`: Add `'injection.scene.position'` and `'sceneStateInterval'` to `REQUIRED_SETTINGS_PATHS`. Do NOT add a depth path — scene depth is calculated, not configured.
   - In `include/DATA_SCHEMA.md`: Document `scene_states` (fingerprint-keyed map of scene snapshots), `scene_ledger` (append-only transition array), `scene_counter` (message counter).
4. **Verify:** Run `npx vitest run tests/store/schemas-scene.test.js tests/store/migrations/v8.test.js` and ensure all pass.
5. **Commit:** `feat(scene-state): add schemas, migration v8, and settings defaults`

---

### Task 2: Scene State Extraction Core

**Objective:** Create the scene state extraction module with the extraction function, prompt builder, state map management, ledger diffing, and pruning logic.

**Depends on:** Task 1 (schemas and defaults).

**Files to modify/create:**
- Create: `src/extraction/scene-state.js` (Purpose: Core extraction function, state map management, ledger diffing, backward-scan lookup, pruning, dynamic depth calculation)
- Create: `src/prompts/scene-state/role.js` (Purpose: System role definition for scene state extraction)
- Create: `src/prompts/scene-state/rules.js` (Purpose: State inertia, stale character eviction, clothing transition, prop eviction rules)
- Create: `src/prompts/scene-state/schema.js` (Purpose: Output schema description for the LLM prompt)
- Create: `src/prompts/scene-state/examples/en.js` (Purpose: English few-shot examples)
- Create: `src/prompts/scene-state/examples/ru.js` (Purpose: Russian few-shot examples)
- Create: `src/prompts/scene-state/examples/index.js` (Purpose: Language-aware example selector, same pattern as other domains)
- Create: `src/prompts/scene-state/builder.js` (Purpose: Assemble extraction prompt messages using shared formatters)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/prompts/world-state/builder.js` for the prompt builder pattern. Read `src/prompts/world-state/role.js`, `src/prompts/world-state/rules.js`, `src/prompts/world-state/schema.js` for the prompt module structure. Read `src/prompts/shared/formatters.js` for `buildMessages()`, `assembleSystemPrompt()`, `assembleUserConstraints()`. Read `src/prompts/shared/format-examples.js` for `formatExamples()`. Read `src/extraction/extract.js` lines 1099-1114 for the interval trigger pattern using `graph_message_count`.
2. **Write Failing Tests:** Create `tests/extraction/scene-state.test.js`. Test the following pure functions (import from `src/extraction/scene-state.js`):
   - **`pruneStateMap(map, maxEntries=10)`**: Given a map with 15 entries, returns only last 10. Given a map with 5 entries, returns all 5. Given empty map, returns empty map.
   - **`diffLedger(prevState, newState, lastFp)`**: Returns a ledger entry `{ fp, location, time }` if location or time changed, returns `null` if unchanged. Test with matching states, changed location only, changed time only, both changed.
   - **`getSceneExtractionWindow(chat, sceneStates, skipSystem=true)`**: Given chat array and scene state map, returns all real messages since the last `source_fp`. If map is empty (cold start), returns all messages. Skips `is_system` messages.
   - **`findCurrentSceneState(chat, sceneStates)`**: The backward-scan lookup. Given a chat array and state map, walks backward from the last message and returns the first state whose fingerprint key matches a message fingerprint. Returns `null` if no match found. Test: exact match at last message, match at earlier message (interval gap), empty map, all messages before any extraction. **Implementation detail:** Build a temporary `Set` of state map keys for O(1) membership checks during the backward walk, rather than `key in sceneStates` on each iteration.
   - **`computeDynamicDepth(state, chat, fpMap)`**: Given a state with `source_fp` and a chat with fingerprint map, computes injection depth as `chat.length - sourceIndex`. **Minimum depth is clamped to 2** to ensure scene state injects after the last complete User+Bot pair, never at the very bottom. Test: state at index 6, chat length 8 → depth 2. Test: state at index 10, chat length 15 → depth 5. Test: `source_fp` not in map → fallback 4. Test: computed depth < 2 → clamp to 2. Test: null state → fallback 4.
   - **`shouldTriggerSceneExtraction(sceneCounter, interval)`**: Returns `true` when `sceneCounter >= interval`.
   Use `it.each()` for all parameterized cases. Run tests to ensure they fail.
3. **Implement Minimal Code:**
   - Create `src/prompts/scene-state/role.js`: Export a system role string for scene state extraction. Keep it concise — the LLM is a scene continuity tracker.
   - Create `src/prompts/scene-state/rules.js`: Export the four prompt engineering rules from the design doc: State Inertia (Preservation), Stale Character Eviction, Clothing Transition, Prop Eviction. Follow the same export pattern as `src/prompts/world-state/rules.js`.
   - Create `src/prompts/scene-state/schema.js`: Export the JSON schema description that the LLM must output. Follow the pattern in `src/prompts/world-state/schema.js`.
   - Create `src/prompts/scene-state/examples/en.js` and `ru.js`: Provide 1-2 few-shot examples showing previous state → new messages → updated state. Follow `src/prompts/world-state/examples/en.js` structure.
   - Create `src/prompts/scene-state/examples/index.js`: Language-aware selector, same pattern as `src/prompts/world-state/examples/index.js`.
   - Create `src/prompts/scene-state/builder.js`: Export `buildSceneStatePrompt(prevState, messages, outputLanguage, prefill)` following the world-state builder pattern. System prompt assembled with `assembleSystemPrompt({ role, examples, outputLanguage })`. User prompt contains `<previous_state>` XML block (previous state JSON or "No previous state — this is the first extraction."), `<new_messages>` block with the message text, and constraints assembled with `assembleUserConstraints()`.
   - Create `src/extraction/scene-state.js`: Export the pure helper functions (`pruneStateMap`, `diffLedger`, `getSceneExtractionWindow`, `findCurrentSceneState`, `shouldTriggerSceneExtraction`, `computeDynamicDepth`). The `computeDynamicDepth(state, chat, fpMap)` function:
     - If no state or no `source_fp`, return fallback `4`
     - Resolve `state.source_fp` to index via `fpMap.get(source_fp)`
     - If not found (message deleted), return fallback `4`
     - Compute `depth = chat.length - sourceIndex`
     - If `depth < 0`, clamp to `0`
     - Return computed depth
   Also export `async function extractSceneState(data, chat, settings, { abortSignal })` which: (1) gets extraction window, (2) builds prompt, (3) calls LLM via `getDeps().fetch` or the shared LLM call utility, (4) validates response with `SceneStateSchema` (import from `schemas.js` via `getSchemas()`), (5) stores in `data.scene_states[lastFp]`, (6) calls `diffLedger` and appends to `data.scene_ledger` if changed, (7) calls `pruneStateMap` on `data.scene_states`. Read `src/extraction/extract.js` to find how LLM calls are made (look for the shared `callLLM` or `fetchWithTimeout` pattern used by world state synthesis).
4. **Verify:** Run `npx vitest run tests/extraction/scene-state.test.js` and ensure all pass.
5. **Commit:** `feat(scene-state): add extraction module, prompt builder, and state management`

---

### Task 3: Pipeline Integration

**Objective:** Wire scene state extraction into the existing extraction pipeline (Stage 7 in `extractMemories`) and add the standalone worker path.

**Depends on:** Task 2 (extraction core).

**Files to modify/create:**
- Modify: `src/extraction/extract.js` (Purpose: Add Stage 7 — scene state extraction after world state synthesis, using `graph_message_count`-style interval trigger)
- Modify: `src/extraction/worker.js` (Purpose: Add standalone scene extraction path — check `scene_counter >= sceneStateInterval` when no memory batch is pending)
- Modify: `src/extraction/scheduler.js` (Purpose: Add scene counter increment logic — increment `scene_counter` on real messages, skip `is_system`. This should be called from wherever `graph_message_count` is incremented)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/extraction/extract.js` — find where `graph_message_count` is incremented (likely early in `extractMemories` near line 900-950) and where Stage 6 (world state synthesis) runs (lines 1099-1114). Read `src/extraction/worker.js` for the full `runWorkerLoop` function. Read `src/extraction/scheduler.js` to find where message counting happens.
2. **Write Failing Tests:** Create `tests/extraction/scene-pipeline.test.js`. This is an integration test — use `setupTestContext()` from `tests/setup.js`. Test:
   - **Stage 7 trigger:** After `extractMemories` processes a batch, verify `data.scene_counter` is incremented by the number of real messages in the batch. When `scene_counter >= sceneStateInterval`, verify `extractSceneState` is called and `scene_counter` resets to 0.
   - **Stage 7 skip when disabled:** When `injection.scene.position === -2`, verify scene extraction is not triggered.
   - **Counter increments on real messages only:** Messages with `is_system: true` should not increment `scene_counter`.
   Keep to 3-5 tests maximum per the Integration Bouncer Rule. Run tests to ensure they fail.
3. **Implement Minimal Code:**
   - In `src/extraction/scheduler.js` or wherever `graph_message_count` is incremented: Add `scene_counter` increment logic — for each real message (not `is_system`) in the processed batch, increment `data.scene_counter`. This should happen alongside the existing `graph_message_count` increment.
   - In `src/extraction/extract.js`: After Stage 6 (world state synthesis), add Stage 7:
     - Check `scenePosition !== -2` (same pattern as world/reflections position guards).
     - Check `data.scene_counter >= sceneStateInterval`.
     - If triggered, call `extractSceneState(data, chat, settings, { abortSignal })`.
     - Reset `data.scene_counter = 0` after successful extraction.
     - Log debug message matching the world state pattern.
   - In `src/extraction/worker.js`: After the main `getNextBatch` check returns `null` (no memory batch pending), add a standalone scene check: if `data.scene_counter >= sceneStateInterval` and `injection.scene.position !== -2`, call `extractSceneState(data, chat, settings, { abortSignal })` and reset counter. This gives Path B (standalone extraction) from the design doc. **Concurrency guard:** The standalone path must respect the same mutex as the main loop — check `operationState.extractionInProgress` before starting scene extraction, and set a flag (e.g., `operationState.sceneExtractionInProgress`) during execution to prevent race conditions with a memory batch that becomes ready mid-extraction.
4. **Verify:** Run `npx vitest run tests/extraction/scene-pipeline.test.js` and ensure all pass.
5. **Commit:** `feat(scene-state): integrate extraction into pipeline (Stage 7 + worker standalone path)`

---

### Task 4: Injection Formatting and Context Wiring

**Objective:** Create the XML formatting function for injection, wire `sceneText` through `injectContext()` and `selectFormatAndInject()`, add backward-scan lookup to retrieval, and register the macro.

**Depends on:** Task 2 (backward-scan lookup in `scene-state.js`).

**Files to modify/create:**
- Modify: `src/retrieval/formatting.js` (Purpose: Add `formatSceneStateForInjection(sceneState)` — converts JSON to dense XML `<scene_status>` block)
- Modify: `src/retrieval/retrieve.js` (Purpose: Add `sceneText` as 4th parameter to `injectContext()`, perform backward-scan lookup, compute dynamic depth from `source_fp`, format and inject)
- Modify: `src/injection/macros.js` (Purpose: Add `scene` to `cachedContent`, register `openvault_scene` macro)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/retrieval/formatting.js` for existing formatting patterns. Read `src/retrieval/retrieve.js` — specifically `injectContext()` (lines 188-231) and `selectFormatAndInject()` (lines 240-322). Read `src/injection/macros.js` for macro registration and `cachedContent` structure.
2. **Write Failing Tests:** Create `tests/retrieval/scene-formatting.test.js`. Test:
   - **`formatSceneStateForInjection(state)`**: Given a full scene state object (location, time, environment, 2 characters with clothing/posture/status, active_props), produces the XML `<scene_status>` block. Verify structure: `[Location]` header line, `[Time]` with environment, one line per character with `[Name]:` prefix containing posture, clothing, and status. Verify active props appear. Test with empty environment (omitted). Test with single character. Test with empty characters map (only location/time line).
   - **Dynamic depth calculation**: Test that given a state with `source_fp` at index 6 and `chat.length = 8`, computes `depth = 2`. Test that given `source_fp` at index 10 and `chat.length = 15`, computes `depth = 5`. Test edge case: `source_fp` not in chat → fallback to `depth = 4`. Test edge case: `depth < 0` → clamp to `0`.
   - **Short chats guard:** When `chat.length < 4`, injection falls back to position `1` (AFTER_MAIN).
   Use `it.each()` for formatting variations. Run tests to ensure they fail.
3. **Implement Minimal Code:**
   - In `src/retrieval/formatting.js`: Export `formatSceneStateForInjection(sceneState)` that converts the scene state JSON to the dense XML format from the design doc. Format: `<scene_status>` block with `[Location]: ... | [Time]: ...` header, then `[CharName]: Posture. Wearing: items. Status: status.` per character, then `</scene_status>`. One line per character. Approximately 60-100 tokens. Include environment in the header if present. Include active props in a `[Props]: ...` line if present.
   - In `src/retrieval/retrieve.js`: Modify `injectContext()` signature to accept 4th parameter `sceneText = ''`. Add `cachedContent.scene = sceneText`. For scene injection with IN_CHAT (position 4):
     - Perform backward-scan lookup using `findCurrentSceneState(chat, data.scene_states)` to find the current state
     - If state found, resolve its `source_fp` to chat index using the `chatFingerprintMap` from `buildRetrievalContext()` (or build a fresh map)
     - Compute dynamic depth: `depth = chat.length - source_index`
     - Edge cases: if `source_fp` doesn't resolve (deleted message), fall back to `depth = 4`; if `depth < 0`, clamp to `depth = 0`
     - Short chats guard: if `chat.length < 4`, use position `1` (AFTER_MAIN) for this turn only
     - Pass computed depth to `safeSetExtensionPrompt(sceneText, 'openvault_scene', effectivePosition, computedDepth)`
   - In `selectFormatAndInject()`: before calling `injectContext()`, perform the backward-scan lookup, resolve source_fp, compute depth, format with `formatSceneStateForInjection()`, and pass as the 4th argument. The retrieval context (`ctx`) already contains `chatFingerprintMap` for fingerprint→index resolution.
   - In `src/injection/macros.js`: Add `scene: ''` to `cachedContent`. In `initMacros()`, register `openvault_scene` macro with handler `() => cachedContent.scene`, following the exact same pattern as `openvault_world`.
4. **Verify:** Run `npx vitest run tests/retrieval/scene-formatting.test.js` and ensure all pass.
5. **Commit:** `feat(scene-state): add injection formatting, backward-scan lookup, and macro registration`

---

### Task 5: Settings UI — Dropdown and Slider

**Objective:** Add the Scene Position dropdown (3 options: In-chat, Custom, Disabled) and Scene State Interval slider to the settings panel. NO depth input — scene depth is hardcoded and not user-configurable.

**Depends on:** Task 1 (settings defaults), Task 4 (injection wiring).

**Files to modify/create:**
- Modify: `templates/settings_panel.html` (Purpose: Add Scene Position dropdown with only 3 options (In-chat, Custom, Disabled) — NO depth input. Add Scene State Interval slider in extraction settings)
- Modify: `src/ui/settings.js` (Purpose: Add event handlers for scene position dropdown (no depth handler), interval slider, disable confirmation, and `updateInjectionUI` for scene)
- Modify: `src/settings.js` (Purpose: Add `injection.scene.position` to `handleSettingChangeSideEffects` for -2 disable wipe of `scene_states`, `scene_ledger`, and `scene_counter`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `templates/settings_panel.html` — find the injection position dropdowns section. Read `src/ui/settings.js` — find `bindInjectionSettings()` for the event handler pattern, `updateInjectionUI()` for UI state sync, and the -2 confirmation dialog pattern. Read `src/settings.js` for `handleSettingChangeSideEffects()`.
2. **Write Failing Tests:**
   - Create `tests/ui/scene-settings.test.js`: Test `updateInjectionUI('scene')` — verify that when `injection.scene.position === 4` (In-chat), NO depth container is shown (scene depth is hardcoded, not configurable). When `position === -1` (Custom), the macro container is visible. When `position === -2` (Disabled), neither shows. Use the existing UI structure test pattern (regex/string-matching on HTML, no JSDOM).
   - Add to `tests/store/settings.test.js` or create `tests/settings/scene-side-effects.test.js`: Test that setting `injection.scene.position` to `-2` triggers `handleSettingChangeSideEffects` which wipes `scene_states` to `{}`, `scene_ledger` to `[]`, and `scene_counter` to `0`. Run tests to ensure they fail.
3. **Implement Minimal Code:**
   - In `templates/settings_panel.html`:
     - In the Injection Positions `<details>` section, after the World Position dropdown, add a 4th dropdown for Scene Position with **only 3 options** (not the full 0-4 range):
       - `<option value="4">In-chat</option>` (default, selected)
       - `<option value="-1">Custom (macro only)</option>`
       - `<option value="-2">Disabled</option>`
     - **NO depth input** — scene depth is hardcoded to 4 internally, not exposed in UI.
     - Include the macro display (same pattern as other dropdowns) for Custom position.
     - In the extraction settings section, add a slider for "Scene State Interval" (range 2-10, default 3, step 1). Follow the existing slider pattern for `worldStateInterval`. Use ID `openvault_scene_state_interval`.
   - In `src/ui/settings.js`:
     - In `bindInjectionSettings()`: Add change handler for `#openvault_scene_position` with -2 confirmation guard (matching the reflections/world pattern). **NO depth input handler** — scene depth is not configurable. Add input handler for `#openvault_scene_state_interval`.
     - In `updateInjectionUI()`: Add a case for `'scene'` that shows/hides only the macro container (for Custom position), never a depth container.
   - In `src/settings.js`:
     - In `handleSettingChangeSideEffects()`: Add `path !== 'injection.scene.position'` to the early-return guard. Add a new `if (path === 'injection.scene.position')` block that: sets `data.scene_states = {}`, sets `data.scene_ledger = []`, sets `data.scene_counter = 0`. Follow the exact pattern of the `injection.world.position` block.
4. **Verify:** Run `npx vitest run tests/ui/scene-settings.test.js tests/settings/scene-side-effects.test.js` and ensure all pass.
5. **Commit:** `feat(scene-state): add settings UI with position dropdown, interval slider, and disable semantics`

---

### Task 6: Memory Temporal Stamping via Ledger

**Objective:** Use the scene ledger to provide temporal/spatial grounding during memory extraction — prepend `<extraction_context>` blocks and deterministically stamp extracted memories with `location` and `temporal_anchor`.

**Depends on:** Task 3 (pipeline integration, ledger populated), Task 2 (ledger resolution algorithm).

**Files to modify/create:**
- Modify: `src/extraction/scene-state.js` (Purpose: Add `resolveLedgerForBatch(ledger, chat, batchMessageFps)` — returns sub-batches with scene context per message range)
- Modify: `src/extraction/extract.js` (Purpose: In Stage 1 (event extraction), if `scene_ledger` has entries, build `<extraction_context>` block and pass to prompt builder. After extraction, stamp each memory with `location` and `temporal_anchor` from the ledger lookup)
- Modify: `src/prompts/events/builder.js` (Purpose: Accept optional `extractionContext` parameter, insert `<extraction_context>` XML block into user prompt via clean assembly pattern)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/extraction/extract.js` — find where `fetchEventsFromLLM` is called in Stage 1 and how the extraction prompt is assembled. Read `src/extraction/scene-state.js` for existing ledger functions. Read `src/prompts/events/builder.js` to understand how event extraction prompts are built.
2. **Write Failing Tests:** Create `tests/extraction/scene-ledger.test.js`. Test:
   - **`resolveLedgerForBatch(ledger, chat, batchFps)`**: Given a ledger with entries for fps at positions 10 and 15, and a batch covering messages 5-20, returns two sub-batches: messages 5-10 with scene A context, messages 11-20 with scene B context. Test with empty ledger (returns single batch with null context). Test with ledger entries outside the batch range. Test with single ledger entry covering entire batch.
   - **Ledger backward scan:** For a message at position 12, the correct scene context is the first ledger entry whose fp corresponds to a message at or before position 12.
   Use `it.each()`. Run tests to ensure they fail.
3. **Implement Minimal Code:**
   - In `src/extraction/scene-state.js`: Export `resolveLedgerForBatch(ledger, chat, batchFps)` implementing the ledger resolution algorithm from the design doc: (1) build a temporary `fingerprint→index` map from the chat array for O(1) resolution, (2) sort ledger entries by resolved position (newest first), (3) for each message, scan ledger backward for the first entry whose fp resolves to a position at or before the message's index, (4) group messages into sub-batches with uniform scene context, (5) return `[{ startIdx, endIdx, location, time }]` sub-batch descriptors.
   - In `src/extraction/extract.js`: Before calling `fetchEventsFromLLM` in Stage 1, if `data.scene_ledger?.length > 0`, call `resolveLedgerForBatch` to get sub-batches. Update `src/prompts/events/builder.js` to accept an optional `extractionContext` parameter — if provided, the builder inserts the `<extraction_context>` XML block into the user prompt using the same clean assembly pattern as other prompt sections. Do not prepend raw strings to the user prompt directly. After event extraction completes, iterate extracted events and stamp each with `location` and `temporal_anchor` from the resolved sub-batch — this is deterministic JS, not LLM output.
4. **Verify:** Run `npx vitest run tests/extraction/scene-ledger.test.js` and ensure all pass.
5. **Commit:** `feat(scene-state): add ledger-based temporal stamping for memory extraction`

---

### Task 7: End-to-End Integration and Verification

**Objective:** Verify the full scene state pipeline works end-to-end — extraction triggers, state is stored, injection happens, disable wipes data, and temporal stamping functions.

**Depends on:** Tasks 1-6 (all prior tasks).

**Files to modify/create:**
- Create: `tests/extraction/scene-e2e.test.js` (Purpose: End-to-end integration test covering the full lifecycle)

**Instructions for Execution Agent:**
1. **Context Setup:** Read existing integration tests in `tests/extraction/extract.test.js` to understand the E2E testing pattern with `setupTestContext()`. Read `tests/retrieval/retrieve.test.js` for injection E2E patterns.
2. **Write and Run Tests:** Create `tests/extraction/scene-e2e.test.js` with `setupTestContext()`. Test the full lifecycle:
   - **Happy Path:** (1) Create a chat with 6 real messages. (2) Set `sceneStateInterval` to 3. (3) Run the extraction pipeline. (4) Verify `data.scene_states` has an entry keyed by the last message's fingerprint. (5) Verify `data.scene_counter` reset to 0. (6) Call `selectFormatAndInject` and verify scene XML is injected. (7) Verify the macro `openvault_scene` returns non-empty content.
   - **Graceful Degradation:** (1) Start with empty chat. (2) Verify no scene state extraction fires. (3) Verify no scene text is injected. (4) Verify backward scan returns null.
   - **Fast-Fail:** (1) Set `injection.scene.position` to -2. (2) Verify no extraction fires. (3) Verify scene_counter is not incremented.
   Keep to 3 tests maximum per the Integration Bouncer Rule.
3. **Verify:** Run `npx vitest run tests/extraction/scene-e2e.test.js` and ensure all pass. Then run the full test suite `npx vitest run` to check for regressions.
4. **Commit:** `test(scene-state): add end-to-end integration tests`
