# Design: Performance Monitoring Tab

## 1. Problem Statement

OpenVault has 12 performance-critical operations spanning sync (blocks AI generation), network (LLM APIs), GPU/WASM (embeddings), and CPU (graph algorithms). Currently there's one hardcoded `console.log` in `math.js`. Users have no visibility into what's slow or scaling poorly without opening F12.

We need a **5th UI tab** that shows last-run timing for each metric, color-coded health, size/complexity context, and one-click clipboard export.

## 2. Goals & Non-Goals

### Must do
- Add 5th "Perf" tab to settings panel
- Track 12 metrics with `performance.now()` instrumentation
- Store last value per metric in `chatMetadata.openvault.perf` (survives page reload)
- Show timing + size/complexity context per metric
- Color-code: green (healthy) / red (slow) based on configurable thresholds in `constants.js`
- Copy full table to clipboard as formatted text
- Respect existing patterns: debug-gated `log()`, constants in `constants.js`, data in `chatMetadata`

### Won't do
- History/trends/sparklines (future upgrade, store API won't change)
- Settings UI for thresholds (constants only — power users edit code)
- Auto-refresh / live polling (updates on tab switch via `refreshAllUI()`)

## 3. Proposed Architecture

### 3.1 New Module: `src/perf/store.js`

Singleton in-memory store. Two public functions:

```javascript
record(metricId, durationMs, sizeInfo?)  // Called from instrumentation points
getAll()                                  // Called by UI to render table
```

On every `record()`, also writes to `chatMetadata.openvault.perf[metricId]`.
On `CHAT_CHANGED`, clears in-memory cache and reloads from chat metadata.

### 3.2 Instrumentation Points (12 metrics)

Each call site wraps existing code with `performance.now()` and calls `record()`.

| # | Metric ID | Source File | Measures | Size Context | Sync? |
|---|-----------|-------------|----------|-------------|-------|
| 1 | `retrieval_injection` | `src/events.js` | Total pre-gen context injection | — | **Yes** (blocks AI) |
| 2 | `auto_hide` | `src/events.js` | Auto-hide old messages | messages scanned | **Yes** (blocks AI) |
| 3 | `memory_scoring` | `src/retrieval/math.js` | Alpha-blend scoring all memories | `{n} memories` | No |
| 4 | `event_dedup` | `src/extraction/extract.js` | `filterSimilarEvents` cross+intra | `{new}×{existing}` | No |
| 5 | `llm_events` | `src/extraction/extract.js` | LLM API: event extraction | — | No (network) |
| 6 | `llm_graph` | `src/extraction/extract.js` | LLM API: graph extraction | — | No (network) |
| 7 | `llm_reflection` | `src/extraction/worker.js` or reflection orchestrator | LLM API: question gen + insight gen | — | No (network) |
| 8 | `llm_communities` | `src/graph/communities.js` or orchestrator | LLM API: community summaries | `{n} communities` | No (network) |
| 9 | `embedding_generation` | `src/embeddings.js` | Batch embedding via Transformers.js/Ollama | `{n} embeddings via {source}` | No (GPU/WASM) |
| 10 | `louvain_detection` | `src/graph/communities.js` | Louvain algorithm | `{n} nodes, {m} edges` | No (CPU) |
| 11 | `entity_merge` | `src/graph/graph.js` | Semantic merge (cosine+overlap+LCS+stems) | `{new}×{existing} nodes` | No (CPU) |
| 12 | `chat_save` | `src/utils/data.js` | `saveChatConditional` I/O | — | No (I/O) |

### 3.3 UI: 5th Tab

Table layout with 4 columns:

| Metric | Last | Scale | Status |
|--------|------|-------|--------|
| Pre-gen injection | 342ms | — | 🟢 |
| Memory scoring | 12ms | 450 memories | 🟢 |
| Event dedup | 89ms | 5×200 O(n×m) | 🟢 |
| Louvain | 1,240ms | 87 nodes, 312 edges | 🔴 |

Footer: `[Copy to Clipboard]` button.

### 3.4 Threshold Color Logic

```
value <= green_threshold  →  green (#4b4 / --ok-color)
value > green_threshold   →  red   (#f44 / --error-color)
```

Simple two-state. No yellow/orange — this is a quick diagnostic, not a dashboard.

## 4. Data Models / Schema

### 4.1 Chat Metadata (`chatMetadata.openvault.perf`)

```typescript
{
  perf: {
    [metricId: string]: {
      ms: number,          // Duration in milliseconds
      size: string | null,  // Human-readable size context, e.g. "450 memories"
      ts: number            // Date.now() timestamp of recording
    }
  }
}
```

### 4.2 Constants (`src/constants.js`)

```javascript
export const PERF_THRESHOLDS = {
    retrieval_injection: 2000,  // sync — blocks AI response
    auto_hide:           500,   // sync — blocks AI response
    memory_scoring:      200,
    event_dedup:         500,
    llm_events:        30000,   // network — LLM API
    llm_graph:         30000,
    llm_reflection:    45000,   // 2 LLM calls (questions + insights)
    llm_communities:   30000,
    embedding_generation: 10000, // GPU/WASM
    louvain_detection:  1000,
    entity_merge:       1000,
    chat_save:          1000,
};
```

### 4.3 Metric Display Metadata (in `src/perf/store.js`)

```javascript
export const PERF_METRICS = {
    retrieval_injection: { label: 'Pre-gen injection',    icon: 'fa-bolt',           sync: true  },
    auto_hide:           { label: 'Auto-hide messages',   icon: 'fa-eye-slash',      sync: true  },
    memory_scoring:      { label: 'Memory scoring',       icon: 'fa-calculator',     sync: false },
    event_dedup:         { label: 'Event dedup',          icon: 'fa-clone',          sync: false },
    llm_events:          { label: 'LLM: Events',         icon: 'fa-cloud',          sync: false },
    llm_graph:           { label: 'LLM: Graph',          icon: 'fa-cloud',          sync: false },
    llm_reflection:      { label: 'LLM: Reflection',     icon: 'fa-cloud',          sync: false },
    llm_communities:     { label: 'LLM: Communities',    icon: 'fa-cloud',          sync: false },
    embedding_generation:{ label: 'Embeddings',           icon: 'fa-vector-square',  sync: false },
    louvain_detection:   { label: 'Louvain',              icon: 'fa-circle-nodes',   sync: false },
    entity_merge:        { label: 'Entity merge',         icon: 'fa-code-merge',     sync: false },
    chat_save:           { label: 'Chat save',            icon: 'fa-floppy-disk',    sync: false },
};
```

## 5. Interface / API Design

### 5.1 Store API (`src/perf/store.js`)

```javascript
/**
 * Record a performance metric.
 * @param {string} metricId - Key from PERF_METRICS
 * @param {number} durationMs - Duration from performance.now() delta
 * @param {string|null} [size=null] - Human-readable scale context
 */
export function record(metricId, durationMs, size = null);

/**
 * Get all recorded metrics (merged: in-memory overrides persisted).
 * @returns {Object<string, {ms: number, size: string|null, ts: number}>}
 */
export function getAll();

/**
 * Load persisted perf data from chatMetadata on chat switch.
 */
export function loadFromChat();

/**
 * Format all metrics as copyable text.
 * @returns {string}
 */
export function formatForClipboard();
```

### 5.2 Instrumentation Pattern

Every call site follows the same 3-line pattern:

```javascript
import { record } from '../perf/store.js';

const t0 = performance.now();
// ... existing operation ...
record('metric_id', performance.now() - t0, 'optional size string');
```

Plus the existing `log()` call from `rpz.txt` for F12 console output.

### 5.3 UI Rendering (`src/ui/settings.js`)

New function `renderPerfTab()` called by `refreshAllUI()`. Builds table rows from `getAll()`, applies threshold coloring from `PERF_THRESHOLDS`.

## 6. Risks & Edge Cases

| Risk | Mitigation |
|------|-----------|
| Metrics not yet recorded (fresh chat) | Show "—" with neutral gray styling |
| Chat switch mid-recording | `loadFromChat()` on `CHAT_CHANGED` clears in-memory, reloads from new chat |
| `performance.now()` across async boundaries (LLM calls) | Wall-clock is what we want here — it measures user-perceived latency |
| Store grows unbounded | Impossible — fixed 12 keys, one value each. ~500 bytes total. |
| Threshold constants get stale | Users edit `constants.js`. No runtime config needed for a debug tool. |
| Clipboard copy fails (no HTTPS) | Fallback: select-all in a textarea popup |

## 7. File Changes Summary

| File | Change |
|------|--------|
| `src/constants.js` | Add `PERF_THRESHOLDS` and `PERF_METRICS` |
| `src/perf/store.js` | **New file** — singleton store (~80 lines) |
| `templates/settings_panel.html` | Add 5th tab button + tab content |
| `src/ui/settings.js` | Add `renderPerfTab()`, call in `refreshAllUI()`, init tab |
| `src/events.js` | Instrument `autoHideOldMessages()` + `onBeforeGeneration()` |
| `src/retrieval/math.js` | Replace `console.log` with `record()` + `log()` |
| `src/extraction/extract.js` | Instrument `filterSimilarEvents()` + 2 LLM calls |
| `src/embeddings.js` | Instrument `enrichEventsWithEmbeddings()` |
| `src/graph/communities.js` | Instrument `detectCommunities()` |
| `src/graph/graph.js` | Instrument entity merge loop |
| `src/utils/data.js` | Instrument `saveOpenVaultData()` |
| Reflection orchestrator | Instrument reflection LLM calls |
| Community summary orchestrator | Instrument community LLM calls |
| `style.css` | Perf table styles + green/red color classes |
