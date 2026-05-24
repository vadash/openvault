# Performance Monitoring

## WHAT
In-memory singleton store for tracking operation timings. Persists to `chatMetadata.openvault.perf`. Renders in Settings → Perf tab.

## ARCHITECTURE
- **Store**: `{ [metricId]: { ms, size, ts } }` — last-value-wins per metric
- **Persistence**: Auto-saves to `chatMetadata.openvault.perf` on every `record()`
- **Hydration**: `loadFromChat()` restores in-memory store on chat switch
- **12 Metrics**: Defined in `PERF_METRICS` (src/constants.js) — 2 sync (critical path), 10 async

## EXPORTS
- `record(metricId, durationMs, size)` — store metric + persist
- `getAll()` — get in-memory snapshot
- `loadFromChat()` — hydrate from chat metadata
- `formatForClipboard()` — plain text report for copy-paste
- `_resetForTest()` — test-only reset

## CONSTANTS (src/constants.js)
- `PERF_THRESHOLDS`: health threshold (ms) for each metric — red if exceeded
- `PERF_METRICS`: `{ label, icon, sync }` metadata per metric

## SYNC vs ASYNC
- **Sync metrics** (`retrieval_injection`, `auto_hide`): run during `GENERATION_AFTER_COMMANDS`. Block chat generation. Red = bad UX.
- **Async metrics**: everything else (LLM calls, embedding, save, etc.)

## INSTRUMENTATION PATTERN
```javascript
const t0 = performance.now();
try {
    // ... operation ...
} finally {
    record('metric_id', performance.now() - t0, 'scale context');
}
```
Use `finally` to ensure timing is recorded even on early returns/exceptions.
