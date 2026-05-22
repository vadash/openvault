# Design: Reflection Control Toggles

## Overview
Add two independent boolean settings to give users control over reflection generation and injection behavior.

## Motivation
Some users may not want reflections injected into their context. Additionally, some may want to disable reflection generation entirely to save LLM tokens. These are independent concerns - a user might want to keep existing reflections but stop generating new ones, or vice versa.

## Architecture

Two independent boolean settings control distinct lifecycle phases of reflections:

| Setting | Default | Location | Purpose |
|---------|---------|----------|---------|
| `reflectionGenerationEnabled` | `true` | Advanced tab | Controls Phase 2 of extraction (LLM reflection generation) |
| `reflectionInjectionEnabled` | `true` | Memories → Injection Settings | Controls whether reflections appear in retrieved context |

## Components & Data Flow

### 1. Settings Layer (`src/constants.js`)

Add to `defaultSettings`:
```javascript
reflectionGenerationEnabled: true,
reflectionInjectionEnabled: true,
```

### 2. Generation Control (`src/extraction/extract.js`)

In `synthesizeReflections()`, before calling `generateReflections()`:
```javascript
if (!getSettings('reflectionGenerationEnabled', true)) {
    logger.debug('[Extraction] Reflection generation disabled, skipping Phase 2');
    return { stChanges: { toUpsert: [], toDelete: [] } };
}
```

**Note:** Importance accumulation continues regardless of this toggle. This is intentional - accumulation is cheap and keeps data ready if the user re-enables generation.

### 3. Injection Control (`src/retrieval/retrieve.js`)

In `retrieveAndInjectContext()`, modify the reflections filter:
```javascript
const includeReflections = getSettings('reflectionInjectionEnabled', true);
const reflections = includeReflections
    ? memories.filter((m) => m.type === 'reflection')
    : [];
```

### 4. UI Layer

#### Advanced Tab (`templates/settings_panel.html`)

Add new subsection under Advanced tab:
```html
<details class="openvault-details">
    <summary>Reflection Engine</summary>
    <div class="flex-container flex-column gap-10">
        <label class="checkbox_label">
            <input id="openvault_reflection_generation" type="checkbox">
            <span>Generate reflections automatically</span>
        </label>
    </div>
</details>
```

#### Memories → Injection Settings (`templates/settings_panel.html`)

Add to existing Injection Settings section:
```html
<label class="checkbox_label">
    <input id="openvault_reflection_injection" type="checkbox">
    <span>Inject reflections into context</span>
</label>
```

#### Bindings (`src/ui/settings.js`)

In `bindUIElements()`:
```javascript
bindSetting('reflection_generation', 'reflectionGenerationEnabled', 'bool');
bindSetting('reflection_injection', 'reflectionInjectionEnabled', 'bool');
```

In `updateUI()`:
```javascript
$('#openvault_reflection_generation').prop('checked', settings.reflectionGenerationEnabled);
$('#openvault_reflection_injection').prop('checked', settings.reflectionInjectionEnabled);
```

## Error Handling

- Both toggles default to `true` - existing behavior is preserved if settings are missing
- Accumulation continues even when generation is disabled (cheap, non-breaking)
- Reflections already in the database remain intact regardless of toggle state
- No cleanup or migration needed - non-destructive design

## Testing Strategy

- **Unit**: Test `synthesizeReflections()` skips generation when toggle is off
- **Unit**: Test `retrieveAndInjectContext()` excludes reflections when toggle is off
- **Integration**: Toggle state persists correctly across settings save/load cycle
- **E2E**: Reflections present in DB are not injected when injection toggle is disabled

## Future Considerations

- Per-character reflection exclusion (if requested)
- Batch purge option for existing reflections (if users want clean slate)
- These are YAGNI for now - the minimal approach covers the stated need
