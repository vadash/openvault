# Design: Eliminate Hardcoded Fallback Values (DRY Cleanup)

## 1. Problem Statement

`src/constants.js` defines `defaultSettings` as the single source of truth for all configurable values. However, **121+ call sites** across the codebase duplicate these values as inline fallbacks:

```js
// Pattern A: nullish coalescing with hardcoded number
const threshold = settings.dedupSimilarityThreshold ?? 0.92;

// Pattern B: logical OR with hardcoded number
const tokenBudget = settings.extractionTokenBudget || 16000;
```

These inline copies have **already drifted** from the actual defaults:

| Setting                        | `constants.js` | Inline fallback |
|--------------------------------|:--------------:|:---------------:|
| `reflectionThreshold`          | 40             | 30              |
| `dedupSimilarityThreshold`     | 0.94           | 0.92            |
| `extractionTokenBudget`        | 12000          | 16000           |
| `entityMergeSimilarityThreshold` | 0.95         | 0.94 / 0.9      |
| `backfillMaxRPM`              | 20             | 30              |

Additionally, the HTML template `settings_panel.html` hardcodes `value="12000"` on sliders, duplicating yet another copy.

## 2. Goals & Non-Goals

### Must do
- Remove **all** inline `?? hardcoded` and `|| hardcoded` fallbacks for settings that are guaranteed populated by `loadSettings()`.
- Set HTML `<input>` default values from JS at init rather than hardcoding in the template.
- Ensure `constants.js` values are the authoritative source for every default.

### Won't do
- Change any default values (keep `constants.js` values as-is).
- Refactor the settings loading mechanism (it already works correctly).
- Add a schema validator or runtime type-checking layer.

## 3. Proposed Architecture

### Why removal is safe

`loadSettings()` in `src/ui/settings.js:292-295` runs on `APP_READY` **before** any extraction, retrieval, or UI code executes:

```js
Object.assign(extension_settings[extensionName], {
    ...defaultSettings,                    // all keys guaranteed
    ...extension_settings[extensionName],  // user overrides win
});
```

After this merge, every key from `defaultSettings` exists on the settings object. The `?? fallback` and `|| fallback` patterns are dead code — they can never fire under normal operation. Removing them:

1. **Fixes the drift bugs** — mismatched inline values become impossible.
2. **Fixes `||` falsy bugs** — `settings.alpha || 0.7` would override a user who intentionally sets `alpha = 0` (pure BM25). Bare `settings.alpha` respects their choice.
3. **Makes `constants.js` the actual single source of truth**, not just a nominal one.

### Scope of changes

| File | Approx. changes | Description |
|------|:---:|---|
| `src/extraction/extract.js` | ~15 | Remove `??` / `||` fallbacks |
| `src/extraction/worker.js` | ~1 | Remove `||` fallback |
| `src/retrieval/scoring.js` | ~5 | Remove `??` fallbacks |
| `src/retrieval/math.js` | ~4 | Remove `??` / `||` fallbacks |
| `src/retrieval/retrieve.js` | ~2 | Remove `||` fallbacks |
| `src/retrieval/query-context.js` | ~2 | Remove `??` fallbacks |
| `src/graph/graph.js` | ~3 | Remove `??` fallbacks |
| `src/reflection/reflect.js` | ~3 | Remove `??` fallbacks |
| `src/embeddings.js` | ~2 | Remove `??` fallbacks |
| `src/events.js` | ~1 | Remove `||` fallback |
| `src/ui/settings.js` | ~60 | Remove `??` / `||` fallbacks in `updateUI()` |
| `src/ui/render.js` | ~1 | Remove `??` fallback |
| `templates/settings_panel.html` | ~30 | Remove hardcoded `value="..."` attributes |

**Not touched** (legitimate fallbacks):
- `src/utils/text.js:148-149` — `a.sequence ?? a.created_at ?? 0` — field fallback chain, not a settings default.
- `src/ui/helpers.js:236` — `importance ?? 3` — data field fallback, not a setting.
- `src/llm.js:114` — `timeoutMs || 120000` — function parameter default, not a setting.
- Any `|| ''` or `|| 0` patterns on **data fields** (not settings).

### HTML template strategy

Current state: sliders have `value="12000"` in HTML, then `updateUI()` overwrites from settings.

