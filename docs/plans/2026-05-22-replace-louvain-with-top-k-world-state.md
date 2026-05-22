# Replace Louvain Communities with Top-K World State — Implementation Plan

**Goal:** Replace Graphology/Louvain community detection with a simple top-K entity selection and single LLM world-state summary, while preserving macro/local retrieval paths.
**Testing Conventions:** Unit tests with zero `vi.mock()` for pure data transforms. Integration tests via `setupTestContext()`. Use `buildMockGraphNode()` from `tests/factories.js`. Keep orchestrator tests to 3-5 max (happy path, graceful degradation, fast-fail). Use `it.each()` for same-pattern-different-input tests. Test files mirror `src/` structure under `tests/`.

---

### Task 1: Constants and CDN Cleanup

**Objective:** Remove graphology dependencies and community-specific constants from `src/constants.js`, `src/utils/cdn.js`, `package.json`, and `tests/setup.js`. Add new `WORLD_STATE_ENTITY_COUNT` constant. Rename `communityDetectionInterval` to `worldStateInterval` in constants and settings schema.

**Files to modify/create:**
- Modify: `src/constants.js` — Remove `MAIN_CHARACTER_ATTENUATION` (line 335), `GLOBAL_SYNTHESIS_CHUNK_SIZE` (line 329), `COMMUNITY_STALENESS_THRESHOLD` (line 211). Add `WORLD_STATE_ENTITY_COUNT: 20`. Rename `communityDetectionInterval` to `worldStateInterval` in `defaultSettings` (line 99) and `settingsKeys` (line 267).
- Modify: `src/utils/cdn.js` — Remove graphology entries from `CDN_VERSIONS` (lines 40-42).
- Modify: `package.json` — Remove `graphology`, `graphology-communities-louvain`, `graphology-operators` from devDependencies (lines 27-29).
- Modify: `tests/setup.js` — Remove graphology CDN overrides (lines 66-68).

**Instructions for Execution Agent:**
1. **Context Setup:** Read the files listed above to orient yourself.
2. **Write Failing Test:** No tests needed for this task — these are config/dependency changes.
3. **Implement Minimal Code:** In `src/constants.js`, delete the three community constants and add `WORLD_STATE_ENTITY_COUNT: 20`. Rename `communityDetectionInterval` to `worldStateInterval` in both `defaultSettings` and `settingsKeys`. In `cdn.js`, delete the three graphology lines from `CDN_VERSIONS`. In `package.json`, remove the three graphology devDependencies. In `tests/setup.js`, delete the three graphology CDN override lines.
4. **Verify:** Run `npm run check` to ensure no lint/type errors from removed constants.
5. **Commit:** Commit with message: `refactor: remove graphology dependencies and community constants`

---

### Task 2: New World State Module

**Objective:** Create `src/graph/world-state.js` with two pure functions: `selectTopEntities(graphData, count)` (sort by mentions, resolve keys to names, collect intra-set edges) and `generateWorldState(entities, edges, preamble, outputLanguage, prefill)` (format prompt, single LLM call, parse response). This replaces the entire `src/graph/communities.js` module.

**Depends on:** Task 1 (needs `WORLD_STATE_ENTITY_COUNT` constant).

