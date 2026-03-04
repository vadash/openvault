# Execution Plan: Prompts & Quality Improvements

**Design:** `docs/designs/2026-03-04-prompts-quality-improvements-design.md`

---

## Phase 1: Bug Fixes (Workstream A + D.1)

### Task 1.1: Fix character state corruption

**Files:** `src/extraction/extract.js`

1. Modify `updateCharacterStatesFromEvents` to accept a `validCharNames` parameter (array of known character names)
2. Build a `validSet` from: `validCharNames` + all `characters_involved` from current event batch (all lowercased)
3. Before creating/updating a character state entry, check `validSet.has(charName.toLowerCase())`
4. If not in set, `log()` a warning and `continue`
5. Update all callers of `updateCharacterStatesFromEvents` to pass `[characterName, userName]` from the chat context

**Verify:** `npm test` passes. Write a unit test in the appropriate test file that confirms a bogus character name like `"don"` is skipped when not in `validCharNames`.

**Commit:** `fix: validate character names in emotional_impact before creating state entries`

### Task 1.2: Add character state cleanup on chat load

**Files:** `src/extraction/extract.js` or `src/utils.js` (wherever chat load initialization happens)

1. Add a `cleanupCharacterStates(data, validCharNames)` function
2. Iterate `data[CHARACTERS_KEY]`, remove entries where `name.toLowerCase()` is not in any memory's `characters_involved` AND not in `validCharNames`
3. Call this during chat initialization (find the appropriate hook)

**Verify:** `npm test` passes. Unit test confirms corrupted entries are removed.

**Commit:** `fix: cleanup corrupted character states on chat load`

### Task 1.3: Add star legend to scene_memory

**Files:** `src/retrieval/formatting.js`

1. In `formatContextForInjection`, change the opening lines from:
   ```
   <scene_memory>
   (#693 messages)
   ```
   to:
   ```
   <scene_memory>
   (#693 messages | ★=minor ★★★=notable ★★★★★=critical)
   ```
2. Update any existing tests for `formatContextForInjection` output format

**Verify:** `npm test` passes.

**Commit:** `feat: add importance star legend to scene_memory header`

---

## Phase 2: Debug Observability (Workstream G + C.1)

### Task 2.1: Cache scoring breakdown in debug-cache

**Files:** `src/retrieval/debug-cache.js`, `src/retrieval/scoring.js`

1. In `debug-cache.js`, add a `cachedScoringDetails` variable and `cacheScoringDetails(scoredResults, selectedIds)` function
2. The function stores: for each scored memory, `{ memoryId, type, summary (truncated to 80 chars), scores: { base, baseAfterFloor, recencyPenalty, vectorSimilarity, vectorBonus, bm25Score, bm25Bonus, total }, selected: boolean, distance }`
3. In `scoring.js` → `selectRelevantMemories` (or equivalent), after scoring and selection, call `cacheScoringDetails(scoredResults, selectedMemoryIds)`
4. Add `getCachedScoringDetails()` export to debug-cache

**Verify:** `npm test` passes.

**Commit:** `feat: cache per-memory scoring breakdown for debug export`

### Task 2.2: Add aggregate stats to debug export

**Files:** `src/retrieval/debug-cache.js`, `src/ui/export-debug.js`

1. Compute aggregate stats from cached scoring details:
   - `totalScored`, `selected`, `reflectionsScored`, `reflectionsSelected`, `eventsScored`, `eventsSelected`
   - `avgReflectionScore`, `avgEventScore`, `topScore`, `cutoffScore`
2. Include top 10 rejected memories (highest-scoring non-selected) in export
3. Wire into the debug export function so `scoringDetails` and `stats` appear in the export JSON

**Verify:** `npm test` passes. Manual test: trigger debug export and confirm scoring data appears.

**Commit:** `feat: add scoring stats and rejected memories to debug export`

### Task 2.3: Add retrieval_hits tracking

**Files:** `src/retrieval/scoring.js`

