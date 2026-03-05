# Implementation Plan - Settings UI Restructure & Missing Bindings

> **Reference:** `docs/designs/2026-03-05-settings-ui-restructure-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Add `dedupJaccardThreshold` to Constants & Update Hints

**Goal:** Add the missing default and ensure all 7 new settings have UI hint entries.

**Step 1: Write the Failing Test**
- File: `tests/constants.test.js`
- Code:
  ```javascript
  // Append to existing file

  describe('dedupJaccardThreshold default', () => {
      it('has dedupJaccardThreshold in defaultSettings', () => {
          expect(defaultSettings.dedupJaccardThreshold).toBe(0.6);
      });

      it('has dedupJaccardThreshold in UI_DEFAULT_HINTS', () => {
          expect(UI_DEFAULT_HINTS.dedupJaccardThreshold).toBe(0.6);
      });
  });

  describe('all settings used in backend have UI hints', () => {
      const requiredHints = [
          'forgetfulnessBaseLambda',
          'forgetfulnessImportance5Floor',
          'reflectionDecayThreshold',
          'entityDescriptionCap',
          'maxReflectionsPerCharacter',
          'communityStalenessThreshold',
          'dedupJaccardThreshold',
      ];

      for (const key of requiredHints) {
          it(`has UI_DEFAULT_HINTS.${key}`, () => {
              expect(UI_DEFAULT_HINTS[key]).toBeDefined();
              expect(UI_DEFAULT_HINTS[key]).toBe(defaultSettings[key]);
          });
      }
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/constants.test.js`
- Expect: Failures for `dedupJaccardThreshold` missing from `defaultSettings` and several missing `UI_DEFAULT_HINTS` entries.

**Step 3: Implementation (Green)**
- File: `src/constants.js`
- Action 1: Add `dedupJaccardThreshold: 0.6` to `defaultSettings` after `dedupSimilarityThreshold`:
  ```javascript
  // Deduplication settings
  dedupSimilarityThreshold: 0.85, // Cosine similarity threshold for filtering duplicates (0-1)
  dedupJaccardThreshold: 0.6,     // Token-overlap (Jaccard index) threshold for near-duplicate filtering
  ```
- Action 2: Add all 7 missing entries to `UI_DEFAULT_HINTS`:
  ```javascript
  // Decay & forgetfulness curve tuning
  forgetfulnessBaseLambda: defaultSettings.forgetfulnessBaseLambda,
  forgetfulnessImportance5Floor: defaultSettings.forgetfulnessImportance5Floor,
  reflectionDecayThreshold: defaultSettings.reflectionDecayThreshold,
  // Graph cap settings
  entityDescriptionCap: defaultSettings.entityDescriptionCap,
  maxReflectionsPerCharacter: defaultSettings.maxReflectionsPerCharacter,
  // Dedup & staleness
  dedupJaccardThreshold: defaultSettings.dedupJaccardThreshold,
  ```
  Note: `communityStalenessThreshold` already exists in `UI_DEFAULT_HINTS`.

**Step 4: Verify (Green)**
- Command: `npm test tests/constants.test.js`
- Expect: ALL PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add dedupJaccardThreshold default and missing UI hint entries"`

---

## Task 2: Add 7 Missing Setting Bindings to `settings.js`

**Goal:** Wire up `bindUIElements()` and `updateUI()` for all 7 unbound settings so the HTML elements (added in Task 3) will work.

**Step 1: Write the Failing Test**
- File: `tests/ui/settings-bindings.test.js`
- Code:
  ```javascript
  import { describe, expect, it, vi, beforeEach } from 'vitest';

  // -------------------------------------------------------------------------
  // Test: settings.js must bind and update all 7 new settings.
  //
  // Strategy: We read the source file as text and verify that the jQuery
  // selectors and saveSetting() calls exist for each new setting. This avoids
  // needing a full DOM + SillyTavern runtime.
  // -------------------------------------------------------------------------

  import { readFileSync } from 'node:fs';
  import { resolve } from 'node:path';

  const settingsSource = readFileSync(resolve('src/ui/settings.js'), 'utf-8');

  describe('settings.js binds all 7 new settings', () => {
      // Each entry: [HTML element ID prefix, settings key]
      const newBindings = [
          ['openvault_forgetfulness_lambda', 'forgetfulnessBaseLambda'],
          ['openvault_importance5_floor', 'forgetfulnessImportance5Floor'],
          ['openvault_reflection_decay_threshold', 'reflectionDecayThreshold'],
          ['openvault_entity_description_cap', 'entityDescriptionCap'],
          ['openvault_max_reflections', 'maxReflectionsPerCharacter'],
          ['openvault_community_staleness', 'communityStalenessThreshold'],
          ['openvault_dedup_jaccard', 'dedupJaccardThreshold'],
      ];

      for (const [elementId, settingsKey] of newBindings) {
          it(`binds #${elementId} to saveSetting('${settingsKey}')`, () => {
              // Verify the input handler exists in bindUIElements
              expect(settingsSource).toContain(`#${elementId}`);
              expect(settingsSource).toContain(`'${settingsKey}'`);
          });

          it(`updateUI sets #${elementId} value`, () => {
              // Verify updateUI populates the element
              expect(settingsSource).toContain(`#${elementId}_value`);
          });
      }
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/ui/settings-bindings.test.js`
- Expect: Failures — source file doesn't contain the new selectors yet.

**Step 3: Implementation (Green)**
- File: `src/ui/settings.js`
- Action 1: Add to `bindUIElements()` (after the existing community interval binding, before action buttons):
  ```javascript
  // =========================================================================
  // NEW: Forgetfulness curve settings (decay math)
  // Controls how fast memories lose relevance over time.
  // =========================================================================

  // Base decay rate — lower values make memories persist longer.
  // Used by math.js exponential decay: score * e^(-lambda * age)
  $('#openvault_forgetfulness_lambda').on('input', function () {
      const value = parseFloat($(this).val());
      saveSetting('forgetfulnessBaseLambda', value);
      $('#openvault_forgetfulness_lambda_value').text(value);
  });

  // Minimum retrieval score for importance-5 (max importance) memories.
  // Ensures critical memories never fully decay below this floor.
  $('#openvault_importance5_floor').on('input', function () {
      const value = parseInt($(this).val(), 10);
      saveSetting('forgetfulnessImportance5Floor', value);
      $('#openvault_importance5_floor_value').text(value);
  });

  // =========================================================================
  // NEW: Reflection decay threshold
  // After this many messages, reflections begin to lose retrieval priority.
  // =========================================================================
  $('#openvault_reflection_decay_threshold').on('input', function () {
      const value = parseInt($(this).val(), 10);
      saveSetting('reflectionDecayThreshold', value);
      $('#openvault_reflection_decay_threshold_value').text(value);
  });

  // =========================================================================
  // NEW: Entity description cap
  // Limits how many description segments an entity accumulates (FIFO).
  // Prevents entity descriptions from growing unbounded in long chats.
  // =========================================================================
  $('#openvault_entity_description_cap').on('input', function () {
      const value = parseInt($(this).val(), 10);
      saveSetting('entityDescriptionCap', value);
      $('#openvault_entity_description_cap_value').text(value);
  });

  // =========================================================================
  // NEW: Max reflections per character
  // Caps total reflection memories per character to prevent bloat.
  // Oldest reflections are pruned when this limit is exceeded.
  // =========================================================================
  $('#openvault_max_reflections').on('input', function () {
      const value = parseInt($(this).val(), 10);
      saveSetting('maxReflectionsPerCharacter', value);
      $('#openvault_max_reflections_value').text(value);
  });

  // =========================================================================
  // NEW: Community staleness threshold
  // Messages since last community detection before summaries are considered
  // stale. Stale communities are re-summarized on next detection cycle.
  // =========================================================================
  $('#openvault_community_staleness').on('input', function () {
      const value = parseInt($(this).val(), 10);
      saveSetting('communityStalenessThreshold', value);
      $('#openvault_community_staleness_value').text(value);
  });

  // =========================================================================
  // NEW: Jaccard dedup threshold
  // Token-overlap (Jaccard index) filter for near-duplicate memories.
  // Lower = more aggressive dedup. Used alongside cosine similarity dedup.
  // =========================================================================
  $('#openvault_dedup_jaccard').on('input', function () {
      const value = parseFloat($(this).val());
      saveSetting('dedupJaccardThreshold', value);
      $('#openvault_dedup_jaccard_value').text(value);
  });
  ```

- Action 2: Add to `updateUI()` (after the existing community interval block):
  ```javascript
  // =========================================================================
  // NEW: Sync 7 previously-unbound settings to their HTML elements.
  // Each block reads the current value (with fallback default) and sets
  // both the <input> value and the adjacent <span> display text.
  // =========================================================================

  // Forgetfulness base lambda — exponential decay rate
  $('#openvault_forgetfulness_lambda').val(settings.forgetfulnessBaseLambda ?? 0.05);
  $('#openvault_forgetfulness_lambda_value').text(settings.forgetfulnessBaseLambda ?? 0.05);

  // Importance-5 floor — minimum score for max-importance memories
  $('#openvault_importance5_floor').val(settings.forgetfulnessImportance5Floor ?? 5);
  $('#openvault_importance5_floor_value').text(settings.forgetfulnessImportance5Floor ?? 5);

  // Reflection decay threshold — messages before reflections start decaying
  $('#openvault_reflection_decay_threshold').val(settings.reflectionDecayThreshold ?? 500);
  $('#openvault_reflection_decay_threshold_value').text(settings.reflectionDecayThreshold ?? 500);

  // Entity description cap — max description segments per entity
  $('#openvault_entity_description_cap').val(settings.entityDescriptionCap ?? 3);
  $('#openvault_entity_description_cap_value').text(settings.entityDescriptionCap ?? 3);

  // Max reflections per character — prevents reflection memory bloat
  $('#openvault_max_reflections').val(settings.maxReflectionsPerCharacter ?? 50);
  $('#openvault_max_reflections_value').text(settings.maxReflectionsPerCharacter ?? 50);

  // Community staleness threshold — messages before re-summarization
  $('#openvault_community_staleness').val(settings.communityStalenessThreshold ?? 100);
  $('#openvault_community_staleness_value').text(settings.communityStalenessThreshold ?? 100);

  // Jaccard dedup threshold — token-overlap filter for near-duplicates
  $('#openvault_dedup_jaccard').val(settings.dedupJaccardThreshold ?? 0.6);
  $('#openvault_dedup_jaccard_value').text(settings.dedupJaccardThreshold ?? 0.6);
  ```

**Step 4: Verify (Green)**
- Command: `npm test tests/ui/settings-bindings.test.js`
- Expect: ALL PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add 7 missing setting bindings in settings.js"`

