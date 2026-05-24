# Settings Strict Initialization Gate

**Date:** 2025-05-24  
**Status:** Approved for Implementation  
**Issue:** World Context position setting not respected - settings persist in UI but retrieval uses stale values

## Problem Summary

Settings exist in TWO places causing a shadowing bug:

1. **Global Extension Settings** (`extension_settings.openvault`) - where UI saves
2. **Chat-Specific Settings** (`chat_metadata.openvault.settings`) - hardcoded defaults that shadow globals

The retrieval code reads from global settings, but those weren't being properly initialized due to a shallow merge in `src/ui/settings.js`. Meanwhile, a hardcoded `settings` object in `chat-data.js:48-54` provided false confidence that settings existed.

## Root Cause

```javascript
// src/ui/settings.js:561-564 - SHALLOW MERGE (BUG)
Object.assign(extension_settings[extensionName], {
    ...defaultSettings,
    ...extension_settings[extensionName],
});
// Object.assign does NOT merge nested objects - injection gets overwritten

// src/settings.js:34-37 - DEEP MERGE (CORRECT)
extensionSettings[extensionName] = lodash.merge(
    structuredClone(defaultSettings),
    extensionSettings[extensionName] || {}
);
```

Plus `src/store/chat-data.js:48-54` has a hardcoded `settings` object that creates a false second source of truth:

```javascript
// THIS IS THE PROBLEM - hardcoded defaults that never get used but confuse debugging
settings: {
    injection: {
        memory: { position: 1, depth: 4 },
        reflections: { position: 1, depth: 4 },
        world: { position: 1, depth: 4 },
    },
},
```

## Solution: Strict Initialization Gate

### Principle: Fail Fast, Never Silent

- Settings are initialized EXACTLY ONCE from global extension settings
- Deep merge ensures user settings are preserved
- NO `??` fallbacks - if a setting is missing after init, throw error
- NO chat-local settings - settings are global by design

### Architecture

```
src/
├── settings.js          # Single source of truth - init, get, set
├── ui/settings.js       # UI only BINDS to settings, never loads/merges
└── store/chat-data.js   # NO settings object - removed
```

### Data Flow

```
SillyTavern loads extension
    ↓
index.js APP_READY event
    ↓
initializeSettings() [DEEP MERGE with defaults]
    ↓
VALIDATE all required paths exist
    ↓
settingsInitialized = true
    ↓
getSettings(path) - guaranteed to return valid value
```

### API Changes

#### `src/settings.js`

```javascript
// BEFORE: Auto-init at module load (race condition prone)
loadSettings();

// AFTER: Explicit init with validation
export function initializeSettings() {
    if (settingsInitialized) return;
    
    const deps = getDeps();
    const extensionSettings = deps.getExtensionSettings();
    const { lodash } = deps.getContext();
    
    // DEEP MERGE: user settings override defaults
    extensionSettings[extensionName] = lodash.merge(
        structuredClone(defaultSettings),
        extensionSettings[extensionName] || {}
    );
    
    // VALIDATE: ensure structure is complete
    validateSettingsStructure(extensionSettings[extensionName]);
    
    settingsInitialized = true;
}

export function getSettings(path) {
    if (!settingsInitialized) {
        throw new Error(
            'OpenVault: Settings accessed before initialization. ' +
            'Call initializeSettings() first.'
        );
    }
    
    const settings = deps.getExtensionSettings()[extensionName];
    
    if (path) {
        const result = lodash.get(settings, path);
        if (result === undefined) {
            throw new Error(
                `OpenVault: Setting "${path}" is undefined. ` +
                'Schema mismatch or corrupted settings.'
            );
        }
        return result;
    }
    
    return settings;
}
```

#### `src/store/chat-data.js`

```javascript
// BEFORE: Hardcoded settings object
getOpenVaultData() {
    if (!context.chatMetadata[METADATA_KEY]) {
        context.chatMetadata[METADATA_KEY] = {
            // ... other fields ...
            settings: {  // ← DELETE THIS
                injection: { memory: {...}, reflections: {...}, world: {...} }
            },
        };
    }
}

// AFTER: No settings in chat data - settings are global
getOpenVaultData() {
    if (!context.chatMetadata[METADATA_KEY]) {
        context.chatMetadata[METADATA_KEY] = {
            schema_version: CURRENT_SCHEMA_VERSION,
            [MEMORIES_KEY]: [],
            [CHARACTERS_KEY]: {},
            [PROCESSED_MESSAGES_KEY]: [],
            reflection_state: {},
            graph: createEmptyGraph(),
            graph_message_count: 0,
            // NO settings field
        };
    }
}
```

#### `src/ui/settings.js`

```javascript
// BEFORE: Duplicate load with shallow merge
export async function loadSettings() {
    const extension_settings = getDeps().getExtensionSettings();
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    // BUG: Object.assign is shallow - injection object gets overwritten
    Object.assign(extension_settings[extensionName], {
        ...defaultSettings,
        ...extension_settings[extensionName],
    });
    // ... rest of UI init
}

// AFTER: Just bind UI - settings already initialized
export async function initSettingsUI() {
    // Settings already validated and initialized by initializeSettings()
    const settings = getSettings(); // Guaranteed to work
    
    // Load HTML, bind controls to existing settings
    const settingsHtml = await $.get(`${extensionFolderPath}/templates/settings_panel.html`);
    $('#extensions_settings2').append(settingsHtml);
    
    populateDefaultHints();
    initTabs();
    initBrowser();
    // ... rest of UI init
}
```

