# Design: Settings UI Restructure & Missing Bindings

## 1. Problem Statement

The OpenVault settings panel has **6 backend settings** defined in `constants.js` and used in the math/extraction/reflection engines that are **not exposed in the UI**. Users cannot tune memory decay speed, entity description caps, reflection limits, community staleness, or Jaccard deduplication thresholds.

Additionally, the current 5-tab layout (Dashboard, Memory Bank, World, Config, System) puts all configuration into a single "Config" tab, making it overwhelming. The browsing UIs (stats, memory browser, entity/community browser) are separated from their related settings, forcing users to tab-switch to understand how settings affect what they're seeing.

## 2. Goals & Non-Goals

### Must Do
- **Add 6 missing UI bindings:** `forgetfulnessBaseLambda`, `forgetfulnessImportance5Floor`, `reflectionDecayThreshold`, `entityDescriptionCap`, `maxReflectionsPerCharacter`, `communityStalenessThreshold`.
- **Add `dedupJaccardThreshold`** to `defaultSettings` and `UI_DEFAULT_HINTS` in `constants.js` (currently only has an inline fallback in `extract.js`).
- **Restructure from 5 tabs to 4 tabs** with a "browsers-first, settings collapsed" layout.
- **Add detailed comments** to all new and modified code sections.

### Won't Do
- Change any backend logic (math.js, extract.js, reflect.js) — this is UI-only.
- Add new settings that don't already exist in `constants.js`.
- Redesign the CSS/visual theme — reuse existing `.openvault-*` classes.

## 3. Proposed Architecture

### Tab Structure: 4 Tabs, Browsers-First

```
┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
│   Dashboard &    │   Memory Bank    │      World       │    Advanced      │
│   Connections    │                  │                  │    Tuning        │
├──────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ VISIBLE:         │ VISIBLE:         │ VISIBLE:         │ VISIBLE:         │
│ • Status card    │ • Search bar     │ • Community list │ • Scoring &      │
│ • Stats grid     │ • Filters        │ • Entity browser │   Weights        │
│ • Batch progress │ • Memory list    │                  │ • BM25 Tuning    │
│ • Quick toggles  │ • Pagination     │ COLLAPSED:       │ • Decay Math     │
│                  │ • Char states    │ • Retrieval &    │ • Similarity     │
│ COLLAPSED:       │ • Refl. progress │   Injection      │   Thresholds     │
│ • LLM Strategy   │                  │   settings       │ • Danger Zone    │
│ • Embedding      │ COLLAPSED:       │                  │ • Debug/Export   │
│   settings       │ • Extraction &   │                  │                  │
│ • Debug toggles  │   Graph Rules    │                  │                  │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

### Tab 1: Dashboard & Connections
**Purpose:** "Get started" — see system health, configure connections.

**Visible (browsers-first):**
- Status card (indicator, text, embedding status)
- Stats grid (memories, characters, embeddings, reflections, entities, communities)
- Batch progress bar + Backfill/Generate Embeddings buttons
- Quick toggles (Enable OpenVault, Auto-hide)

**Collapsed section: "Connection Settings"**
- Extraction Profile dropdown
- Embedding Source selector + Ollama URL/model/prefix fields + Test button + WebGPU help
- Debug Mode checkbox
- Request Logging checkbox

### Tab 2: Memory Bank
**Purpose:** Browse memories, configure how data goes IN.

**Visible (browsers-first):**
- Memory search, filters, list, pagination
- Character States (existing collapsible)
- Reflection Progress (existing collapsible)

**Collapsed section: "Extraction & Graph Rules"**
- Messages per Extraction slider (existing)
- Extraction Buffer / Context Window Size slider (existing `extractionRearviewTokens`)
- **NEW:** Entity Description Cap slider (1–10, default 3)
- Edge Description Cap slider (existing)
- Reflection Threshold slider (existing)
- Max Insights per Reflection slider (existing)
- Reflection Dedup Threshold slider (existing)
- **NEW:** Max Reflections per Character slider (10–200, default 50)
- **NEW:** Reflection Decay Threshold slider (100–2000, default 500)
- Community Detection Interval slider (existing)
- **NEW:** Community Staleness Threshold slider (20–500, default 100)
- Backfill Rate Limit input (existing)

### Tab 3: World
**Purpose:** Browse entities/communities, configure how data comes OUT.

**Visible (browsers-first):**
- Community list with count badge
- Entity browser with search + type filter

**Collapsed section: "Retrieval & Injection"**
- Final Context Token Budget slider (existing)
- World Context Budget slider (existing)
- Auto-hide Threshold slider (existing)
- Entity Window Size slider (existing)
- Embedding Window Size slider (existing)
- Top Entities Count slider (existing)
- Entity Boost Weight slider (existing)

### Tab 4: Advanced Tuning
**Purpose:** Math knobs + system utilities. Power users only.

**Section: Scoring & Weights**
- Alpha blend slider (existing)
- Combined Boost Weight slider (existing)

**Section: Decay Math (NEW)**
- **NEW:** Forgetfulness Base Lambda slider (0.01–0.20, step 0.01, default 0.05)
  - *Controls how fast memories fade. Lower = memories last longer.*
- **NEW:** Importance-5 Floor slider (1–20, step 1, default 5)
  - *Minimum score for max-importance memories. Higher = critical memories stay relevant longer.*
- **NEW:** Reflection Decay Threshold (also accessible from Tab 2, but shown here for completeness — linked, not duplicated)

**Section: Similarity Thresholds**
- Vector Similarity Threshold slider (existing)
- Dedup Cosine Threshold slider (existing)
- **NEW:** Jaccard Dedup Threshold slider (0.3–0.9, step 0.05, default 0.6)
  - *Token-overlap filter for near-duplicate memories. Lower = more aggressive dedup.*
- Reflection Dedup Threshold (reference to Tab 2 setting)
- Entity Merge Threshold slider (existing)

**Section: System**
- Debug Mode, Request Logging (linked to Tab 1 — `id` attributes shared)
- Export Debug to Clipboard button
- Danger Zone: Delete Chat Memories, Delete Chat Embeddings

## 4. Data Models / Schema

### New default in `constants.js`

```javascript
// In defaultSettings, add:
dedupJaccardThreshold: 0.6, // Token-overlap threshold for near-duplicate filtering (Jaccard index)

