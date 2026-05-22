# Stream Disable via Position Dropdown

**Date:** 2026-05-22
**Status:** Draft
**Supersedes:** `2026-04-10-reflection-control-toggles.md`

## Problem

The current reflection control uses two scattered checkboxes ("Generate reflections automatically" in Advanced, "Inject reflections into context" in Memories). This splits the user's mental model — controlling reflections requires visiting two different UI locations with no visual connection to the injection position that determines where reflections appear. Users who want to run OpenVault as a pure memory summarizer (no reflections, no world context) have no clean way to opt out.

## Solution

Add a **Disabled** option (position value `-2`) to the Reflections and World position dropdowns. When selected:

- **Reflections**: Confirm with popup → delete all `type: 'reflection'` memories → stop generation + injection. Re-enabling resumes generation for new messages only (no backfill).
- **World**: Silently stop retrieval + injection. Community data preserved. Re-enable is instant.

Remove both reflection checkboxes (`reflectionGenerationEnabled`, `reflectionInjectionEnabled`) from Advanced and Memories tabs. The dropdown now controls everything.

Memory position dropdown stays unchanged — no Disabled option. Memory is the core feature (KISS).

## Position Value Map

| Value | Meaning | Behavior |
|-------|---------|----------|
| 0–4   | Inject at position | Generate + format + inject |
| -1    | Custom (macro) | Generate + format, inject via macro only |
| **-2** | **Disabled** | **Skip generation + format + injection** |

## UI Changes

### Remove from Advanced tab

Delete the entire "Reflection Engine" `<details>` section containing the "Generate reflections automatically" checkbox.

### Remove from Memories tab

Delete the "Inject reflections into context" checkbox from the Reflections settings group.

### Add to position dropdowns

Add `<option value="-2">Disabled</option>` to the Reflections and World position `<select>` elements. Do NOT add it to the Memory position dropdown.

When Disabled is selected for Reflections, show depth and macro containers as hidden (same as positions 0–3 — no depth/macro needed).

### Confirmation popup for Reflections

When user selects Disabled in the Reflections dropdown:

1. Revert the dropdown to previous value immediately
2. Show confirmation: *"This will delete all existing reflections and stop generating new ones. Existing memories and world context are not affected. Continue?"*
3. On confirm → set position to `-2`, nuke reflection memories, clear injection slot
4. On cancel → dropdown stays at previous value

No popup for World — disabled is non-destructive (communities preserved).

## Pipeline Changes

### Extraction (`src/extraction/extract.js`)

Replace `reflectionGenerationEnabled` check in `synthesizeReflections()`:

```javascript
// Before
if (!getSettings('reflectionGenerationEnabled', true)) { ... }

// After
const reflectionsDisabled = getSettings('injection.reflections.position', 1) === -2;
if (reflectionsDisabled) { ... }
```

Importance accumulation continues regardless (cheap, keeps data ready for re-enable).

### Retrieval (`src/retrieval/retrieve.js`)

Replace `reflectionInjectionEnabled` checks in `retrieveAndInjectContext()` (two locations):

```javascript
// Before
const includeReflections = getSettings('reflectionInjectionEnabled', true);
const reflections = includeReflections ? memories.filter(m => m.type === 'reflection') : [];

// After
const reflectionsDisabled = getSettings('injection.reflections.position', 1) === -2;
const reflections = reflectionsDisabled ? [] : memories.filter(m => m.type === 'reflection');
```

Add world disable check:

```javascript
const worldDisabled = getSettings('injection.world.position', 1) === -2;
if (!worldDisabled && worldCommunities && Object.keys(worldCommunities).length > 0) {
    // ... retrieve world context
}
```

### Injection (`src/retrieval/retrieve.js`)

In `injectContext()`, when position is `-2`, call `safeSetExtensionPrompt('', slot, ...)` to clear the slot. The existing empty-string handling already does this — just ensure we pass empty text when the stream is disabled.

### Macros (`src/injection/macros.js`)

`cachedContent.reflections` is already set to `''` when no reflection text is provided. The `{{openvault_reflections}}` macro will return empty string when disabled — no changes needed.

## Data Lifecycle

### Reflections — Disable

