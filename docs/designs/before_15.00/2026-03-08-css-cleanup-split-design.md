# Design: CSS Cleanup & Component Split

## 1. Problem Statement

`style.css` is a 1,369-line monolith containing 113 class selectors. 20 classes (~18%) are dead code from past refactors (legacy `openvault-memory-item-*`, batch info, old stat styles). The file has no logical grouping, making it hard to locate styles for a specific UI component.

## 2. Goals & Non-Goals

**Must do:**
- Delete all 20 confirmed-unused CSS classes (~150-200 lines)
- Split into ~10 component-scoped files under `css/`
- Keep `style.css` as the single manifest entry, using `@import` to load parts
- Add a dead-CSS lint script to the existing pre-commit hook

**Won't do:**
- CSS-in-JS, CSS modules, or build tooling (this is a vanilla SillyTavern extension)
- Rename any classes (no functional changes)
- Refactor HTML templates or JS to match new file boundaries

## 3. Proposed Architecture

### File Structure

```
openvault/
├── style.css              ← @import hub only (~12 lines)
├── css/
│   ├── base.css           ← Root, animations, utility classes
│   ├── tabs.css           ← Tab navigation
│   ├── cards.css          ← Generic cards + memory cards + edit forms
│   ├── dashboard.css      ← Status indicator, stats, toggles, batch progress
│   ├── forms.css          ← Search, settings groups, checkboxes, filters
│   ├── navigation.css     ← Buttons, pagination, status badges
│   ├── world.css          ← Communities, entities, characters, emotions
│   ├── details.css        ← Collapsible drawers, help content
│   ├── budget.css         ← Budget indicators, payload calculator
│   └── prefill.css        ← Custom prefill dropdown with preview
├── scripts/
│   └── check-css.js       ← Dead-CSS lint (Node, zero deps)
└── .githooks/
    └── pre-commit         ← Extended with CSS check
```

### `style.css` (new contents)

```css
/* OpenVault Extension Styles */
@import url('css/base.css');
@import url('css/tabs.css');
@import url('css/cards.css');
@import url('css/dashboard.css');
@import url('css/forms.css');
@import url('css/navigation.css');
@import url('css/world.css');
@import url('css/details.css');
@import url('css/budget.css');
@import url('css/prefill.css');
```

### Component File Map

| File | Classes | ~Lines | Contents |
|------|---------|--------|----------|
| `base.css` | ~10 | ~50 | `#openvault_settings`, `@keyframes` (pulse-glow, spin, pulse), `.openvault-hint`, `.openvault-default-hint`, `.openvault-placeholder`, `.openvault-footer` |
| `tabs.css` | 5 | ~40 | `.openvault-tab-nav`, `.openvault-tab-btn`, `.openvault-tab-content`, `.openvault-section` variants |
| `cards.css` | ~25 | ~200 | `.openvault-card-*`, `.openvault-memory-card-*`, `.openvault-edit-*` |
| `dashboard.css` | ~20 | ~170 | `.openvault-status-*`, `.openvault-stat-card`, `.openvault-stats-grid`, `.openvault-quick-toggle*`, `.openvault-batch-progress-*`, `.openvault-embedding-status`, `.working` state |
| `forms.css` | ~12 | ~100 | `.openvault-search-*`, `.openvault-settings-group*`, `#openvault_settings` form elements (checkbox, range, select), `.openvault-filters` |
| `navigation.css` | ~8 | ~60 | `.openvault-test-btn`, `.openvault-status` (badge), `.openvault-button-row`, `.menu_button.*`, `.openvault-pagination` |
| `world.css` | ~15 | ~110 | `.openvault-community-*`, `.openvault-entity-*`, `.openvault-character-*`, `.openvault-emotion-*`, `.openvault-reflection-*` |
| `details.css` | ~8 | ~80 | `.openvault-details*`, `.openvault-help-content*` |
| `budget.css` | ~10 | ~60 | `.openvault-budget-*`, `.openvault-payload-*`, `.payload-safe/caution/warning/danger` |
| `prefill.css` | ~10 | ~90 | `.openvault-prefill-*` |

## 4. Dead Code to Remove

All 20 classes confirmed zero references across HTML and JS:

**Legacy memory-item system** (9 classes, replaced by memory-card):
- `.openvault-memory-item`, `.openvault-memory-header`, `.openvault-memory-type`, `.openvault-memory-date`, `.openvault-memory-summary`, `.openvault-memory-actions`, `.openvault-memory-importance`
- `.openvault-memory-card-icon`, `.openvault-memory-card-type`

**Legacy batch info** (4 classes, replaced by batch-progress):
- `.openvault-batch-info`, `.openvault-batch-label`, `.openvault-batch-row`, `.openvault-batch-value`

**Legacy stat styles** (3 classes, replaced by stat-card):
- `.openvault-stat-label`, `.openvault-stat-value`, `.openvault-stats-compact`

**Misc unreferenced** (4 classes):
- `.openvault-advanced-toggle`, `.openvault-advanced-content`, `.openvault-badge`, `.openvault-section`

## 5. Lint Script Design

### `scripts/check-css.js`

Zero-dependency Node script. Logic:

1. Read all `css/*.css` files
2. Extract class selectors via regex: `/\.(openvault-[\w-]+)/g`
3. Read all `*.html` + `src/**/*.js` + `index.js` files
4. For each CSS class, check if it appears as a string literal anywhere in JS/HTML
5. Report unused classes and exit with code 1 if any found

Edge cases handled:
- Classes constructed dynamically in JS (e.g., `openvault-memory-card ${type}`) — the script checks substring matches, not whole-word. Classes built from variables (like `.action`, `.revelation`) are modifier classes applied alongside the base class, so the base class will still be found.
- Non-`openvault-` selectors (like `.payload-safe`, `.menu_button.danger`) — included in scan.

### Pre-commit hook extension

Append to `.githooks/pre-commit`:

```bash
# Check for dead CSS (only if CSS files were staged)
CSS_FILES=$(echo "$STAGED_FILES" | grep -E '\.css$' || true)
if [ -n "$CSS_FILES" ]; then
    echo "Checking for unused CSS classes..."
    node scripts/check-css.js
fi
```

## 6. Risks & Edge Cases

| Risk | Mitigation |
|------|------------|
| `@import` ordering matters for specificity | All selectors are class-based, no overlapping specificity conflicts exist. Order in `style.css` matches original declaration order. |
| SillyTavern caching of `style.css` | `@import` is resolved at load time by the browser, not by ST. No caching issues. |
| Dynamic class construction misses in lint | The lint checks substring presence, not exact class names. `openvault-memory-card` will match even if constructed as template literal. Modifier-only classes (`.action`, `.ready`) are scoped under parent selectors in CSS, so their parent base class is the one that needs to be referenced. |
| `manifest.json` only supports `"css": "style.css"` | Confirmed — single CSS entry. `@import` in that file is the correct approach. No manifest changes needed. |
| `repomix:source` script references `style.css` | Update include glob to `style.css,css/**` |

## 7. Execution Order

1. Create `css/` directory
2. Split classes from `style.css` into 10 component files (excluding dead code)
3. Replace `style.css` contents with `@import` hub
4. Create `scripts/check-css.js`
5. Extend `.githooks/pre-commit`
6. Update `package.json` repomix include glob
7. Verify: open ST, confirm extension loads, all tabs render correctly