### Required Paths (Schema Contract)

Settings MUST have these paths after initialization:

```javascript
const REQUIRED_SETTINGS_PATHS = [
    'enabled',
    'debugMode',
    'requestLogging',
    'autoHideEnabled',
    'visibleChatBudget',
    'extractionTokenBudget',
    'extractionMaxTurns',
    'extractionRearviewTokens',
    'retrievalFinalTokens',
    'reflectionThreshold',
    'maxInsightsPerReflection',
    'maxConcurrency',
    'backfillMaxRPM',
    'embeddingSource',
    'ollamaUrl',
    'embeddingModel',
    'embeddingQueryPrefix',
    'embeddingDocPrefix',
    'alpha',
    'vectorSimilarityThreshold',
    'dedupSimilarityThreshold',
    'dedupJaccardThreshold',
    'forgetfulnessBaseLambda',
    'transientDecayMultiplier',
    'bucketMinRepresentation',
    'bucketSoftBalanceBudget',
    'worldContextBudget',
    'worldStateInterval',
    'entityWindowSize',
    'embeddingWindowSize',
    'recencyDecayFactor',
    'topEntitiesCount',
    'entityBoostWeight',
    'exactPhraseBoostWeight',
    'maxReflectionsPerCharacter',
    'preambleLanguage',
    'extractionPrefill',
    'outputLanguage',
    'injection.memory.position',
    'injection.memory.depth',
    'injection.reflections.position',
    'injection.reflections.depth',
    'injection.world.position',
    'injection.world.depth',
];
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/settings.js` | Add `initializeSettings()`, `validateSettingsStructure()`, modify `getSettings()` to throw if not initialized |
| `src/settings.js` | Remove auto-init at module load (line 225) |
| `src/ui/settings.js` | Rename `loadSettings()` → `initSettingsUI()`, remove merge logic |
| `src/ui/settings.js` | Update all `getSettings()` calls - no default params needed |
| `src/store/chat-data.js` | Remove `settings` object from `getOpenVaultData()` initialization |
| `src/index.js` | Call `initializeSettings()` before `loadSettings()` → `initSettingsUI()` |
| All `src/**/*.js` | Remove `?? defaultValue` fallbacks from `getSettings()` calls |

### Migration: Old Chat Data

If `chat_metadata.openvault.settings` exists from older versions:

1. **Ignore it** - never read from it
2. **Delete it on next save** - `saveOpenVaultData()` should strip the `settings` field
3. **Log once** - console warning that old settings were discarded

```javascript
// In getOpenVaultData()
if (data.settings) {
    logWarn('Old chat-local settings found and ignored. Using global settings.');
    delete data.settings;
}
```

### Testing Strategy

1. **Unit Test**: `initializeSettings()` with empty extension_settings → validates with defaults
2. **Unit Test**: `initializeSettings()` twice → no-op second time
3. **Unit Test**: `getSettings('injection.world.position')` before init → throws
4. **Unit Test**: `getSettings('bogus.path')` → throws (path doesn't exist)
5. **Integration Test**: Full ST mock - init → set → get → verify value

### Benefits

- **Fail Fast**: Problems surface immediately, not silently with wrong defaults
- **Single Source**: Global settings only, no shadowing
- **Type Safety**: Settings structure guaranteed after init
- **LLM-Proof**: Can't accidentally break - throws if pattern violated
- **Debuggable**: Clear error messages tell you exactly what's wrong

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Settings accessed before init | Throws clear error with fix instruction |
| Nested settings missing | Validation catches at init time |
| Old chat data with settings | Log warning, auto-delete on save |
| Race condition in ST loading | Initialize from APP_READY event (after ST ready) |

## Appendix: Settings Categorization

### Global Settings (Current Behavior)

These are user preferences that should be consistent across chats:

- All injection positions (`injection.*.position`, `injection.*.depth`)
- All token budgets (`retrievalFinalTokens`, `worldContextBudget`, etc.)
- All math thresholds (`alpha`, `*Threshold`)
- Model selection (`embeddingSource`, `ollamaUrl`)
- Feature toggles (`enabled`, `debugMode`, `autoHideEnabled`)
- UI preferences (`preambleLanguage`, `outputLanguage`)

### Per-Chat Data (Already Correct)

These are chat-specific state:

- Memories array
- Character states
- Entity graph
- Processed message IDs
- Reflection state accumulator
- Graph message count

## Decision Log

| Decision | Rationale |
|----------|-----------|
| **Remove chat-local settings entirely** | They were never the source of truth, just shadow defaults |
| **No `??` fallbacks** | Fail fast - missing settings = bug, not feature |
| **Single init from APP_READY** | Guarantees ST context is ready, lodash available |
| **Validation with required paths** | Schema contract - can't add setting without updating validator |
| **Delete old settings on save** | Clean migration, no user action needed |
