# Flatten Reflections to Level 1 — Implementation Plan

**Goal:** Remove multi-tier recursive reflections (Level 2+), simplifying the reflection pipeline to event-only synthesis and removing all level-aware decay/setting infrastructure.
**Testing Conventions:** Unit tests for pure math (inline objects, no mocks). Integration tests via `setupTestContext()`. Never mock internal modules. Mirror `src/` structure in `tests/{module}/`. Use `buildMockMemory()` factory for structural tests, inline objects for math tests.

---

### Task 1: V7 Migration — Delete Level 2+ Reflections

**Objective:** Add the schema migration that permanently deletes Level 2+ reflections and cleans stale settings, bumping schema version from 6 to 7.

**Files to modify/create:**
- Create: `src/store/migrations/v7.js` (Purpose: Migration function that deletes Level 2+ reflections and removes stale settings)
- Modify: `src/store/migrations/index.js` (Purpose: Register v7 migration, bump `CURRENT_SCHEMA_VERSION` to 7)
- Test: `tests/store/migrations.test.js` (Purpose: Add v7 migration test cases)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/store/migrations/v6.js` for the migration pattern. Read `src/store/migrations/index.js` for registration pattern. Read `tests/store/migrations.test.js` for test pattern.
2. **Write Failing Test:** In `tests/store/migrations.test.js`, add a `describe('v7 migration')` block with these cases:
   - Deletes reflections where `level > 1` but keeps Level 1 reflections and events
   - Keeps data unchanged when no Level 2+ reflections exist
   - Removes `maxReflectionLevel` and `reflectionLevelMultiplier` from `data.settings` if present
   - Handles missing `data.memories` gracefully (no crash)
   - Returns `true` when changes made, `false` when no changes needed
3. **Implement Migration:** Create `src/store/migrations/v7.js` exporting `migrateToV7(data, _chat)`. Filter `data.memories` to remove entries where `type === 'reflection' && (m.level || 1) > 1`. Delete `maxReflectionLevel` and `reflectionLevelMultiplier` from `data.settings` if present.
4. **Register:** In `src/store/migrations/index.js`, import `migrateToV7`, add `{ version: 7, run: migrateToV7 }` to `MIGRATIONS` array, bump `CURRENT_SCHEMA_VERSION` to 7.
5. **Verify:** Run `npx vitest run tests/store/migrations.test.js` and ensure all tests pass.
6. **Commit:** `feat(migration): v7 deletes Level 2+ reflections, removes level settings`

---

### Task 2: Simplify Reflection Decay in `calculateScore`

**Objective:** Remove level-aware decay from the scoring formula, leaving a single decay path for all reflections.

**Files to modify:**
- Modify: `src/retrieval/math.js` (Purpose: Simplify reflection decay in `calculateScore`, remove `level`/`levelDivisor`/`reflectionLevelMultiplier` usage)
- Modify: `src/store/schemas.js` (Purpose: Remove `reflectionLevelMultiplier` from `ScoringConfigSchema` and `ForgetfulnessConstantsSchema`)
- Test: `tests/retrieval/math.test.js` (Purpose: Remove level-aware decay tests, verify simplified decay still works)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/retrieval/math.js` lines 329–341 (reflection decay block). Read `src/store/schemas.js` lines 164–174 (`ScoringConfigSchema`) and lines 306–312 (`ForgetfulnessConstantsSchema`). Read `tests/retrieval/math.test.js` lines 447–502 (level divisor tests).
2. **Write Failing Test:** In `tests/retrieval/math.test.js`:
   - Remove the entire `describe('Reflection decay with level divisor')` block (both tests)
   - Add a new test: "should apply decay to reflections beyond threshold" — verify that a reflection at distance 1000 (past threshold 750) gets a lower score than one at distance 500. Use inline objects (math test convention). Constants should NOT include `reflectionLevelMultiplier`.
3. **Implement:** In `src/retrieval/math.js`, replace the level-aware decay block (lines 329–341) with:
   ```
   if (memory.type === 'reflection' && distance > constants.reflectionDecayThreshold) {
       const threshold = constants.reflectionDecayThreshold;
       const decayFactor = Math.max(0.25, 1 - (distance - threshold) / (2 * threshold));
       total *= decayFactor;
   }
   ```
   Remove the `reflectionLevelMultiplier` reference and the `level` variable. In `src/store/schemas.js`, remove `reflectionLevelMultiplier: z.number().min(1).max(10)` from `ScoringConfigSchema` (line 168) and `reflectionLevelMultiplier: z.number().optional()` from `ForgetfulnessConstantsSchema` (line 311).
4. **Verify:** Run `npx vitest run tests/retrieval/math.test.js` and ensure all tests pass.
5. **Commit:** `feat(scoring): remove level-aware reflection decay`

---

### Task 3: Simplify Reflection Prompt Builder

**Objective:** Remove level-aware synthesis instructions from the prompt builder so the LLM only sees events in the candidate set.

