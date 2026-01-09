# Default Hints from Constants - Design Document

## Problem

Default values are defined in `src/constants.js`, but UI hint text `(default: X)` is hardcoded in `templates/settings_panel.html`. These have already diverged (e.g., Messages per Extraction shows 10 in UI but constant is 30).

## Solution

Use data attributes on hint elements, populated via JavaScript from constants after template load.

## Implementation

### 1. Constants Mapping (src/constants.js)

Add a derived mapping object:

```javascript
export const UI_DEFAULT_HINTS = {
    // Extraction
    messagesPerExtraction: defaultSettings.messagesPerExtraction,

    // Context budget
    retrievalFinalTokens: defaultSettings.retrievalFinalTokens,
    messagesToKeep: defaultSettings.messagesToKeep,

    // Retrieval weights
    vectorSimilarityWeight: defaultSettings.vectorSimilarityWeight,
    keywordMatchWeight: defaultSettings.keywordMatchWeight,
    vectorSimilarityThreshold: defaultSettings.vectorSimilarityThreshold,

    // Entity settings
    entityWindowSize: QUERY_CONTEXT_DEFAULTS.entityWindowSize,
    embeddingWindowSize: QUERY_CONTEXT_DEFAULTS.embeddingWindowSize,
    topEntitiesCount: QUERY_CONTEXT_DEFAULTS.topEntitiesCount,
    entityBoostWeight: QUERY_CONTEXT_DEFAULTS.entityBoostWeight,

    // Summarization
    contextWindowSize: defaultSettings.contextWindowSize,
    retrievalPreFilterTokens: defaultSettings.retrievalPreFilterTokens,
    backfillRateLimit: defaultSettings.backfillRateLimit,
};
```

### 2. HTML Changes (templates/settings_panel.html)

Convert each hint from hardcoded to data-attribute based:

**Before:**
```html
<small style="opacity: 0.6;"> (default: 15)</small>
```

**After:**
```html
<small class="openvault-default-hint" data-default-key="vectorSimilarityWeight"></small>
```

### 3. CSS (src/styles/)

Add styling for hint class:

```css
.openvault-default-hint {
    opacity: 0.6;
}
```

### 4. JavaScript (src/ui/settings.js)

Add population function:

```javascript
import { UI_DEFAULT_HINTS } from '../constants.js';

function populateDefaultHints() {
    $('.openvault-default-hint').each(function() {
        const key = $(this).data('default-key');
        const value = UI_DEFAULT_HINTS[key];

        if (value !== undefined) {
            $(this).text(` (default: ${value})`);
        } else {
            console.warn(`[OpenVault] Unknown default hint key: ${key}`);
        }
    });
}
```

Call in `loadSettings()` after template is appended to DOM.

## Files Changed

1. `src/constants.js` - Add `UI_DEFAULT_HINTS` export
2. `templates/settings_panel.html` - Convert ~13 hint elements
3. `src/styles/components/*.css` - Add `.openvault-default-hint` style
4. `src/ui/settings.js` - Add `populateDefaultHints()`, call in `loadSettings()`

## Testing

1. Unit test: Verify `UI_DEFAULT_HINTS` keys exist in source constants
2. Manual: Load extension, verify all hints display correctly
3. Regression: Confirm corrected values (e.g., messagesPerExtraction now shows 30)

## Adding New Settings

1. Add entry to `UI_DEFAULT_HINTS` in constants.js
2. Add `<small class="openvault-default-hint" data-default-key="newKey"></small>` in HTML