// In UI_DEFAULT_HINTS, add:
dedupJaccardThreshold: defaultSettings.dedupJaccardThreshold,
forgetfulnessBaseLambda: defaultSettings.forgetfulnessBaseLambda,
forgetfulnessImportance5Floor: defaultSettings.forgetfulnessImportance5Floor,
reflectionDecayThreshold: defaultSettings.reflectionDecayThreshold,
entityDescriptionCap: defaultSettings.entityDescriptionCap,
maxReflectionsPerCharacter: defaultSettings.maxReflectionsPerCharacter,
communityStalenessThreshold: defaultSettings.communityStalenessThreshold,
```

No schema changes — all settings already exist in the `defaultSettings` object (except `dedupJaccardThreshold` which is being added).

## 5. Interface / API Design

### New HTML element IDs

| Setting | Input ID | Value Display ID | Type | Min | Max | Step |
|---------|----------|-------------------|------|-----|-----|------|
| `forgetfulnessBaseLambda` | `openvault_forgetfulness_lambda` | `openvault_forgetfulness_lambda_value` | range | 0.01 | 0.20 | 0.01 |
| `forgetfulnessImportance5Floor` | `openvault_importance5_floor` | `openvault_importance5_floor_value` | range | 1 | 20 | 1 |
| `reflectionDecayThreshold` | `openvault_reflection_decay_threshold` | `openvault_reflection_decay_threshold_value` | range | 100 | 2000 | 50 |
| `entityDescriptionCap` | `openvault_entity_description_cap` | `openvault_entity_description_cap_value` | range | 1 | 10 | 1 |
| `maxReflectionsPerCharacter` | `openvault_max_reflections` | `openvault_max_reflections_value` | range | 10 | 200 | 10 |
| `communityStalenessThreshold` | `openvault_community_staleness` | `openvault_community_staleness_value` | range | 20 | 500 | 10 |
| `dedupJaccardThreshold` | `openvault_dedup_jaccard` | `openvault_dedup_jaccard_value` | range | 0.30 | 0.90 | 0.05 |

### Files modified

1. **`src/constants.js`** — Add `dedupJaccardThreshold` to `defaultSettings`, add 7 entries to `UI_DEFAULT_HINTS`.
2. **`templates/settings_panel.html`** — Full restructure from 5 tabs to 4 tabs. Move existing HTML blocks between tabs. Add 7 new slider controls with labels, hints, and default-hint spans.
3. **`src/ui/settings.js`** — Add 7 new `bindUIElements()` handlers, 7 new `updateUI()` sync blocks. Update `initTabs()` if tab data attributes change.

### Shared elements between tabs

Some settings appear conceptually in two places (e.g., Reflection Decay Threshold in both Tab 2 and Tab 4). **These will NOT be duplicated.** Each setting has a single HTML element with a single ID. The element lives in its primary tab; the other tab may reference it with a text note like "See Advanced Tuning tab."

## 6. Risks & Edge Cases

- **Existing user settings preserved:** `loadSettings()` already uses `Object.assign` with defaults, so adding `dedupJaccardThreshold` to `defaultSettings` won't overwrite existing user values.
- **Tab button count:** Going from 5 to 4 tabs. Icon-only buttons on narrow panels may need testing. Current CSS already handles `flex-wrap` on `.openvault-tab-nav`.
- **Duplicate IDs:** Must ensure no HTML element ID is duplicated across tabs (shared elements live in one tab only).
- **Backward compatibility:** Users with saved settings referencing removed tab names (e.g., `data-tab="configuration"`) — the JS binding uses `data-tab` attributes, so old localStorage tab state could try to activate a non-existent tab. `initTabs()` should default to the first tab if the stored tab doesn't exist.
- **Empty state:** If no chat is loaded, the Memory Bank and World browsers show placeholders. This is existing behavior and remains unchanged.
