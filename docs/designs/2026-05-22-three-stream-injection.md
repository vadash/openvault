# Three-Stream Injection Split

**Date:** 2026-05-22
**Status:** Approved

## Problem

Memory and reflections are currently bundled into a single injection stream (`openvault` slot). The `<scene_memory>` block and `<subconscious_drives>` block are concatenated and injected together at one position. This prevents users from placing them independently — e.g., memories after character definitions but reflections deeper in the prompt near the author's note.

## Solution

Split the current 2-stream injection system (memory+bundled-reflections, world) into a 3-stream system:

1. **Memory** — chronological scene memories only
2. **Reflections** — subconscious drives / psychological insights only
3. **World** — community summaries (unchanged)

Each stream gets its own injection slot, macro, position/depth settings, and XML block with a plain-text bracket comment explaining its purpose.

## Architecture

**Split point: format time.** Retrieval and selection remain unchanged. Only the formatting and injection layers are modified.

```
selectFormatAndInject()
       ↓
formatContextForInjection()
  → { memoryText, reflectionText }     (was: single concatenated string)
       ↓
injectContext(memoryText, reflectionText, worldText)
       ↓
3 × safeSetExtensionPrompt():
  slot 'openvault'            → memory
  slot 'openvault_reflections' → reflections
  slot 'openvault_world'      → world
```

## XML Block Structure

### Stream 1 — Memory

Slot: `openvault` | Macro: `{{openvault_memory}}`

```xml
<scene_memory>
[The following is a chronological recollection of past events the character has witnessed or experienced]

(#N messages | ★=minor ★★★=notable ★★★★★=critical)

## The Story So Far
...

## Leading Up To This Moment
...

## Current Scene
...
</scene_memory>
```

Identical to current `<scene_memory>` block. The `<subconscious_drives>` block that was previously appended is removed.

### Stream 2 — Reflections

Slot: `openvault_reflections` | Macro: `{{openvault_reflections}}`

```xml
<subconscious_drives>
[These are hidden psychological truths the character would never speak aloud — they influence behavior as subtext]

[★★★] Reflection summary 1
[★★★★★] Reflection summary 2
</subconscious_drives>
```

Only injected when reflections exist. When empty, the slot is cleared (empty string).

### Stream 3 — World

Slot: `openvault_world` | Macro: `{{openvault_world}}`

```xml
<world_context>
[This is background knowledge about the world, its communities, and broader context the character is aware of]

## Community Title
...
</world_context>
```

Same as current `<world_context>` block with the added framing bracket comment.

## Settings Schema

### Before

```javascript
injection: {
    memory: { position: 1, depth: 4 },
    world: { position: 1, depth: 4 },
}
```

### After

```javascript
injection: {
    memory: { position: 1, depth: 4 },
    reflections: { position: 1, depth: 4 },
    world: { position: 1, depth: 4 },
}
```

**Migration:** Add `injection.reflections` with defaults `{ position: 1, depth: 4 }` to match the previous bundled behavior. No existing settings are removed or renamed.

## Changes by File

| File | Change |
|------|--------|
| `src/retrieval/formatting.js` | `formatContextForInjection()` returns `{ memoryText, reflectionText }` instead of concatenating `<subconscious_drives>` into the memory string |
| `src/retrieval/retrieve.js` | `injectContext()` takes 3 args, calls `safeSetExtensionPrompt()` 3 times; `selectFormatAndInject()` handles the 3-way split |
| `src/retrieval/world-context.js` | Add framing bracket comment inside `<world_context>` tag |
| `src/injection/macros.js` | Add `cachedContent.reflections` property; register `{{openvault_reflections}}` macro |
| `src/constants.js` | Add `reflections: { position: 1, depth: 4 }` to default settings `injection` object |
| `src/store/migrations/` | Migration to add `injection.reflections` with defaults to existing settings |
| `templates/settings_panel.html` | Add reflections injection position UI row (position dropdown, depth input, macro display) |
| `src/ui/settings.js` | Bind new reflections position/depth controls to settings |

## Default Behavior

By default, all three streams use position `1` (↓Char) at depth `4`. This preserves the current user experience — memory and reflections appear together at the same position. Users who want to separate them can change the reflections position independently.

## Testing Strategy

- Unit tests for `formatContextForInjection()` returning two separate strings
- Unit tests for `injectContext()` making 3 separate `safeSetExtensionPrompt` calls
- Unit tests for the new macro returning `cachedContent.reflections`
- Migration test for adding `injection.reflections` to existing settings
- UI test for reflections position/depth controls binding correctly
