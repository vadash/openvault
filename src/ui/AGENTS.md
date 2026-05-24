# UI, DOM, and Progressive Disclosure

## PROGRESSIVE DISCLOSURE ARCHITECTURE
- **Structure tabs by workflow.** `Dashboard` (Status/Toggles/Emergency Cut), `Memories` (Browser/Extract settings), `World` (Pure viewer), `Advanced` (Expert math/Danger Zone), `Perf` (Metrics).
- **Hide expert settings in Drawers.** Use `<details class="openvault-details">`. Do not expose vector thresholds or decay lambda without a warning banner.
- **Decouple DOM from Domain.** Route UI clicks through thin wrapper functions in `settings.js`. Pass callbacks (`onProgress`, `onError`) down to domain orchestrators (`extract.js`).

## DOM & JQUERY CONVENTIONS
- **Bind events centrally.** Use `bindSetting()` in `initBrowser()`. Never use inline HTML `onclick`.
- **Mount modals to `document.body`.** Avoid SillyTavern's extension panel CSS stacking context issues (e.g. `z-index` clipping) by appending the Emergency Cut modal directly to the body.
- **Trap keyboard focus.** Ensure modal `Escape` handlers work, but `stopPropagation()` to prevent ST from swallowing the keypress.
- **Sanitize dynamically rendered text.** Wrap all user-generated strings (summaries, character names) in `escapeHtml()`.

## PROMISE HYGIENE
- **Always chain `.catch()` on fire-and-forget promises.** Clipboard API calls (`navigator.clipboard.writeText`) and dynamic imports (`import('./module')`) that aren't `await`ed must have `.catch(() => {})` on the outer `.then()` to prevent unhandled rejection warnings in the browser.

## PAYLOAD CALCULATOR
- **Use `PAYLOAD_CALC` as the single source of truth.** (`src/constants.js`). 
- **Include overhead in warnings.** Calculate `Budget + Rearview + 12k Overhead`. Display severity colors: Green (≤32k), Yellow (≤48k), Orange (≤64k), Red (>64k).

## SETTINGS MANAGEMENT
- **Preserve connection settings on reset.** `handleResetSettings()` must cache `embeddingSource`, `ollamaUrl`, and API limits before restoring default math thresholds.

## INLINE EDITING PATTERN
- **Store edit state in a Map.** Use `entityEditState = new Map()` keyed by entity key to support cancel/revert.
- **Replace card DOM with form.** Use `$card.replaceWith(editHtml)` to swap view ↔ edit mode; use `data-key` attributes for event delegation.
- **Clean up edit state on delete.** Call `entityEditState.delete(key)` in the delete handler to prevent stale entries.
- **Build aliases from chip DOM on save.** Iterate `.openvault-alias-chip` elements, strip the `×` character, collect text values.

## MERGE PICKER PATTERN
- **Replace card DOM with merge panel.** Use `$card.replaceWith(pickerHtml)` — same pattern as inline editing.
- **Use native `<datalist>` for entity selection.** No custom jQuery dropdowns. The input's `list` attribute points to a `<datalist>` with `<option>` values for each entity name/type.
- **Resolve target key from input text on confirm.** Call `findMergeTargetFromInput()` which matches the input string (case-insensitive, stripped of type suffixes like ` [PERSON]`) against node names and aliases. Do not store keys in `data-key` on `<option>` elements — browsers don't expose them reliably.
- **Restore card view on cancel.** Call `renderEntityList()` to re-render, not DOM surgery.

## ENTITY / COMMUNITY TABS
- **Entities tab** (`data-tab="entities"`) has CRUD controls: search input, type filter dropdown, count badge.
- **Communities tab** (`data-tab="communities"`) is read-only; moved from the old World tab.
- **Entity type badge CSS** uses class-based selectors (`.person`, `.place`) defined in `world.css`. Do NOT use `data-type` attribute selectors.
