# Feature Disable Semantics

## Problem

When users set World Info or Reflections to "Disabled" in the UI, the system still generates data in the background:

1. **World Info**: Setting to "Disabled" only stops injection — background extraction still generates `global_world_state` and consolidates edges
2. **Reflections**: Should respect disabled setting, but async save delays or chat-specific overrides can bypass the toggle

## Solution

True disable semantics: no generation + wipe existing data + clear accumulators. Lazy catch-up on re-enable (no bypass logic).

## Design

### Settings Controller (`src/settings.js`)

Add `handleSettingChangeSideEffects()` triggered on dropdown changes:

**When `injection.reflections.position` → `-2`:**
- Filter out all memories with `type: 'reflection'`
- Clear `reflection_state` (all character importance accumulators)

**When `injection.world.position` → `-2`:**
- Delete `global_world_state`
- Clear `graph._edgesNeedingConsolidation`
- Reset `graph_message_count` to 0

Save and refresh UI immediately after wipe.

### Events (`src/events.js`)

In `onChatChanged`, after schema migration, enforce global disabled settings on loaded chat metadata:

```javascript
if (globalSettings.injection?.reflections?.position === -2) {
    data[MEMORIES_KEY] = data[MEMORIES_KEY].filter(m => m.type !== 'reflection');
    data.reflection_state = {};
}
if (globalSettings.injection?.world?.position === -2) {
    delete data.global_world_state;
    data.graph._edgesNeedingConsolidation = [];
    data.graph_message_count = 0;
}
```

This prevents legacy data from leaking when a disabled global setting loads an older chat.

### Extraction Pipeline (`src/extraction/extract.js`)

Add early-exit guards at the start of generation functions:

**`synthesizeWorldState()`:**
```javascript
if (getSettings('injection.world.position') === -2) {
    return; // Skip generation entirely
}
```

**`synthesizeReflections()`:**
```javascript
if (getSettings('injection.reflections.position') === -2) {
    return; // Skip generation entirely
}
```

No catch-up bypass logic. Thresholds/intervals trigger naturally on re-enable since accumulators start at 0.

## Behavior Summary

| Action | Data | Accumulators | Generation |
|--------|------|--------------|------------|
| Disable | Wiped instantly | Cleared | Blocked |
| Re-enable | Empty (wiped) | Start at 0 | Resumes normally, triggers when thresholds met |

## Files Changed

- `src/settings.js` — Add side effect handler
- `src/events.js` — Enforce on chat load
- `src/extraction/extract.js` — Add early-exit guards