**Files to modify/create:**
- Create: `src/graph/world-state.js` — New module with `selectTopEntities` and `generateWorldState`.
- Create: `tests/graph/world-state.test.js` — Unit tests for both functions.

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/graph/communities.js` to understand the existing pattern (imports from `../llm.js`, `../extraction/structured.js`, `../prompts/index.js`, `../utils/embedding-codec.js`). Read `src/constants.js` to find the new `WORLD_STATE_ENTITY_COUNT`. Read `tests/factories.js` to find `buildMockGraphNode()` helper. Read `src/extraction/structured.js` lines 414-468 to understand `parseCommunitySummaryResponse` and `parseGlobalSynthesisResponse` — these can be reused or adapted for the new response format.
2. **Write Failing Test:** In `tests/graph/world-state.test.js`, write tests for:
   - `selectTopEntities`: sorts by mentions descending, caps at `count`, resolves edge keys to display names (never returns raw normalized keys), includes `sourceType`/`targetType` on edges, returns empty arrays for empty graph, excludes edges where only one endpoint is in the set.
   - `generateWorldState`: calls `buildGlobalWorldStatePrompt` (will be created in Task 4 — for now import from `../prompts/index.js` expecting it to exist), calls `callLLM` once, parses response, returns `{ summary, last_updated }`.
3. **Implement Minimal Code:** Create `src/graph/world-state.js`. Import `WORLD_STATE_ENTITY_COUNT` from constants, `callLLM`/`LLM_CONFIGS` from llm, parsing functions from structured. `selectTopEntities` is pure — no mocks needed. `generateWorldState` calls LLM once and returns structured result. Do NOT import graphology — there should be zero CDN imports in this file.
4. **Verify:** Run the new test file. Tests for `selectTopEntities` should pass. Tests for `generateWorldState` will need `buildGlobalWorldStatePrompt` from Task 4 — stub it in the test if needed, or defer this subset until Task 4 lands.
5. **Commit:** Commit with message: `feat(world-state): add selectTopEntities and generateWorldState`

---

### Task 3: World Context Retrieval Rewrite

**Objective:** Rewrite `src/retrieval/world-context.js` to use entity embeddings directly for local retrieval instead of community embeddings. Keep macro intent path unchanged (returns `global_world_state.summary`). Local path scores entities by cosine similarity, selects top-K within token budget, formats with entity description + top 3 edges including endpoint type inline.

**Depends on:** Task 1 (constants cleanup).

**Files to modify/create:**
- Modify: `src/retrieval/world-context.js` — Rewrite local retrieval path to search entity embeddings. Remove community-specific logic.
- Modify: `tests/retrieval/world-context.test.js` — Update tests for entity-based retrieval.

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/retrieval/world-context.js` (full file — only 113 lines) and `tests/retrieval/world-context.test.js`. Read `src/utils/embedding-codec.js` to understand `getEmbedding`/`hasEmbedding`. Read `src/graph/graph.js` to understand the flat graph edge schema.
2. **Write Failing Test:** Update `tests/retrieval/world-context.test.js`:
   - Macro intent tests remain the same.
   - Replace community-based vector search tests with entity-based tests: provide `graphData` with entities that have embeddings, verify cosine similarity scoring, verify top-K selection within token budget, verify edge formatting includes endpoint types inline (e.g., `→ Warehouse (PLACE): description`), verify entities without embeddings are skipped.
   - Use `buildMockGraphNode()` from factories where appropriate, inline objects for scoring math.
3. **Implement Minimal Code:** Rewrite `retrieveWorldContext()`. The function signature changes: instead of `(communities, globalState, ...)` it now takes `(graphData, globalState, userMessagesString, queryEmbedding, tokenBudget)`. The function needs access to the flat graph `{ nodes, edges }` to search entity embeddings and look up edges. Macro path unchanged. Local path: iterate `graphData.nodes`, score by cosine similarity, sort, select within budget, format each entity with its top 3 edges (by weight) including endpoint type. Keep `detectMacroIntent()` as-is.
4. **Verify:** Run `tests/retrieval/world-context.test.js` — all tests should pass.
5. **Commit:** Commit with message: `feat(retrieval): rewrite world-context for entity-based local retrieval`

---

### Task 4: Prompt Replacement

**Objective:** Replace community-specific prompts (`src/prompts/communities/`) with a single `buildGlobalWorldStatePrompt` in a new `src/prompts/world-state/` directory. Update `src/prompts/index.js` to export the new function and remove old community exports. Reuse `parseCommunitySummaryResponse` from `src/extraction/structured.js` (or create a simpler `parseWorldStateResponse` if the schema differs).

**Depends on:** Task 2 (generateWorldState needs the prompt).

