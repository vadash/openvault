# Memory Extraction Subsystem

> For the big picture of how this fits into the whole app, see `docs/ARCHITECTURE.md`.

## WHAT
Extracts events, entities, and relationships from chat. Converts raw messages into structured JSON, deduplicates, embeds. Triggers reflection and community detection pipelines.

## HOW: The Pipeline (`extract.js`)
1. **Message Selection**: `scheduler.js` determines unextracted batches.
2. **Stage A - Event Extraction**: `buildEventExtractionPrompt()` builds event-only prompt. LLM reasons in `<reasoning>` XML tags (stripped before parse), then returns `EventExtractionSchema` (events only).
3. **Stage B - Graph Extraction**: If events found, `buildGraphExtractionPrompt()` builds graph prompt with extracted events as context. LLM returns `GraphExtractionSchema` (entities + relationships).
4. **Processing**: `parseEventExtractionResponse()` / `parseGraphExtractionResponse()` strip tags, validate via Zod.
5. **Graph Update**: Semantic entity merge via `mergeOrInsertEntity()`, relationships via `upsertRelationship()`.
6. **Character States**: `updateCharacterStatesFromEvents()` validates names against known characters before creating state entries.
7. **Reflection Check**: Per-character importance accumulation; triggers at threshold 40.
8. **Community Detection**: Every 50 messages, runs Louvain via `src/graph/communities.js`.
9. **Commit**: Two-phase dedup — Cosine >= 0.92 vs existing memories, then Jaccard >= 0.6 within batch. Save to `chatMetadata`.

## GOTCHAS & RULES
- **Two-Stage Extraction**: Events extracted first (Stage A), then entities/relationships (Stage B) using events as context. Reduces LLM cognitive load and JSON failures.
- **Split Schemas**: `EventExtractionSchema` (events only), `GraphExtractionSchema` (entities + relationships). No unified `ExtractionResponseSchema`. Reasoning happens outside JSON via `<reasoning>` XML tags, stripped by `stripThinkingTags()`.
- **JSON Array Recovery**: If LLM returns malformed JSON (e.g., missing wrapping array), attempts to recover via regex before failing. Expected retry via backoff scheduler.
- **Event Summary Minimum**: 30 characters strictly enforced via Zod schema. LLM failures here are expected — scheduler retries automatically.
- **Entity Keys**: Always normalize via `normalizeKey()` (lowercase, strips possessives) before graph operations. LLM outputs original casing.
- **Key Normalization**: `source`/`target` in relationships resolved via `_resolveKey()` to handle entity merge redirects.
- **Zod Schemas**: Defined in `structured.js`, converted to JSON Schema Draft-04 for ST. Use `getEventExtractionJsonSchema()` / `getGraphExtractionJsonSchema()`.
- **LLM Configs**: `LLM_CONFIGS.extraction_events` (4000 tokens), `LLM_CONFIGS.extraction_graph` (2000 tokens). No unified `extraction` config.
- **Settings Values**: All thresholds/interval values read from `settings` object (defaults provided): `reflectionThreshold` (40), `communityDetectionInterval` (50), `entityDescriptionCap` (3), `edgeDescriptionCap` (5).
- **Reflections are Memories**: Stored with `type: 'reflection'`, retrieved alongside events.
- **Character Validation**: `updateCharacterStatesFromEvents()` and `cleanupCharacterStates()` prevent corrupted state entries from invalid names.
- **Two-Phase Dedup**: `filterSimilarEvents` (exported) first filters vs existing via cosine, then intra-batch via Jaccard token overlap. Catches near-duplicates with orthogonal embeddings.
- **Testing**: Test parsers heavily. See `tests/extraction/structured.test.js`.