1. After final memory selection, increment `memory.retrieval_hits = (memory.retrieval_hits || 0) + 1` for each selected memory
2. This mutates the memory objects in-place (they're references to chatMetadata objects)
3. The next save cycle will persist the counter

**Verify:** `npm test` passes.

**Commit:** `feat: track retrieval_hits counter on memories`

---

## Phase 3: Prompt Tuning (Workstream B)

### Task 3.1: Make reasoning field configurable

**Files:** `src/constants.js`, `src/prompts.js`, `src/extraction/structured.js`, `src/ui/settings.js`, `templates/settings_panel.html`

1. Add `extractionReasoning: false` to `defaultSettings` in `constants.js`
2. In `buildExtractionPrompt`, accept `reasoning` option from context/settings
3. When `reasoning === false`:
   - Remove `"reasoning"` key from the `<output_schema>` description
   - Remove `<thinking_process>` section entirely
   - Change the schema reference from 4 keys to 3 keys
   - Update the "CRITICAL FORMAT RULES" count
4. In `structured.js`, the `ExtractionResponseSchema` already has `reasoning: z.string().nullable().default(null)` — this is fine, it'll just be absent from output
5. Add a checkbox toggle in the settings panel under Config tab

**Verify:** `npm test` passes. Verify prompt output with reasoning=true and reasoning=false both produce valid prompts.

**Commit:** `feat: configurable reasoning field in extraction prompt`

### Task 3.2: Generalize dedup rules

**Files:** `src/prompts.js`

1. Replace the current `<dedup_rules>` section with the genre-neutral version from the design doc
2. The 4 conditions become:
   - New action type begins
   - Major outcome occurs (climax, death, unconsciousness, escape, capture)
   - New element changes scene nature (new character, weapon, secret, kink/toy)
   - Explicit boundary set or broken (safeword, surrender, betrayal, promise)

**Verify:** `npm test` passes.

**Commit:** `feat: generalize extraction dedup rules beyond NSFW content`

### Task 3.3: Diversify extraction examples

**Files:** `src/prompts.js`

1. Remove one redundant NSFW dedup example (keep `dedup_oral_continuation`, remove `dedup_sex_continuation` since they teach the same lesson)
2. Add a `political_betrayal` example (confrontation/revelation scene)
3. Add an `adventure_dedup` example (combat continuation → empty events)
4. Final example mix target: 3 NSFW, 3 adventure/political/emotional, 2 dedup demonstrations

**Verify:** `npm test` passes.

**Commit:** `feat: diversify extraction prompt examples across genres`

---

## Phase 4: Entity Quality (Workstream E)

### Task 4.1: Cap entity descriptions

**Files:** `src/graph/graph.js`

1. In `upsertEntity`, when merging descriptions:
   - Split existing description by `' | '`
   - Check if new description already exists (exact match)
   - If not, append new description
   - If count > 3, remove the oldest (first) entry
   - Rejoin with `' | '`
2. Make cap configurable: read from settings (`entityDescriptionCap`, default 3)

**Verify:** `npm test` passes. Write unit test: upsert same entity 5 times with different descriptions, confirm only last 3 remain.

**Commit:** `feat: cap entity descriptions at 3 segments`

### Task 4.2: Improve entity key normalization

**Files:** `src/graph/graph.js`

1. Add `normalizeEntityKey(name)` function:
   - `.toLowerCase()`
   - Strip possessives: `.replace(/[''\u2019]s\b/g, '')`
   - Collapse whitespace: `.replace(/\s+/g, ' ').trim()`
2. Use `normalizeEntityKey` instead of bare `.toLowerCase().trim()` in `upsertEntity` and `upsertRelationship`
3. Update edge key generation to use normalized keys

**Verify:** `npm test` passes. Write unit test: `"Vova's Apartment"` and `"Vova's apartment"` map to same key.

**Commit:** `feat: improve entity key normalization to reduce duplicates`

---

## Phase 5: Reflection Quality (Workstream C.2 + C.3)

### Task 5.1: Add reflection decay in scoring

**Files:** `src/retrieval/math.js`, `src/constants.js`

1. Add `reflectionDecayThreshold: 500` to `defaultSettings`
2. In `calculateScore`, after computing `total`:
   - If `memory.type === 'reflection'` and distance > threshold:
     - `decayFactor = Math.max(0.25, 1 - (distance - threshold) / (2 * threshold))`
     - `total *= decayFactor`
3. Pass the threshold through the `constants` parameter

**Verify:** `npm test` passes. Write unit test: reflection at distance 1000 with threshold 500 scores lower than same reflection at distance 100.

**Commit:** `feat: apply decay multiplier to old reflections in scoring`

### Task 5.2: Add reflection cap per character

**Files:** `src/reflection/reflect.js`, `src/constants.js`

1. Add `maxReflectionsPerCharacter: 50` to `defaultSettings`
2. In `generateReflections`, before generating new reflections:
   - Count existing reflections for this character
   - If count >= cap, mark oldest reflections (by sequence) as `archived: true`
3. In retrieval scoring, skip memories where `archived === true`

**Verify:** `npm test` passes.

**Commit:** `feat: cap reflections per character with archival of oldest`

---

## Phase 6: Community Freshness (Workstream F)

### Task 6.1: Community staleness detection and refresh

**Files:** `src/graph/communities.js`, `src/constants.js`

1. Add `communityStalenessThreshold: 100` to `defaultSettings`
2. In `updateCommunitySummaries` (or its caller in `extract.js`):
   - Check each community's `lastUpdated` vs current `graph_message_count`
   - If delta > threshold, mark for re-summarization even if membership unchanged
3. Special case: if Louvain produces a single community, always re-summarize at the staleness interval

**Verify:** `npm test` passes.

**Commit:** `feat: re-summarize stale communities based on message threshold`

### Task 6.2: Add reflection type tag in scene_memory

**Files:** `src/retrieval/formatting.js`

1. In `formatMemory`, check `memory.type === 'reflection'`
2. If reflection, append ` ⟨insight⟩` to the formatted line
3. Result: `[★★★★] Suzy's fear of abandonment drives her attachment ⟨insight⟩`

**Verify:** `npm test` passes.

**Commit:** `feat: tag reflections with ⟨insight⟩ in scene_memory output`

---

## Final Verification

1. Run `npm test` — all tests pass
2. Run manual extraction on a test chat to confirm extraction still works
3. Trigger debug export and confirm scoring breakdown appears
4. Review git log for clean commit history
