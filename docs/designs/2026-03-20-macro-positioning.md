# Macro Positioning System Design

**Date:** 2026-03-20
**Status:** Draft
**Author:** Claude Code

## Overview

Add configurable macro positioning for OpenVault's memory and world content injection. Users can select from SillyTavern's predefined injection positions (↑Char, ↓Char, ↑AN, ↓AN, In-chat) or choose Custom to manually place macros like `{{openvault_memory}}` and `{{openvault_world}}` anywhere in their prompts.

## Requirements

1. **Position Selection**: User can configure injection position for each content type (memory, world)
2. **Predefined Positions**: Support ST's extension prompt positions (0-4)
3. **Custom Position**: Expose macros for manual placement when Custom is selected
4. **UI Display**: Show active positions and macro names in both settings and inline display
5. **Backward Compatible**: Default to existing behavior (↓Char, position 1)

## API Constraints (from ST Extension Docs)

- `setExtensionPrompt` imported from `scripts/extensions.js` — NOT in `getContext()`
- `registerMacro` from `SillyTavern.getContext()` — synchronous only, no async
- Use `lodash.merge` (bundled) for settings initialization
- Consider `generate_interceptor` API for cleaner Custom position handling

## Architecture

### Position Constants

| Code | Name | UI Label | Description |
|------|------|----------|-------------|
| 0 | `before_main` | ↑Char | Before system/char card prompt |
| 1 | `after_main` | ↓Char | After main prompt (default, current behavior) |
| 2 | `before_an` | ↑AN | Top of Author's Note block |
| 3 | `after_an` | ↓AN | Bottom of Author's Note block |
| 4 | `in_chat` | In-chat | At specified message depth |
| -1 | `custom` | Custom | Macro-only, no auto-injection |

### Data Schema

```javascript
// extension_settings.openvault
{
  injection: {
    memory: {
      position: 1,    // 0, 1, 2, 3, 4, or -1 (custom)
      depth: 4        // Only used when position === 4
    },
    world: {
      position: 1,
      depth: 4
    }
  }
}
```

### Component Structure

```
src/
├── injection/
│   ├── settings.js       # New: Position config UI
│   └── inject.js         # Modified: Use position settings
├── ui/
│   ├── settings.js       # Modified: Add injection settings panel
│   └── display.js        # Modified: Add position badges
├── constants.js          # Modified: Add position enum/mapping
└── macros.js             # New: Macro registration
```

## Implementation Details

### 1. Settings Initialization

```javascript
// src/utils/settings.js
const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();
const { lodash } = SillyTavern.libs;

const defaultSettings = Object.freeze({
  injection: {
    memory: { position: 1, depth: 4 },
    world:  { position: 1, depth: 4 },
  }
});

function loadSettings() {
  extensionSettings.openvault = lodash.merge(
    structuredClone(defaultSettings),
    extensionSettings.openvault || {}
  );
}
```

### 2. Injection Logic

```javascript
// src/injection/inject.js
import { setExtensionPrompt } from '../../../../scripts/extensions.js';

const cachedContent = {
  memory: '',
  world: ''
};

function injectContent(type, content) {
  const settings = extensionSettings.openvault.injection[type];

  // Always update cached content for macro access
  cachedContent[type] = content;

  // Custom (-1) = macro-only, skip auto-injection
  if (settings.position === -1) {
    return;
  }

  // Use setExtensionPrompt for predefined positions
  setExtensionPrompt(
    `openvault_${type}`,
    content,
    settings.position,
    settings.depth
  );
}
```

### 3. Macro Registration

```javascript
// src/macros.js
const { registerMacro } = SillyTavern.getContext();

// Macros MUST be synchronous - no async/await
registerMacro('openvault_memory', () => cachedContent.memory);
registerMacro('openvault_world', () => cachedContent.world);

// Note: Do NOT wrap name in {{ }} - ST does that automatically
// Users write: {{openvault_memory}} - ST strips braces and calls registerMacro
```

### 4. Prompt Interceptor (Alternative to GENERATION_AFTER_COMMANDS)

For the Custom position case, consider using ST's `generate_interceptor` API:

```json
// manifest.json
{
  "generate_interceptor": "openvaultInterceptor"
}
```