**Files to modify/create:**
- Create: `src/prompts/world-state/builder.js` — New `buildGlobalWorldStatePrompt(entities, edges, preamble, outputLanguage, prefill)`.
- Create: `src/prompts/world-state/schema.js` — JSON schema for world state response.
- Create: `src/prompts/world-state/role.js` — System prompt for world state synthesis.
- Create: `src/prompts/world-state/rules.js` — Rules/instructions for world state generation.
- Create: `src/prompts/world-state/examples/en.js` — English examples.
- Create: `src/prompts/world-state/examples/ru.js` — Russian examples.
- Create: `src/prompts/world-state/examples/index.js` — Example aggregator.
- Modify: `src/prompts/index.js` — Replace `buildCommunitySummaryPrompt`/`buildGlobalSynthesisPrompt` exports with `buildGlobalWorldStatePrompt`.
- Delete: `src/prompts/communities/` — Entire directory removed.
- Modify: `src/extraction/structured.js` — If needed, add `parseWorldStateResponse` or reuse existing parsers.

**Instructions for Execution Agent:**
1. **Context Setup:** Read the full `src/prompts/communities/` directory to understand the existing prompt topology (builder, schema, role, rules, examples). Read `src/prompts/index.js` to see how prompts are exported. Read `src/extraction/structured.js` lines 414-468 to understand parsing. Read `src/llm.js` line 82 to see the `community` LLM config — rename it to `worldState` or keep the key (it's an internal config name, not user-facing).
2. **Write Failing Test:** No prompt-content tests per test conventions. If `src/extraction/structured.js` gets a new parser, test it with structured test data. Verify the builder function exists and returns a string (test the export, not the prompt text).
3. **Implement Minimal Code:** Create the new `src/prompts/world-state/` directory mirroring the communities structure. The builder receives `entities[]` and `edges[]` (already resolved to display names by `selectTopEntities`) and formats them into the prompt. Update `src/prompts/index.js` to export the new builder. Optionally add a `parseWorldStateResponse` to `src/extraction/structured.js` if the response schema differs from community summaries — but if it's the same `{ title, summary, findings }` shape, reuse `parseCommunitySummaryResponse` directly.
4. **Verify:** Run `npm run check` to ensure no broken imports. Run existing prompt tests.
5. **Commit:** Commit with message: `feat(prompts): replace community prompts with world-state prompt`

---

### Task 5: Extraction Pipeline Integration

**Objective:** Replace `synthesizeCommunities()` in `src/extraction/extract.js` with `synthesizeWorldState()` using the new `selectTopEntities` and `generateWorldState`. Update the trigger interval logic. Wire the new `retrieveWorldContext` signature into `src/retrieval/retrieve.js`.

**Depends on:** Tasks 2, 3, 4 (all new modules must exist).

**Files to modify/create:**
- Modify: `src/extraction/extract.js` — Replace `synthesizeCommunities` with `synthesizeWorldState`. Update imports (remove community imports, add world-state imports). Update trigger interval to use `worldStateInterval`. Rename `communityInterval` variable.
- Modify: `src/retrieval/retrieve.js` — Update `selectFormatAndInject` to pass `data.graph` instead of `data.communities` to the new `retrieveWorldContext` signature.
- Modify: `tests/extraction/extract.test.js` — Update any tests that mock `synthesizeCommunities` to mock `synthesizeWorldState` instead.

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/extraction/extract.js` lines 34 (imports), 648-684 (synthesizeCommunities), 1019-1023 (trigger interval), 1073 (backfill call). Read `src/retrieval/retrieve.js` lines 274-300 (world context injection). Read `tests/extraction/extract.test.js` to find all references to `synthesizeCommunities` and `communities`.
2. **Write Failing Test:** Update integration tests in `tests/extraction/extract.test.js` — replace any mock/setup referencing `synthesizeCommunities` with `synthesizeWorldState`. Keep to 3-5 orchestrator tests max. The test should verify that: world state synthesis is triggered at the correct message interval, edge consolidation still runs before synthesis, empty graph is skipped (cold start guard).
3. **Implement Minimal Code:** In `extract.js`: replace the import from `../graph/communities.js` with imports from `../graph/world-state.js`. Rewrite `synthesizeCommunities` as `synthesizeWorldState`: add empty-graph guard, call `selectTopEntities`, call `generateWorldState`, store result in `data.global_world_state`. Remove all community-related state writes (`data.communities = ...`). Update the trigger interval variable from `settings.communityDetectionInterval` to `settings.worldStateInterval`. In `retrieve.js`: update the call to `retrieveWorldContext` — pass `data.graph` instead of `data.communities` as the first argument. Update the guard condition: instead of checking `Object.keys(worldCommunities).length > 0`, check that `data.graph?.nodes` has entries.
4. **Verify:** Run `npm run check` and all tests.
5. **Commit:** Commit with message: `feat(extraction): replace community synthesis with world-state pipeline`

---

### Task 6: Schema, Migration, and State Cleanup

**Objective:** Add a v6 schema migration that deletes `data.communities`, removes `community_count` from `global_world_state`, and renames the interval setting. Update Zod schemas in `src/store/schemas.js` to remove community types. Update `src/store/chat-data.js` to remove community initialization. Remove community references from embedding migration counts.

**Depends on:** Task 5 (pipeline must no longer reference communities).

**Files to modify/create:**
- Create: `src/store/migrations/v6.js` — Migration: delete `data.communities`, strip `community_count` from `global_world_state`, rename `communityDetectionInterval` → `worldStateInterval` in extension settings.
- Modify: `src/store/migrations/index.js` — Add v6 migration, bump `CURRENT_SCHEMA_VERSION` to 6.
- Modify: `src/store/schemas.js` — Remove `CommunitySummarySchema`, `CommunitySummaryParamsSchema`, remove `communities` from `OpenVaultDataSchema` and `ExtensionSettingsSchema`. Remove `community_count` from `GlobalWorldStateSchema`.
- Modify: `src/store/chat-data.js` — Remove `communities: {}` from initial data (line 46).
- Modify: `src/embeddings/migration.js` — Remove community embedding iteration (lines 23-24, 82-84).
- Create: `tests/store/migrations/v6.test.js` — Migration tests: fresh data, already-migrated data, partial migration recovery.

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/store/migrations/v5.js` and `src/store/migrations/index.js` for migration patterns. Read `src/store/schemas.js` lines 145-170 (community schemas). Read `src/store/chat-data.js` line 46 (initial data). Read `src/embeddings/migration.js` lines 8-30 and 75-90 (embedding counts). Read `src/store/migrations/CLAUDE.md` for migration anatomy.
2. **Write Failing Test:** Create `tests/store/migrations/v6.test.js` with test cases: (1) v5 data with communities → communities deleted, global_world_state.community_count removed, settings key renamed. (2) Data without communities → migration is no-op but still returns changed if settings key existed. (3) Fresh v6 data → no changes.
3. **Implement Minimal Code:** Create `v6.js` migration following the pattern from v5. In `schemas.js`: remove `CommunitySummarySchema`, `CommunitySummaryParamsSchema`, remove `communities` field from data schemas, remove `community_count` from `GlobalWorldStateSchema`. In `chat-data.js`: remove `communities: {}` from initial data. In `migrations/index.js`: add v6, bump version. In `embeddings/migration.js`: remove community embedding loops (replace with entity-only iteration if communities no longer exist).
4. **Verify:** Run all tests. Run `npm run check`.
5. **Commit:** Commit with message: `feat(store): v6 migration removes communities, adds world-state schema`

---

### Task 7: UI and Debug Export Updates

**Objective:** Update the settings panel to rename "Community Detection Interval" to "World State Interval". Update community list rendering in the UI to show world state summary instead. Update debug export to remove community section. Remove community-related CSS classes if no longer used.

**Depends on:** Task 6 (schemas must be updated).

**Files to modify/create:**
- Modify: `templates/settings_panel.html` — Rename community interval label/DOM IDs to world-state equivalents. Update community list section to show world state.
- Modify: `src/ui/settings.js` — Update `bindSetting` calls (line 780), setting key references (line 457), load defaults (lines 1054-1055). Rename from `community_interval` to `world_state_interval`.
- Modify: `src/ui/render.js` — Replace community accordion rendering with world state display.
- Modify: `src/ui/templates.js` — Replace `renderCommunityAccordion` with world state rendering.
- Modify: `src/ui/status.js` — Update community count/stats display.
- Modify: `src/ui/export-debug.js` — Remove `buildCommunitiesExport`, update export structure.
- Modify: `src/llm.js` — Rename `community` config key to `worldState` (line 82).

**Instructions for Execution Agent:**
1. **Context Setup:** Read `templates/settings_panel.html` lines 470-475. Read `src/ui/settings.js` lines 457, 780, 1054-1055. Read `src/ui/render.js` lines 355-374. Read `src/ui/templates.js` lines 255-274. Read `src/ui/status.js` lines 100-132. Read `src/ui/export-debug.js` lines 311-413. Read `src/llm.js` lines 79-86.
2. **Write Failing Test:** No new tests needed — UI changes are structural. Run `npm run check-css` to verify no orphaned CSS classes.
3. **Implement Minimal Code:** In `settings_panel.html`: rename the community interval slider to world state interval. In `settings.js`: update all references from `community_interval`/`communityDetectionInterval` to `world_state_interval`/`worldStateInterval`. In `render.js`: replace community list rendering with a single world state summary display. In `templates.js`: replace `renderCommunityAccordion` with a simpler `renderWorldStateCard` showing the summary. In `status.js`: replace community stats with world state stats (or remove if not applicable). In `export-debug.js`: remove `buildCommunitiesExport`, replace with world state export. In `llm.js`: rename `community` key to `worldState` in `LLM_CONFIGS`.
4. **Verify:** Run `npm run check` (includes CSS check). Run all tests.
5. **Commit:** Commit with message: `feat(ui): replace community UI with world-state display`

---

### Task 8: Cleanup and CLAUDE.md Updates

**Objective:** Delete `src/graph/communities.js`, `tests/graph/communities.test.js`, and `src/prompts/communities/` directory. Update all CLAUDE.md files that reference communities. Remove the `communit` LLM config from `tests/prompts/prefill.test.js` if it references community prompts. Final verification.

**Depends on:** Tasks 1-7 (everything else must be done).

**Files to modify/create:**
- Delete: `src/graph/communities.js`
- Delete: `tests/graph/communities.test.js`
- Delete: `src/prompts/communities/` — entire directory
- Modify: `src/graph/CLAUDE.md` — Remove community detection section, update to describe world-state approach.
- Modify: `src/retrieval/CLAUDE.md` — Update intent routing section to reflect entity-based retrieval.
- Modify: `src/extraction/CLAUDE.md` — Replace community references with world state.
- Modify: `src/store/migrations/CLAUDE.md` — Remove community embedding item type references.
- Modify: `tests/prompts/prefill.test.js` — Remove community prompt test if present.
- Modify: `vitest.config.js` — Remove any graphology aliases (if they exist — may have been CDN-only).
- Run: `rm -rf node_modules && npm install` to clean lock file, then `npm run check`.

**Instructions for Execution Agent:**
1. **Context Setup:** Read all CLAUDE.md files listed above. Read `tests/prompts/prefill.test.js` to check for community prompt tests.
2. **No Tests:** This is cleanup only.
3. **Implement Minimal Code:** Delete the three files/directories listed. Update each CLAUDE.md to replace community references with world-state descriptions. Keep CLAUDE.md files factual and concise — describe what exists, not what was removed. Remove stale references to Louvain, Graphology, and community detection.
4. **Verify:** Run `npm run check` (lint, jsdoc, css, typecheck). Run full test suite with `npx vitest run`. Fix any lingering references to deleted modules.
5. **Commit:** Commit with message: `chore: delete communities module, update documentation`