---

## Task 3: Restructure HTML from 5 Tabs to 4 Tabs

**Goal:** Rewrite `templates/settings_panel.html` to use the 4-tab browsers-first layout defined in the design doc.

**Step 1: Write the Failing Test**
- File: `tests/ui/settings-panel-structure.test.js`
- Code:
  ```javascript
  import { describe, expect, it } from 'vitest';
  import { readFileSync } from 'node:fs';
  import { resolve } from 'node:path';

  // -------------------------------------------------------------------------
  // Test: Validate the HTML template has the correct 4-tab structure
  // and contains all 7 new slider inputs with proper IDs.
  // -------------------------------------------------------------------------

  const html = readFileSync(resolve('templates/settings_panel.html'), 'utf-8');

  describe('settings_panel.html tab structure', () => {
      it('has exactly 4 tab buttons', () => {
          const tabBtns = html.match(/class="openvault-tab-btn[^"]*"/g);
          expect(tabBtns).toHaveLength(4);
      });

      it('has tab: dashboard-connections', () => {
          expect(html).toContain('data-tab="dashboard-connections"');
      });

      it('has tab: memory-bank', () => {
          expect(html).toContain('data-tab="memory-bank"');
      });

      it('has tab: world', () => {
          expect(html).toContain('data-tab="world"');
      });

      it('has tab: advanced', () => {
          expect(html).toContain('data-tab="advanced"');
      });

      it('does NOT have old tab: configuration', () => {
          expect(html).not.toContain('data-tab="configuration"');
      });

      it('does NOT have old tab: system', () => {
          expect(html).not.toContain('data-tab="system"');
      });
  });

  describe('settings_panel.html has all 7 new slider inputs', () => {
      const newInputIds = [
          'openvault_forgetfulness_lambda',
          'openvault_importance5_floor',
          'openvault_reflection_decay_threshold',
          'openvault_entity_description_cap',
          'openvault_max_reflections',
          'openvault_community_staleness',
          'openvault_dedup_jaccard',
      ];

      for (const id of newInputIds) {
          it(`contains input#${id}`, () => {
              expect(html).toContain(`id="${id}"`);
          });

          it(`contains value display #${id}_value`, () => {
              expect(html).toContain(`id="${id}_value"`);
          });
      }
  });

  describe('settings_panel.html has default-hint spans for new settings', () => {
      const newHintKeys = [
          'forgetfulnessBaseLambda',
          'forgetfulnessImportance5Floor',
          'reflectionDecayThreshold',
          'entityDescriptionCap',
          'maxReflectionsPerCharacter',
          'dedupJaccardThreshold',
      ];

      for (const key of newHintKeys) {
          it(`has default-hint for ${key}`, () => {
              expect(html).toContain(`data-default-key="${key}"`);
          });
      }
  });

  describe('settings_panel.html collapsed sections', () => {
      // Tab 1: Dashboard & Connections should have a collapsed "Connection Settings" section
      it('has collapsed Connection Settings section', () => {
          expect(html).toContain('Connection Settings');
      });

      // Tab 2: Memory Bank should have a collapsed "Extraction & Graph Rules" section
      it('has collapsed Extraction & Graph Rules section', () => {
          expect(html).toContain('Extraction');
      });

      // Tab 3: World should have a collapsed "Retrieval & Injection" section
      it('has collapsed Retrieval section', () => {
          expect(html).toContain('Retrieval');
      });

      // Tab 4: Advanced should have Decay Math section
      it('has Decay Math section in advanced', () => {
          expect(html).toContain('Decay');
      });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/ui/settings-panel-structure.test.js`
- Expect: Failures — old tab structure (5 tabs), missing new input IDs.

**Step 3: Implementation (Green)**
- File: `templates/settings_panel.html`
- Action: Full rewrite of the tab structure. This is the largest task. The exact HTML is specified below.

**Tab navigation replacement:**
```html
<!-- Tab Navigation — 4 tabs, browsers-first layout -->
<div class="openvault-tab-nav">
    <button class="openvault-tab-btn active" data-tab="dashboard-connections">
        <i class="fa-solid fa-gauge-high"></i> Dashboard
    </button>
    <button class="openvault-tab-btn" data-tab="memory-bank">
        <i class="fa-solid fa-brain"></i> Memories
    </button>
    <button class="openvault-tab-btn" data-tab="world">
        <i class="fa-solid fa-globe"></i> World
    </button>
    <button class="openvault-tab-btn" data-tab="advanced">
        <i class="fa-solid fa-sliders"></i> Advanced
    </button>
</div>
```

**Tab 1: Dashboard & Connections** — Keep existing dashboard HTML (status card, stats grid, batch progress, quick toggles). Add a collapsed `<details>` section containing: Extraction Profile dropdown, Embedding Source + Ollama settings, Debug/Request Logging checkboxes.

**Tab 2: Memory Bank** — Keep existing memory browser HTML (search, filters, list, pagination, character states, reflection progress). Add a collapsed `<details>` section "Extraction & Graph Rules" containing: Messages per Extraction, Context Window Size, Entity Description Cap (NEW), Edge Description Cap, Reflection Threshold, Max Insights, Reflection Dedup Threshold, Max Reflections per Character (NEW), Reflection Decay Threshold (NEW), Community Detection Interval, Community Staleness Threshold (NEW), Backfill Rate Limit.

**Tab 3: World** — Keep existing world browser HTML (community list, entity browser). Add a collapsed `<details>` section "Retrieval & Injection" containing: Final Context Budget, World Context Budget, Auto-hide Threshold, Entity Window, Embedding Window, Top Entities, Entity Boost.

**Tab 4: Advanced** — Sections for: Scoring & Weights (Alpha, Combined Boost), Decay Math (Forgetfulness Lambda NEW, Importance-5 Floor NEW), Similarity Thresholds (Vector, Cosine Dedup, Jaccard Dedup NEW, Reflection Dedup, Entity Merge), System (Debug, Request Logging, Export Debug, Danger Zone).

**New slider HTML pattern** (repeat for each of the 7 new settings):
```html
<!-- Forgetfulness Base Lambda — controls exponential memory decay rate.
     Lower values make memories persist longer. Used in math.js scoring. -->
<label for="openvault_forgetfulness_lambda">
    Decay Rate (Lambda): <span id="openvault_forgetfulness_lambda_value">0.05</span>
    <small class="openvault-default-hint" data-default-key="forgetfulnessBaseLambda"></small>
</label>
<input type="range" id="openvault_forgetfulness_lambda" min="0.01" max="0.20" step="0.01" value="0.05" />
<small class="openvault-hint">How fast memories fade. Lower = memories last longer. 0.05 = moderate, 0.01 = near-permanent.</small>
```

Slider specs for all 7:

| ID | Label | min | max | step | default | Hint text |
|----|-------|-----|-----|------|---------|-----------|
| `openvault_forgetfulness_lambda` | Decay Rate (Lambda) | 0.01 | 0.20 | 0.01 | 0.05 | How fast memories fade. Lower = longer persistence. |
| `openvault_importance5_floor` | Importance-5 Floor | 1 | 20 | 1 | 5 | Minimum score for max-importance memories. Higher = critical memories stay relevant. |
| `openvault_reflection_decay_threshold` | Reflection Decay Threshold | 100 | 2000 | 50 | 500 | Messages before reflections start losing priority. |
| `openvault_entity_description_cap` | Entity Description Cap | 1 | 10 | 1 | 3 | Max description segments per entity. Older segments are evicted (FIFO). |
| `openvault_max_reflections` | Max Reflections per Character | 10 | 200 | 10 | 50 | Caps total reflection memories per character. Prevents bloat in long chats. |
| `openvault_community_staleness` | Community Staleness Threshold | 20 | 500 | 10 | 100 | Messages before community summaries are considered stale. |
| `openvault_dedup_jaccard` | Jaccard Dedup Threshold | 0.30 | 0.90 | 0.05 | 0.60 | Token-overlap filter for near-duplicates. Lower = more aggressive dedup. |

**Step 4: Verify (Green)**
- Command: `npm test tests/ui/settings-panel-structure.test.js`
- Expect: ALL PASS

**Step 5: Additional Verification**
- Command: `npm test`
- Expect: ALL tests pass (including existing `ui-templates.test.js` which doesn't depend on tab structure).

**Step 6: Git Commit**
- Command: `git add . && git commit -m "feat: restructure settings panel from 5 tabs to 4 browsers-first tabs"`

---

## Task 4: Update Tab Initialization for New Tab Names

**Goal:** Ensure `initTabs()` works with the renamed tab data attributes and defaults to the first tab gracefully.

**Step 1: Write the Failing Test**
- File: `tests/ui/settings-bindings.test.js` (append)
- Code:
  ```javascript
  describe('settings.js handles new tab names', () => {
      it('does not reference old tab name "configuration"', () => {
          expect(settingsSource).not.toContain('"configuration"');
      });

      it('does not reference old tab name "system"', () => {
          // Check for data-tab="system" style references, not the word "system" in comments
          expect(settingsSource).not.toMatch(/data-tab=["']system["']/);
      });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test tests/ui/settings-bindings.test.js`
- Expect: Should already pass if settings.js doesn't hardcode tab names. If it references old names, fix them.

**Step 3: Implementation (Green)**
- File: `src/ui/settings.js`
- Action: Verify `initTabs()` uses dynamic `data-tab` attribute lookups (it does — current code is already generic via `$(this).data('tab')`). No changes needed unless tests fail.

**Step 4: Verify (Green)**
- Command: `npm test tests/ui/settings-bindings.test.js`
- Expect: ALL PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "test: verify tab initialization handles new tab names"`

---

## Task 5: Full Regression Test

**Goal:** Run the complete test suite and lint to ensure nothing is broken.

**Step 1: Run All Tests**
- Command: `npm test`
- Expect: ALL PASS

**Step 2: Run Linter**
- Command: `npm run lint`
- Expect: No errors

**Step 3: Git Commit (if any lint fixes needed)**
- Command: `git add . && git commit -m "chore: lint fixes for settings restructure"`

---

## Execution Order Summary

```
Task 1: constants.js — Add dedupJaccardThreshold + UI hints
    ↓
Task 2: settings.js — Add 7 bind + updateUI blocks
    ↓
Task 3: settings_panel.html — Full 4-tab restructure + 7 new sliders
    ↓
Task 4: settings.js — Verify tab init compatibility
    ↓
Task 5: Full regression
```

Tasks 1 and 2 can be done in parallel since they touch different files. Task 3 depends on knowing the element IDs from Task 2. Task 4 is a verification pass. Task 5 is the final gate.
