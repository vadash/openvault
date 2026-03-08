# Plan: CSS Cleanup & Component Split

**Design:** `docs/designs/2026-03-08-css-cleanup-split-design.md`

## Task 1: Split `style.css` into component files

1. Create `css/` directory.
2. Create 10 component files by extracting selectors from `style.css`:
   - `css/base.css` — `#openvault_settings` root, `@keyframes` (pulse-glow, spin, pulse), `.openvault-hint`, `.openvault-default-hint`, `.openvault-placeholder`, `.openvault-footer`
   - `css/tabs.css` — `.openvault-tab-nav`, `.openvault-tab-btn*`, `.openvault-tab-content*`
   - `css/cards.css` — `.openvault-card*`, `.openvault-memory-card*`, `.openvault-edit-*`
   - `css/dashboard.css` — `.openvault-status-card`, `.openvault-status-indicator*`, `.openvault-stats-grid`, `.openvault-stat-card*`, `.openvault-quick-toggle*`, `.openvault-stats`, `.openvault-stat` (non-card), `.openvault-batch-progress*`, `.openvault-embedding-status*`, `#openvault_settings.working *`
   - `css/forms.css` — `.openvault-search-*`, `.openvault-settings-group*`, `#openvault_settings .checkbox_label*`, `#openvault_settings input[type="range"]`, `#openvault_settings select.text_pole`, `.openvault-filters`
   - `css/navigation.css` — `.openvault-test-btn*`, `.openvault-status` (badge), `.openvault-button-row`, `.menu_button.wide`, `.menu_button.danger*`, `.openvault-pagination*`, `#openvault_page_info`
   - `css/world.css` — `.openvault-community-*`, `.openvault-entity-*`, `.openvault-character-*`, `.openvault-emotion-*`, `.openvault-reflection-*`, `.openvault-danger *`
   - `css/details.css` — `.openvault-details*`, `.openvault-help-content*`
   - `css/budget.css` — `.openvault-budget-*`, `.openvault-payload-*`, `.payload-safe/caution/warning/danger`
   - `css/prefill.css` — `.openvault-prefill-*`
3. **Do NOT include** the 20 dead classes (listed in design §4).
4. Replace `style.css` contents with `@import` hub (10 imports).

- Verify: `grep -r "openvault-" css/ | wc -l` should be ~93 unique classes. `wc -l style.css` should be ~12 lines.
- Commit: `style: split style.css into 10 component files under css/`

## Task 2: Dead-CSS lint script

1. Create `scripts/check-css.js`:
   - Read all `css/*.css` files.
   - Extract class selectors via regex.
   - Read `templates/**/*.html` + `src/**/*.js` + `index.js`.
   - Report any class not found in JS/HTML. Exit 1 on failures.
2. Extend `.githooks/pre-commit` to run `node scripts/check-css.js` when `.css` files are staged.

- Verify: `node scripts/check-css.js` exits 0 (no unused classes after cleanup).
- Commit: `chore: add dead-CSS lint script and pre-commit hook`

## Task 3: Update build/tool config

1. Update `package.json` repomix include glob: `style.css` → `style.css,css/**`.
2. Add `"check-css": "node scripts/check-css.js"` to scripts.

- Verify: `npm run lint` passes. `npm test` passes.
- Commit: `chore: update repomix glob and add check-css script`
