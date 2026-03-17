# UI Subsystem

## WHAT
Handles the ST settings panel with progressive disclosure design: status/browsing first, settings hidden behind collapsible sections. Uses standard jQuery with strict architectural boundaries.

## ARCHITECTURE
- **`helpers.js`**: Pure data transformations (pagination, filtering, math). **ZERO DOM INTERACTION**. Fully unit testable.
- **`templates.js`**: Pure functions returning HTML strings. Includes `graphStatsCard()` for World tab. **ZERO STATE MUTATION**.
- **`render.js`**: State orchestration and DOM manipulation (`$()`). Includes `renderGraphStats()` for World tab.
- **`settings.js`**: Event binding and persistence. `handleResetSettings()` preserves connection settings.

## TAB STRUCTURE (Progressive Disclosure)
Settings reorganized by user activity pattern, not technical category:

1. **Dashboard** (dashboard-connections): Quick Toggles → Status → Stats → Progress → [collapsed] Connection & Setup, Embeddings, API Limits
2. **Memories** (memory-bank): Browser/Search first → [collapsed] Character States, Extraction & Context, Reflection Engine
3. **World** (world): Graph Stats Card → Communities → Entities. **Pure viewer, zero settings**.
4. **Advanced** (advanced): Warning banner → [collapsed] Scoring & Weights, Decay Math, Similarity Thresholds → Danger Zone
5. **Perf** (perf): Performance metrics table with health indicators

## PATTERNS & CONVENTIONS
- **Drawers (`.openvault-details`)**: Collapsible `<details>` elements. CSS hides native triangle, uses rotating `›` chevron.
- **Settings Binding**: Uses `bindSetting(elementId, settingKey, type)`. ALL saves via `getDeps().saveSettingsDebounced()`.
- **Reset Behavior**: `handleResetSettings()` preserves connection profiles (extractionProfile, embeddingSource, ollamaUrl, etc.) and only resets fine-tuning math.
- **Warning Banner**: Advanced tab has amber warning banner discouraging changes to pre-calibrated values.
- **Naming**:
  - IDs: `openvault_setting_name`
  - Values: `openvault_setting_name_value`
  - Setting Keys: `camelCase` (e.g., `reflectionThreshold`)

## INTERNAL CONSTANTS (Not User-Configurable)
These 9 settings were moved from `defaultSettings` to internal constants in `src/constants.js`:
- `REFLECTION_DEDUP_REJECT_THRESHOLD` (0.9), `REFLECTION_DEDUP_REPLACE_THRESHOLD` (0.8)
- `REFLECTION_DECAY_THRESHOLD` (750), `ENTITY_DESCRIPTION_CAP` (3), `EDGE_DESCRIPTION_CAP` (5)
- `COMMUNITY_STALENESS_THRESHOLD` (100), `COMBINED_BOOST_WEIGHT` (15)
- `IMPORTANCE_5_FLOOR` (5), `ENTITY_MERGE_THRESHOLD` (0.8)

## PAYLOAD CALCULATOR (`PAYLOAD_CALC`)
- Single source of truth in `src/constants.js`.
- Shows real total token cost: `Budget + Rearview + OVERHEAD`.
- **OVERHEAD** = 12k (8k max output + 4k prompt/safety buffer).
- Thresholds: Green <=32k, Yellow <=48k, Orange <=64k, Red >64k.
- Shows LLM context size compatibility warning.

## GOTCHAS & RULES
- **No Inline Events**: Bind exclusively via jQuery `.on()` in `initBrowser()`.
- **XSS Safety**: ALL user-generated data (summaries, entity names) MUST pass through `escapeHtml()` from `src/utils/dom.js` before templates.
- **Manual Backfill Guard**: Checks `isWorkerRunning()` first. Rejects if active to prevent race conditions.

## PERF TAB
- **Purpose**: Last-run timings for 12 metrics (2 sync, 10 async) with health indicators.
- **Table**: Icon | Metric name | Last timing | Scale | Status dot
- **SYNC Badge**: Blocking metrics (`retrieval_injection`, `auto_hide`) show red "SYNC" badge.
- **Copy Button**: `formatForClipboard()` generates plain text report.
- **Rendering**: `renderPerfTab()` in `settings.js` called from `refreshAllUI()`.
- **Hydration**: `loadPerfFromChat()` restores persisted perf data on chat switch.