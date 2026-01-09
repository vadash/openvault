# Settings.js Decomposition Design

**Date:** 2026-01-10
**Goal:** Improve maintainability by splitting `src/ui/settings.js` into focused modules

## Problem

`src/ui/settings.js` is ~530 lines handling multiple concerns:
- Generic DOM binding utilities
- Debug/diagnostic functions
- Settings orchestration

Changes are risky because unrelated code is interleaved.

## Solution

Extract two modules, leaving `settings.js` as a focused orchestration layer.

### File Structure After Refactor

```
src/ui/
├── base/
│   ├── Component.js      (existing)
│   ├── constants.js      (existing)
│   └── bindings.js       (NEW)
├── debug.js              (NEW)
├── settings.js           (REDUCED)
└── ...
```

## Module Details

### 1. `src/ui/base/bindings.js` (~80 lines)

Generic, reusable DOM↔settings binding utilities.

**Exports:**

```javascript
export function bindCheckbox(selector, settingKey, onChange)
export function bindSlider(selector, settingKey, displaySelector, formatFn)
export function bindDropdown(selector, settingKey, onChange)
export function bindTextarea(selector, settingKey, onChange)
```

**Characteristics:**
- No UI-specific knowledge
- Pure binding logic: read setting → set DOM → attach listener → save on change
- Each function ~15-25 lines

### 2. `src/ui/debug.js` (~150 lines)

Diagnostic and connection testing functions.

**Exports:**

```javascript
export async function testOllamaConnection()
export async function copyMemoryWeights()
```

**`testOllamaConnection`:**
- Verifies Ollama endpoint connectivity
- Updates button state (loading → success/error)
- Shows result message

**`copyMemoryWeights`:**
- Gathers retrieval context and scores
- Calculates weighted scores for all memories
- Formats and copies to clipboard
- Updates button state during operation

**Characteristics:**
- Both manage their own button state
- Self-contained, side-effect only (clipboard, UI updates)

### 3. `src/ui/settings.js` (reduced to ~300 lines)

Orchestration layer.

**Exports (unchanged):**

```javascript
export function initTabs()
export function bindUIElements()
export function setExternalFunctions(fns)
export function updateUI()
export function populateProfileSelector()
```

**Imports:**

```javascript
import { bindCheckbox, bindSlider, bindDropdown, bindTextarea } from './base/bindings.js';
import { testOllamaConnection, copyMemoryWeights } from './debug.js';
```

**Remaining concerns:**
- Tab switching
- Settings-to-DOM synchronization via binding calls
- Profile selector population
- External function wiring

## Migration

1. Create `src/ui/base/bindings.js` with binding functions
2. Create `src/ui/debug.js` with debug functions
3. Update `settings.js` to import from new modules
4. Remove extracted code from `settings.js`
5. Verify all exports still work

## Size Impact

| File | Before | After |
|------|--------|-------|
| settings.js | ~530 lines | ~300 lines |
| base/bindings.js | - | ~80 lines |
| debug.js | - | ~150 lines |

No net reduction, but clear separation of concerns.
