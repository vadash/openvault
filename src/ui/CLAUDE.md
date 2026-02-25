# OpenVault UI Subsystem

## WHAT
Handles the extension settings panel, stats display, and the interactive memory browser within SillyTavern.

## HOW: Architecture
We use standard jQuery (provided by SillyTavern), but enforce a strict separation of concerns:
- **`helpers.js`**: Pure data transformation and calculation (pagination, formatting). **Zero DOM interaction.**
- **`templates.js`**: Pure functions that return HTML strings. **Zero state mutation.**
- **`render.js`**: State orchestration and DOM manipulation (`$()`).
- **`settings.js`**: Settings panel event binding and persistence.

## GOTCHAS & RULES
- **No Inline Event Handlers**: Bind all events using jQuery `.on()` in `initBrowser()` or `bindUIElements()`.
- **XSS Prevention**: Always wrap dynamic user data in `escapeHtml()` from `src/utils.js` before placing it in template strings.
- **Debounced Saves**: Always use `getDeps().saveSettingsDebounced()` when an input changes to avoid spamming the ST backend.