**Files to modify:**
- Modify: `src/prompts/reflection/builder.js` (Purpose: Remove `hasOldReflections` detection, `levelIndicator`, level-aware rules, and `levelAwareInstruction`)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/prompts/reflection/builder.js` in full (89 lines).
2. **Implement Changes:**
   - Remove the `hasOldReflections` variable and its detection (line 37)
   - Remove `levelIndicator` from the memory list formatting (line 42) — the line becomes: `` `${m.id}. [${importance}] ${m.summary}` ``
   - Change the `rules` variable (lines 47–54) to always use `UNIFIED_REFLECTION_RULES` without the appended level-aware synthesis rules
   - Remove the `levelAwareInstruction` variable (lines 64–66)
   - Remove `${levelAwareInstruction}` from the user prompt (line 84)
3. **Verify:** Run `npx vitest run` — prompt changes should not break any existing tests. No prompt-content tests exist per test conventions.
4. **Commit:** `feat(prompts): remove level-aware synthesis from reflection prompt`

---

### Task 4: Flatten Reflection Generation in `reflect.js`

**Objective:** Remove multi-tier synthesis from the reflection engine — candidate set becomes events only, all generated reflections are forced to Level 1.

**Files to modify:**
- Modify: `src/reflection/reflect.js` (Purpose: Remove `oldReflections` collection, force `level: 1` and `parent_ids: []`, remove `defaultSettings` import for `maxReflectionLevel`)
- Test: `tests/reflection/reflect.test.js` (Purpose: Remove Level 2+ tests, update candidate set test)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/reflection/reflect.js` in full (347 lines). Read `tests/reflection/reflect.test.js` lines 255–510.
2. **Write Failing Test:** In `tests/reflection/reflect.test.js`:
   - Remove the entire `describe('Reflection level derivation from parent_ids')` block (lines 297–484, both tests)
   - Update `describe('Old reflections in candidate set')` (lines 486–510): Change the test to verify that the candidate set does NOT include reflections — only events. The test should filter to events only and assert `candidateSet` contains no reflections.
   - Keep `describe('Reflection level and parent_ids fields')` (lines 255–295) — its assertions (`level === 1`, `parent_ids` is array) are already correct for the flattened model.
3. **Implement:** In `src/reflection/reflect.js`:
   - Remove the `oldReflections` line (line 232: `const oldReflections = accessibleMemories.filter(...)`)
   - Replace the candidate set construction (line 235) with: `const candidateSet = recentMemories;`
   - In the reflection object construction (lines 278–315), replace the entire level/parent detection block with fixed values:
     - `source_ids: evidence_ids` (keep all evidence IDs as-is)
     - `parent_ids: []`
     - `level: 1`
   - Remove the `defaultSettings` import (line 17) — check if it's still needed elsewhere in the file. If not, remove it from the import statement.
4. **Verify:** Run `npx vitest run tests/reflection/reflect.test.js` and ensure all tests pass.
5. **Commit:** `feat(reflection): flatten to Level 1, remove multi-tier synthesis`

---

### Task 5: Clean Up Constants and Settings

**Objective:** Remove `maxReflectionLevel` and `reflectionLevelMultiplier` from `defaultSettings`, `UI_DEFAULT_HINTS`, and all remaining references.

**Files to modify:**
- Modify: `src/constants.js` (Purpose: Remove `maxReflectionLevel` and `reflectionLevelMultiplier` from `defaultSettings` and `UI_DEFAULT_HINTS`)
- Modify: `src/reflection/CLAUDE.md` (Purpose: Update documentation to remove Level 2+ references)
- Modify: `include/DATA_SCHEMA.md` (Purpose: Update reflection schema to reflect single-tier model)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/constants.js` lines 57–127 (`defaultSettings`) and lines 236–278 (`UI_DEFAULT_HINTS`). Read `src/reflection/CLAUDE.md`.
2. **Implement:**
   - In `src/constants.js`, remove `maxReflectionLevel: 3` from `defaultSettings` (line 112) and `reflectionLevelMultiplier: 2.0` (line 113)
   - In `UI_DEFAULT_HINTS`, remove `maxReflectionLevel` (line 270) and `reflectionLevelMultiplier` (line 271)
   - In `src/reflection/CLAUDE.md`, update the pipeline description to remove Level 2+ references: remove the bullet about "Recursive Linking", update "Level-Aware Decay" to just "Reflection Decay" without level mention, update "Candidate Set" to say events only (no old reflections)
   - In `include/DATA_SCHEMA.md`, search for any `level`, `parent_ids`, `maxReflectionLevel`, or `reflectionLevelMultiplier` references and update to reflect the single-tier model
3. **Verify:** Run `npx vitest run` to ensure nothing is broken.
4. **Commit:** `chore: remove maxReflectionLevel and reflectionLevelMultiplier from settings`

---

### Task 6: Regenerate Types and Final Verification

**Objective:** Run the type generator (Zod schemas changed), run the full test suite, and verify the `npm run check` pipeline passes.

**Files to modify:**
- Modify: `src/types.d.ts` (Purpose: Auto-regenerated from Zod schemas — `reflectionLevelMultiplier` removed from config types)
- Modify: `docs/designs/2026-05-22-flatten-reflections-level-1.md` (Purpose: Mark design doc as approved)

**Instructions for Execution Agent:**
1. **Context Setup:** Read `src/types.d.ts` to understand what will change.
2. **Execute:** Run `npm run generate-types` to regenerate `src/types.d.ts` from the updated Zod schemas. Verify `reflectionLevelMultiplier` is gone from the generated types.
3. **Verify:** Run `npm run check` — this runs sync-version, generate-types, lint, jsdoc, css, and typecheck. All must pass.
4. **Run full test suite:** `npx vitest run` — all tests must pass.
5. **Commit:** `chore: regenerate types after reflection flattening`