```javascript
// src/interceptor.js
globalThis.openvaultInterceptor = function(chat, contextSize, abort, type) {
  const settings = extensionSettings.openvault.injection;

  // For custom positions, macros handle injection
  // cachedContent is already populated by retrieveAndInjectContext()
  if (settings.memory.position === -1 || settings.world.position === -1) {
    // No-op - macros provide the content
  }

  // Positions 0-4 are handled by setExtensionPrompt before this runs
};
```

**Note**: The interceptor approach is cleaner than `GENERATION_AFTER_COMMANDS` for ordering guarantees. Implement in Phase 2 if needed.

## UI Design

### Settings Panel

```
┌───────────────────────────────────────────────┐
│ OpenVault Injection Settings                  │
├───────────────────────────────────────────────┤
│                                               │
│ Memory Position                               │
│ ┌─────────────────────────────────────────┐   │
│ │ Position: [↓Char ▼]                     │   │
│ │ Depth: [4]          (when In-chat)      │   │
│ └─────────────────────────────────────────┘   │
│                                               │
│ World Position                                │
│ ┌─────────────────────────────────────────┐   │
│ │ Position: [↓Char ▼]                     │   │
│ │ Depth: [4]          (when In-chat)      │   │
│ └─────────────────────────────────────────┘   │
│                                               │
└───────────────────────────────────────────────┘
```

**When Custom is selected:**
```
┌───────────────────────────────────────────────┐
│ Memory Position: [Custom ▼]                   │
│                                               │
│ Macro: {{openvault_memory}}            [Copy] │
│                                               │
│ Place this macro anywhere in your prompt      │
│ or character card to inject retrieved memory. │
└───────────────────────────────────────────────┘
```

**Position Dropdown Options:**
- ↑Char (Before character definitions)
- ↓Char (After character definitions) — *Recommended default*
- ↑AN (Before author's note)
- ↓AN (After author's note)
- In-chat (At specified message depth)
- **Custom (Use macro manually)**

### Inline Display

In the main OpenVault UI, show current positions:

```
┌─────────────────────────────────────┐
│ OpenVault   [Settings]              │
├─────────────────────────────────────┤
│ Memories: 142 chunks  [↓Char]       │
│ World: 89 entries    [↑AN]          │
└─────────────────────────────────────┘
```

**When Custom is active:**
```
┌─────────────────────────────────────────────┐
│ Memories: 142 chunks  [📋 {{openvault_memory}}] │
│ World: 89 entries    [📋 {{openvault_world}}]   │
└─────────────────────────────────────────────┘
```

Clicking the badge or copy button copies the macro to clipboard.

## Implementation Plan

### Phase 1: Core Positioning

1. **Settings Schema**: Add `injection` config with defaults
2. **Injection Logic**: Modify `injectContent()` to use position settings
3. **Settings UI**: Create position selector panel
4. **Inline Display**: Add position badges to main UI
5. **Testing**: Verify all positions work correctly

### Phase 2: Macro Support

1. **Macro Registration**: Register `openvault_memory` and `openvault_world`
2. **Custom Position**: Add -1 (custom) option to selector
3. **Copy Button**: Add copy-to-clipboard for macro names
4. **Documentation**: Update README with macro usage

### Phase 3: Polish (Optional)

1. **Prompt Interceptor**: Migrate from `GENERATION_AFTER_COMMANDS` if needed
2. **Per-Profile Settings**: Allow different positions per character profile
3. **World Info Positions**: Add ↑EM, ↓EM, Outlet if requested by users

## Migration Path

- **No breaking changes**: Defaults to current behavior (position 1, ↓Char)
- **Existing users**: Continue working without configuration
- **New users**: Can customize positions immediately

## Testing Strategy

1. **Unit Tests**: Position mapping, settings initialization
2. **Integration Tests**: Verify content appears at correct positions
3. **Manual Tests**: Test each position in actual ST context
4. **Macro Tests**: Verify `{{openvault_memory}}` works when Custom selected

## Future Considerations

- **World Info Positions** (↑EM, ↓EM, Outlet): Not supported by extension prompt API — would require creating WI entries
- **Per-Character Profiles**: Store position overrides per character
- **Multiple Injection Points**: Allow same content at multiple positions

## References

- SillyTavern Extension Docs: Position constants and macro API
- SillyTavern-MemoryBooks: Reference implementation for position UI
- OpenVault Architecture: Current injection system (`safeSetExtensionPrompt`)
