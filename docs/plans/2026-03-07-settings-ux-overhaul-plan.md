# Implementation Plan — Settings UX Overhaul

> **Reference:** `docs/designs/2026-03-07-settings-ux-overhaul-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Add `PAYLOAD_CALC` constants & update defaults

**Goal:** Single source of truth for all payload calculator magic numbers. Lower slider defaults so the out-of-box total = 32k (green).

**Step 1: Write the Failing Test**
- File: `tests/constants.test.js`
- Code:
  ```javascript
  import { describe, it, expect } from 'vitest';
  import { PAYLOAD_CALC, defaultSettings } from '../src/constants.js';

  describe('PAYLOAD_CALC', () => {
      it('exports all required fields', () => {
          expect(PAYLOAD_CALC.LLM_OUTPUT_TOKENS).toBe(8000);
          expect(PAYLOAD_CALC.PROMPT_ESTIMATE).toBe(2000);
          expect(PAYLOAD_CALC.SAFETY_BUFFER).toBe(2000);
          expect(PAYLOAD_CALC.OVERHEAD).toBe(12000);
          expect(PAYLOAD_CALC.THRESHOLD_GREEN).toBe(32000);
          expect(PAYLOAD_CALC.THRESHOLD_YELLOW).toBe(48000);
          expect(PAYLOAD_CALC.THRESHOLD_ORANGE).toBe(64000);
      });

      it('default slider sum + overhead = THRESHOLD_GREEN', () => {
          const total = defaultSettings.extractionTokenBudget
              + defaultSettings.extractionRearviewTokens
              + PAYLOAD_CALC.OVERHEAD;
          expect(total).toBe(PAYLOAD_CALC.THRESHOLD_GREEN);
      });
  });

  describe('defaultSettings updated defaults', () => {
      it('extractionTokenBudget is 12000', () => {
          expect(defaultSettings.extractionTokenBudget).toBe(12000);
      });

      it('extractionRearviewTokens is 8000', () => {
          expect(defaultSettings.extractionRearviewTokens).toBe(8000);
      });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/constants.test.js`
- Expect: Fail — `PAYLOAD_CALC` is not exported; defaults are still 16000/12000.

**Step 3: Implementation (Green)**
- File: `src/constants.js`
- Action 1: Change `extractionTokenBudget: 16000` → `extractionTokenBudget: 12000`
- Action 2: Change `extractionRearviewTokens: 12000` → `extractionRearviewTokens: 8000`
- Action 3: Add the following export **after** the `QUERY_CONTEXT_DEFAULTS` block and **before** the `UI_DEFAULT_HINTS` block:

  ```javascript
  /**
   * Payload calculator constants — single source of truth.
   * Used by the settings UI to show how much total context the background LLM needs.
   * OVERHEAD = output tokens reserved for LLM response + prompt template estimate + safety buffer.
   * Thresholds determine the color-coded severity of the total.
   */
  export const PAYLOAD_CALC = {
      LLM_OUTPUT_TOKENS: 8000,   // Matches maxTokens in all LLM_CONFIGS (see llm.js)
      PROMPT_ESTIMATE: 2000,     // Approximate system/user prompt template size
      SAFETY_BUFFER: 2000,       // Headroom for variance in prompt size
      /** Derived: total overhead added on top of user-controlled sliders */
      get OVERHEAD() { return this.LLM_OUTPUT_TOKENS + this.PROMPT_ESTIMATE + this.SAFETY_BUFFER; },
      /** Color thresholds for total context (sliders + OVERHEAD) */
      THRESHOLD_GREEN: 32000,    // ≤ this = safe (green ✅)
      THRESHOLD_YELLOW: 48000,   // ≤ this = caution (yellow ⚠️)
      THRESHOLD_ORANGE: 64000,   // ≤ this = warning (orange 🟠), above = danger (red 🔴)
  };
  ```

- Note: `UI_DEFAULT_HINTS.extractionTokenBudget` and `UI_DEFAULT_HINTS.contextWindowSize` already derive from `defaultSettings`, so they auto-update.

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/constants.test.js`
- Expect: PASS

**Step 5: Git Commit**
- `git add src/constants.js tests/constants.test.js && git commit -m "feat: add PAYLOAD_CALC constants, lower extraction defaults to fit 32k"`

---

## Task 2: Drawer CSS + Payload Calculator CSS

**Goal:** Replace flat `.openvault-details` styles with accent-stripe drawers. Add color-coded payload calculator classes.

**Step 1: No unit test** (CSS-only change — visual verification)

**Step 2: Implementation**
- File: `style.css`
- Action 1: Replace the entire `.openvault-details` block (lines 1079–1096, from `.openvault-details {` through `.openvault-details summary i {`) with:

  ```css
  /* ── Drawer (collapsible details) ─────────────────────── */
  .openvault-details {
      margin-top: 10px;
      border-left: 3px solid var(--SmartThemeQuoteColor, #4a90d9);
      border-radius: 4px;
      background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 40%, transparent);
      overflow: hidden;
  }

  .openvault-details summary {
      cursor: pointer;
      padding: 8px 12px;
      font-weight: 600;
      font-size: 0.9em;
      color: var(--SmartThemeBodyColor, #ccc);
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
      transition: background 0.15s ease;
      list-style: none;
  }

  .openvault-details summary:hover {
      background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 60%, transparent);
  }

  /* Chevron — rotates 90° on open */
  .openvault-details summary::after {
      content: '›';
      font-size: 1.2em;
      font-weight: bold;
      transition: transform 0.2s ease;
      margin-left: auto;
      padding-left: 8px;
  }

  .openvault-details[open] > summary::after {
      transform: rotate(90deg);
  }

  /* Content area padding */
  .openvault-details .openvault-settings-group,
  .openvault-details .openvault-help-content {
      padding: 8px 12px 12px;
  }

  /* Remove default browser disclosure triangle */
  .openvault-details summary::-webkit-details-marker,
  .openvault-details summary::marker {
      display: none;
      content: '';
  }

  .openvault-details summary i {
      margin-right: 2px;
  }
  ```

- Action 2: Add the following **immediately after** the drawer block above:

  ```css
  /* ── Payload Calculator ─────────────────────────────── */
  .openvault-payload-calc {
      margin-top: 10px;
      padding: 8px 10px;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.1);
      font-size: 0.9em;
      line-height: 1.6;
  }

  .openvault-payload-breakdown {
      font-size: 0.8em;
      color: var(--SmartThemeEmColor, #888);
  }

  .openvault-payload-hint {
      font-size: 0.8em;
      color: var(--SmartThemeEmColor, #888);
      font-style: italic;
  }

  .payload-safe { color: #5cb85c; }
  .payload-caution { color: #f0ad4e; }
  .payload-warning { color: #e87d2a; }
  .payload-danger { color: #d9534f; font-weight: bold; }
  ```

**Step 3: Verify**
- Command: Open SillyTavern, open OpenVault settings. Visually confirm:
  1. All `<details>` sections now have a blue left accent stripe, tinted background, and `›` chevron.
  2. Chevron rotates downward when section is opened.
  3. Hover over summary text — background brightens.
  4. No browser default triangle/marker visible.

**Step 4: Git Commit**
- `git add style.css && git commit -m "style: drawer accent-stripe + payload calculator color classes"`

---

## Task 3: Split Tab 2 HTML into 4 sub-groups + Payload Calculator

**Goal:** Replace the single "Extraction & Graph Rules" `<details>` with 4 collapsed groups. Add the payload calculator readout inside group 1.

**Step 1: No unit test** (HTML restructure — visual verification)

**Step 2: Implementation**
- File: `templates/settings_panel.html`
- Action: Replace the entire `<!-- Extraction & Graph Rules (collapsed) -->` block (the single `<details>` containing all 12+ sliders) with the following 4 `<details>` blocks. The slider HTML inside each group stays exactly the same — only the container `<details>` + `<summary>` wrapper changes.

  **Group 1: Background LLM Payload**
  ```html
  <!-- Background LLM Payload -->
  <details class="openvault-details" style="margin-top: 15px;">
      <summary><i class="fa-solid fa-microchip"></i> Background LLM Payload</summary>
      <div class="openvault-settings-group">
          <!-- Extraction Token Budget slider (existing, unchanged) -->
          <label for="openvault_extraction_token_budget">
              Extraction Token Budget: <span id="openvault_extraction_token_budget_value">12000</span> tokens
              <small class="openvault-default-hint" data-default-key="extractionTokenBudget"></small>
          </label>
          <input type="range" id="openvault_extraction_token_budget" min="4000" max="64000" step="1000" value="12000" />
          <small class="openvault-hint">Token threshold for extraction batches. When unextracted messages accumulate past this budget, a batch is processed. Larger = fewer LLM calls, smaller = more frequent extraction.</small>

          <div class="openvault-budget-indicator">
              <span class="openvault-budget-label">Unextracted:</span>
              <div class="openvault-budget-bar">
                  <div class="openvault-budget-fill" id="openvault_extraction_budget_fill"></div>
              </div>
              <span class="openvault-budget-text" id="openvault_extraction_budget_text">0 / 12k</span>
          </div>

          <div style="height: 8px;"></div>

          <!-- Context Window Size slider (existing, unchanged) -->
          <label for="openvault_extraction_rearview">
              Context Window Size: <span id="openvault_extraction_rearview_value">8000</span> tokens
              <small class="openvault-default-hint" data-default-key="contextWindowSize"></small>
              <small class="openvault-words-hint">~<span id="openvault_extraction_rearview_words">6000</span> words</small>
          </label>
          <input type="range" id="openvault_extraction_rearview" min="1000" max="32000" step="1000" value="8000" />
          <small class="openvault-hint">How much past memories the LLM sees when writing new memories</small>

          <!-- Payload Calculator (NEW) -->
          <div id="openvault_payload_calculator" class="openvault-payload-calc">
              <span id="openvault_payload_emoji">✅</span>
              Estimated total: ~<span id="openvault_payload_total">32,000</span> tokens
              <div class="openvault-payload-breakdown" id="openvault_payload_breakdown">
                  (12k batch + 8k rearview + 12k overhead)
              </div>
              <div class="openvault-payload-hint">
                  Ensure your Extraction Profile supports this context size.
              </div>
          </div>
      </div>
  </details>
  ```

  **Group 2: Reflection Engine**
  ```html
  <!-- Reflection Engine -->
  <details class="openvault-details" style="margin-top: 10px;">
      <summary><i class="fa-solid fa-lightbulb"></i> Reflection Engine</summary>
      <div class="openvault-settings-group">
          <!-- Contains (moved from original block, HTML unchanged):
               - Reflection Threshold slider
               - Max Insights per Reflection slider
               - Reflection 3-Tier Dedup System (the dark box with reject/replace/add)
               - Max Reflections per Character slider
               - Reflection Decay Threshold slider
          -->
          {paste existing HTML for these 5 controls exactly as-is, including spacer divs}
      </div>
  </details>
  ```

  **Group 3: Graph & Communities**
  ```html
  <!-- Graph & Communities -->
  <details class="openvault-details" style="margin-top: 10px;">
      <summary><i class="fa-solid fa-diagram-project"></i> Graph & Communities</summary>
      <div class="openvault-settings-group">
          <!-- Contains (moved from original block, HTML unchanged):
               - Entity Description Cap slider
               - Edge Description Cap slider
               - Community Detection Interval slider
               - Community Staleness Threshold slider
          -->
          {paste existing HTML for these 4 controls exactly as-is, including spacer divs}
      </div>
  </details>
  ```

  **Group 4: System Limits**
  ```html
  <!-- System Limits -->
  <details class="openvault-details" style="margin-top: 10px;">
      <summary><i class="fa-solid fa-gauge"></i> System Limits</summary>
      <div class="openvault-settings-group">
          <!-- Contains (moved from original block, HTML unchanged):
               - Backfill Rate Limit (RPM) input
          -->
          {paste existing HTML for this 1 control exactly as-is}
      </div>
  </details>
  ```

- **Critical:** Every slider's `id`, `min`, `max`, `step`, `value`, and associated `<span id>` must be preserved exactly. Only the wrapping `<details>` changes. Update the `value` attributes for `openvault_extraction_token_budget` to `12000` and `openvault_extraction_rearview` to `8000` to match new defaults.

**Step 3: Verify**
- Command: Open SillyTavern → OpenVault → Memories tab. Confirm:
  1. Four separate drawer sections visible (all collapsed).
  2. "Background LLM Payload" contains 2 sliders + budget indicator + payload calculator readout.
  3. "Reflection Engine" contains 5 controls.
  4. "Graph & Communities" contains 4 sliders.
  5. "System Limits" contains 1 input.
  6. All sliders still save their values (drag any slider, refresh page, value persists).

**Step 4: Git Commit**
- `git add templates/settings_panel.html && git commit -m "feat: split Tab 2 into 4 drawer groups, add payload calculator HTML"`

---

## Task 4: Split Tab 3 HTML into 2 sub-groups

**Goal:** Replace the single "Retrieval & Injection" `<details>` with 2 collapsed groups.

**Step 1: No unit test** (HTML restructure — visual verification)

**Step 2: Implementation**
- File: `templates/settings_panel.html`
- Action: Replace the entire `<!-- Retrieval & Injection (collapsed) -->` block with 2 `<details>` blocks:

  **Group 1: Prompt Injection Budgets**
  ```html
  <!-- Prompt Injection Budgets -->
  <details class="openvault-details" style="margin-top: 15px;">
      <summary><i class="fa-solid fa-syringe"></i> Prompt Injection Budgets</summary>
      <div class="openvault-settings-group">
          <!-- Contains (moved, HTML unchanged):
               - Final Context Budget slider + words hint
               - World Context Budget slider + words hint
               - Visible Chat Budget slider + budget indicator
          -->
          {paste existing HTML for these 3 controls + indicator exactly as-is, including spacer divs}
      </div>
  </details>
  ```

  **Group 2: Entity Detection Rules**
  ```html
  <!-- Entity Detection Rules -->
  <details class="openvault-details" style="margin-top: 10px;">
      <summary><i class="fa-solid fa-magnifying-glass-chart"></i> Entity Detection Rules</summary>
      <div class="openvault-settings-group">
          <!-- Contains (moved, HTML unchanged):
               - Entity Window slider
               - Embedding Window slider
               - Top Entities slider
               - Entity Boost slider
          -->
          {paste existing HTML for these 4 controls exactly as-is, including spacer divs}
      </div>
  </details>
  ```

- **Critical:** Same rule — preserve all `id` attributes and attributes exactly. Only the wrapping `<details>` changes.

**Step 3: Verify**
- Command: Open SillyTavern → OpenVault → World tab. Confirm:
  1. Two separate drawer sections visible below the entity browser (both collapsed).
  2. "Prompt Injection Budgets" contains 3 sliders + budget indicator.
  3. "Entity Detection Rules" contains 4 sliders.
  4. All sliders still save values.

**Step 4: Git Commit**
- `git add templates/settings_panel.html && git commit -m "feat: split Tab 3 into 2 drawer groups"`

---

## Task 5: Wire `updatePayloadCalculator()` in settings.js

**Goal:** Add the calculator logic, import `PAYLOAD_CALC`, call from slider handlers and `updateUI()`.

**Step 1: Write the Failing Test**
- File: `tests/payload-calculator.test.js`
- Code:
  ```javascript
  import { describe, it, expect } from 'vitest';
  import { PAYLOAD_CALC } from '../src/constants.js';

  /**
   * Test the pure calculation logic that updatePayloadCalculator() uses.
   * We can't test DOM manipulation in vitest, but we can test the threshold logic.
   */
  function getPayloadSeverity(budget, rearview) {
      const total = budget + rearview + PAYLOAD_CALC.OVERHEAD;
      if (total <= PAYLOAD_CALC.THRESHOLD_GREEN) return { total, severity: 'safe', emoji: '✅' };
      if (total <= PAYLOAD_CALC.THRESHOLD_YELLOW) return { total, severity: 'caution', emoji: '⚠️' };
      if (total <= PAYLOAD_CALC.THRESHOLD_ORANGE) return { total, severity: 'warning', emoji: '🟠' };
      return { total, severity: 'danger', emoji: '🔴' };
  }

  describe('Payload severity calculation', () => {
      it('defaults (12k + 8k) = 32k = green', () => {
          const r = getPayloadSeverity(12000, 8000);
          expect(r.total).toBe(32000);
          expect(r.severity).toBe('safe');
          expect(r.emoji).toBe('✅');
      });

      it('16k + 8k = 36k = yellow', () => {
          const r = getPayloadSeverity(16000, 8000);
          expect(r.total).toBe(36000);
          expect(r.severity).toBe('caution');
      });

      it('32k + 8k = 52k = orange', () => {
          const r = getPayloadSeverity(32000, 8000);
          expect(r.total).toBe(52000);
          expect(r.severity).toBe('warning');
      });

      it('48k + 16k = 76k = red', () => {
          const r = getPayloadSeverity(48000, 16000);
          expect(r.total).toBe(76000);
          expect(r.severity).toBe('danger');
      });

      it('boundary: exactly 32k = green (inclusive)', () => {
          const r = getPayloadSeverity(12000, 8000);
          expect(r.total).toBe(32000);
          expect(r.severity).toBe('safe');
      });

      it('boundary: 32001 = yellow', () => {
          // 12001 + 8000 + 12000 = 32001
          const r = getPayloadSeverity(12001, 8000);
          expect(r.total).toBe(32001);
          expect(r.severity).toBe('caution');
      });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npx vitest run tests/payload-calculator.test.js`
- Expect: PASS (these test pure logic using already-exported `PAYLOAD_CALC` from Task 1). If Task 1 is done, this should be green immediately. This is a "green from start" test to lock down the boundary logic before wiring it into the DOM.

**Step 3: Implementation (Green)**
- File: `src/ui/settings.js`
- Action 1: Add `PAYLOAD_CALC` to the import from `../constants.js`:
  ```javascript
  import {
      defaultSettings,
      embeddingModelPrefixes,
      extensionFolderPath,
      extensionName,
      MEMORIES_KEY,
      PAYLOAD_CALC,
      QUERY_CONTEXT_DEFAULTS,
      UI_DEFAULT_HINTS,
  } from '../constants.js';
  ```

- Action 2: Add the following function in the `// Helper Functions` section (after `updateReflectionDedupDisplay`):
  ```javascript
  /**
   * Update the payload calculator readout.
   * Reads current slider values, adds PAYLOAD_CALC.OVERHEAD, sets emoji + color class.
   */
  function updatePayloadCalculator() {
      const budget = Number($('#openvault_extraction_token_budget').val()) || 12000;
      const rearview = Number($('#openvault_extraction_rearview').val()) || 8000;
      const total = budget + rearview + PAYLOAD_CALC.OVERHEAD;

      $('#openvault_payload_total').text(total.toLocaleString());

      // Breakdown: show each component so user understands
      const bStr = Math.round(budget / 1000) + 'k';
      const rStr = Math.round(rearview / 1000) + 'k';
      const oStr = Math.round(PAYLOAD_CALC.OVERHEAD / 1000) + 'k';
      $('#openvault_payload_breakdown').text(
          `(${bStr} batch + ${rStr} rearview + ${oStr} overhead)`
      );

      // Color thresholds — all from PAYLOAD_CALC, no magic numbers here
      const $calc = $('#openvault_payload_calculator');
      $calc.removeClass('payload-safe payload-caution payload-warning payload-danger');
      let emoji;
      if (total <= PAYLOAD_CALC.THRESHOLD_GREEN) {
          $calc.addClass('payload-safe');
          emoji = '✅';
      } else if (total <= PAYLOAD_CALC.THRESHOLD_YELLOW) {
          $calc.addClass('payload-caution');
          emoji = '⚠️';
      } else if (total <= PAYLOAD_CALC.THRESHOLD_ORANGE) {
          $calc.addClass('payload-warning');
          emoji = '🟠';
      } else {
          $calc.addClass('payload-danger');
          emoji = '🔴';
      }
      $('#openvault_payload_emoji').text(emoji);
  }
  ```

- Action 3: Modify the two existing slider bindings to also call `updatePayloadCalculator`:
  ```javascript
  // BEFORE:
  bindSetting('extraction_token_budget', 'extractionTokenBudget');
  bindSetting('extraction_rearview', 'extractionRearviewTokens', 'int', (v) =>
      updateWordsDisplay(v, 'openvault_extraction_rearview_words')
  );

  // AFTER:
  bindSetting('extraction_token_budget', 'extractionTokenBudget', 'int', () =>
      updatePayloadCalculator()
  );
  bindSetting('extraction_rearview', 'extractionRearviewTokens', 'int', (v) => {
      updateWordsDisplay(v, 'openvault_extraction_rearview_words');
      updatePayloadCalculator();
  });
  ```

- Action 4: Add `updatePayloadCalculator();` call at the end of `updateUI()`, just before the `refreshAllUI()` call:
  ```javascript
  // ... (end of updateUI function, before refreshAllUI)

  // Payload calculator — must run after sliders are synced
  updatePayloadCalculator();

  // Refresh all UI components
  refreshAllUI();
  ```

- Action 5: Update the fallback default values in `updateUI()` to match new defaults:
  ```javascript
  // BEFORE:
  $('#openvault_extraction_token_budget').val(settings.extractionTokenBudget ?? 16000);
  $('#openvault_extraction_token_budget_value').text(settings.extractionTokenBudget ?? 16000);

  // AFTER:
  $('#openvault_extraction_token_budget').val(settings.extractionTokenBudget ?? 12000);
  $('#openvault_extraction_token_budget_value').text(settings.extractionTokenBudget ?? 12000);
  ```

**Step 4: Verify (Green)**
- Command: `npx vitest run tests/payload-calculator.test.js`
- Expect: PASS
- Manual: Open SillyTavern → OpenVault → Memories → Background LLM Payload.
  1. Calculator shows "✅ Estimated total: ~32,000 tokens" with green text.
  2. Drag Extraction Token Budget to 16k → calculator updates to "⚠️ ~36,000 tokens" in yellow.
  3. Drag to 48k → "🟠 ~68,000 tokens" — wait, 48k + 8k + 12k = 68k → red 🔴. Confirm red.
  4. Reset sliders to 12k + 8k → back to green ✅.

**Step 5: Git Commit**
- `git add src/ui/settings.js tests/payload-calculator.test.js && git commit -m "feat: wire updatePayloadCalculator into settings UI"`
