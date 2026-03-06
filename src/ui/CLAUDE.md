# OpenVault UI Subsystem

## WHAT
Handles the extension settings panel, stats display, and the interactive memory browser within SillyTavern.

## HOW: Architecture
We use standard jQuery (provided by SillyTavern), but enforce a strict separation of concerns:
- **`helpers.js`**: Pure data transformation and calculation (pagination, formatting). **Zero DOM interaction.**
- **`templates.js`**: Pure functions that return HTML strings. **Zero state mutation.**
- **`render.js`**: State orchestration and DOM manipulation (`$()`).
- **`settings.js`**: Settings panel event binding and persistence.

## PATTERNS

### Slider/Range Input Binding
Use the `bindSetting` helper for standard int/float/bool settings:
```javascript
bindSetting('setting_name', 'settingKey');           // int
bindSetting('alpha', 'alpha', 'float');              // float
bindSetting('enabled', 'enabled', 'bool');           // bool (uses 'change' event)
bindSetting('budget', 'budget', 'int', (v) => ...)   // with callback
```
- Display element has `_value` suffix (auto-updated for int/float)
- For token budgets, use `updateWordsDisplay(value, 'element_id_words')` callback
- Keep manual handlers for string inputs, complex validation, or async operations

### List Renderer Pattern
```javascript
function renderEntityList() {
    const $container = $('#openvault_entity_list');
    const $count = $('#openvault_entity_count');
    const data = getOpenVaultData();
    const items = data?.graph?.nodes || {};
    // filter, then map through template, then $container.html(html)
}
```
- Container: `#openvault_xxx_list`
- Count badge: `#openvault_xxx_count`
- Get data via `getOpenVaultData()`
- Show `<p class="openvault-placeholder">` for empty state
- Bind filter events in `initBrowser()` with debounced search (200ms timeout)

### Naming Conventions
- Input IDs: `openvault_setting_name` (snake_case)
- Display value IDs: `openvault_setting_name_value` (add `_value`)
- Setting keys: `camelCase` (e.g., `reflectionThreshold`)
- Template functions: `renderXxxYyy` (e.g., `renderCommunityAccordion`)
- Helper filters: `filterXxxYyy` (e.g., `filterEntities`)

## GOTCHAS & RULES
- **No Inline Event Handlers**: Bind all events using jQuery `.on()` in `initBrowser()` or `bindUIElements()`.
- **XSS Prevention**: Always wrap dynamic user data in `escapeHtml()` from `src/utils.js` before placing it in template strings.
- **Debounced Saves**: Always use `getDeps().saveSettingsDebounced()` when an input changes to avoid spamming the ST backend.
- **Manual Backfill Guard**: `handleExtractAll()` checks `isWorkerRunning()` from `src/extraction/worker.js` before starting. Shows warning toast if background worker is active. Mutual exclusion with the worker (worker also yields if manual backfill starts).