1. User selects "Disabled" → confirmation popup
2. On confirm: `deleteAllMemoriesOfType('reflection')` removes all reflection memories from `chatMetadata.openvault.memories`
3. Keep `reflection_state` (importance accumulators) intact — accumulators represent "pending importance" from events, valid even after nuke
4. Clear `cachedContent.reflections`, clear injection slot
5. `synthesizeReflections()` exits early on next extraction cycle

### Reflections — Re-enable

1. User selects any position 0–4 or -1
2. Generation resumes immediately: accumulators may already be above threshold, so first reflection covers accumulated importance from recent events
3. No backfill of the disabled period — only new events trigger reflections going forward
4. Injection resumes at the selected position

### World — Disable

1. User selects "Disabled"
2. Skip world context retrieval in `selectFormatAndInject()`
3. Communities and `global_world_state` remain in graph data
4. Clear `cachedContent.world`, clear injection slot

### World — Re-enable

1. User selects any position 0–4 or -1
2. Immediate — community data is still current, retrieval resumes normally

## Settings Migration

### Schema change

Remove from `defaultSettings`:
```javascript
// REMOVED
reflectionGenerationEnabled: true,
reflectionInjectionEnabled: true,
```

No new settings keys needed — `injection.reflections.position` and `injection.world.position` already exist.

### Migration logic

```javascript
// If user had injection disabled, map to the new Disabled position
if (settings.reflectionInjectionEnabled === false) {
    settings.injection.reflections.position = -2;
}
// Always clean up the old keys
delete settings.reflectionGenerationEnabled;
delete settings.reflectionInjectionEnabled;
```

**Important:** Migration does NOT nuke existing reflection data. Only the active "select Disabled from dropdown" action triggers the nuke. A migrated user who re-enables reflections will find their old reflections still intact.

## Changes by File

| File | Change |
|------|--------|
| `src/constants.js` | Remove `reflectionGenerationEnabled` and `reflectionInjectionEnabled` from `defaultSettings` |
| `src/extraction/extract.js` | Replace `reflectionGenerationEnabled` check with `injection.reflections.position === -2` |
| `src/retrieval/retrieve.js` | Replace `reflectionInjectionEnabled` checks with position-based checks; add world disable check |
| `src/ui/settings.js` | Remove `bindSetting()` calls for both checkboxes; remove `$('#openvault_reflection_generation')` and `$('#openvault_reflection_injection')` from `updateUI()`; add confirmation popup handler for reflections dropdown; add `Disabled` option to dropdown update logic |
| `templates/settings_panel.html` | Remove "Reflection Engine" `<details>` section from Advanced; remove "Inject reflections into context" checkbox from Memories; add `<option value="-2">Disabled</option>` to Reflections and World dropdowns |
| `src/store/migrations/` | Migration to convert `reflectionInjectionEnabled: false` → `position: -2` and delete old keys |
| `tests/reflection/toggles.test.js` | Rewrite to test position-based disable instead of checkbox toggles |

## Edge Cases

- **Macro used while disabled**: `{{openvault_reflections}}` returns empty string. No error, no stale data leak.
- **Disabled + manual macro placement**: User previously set position to Custom (-1) and placed macro in character card. If they switch to Disabled (-2), the macro returns empty string — consistent behavior.
- **Chat switch while disabled**: Position setting is global (not per-chat). If reflections are disabled, they stay disabled across chats. Reflection memories in other chats are unaffected (each chat has its own `chatMetadata`).
- **Migration with generation disabled but injection enabled**: Edge case (`reflectionGenerationEnabled: false`, `reflectionInjectionEnabled: true`). User had old reflections they were injecting but no new ones. Migration keeps `injection.reflections.position` at its current value (0–4 or -1) — no change. Old reflections remain injectable. The user loses the "stop generating" toggle but existing reflections keep working. This is acceptable because the new design ties generation to the position value.

## Testing Strategy

- Unit: `synthesizeReflections()` exits early when `injection.reflections.position === -2`
- Unit: `retrieveAndInjectContext()` excludes reflections/world when position is `-2`
- Unit: Confirmation popup fires when selecting Disabled for reflections, not for world
- Unit: Reflection nuke deletes only `type: 'reflection'` memories, preserves accumulators
- Migration: `reflectionInjectionEnabled: false` → `injection.reflections.position: -2`
- Migration: Old keys deleted from settings
- UI: Disabled option not present in Memory dropdown
- UI: Disabled option present in Reflections and World dropdowns