Change: Remove the `value="..."` attribute from HTML. In `updateUI()`, the values already get set from `settings.xxx` (which is guaranteed populated from defaults). The HTML `value` attributes only matter for the brief moment before `updateUI()` runs — during which the settings panel is not visible anyway.

For `<input type="range">`, browsers default to the midpoint of min/max when no `value` is specified. Since `updateUI()` runs immediately after the template is injected, users never see the browser default.

## 4. Data Models / Schema

No schema changes. `defaultSettings` in `constants.js` is the existing schema — this design just enforces that it's respected everywhere.

## 5. Transformation Rules

### Rule 1: Setting with `??` hardcoded value → bare setting

```diff
- const threshold = settings.dedupSimilarityThreshold ?? 0.92;
+ const threshold = settings.dedupSimilarityThreshold;
```

### Rule 2: Setting with `||` hardcoded value → bare setting

```diff
- const tokenBudget = settings.extractionTokenBudget || 16000;
+ const tokenBudget = settings.extractionTokenBudget;
```

### Rule 3: `updateUI()` — setting with `??` inline → bare setting

```diff
- $('#openvault_extraction_token_budget').val(settings.extractionTokenBudget ?? 12000);
+ $('#openvault_extraction_token_budget').val(settings.extractionTokenBudget);
```

### Rule 4: HTML template — remove default `value` attributes

```diff
- <input type="range" id="openvault_extraction_token_budget" min="4000" max="64000" step="1000" value="12000" />
+ <input type="range" id="openvault_extraction_token_budget" min="4000" max="64000" step="1000" />
```

### Rule 5: Non-setting imports of `defaultSettings` — keep as reference (already correct)

Some places import `defaultSettings` directly for comparison or display. These are fine:
```js
// Already correct — references the constant, not a hardcoded copy
$('#openvault_alpha').val(settings.alpha ?? defaultSettings.alpha);
```
These become:
```js
$('#openvault_alpha').val(settings.alpha);
```

## 6. Risks & Edge Cases

### Risk: Settings accessed before `loadSettings()` completes
**Mitigation:** The `APP_READY` → `loadSettings()` → `updateUI()` chain runs before any user interaction or extraction/retrieval. All code paths that read settings are event-driven (chat events, button clicks) and cannot fire until after init. No risk.

### Risk: New settings added to code but not to `defaultSettings`
**Mitigation:** Existing risk (unchanged by this design). The `Object.assign` merge only guarantees keys listed in `defaultSettings`. If a developer adds a new `settings.newThing` reference without adding it to `defaultSettings`, it will be `undefined`. This is a pre-existing concern — but without inline fallbacks, it will now fail visibly (NaN in UI, etc.) rather than silently using a stale hardcoded value. This is actually better — bugs surface immediately.

### Prerequisite: Merge `QUERY_CONTEXT_DEFAULTS` into `defaultSettings`
`query-context.js` uses `settings?.entityWindowSize ?? QUERY_CONTEXT_DEFAULTS.entityWindowSize`. These five keys (`entityWindowSize`, `embeddingWindowSize`, `recencyDecayFactor`, `topEntitiesCount`, `entityBoostWeight`) live in `QUERY_CONTEXT_DEFAULTS` but are **not** in `defaultSettings`. The `loadSettings()` merge does not include them, so for first-time users these are `undefined` on the settings object.

**Fix:** Add these five keys to `defaultSettings` in `constants.js` (values copied from `QUERY_CONTEXT_DEFAULTS`). After this, the `?? QUERY_CONTEXT_DEFAULTS.xxx` fallbacks in `query-context.js` become dead code and can be removed like everything else. The `QUERY_CONTEXT_DEFAULTS` export can be kept for backward compat or removed if no external consumers exist.

```diff
  // Entity settings
  entityDescriptionCap: 3,
  edgeDescriptionCap: 5,
  entityMergeSimilarityThreshold: 0.95,
+ // Query context settings (previously in QUERY_CONTEXT_DEFAULTS)
+ entityWindowSize: 10,
+ embeddingWindowSize: 5,
+ recencyDecayFactor: 0.09,
+ topEntitiesCount: 5,
+ entityBoostWeight: 5.0,
```

### Edge case: `||` with intentionally falsy values
`settings.embeddingDocPrefix || ''` — if the user sets prefix to empty string, `||` would override to `''` (same value, harmless). But `settings.extractionProfile || ''` with an empty profile would also be harmless. After removal, these edge cases become non-issues since the bare reference respects all values including falsy ones.
