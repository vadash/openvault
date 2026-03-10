# OpenVault Architecture

Decoupled two-path architecture operating entirely within SillyTavern's `chatMetadata.openvault`.

## 1. DATA FLOW PIPELINES

### Critical Path (Synchronous, on `GENERATION_AFTER_COMMANDS`)
1. `autoHideOldMessages()`: Marks extracted messages as `is_system=true` if visible tokens > budget. Turn-boundary snapped.
2. `retrieveAndInjectContext()`: Scores memories -> Injects via `safeSetExtensionPrompt` (`openvault_memory` & `openvault_world`).

**Pending Message Source**: ST fires this event BEFORE `chat.push()` and BEFORE textarea clear. For new sends (`type=normal`), the user message is read from `$('#send_textarea').val()`. For regenerate/swipe, it falls back to the last `is_user` message in `context.chat`.

### Background Path (Async worker, on `MESSAGE_RECEIVED`)
Worker (`src/extraction/worker.js`) is single-instance, interruptible (checks `wakeGeneration` every 500ms), fast-fails on chat switch, and uses exponential backoff.

**Phase 1: Critical (Gates Auto-hide)**
- **Stage A (Events)**: LLM extracts events using configurable assistant prefill (default: `<think>` tag) and preamble language (CN/EN) -> JSON. Mirror Language Rule auto-detects input language and mirrors it in output values. Bilingual few-shot examples (EN/RU) calibrate model compliance. Non-Latin script detection adds user-message reinforcement to prevent English default.
- **Stage B (Graph)**: LLM extracts entities/relationships using Stage A output.
- **Graph Update**: Upsert nodes/edges. Semantic Merge (Cosine >0.94 + Token Overlap guard filtering stopwords).
- **INTERMEDIATE SAVE**: Events, graph, and `processed_message_ids` persisted.

**Phase 2: Enrichment (Errors swallowed, non-blocking)**
- **Reflection**: If character `importance_sum >= 40` -> Generate questions -> Insights -> 3-Tier dedup -> Embed.
- **Communities**: Every 50 msgs -> Louvain GraphRAG -> LLM Summaries.
- **FINAL SAVE**: Reflections and Communities persisted.

## 2. DATA SCHEMA (`chatMetadata.openvault`)
```typescript
{
  embedding_model_id: string,  // tracks which model generated stored embeddings
  memories: [{ // Both events and reflections
    id: string, type: "event"|"reflection", summary: string, importance: 1-5,
    tokens: string[], message_ids?: number[], source_ids?: string[], // source_ids for reflections
    characters_involved: string[], embedding_b64: string, archived: boolean, mentions?: number
  }],
  graph: {
    nodes: { [normKey]: { name, type, description, mentions, embedding_b64: string, aliases? } },
    edges: { "src__tgt": { source, target, description, weight } }
  },
  communities: { "C0": { title, summary, findings: string[], nodeKeys: string[], embedding_b64: string } },
  character_states: { "Name": { current_emotion, emotion_intensity, known_events: string[] } },
  reflection_state: { "Name": { importance_sum: number } },
  processed_message_ids: number[],
  perf: { // Performance monitoring — last-value-wins per metric
    [metricId]: { ms: number, size: string | null, ts: number }
  }
}
```

## 3. CORE SYSTEMS SAUCE

**Retrieval Math (Alpha-Blend)**: `Score = (Base + (Alpha * VectorBonus) + ((1 - Alpha) * BM25Bonus)) × FrequencyFactor`
- *Base (Forgetfulness)*: `Importance * e^(-Lambda * Distance)`. Lambda dampened by `hitDamping = max(0.5, 1/(1 + retrieval_hits × 0.1))` — frequently retrieved memories decay up to 50% slower. Imp 5 has soft floor of 1.0. Reflections > 750 msgs decay linearly to 0.25x.
- *Frequency Factor*: `1 + ln(mentions) × 0.05`. Sublinear boost from event repetitions (dedup increments `mentions`). 10 mentions ≈ +11.5%, 50 mentions ≈ +20%.
- *BM25*: IDF-aware using **expanded corpus** (candidates + hidden memories) to prevent common terms from getting artificially high scores. Dynamic Character Stopwords (names filtered out to prevent score inflation). **Three-Token-Tier System** (Layers 1-3): Entity stems at 5x, corpus-grounded stems at 3x, non-grounded stems at 2x. **Event Gate**: BM25 skipped when no events in candidates (returns empty token array).

**BM25 Token Construction** (`buildBM25Tokens` + `buildCorpusVocab`):
- **Layer 1**: Named entities from graph — full boost (`entityBoostWeight` = 5x).
- **Layer 2**: User-message stems that exist in corpus vocab — 60% boost (`ceil(entityBoostWeight * 0.6)` = 3x). High-signal tokens that match memory/graph content.
- **Layer 3**: User-message stems NOT in corpus vocab — 40% boost (`ceil(entityBoostWeight * 0.4)` = 2x). Scene context and dialogue tokens that may match memory content via IDF.
- Corpus vocab = memory `.tokens` + tokenized graph node/edge descriptions.
- Backward compat: `corpusVocab=null` includes all message tokens at 1x (unfiltered).

**Entity Semantic Merging**: Prevents duplicates ("The King" vs "King Aldric").
- *Guard 1*: Embeddings (type + name + description) cosine sim >= `0.94`.
- *Guard 2*: Token Overlap >= 50% filtering base EN+RU stopwords. Old names saved to `aliases`. Does NOT bridge script boundaries (Latin↔Cyrillic) — prompt rules enforce name preservation instead.
- *Guard 3 (LCS)*: Longest Common Substring ratio >= 60% for keys longer than 2 chars (lowered from 3 to catch short names like "Кай"/"Каю").
- *Guard 4 (Stems)*: `stemWord()`-based token overlap catches Russian morphological variants (e.g., "ошейник"/"ошейником").

**POV Filtering**: `filterMemoriesByPOV()` controls what each character "knows":
- Witnesses see any event (including secrets).
- Characters in `characters_involved` see the event regardless of `is_secret` (participants know their own secrets).
- `is_secret` only hides events from characters who are neither involved nor witnesses.
- Explicit `known_events` tracking for additional access.
- *Pre-flight*: Aborts if recent events >85% similar to existing insights.
- *Tier 1 (Reject >=90%)*: Duplicate, discard.
- *Tier 2 (Replace 80-89%)*: Same theme. Old set to `archived: true`, new added.
- *Tier 3 (Add <80%)*: Genuinely new.

**GraphRAG Communities**:
- *Pruning*: Edges involving User/Char temporarily removed before Louvain to prevent "hairball" clusters. Re-assigned after.
- *Injection*: Pure vector search injected into `openvault_world` slot.

**Embeddings**: Stored as Base64 Float32Array, decoded to `Float32Array` at runtime (not `number[]`). Legacy JSON arrays wrapped in `Float32Array` on read (lazy migration). True LRU cache (max 500). All cosine similarity uses 4x loop-unrolled dot product on typed arrays. WebGPU attempts first -> falls back to WASM. `device.lost` not monitored (implicitly retries pipeline on next call). Failures degrade gracefully to BM25.

**Performance Monitoring**: Singleton store (`src/perf/store.js`) tracks 12 metrics across the pipeline. Sync metrics (`retrieval_injection`, `auto_hide`) run on critical path and block generation — red indicates UX degradation. Async metrics (LLM calls, embeddings, community detection, etc.) run in background worker. Each metric records `{ ms, size, ts }` and persists to `chatMetadata.openvault.perf`. Health thresholds in `PERF_THRESHOLDS` (src/constants.js) determine green/red indicator in UI. Copy-to-clipboard generates plain text report for debugging.

**Embedding Model Mismatch Protection**: `embedding_model_id` field at root of `chatMetadata.openvault` records which model generated the stored vectors. Stamped during extraction (when first embeddings are generated) and on `CHAT_CHANGED` for new chats. On `CHAT_CHANGED` and on embedding source dropdown change, `invalidateStaleEmbeddings()` compares the stored tag to the current global `embeddingSource` setting. Mismatch triggers bulk wipe of all `embedding_b64` fields across memories, graph nodes, and communities. Tag is updated to new model. `backfillAllEmbeddings()` auto-triggers in background to re-embed all three types (memories, graph nodes, communities). Legacy chats without a tag are treated as mismatch on first load (one-time re-embed). No UI confirmation needed — all embeddings are local Transformers.js (free). Manual "Backfill Embeddings" button also calls `backfillAllEmbeddings()` for comprehensive coverage.

**Abort/Cancellation**: Session-scoped `AbortController` in `state.js`. `resetSessionController()` fires on `CHAT_CHANGED`, aborting all in-flight LLM and embedding operations. Leaf I/O functions (`callLLM`, `getQueryEmbedding`, `getDocumentEmbedding`) read `getSessionSignal()` as default — mid-level orchestrators need no signature changes. `callLLM` uses `Promise.race` (logical cancel — HTTP continues server-side). Transformers.js pipeline and Ollama fetch use native `signal` (true cancel). AbortError re-thrown from Phase 2 catch, handled cleanly by worker and backfill loops.

**Multilingual Prompt Architecture**:
- *Output Language Setting*: User-configurable setting (`auto`/`ru`/`en`) controls language instruction and example filtering. `auto` preserves heuristic behavior (script detection via `buildLanguageReminder`). `ru`/`en` forces deterministic language instruction via `buildOutputLanguageInstruction` and filters few-shot examples to matching language only (halving token cost).
- *Mirror Language Rule*: All prompts auto-detect input language and mirror it in output string values. JSON keys remain English.
- *User-Message Reinforcement*: `buildLanguageReminder()` detects non-Latin script in input and injects an explicit "do NOT translate to English" reminder into the user message of all 5 prompts. Fires only for non-English content. Includes explicit exception for character names (must stay in original script).
- *Character Name Enforcement*: Prompt instruction injects canonical names directly (`Use EXACT character names: X, Y`). If a transliteration slips through, the graph's Semantic Merge (`mergeOrInsertEntity`) catches it via cosine similarity + token overlap, adding the variant to `aliases`.
- *Bilingual Examples*: Every prompt includes paired EN/RU few-shot examples (events: 10, graph: 8, questions: 6, insights: 6, communities: 6).
- *SFW→Kink Gradient*: Examples progress from safe to explicit content, calibrating model compliance.
- *Graph Normalization*: Entity names extracted in nominative/base form to prevent morphological duplicates. Names preserved in original script (Suzy stays Latin, Саша stays Cyrillic).
- *Stem-Augmented Overlap*: `hasSufficientTokenOverlap()` uses `stemWord()` to catch Russian inflected variants (Check 4).
- *Prompt Modules*: `src/prompts/` contains `rules.js` (shared language rules), `roles.js` (role definitions), `examples/` (bilingual few-shots), `examples/format.js` (XML formatter).

**Event Dedup**: Two-phase filtering in `filterSimilarEvents()`:
- *Phase 1 (Cross-batch)*: Cosine similarity >= threshold AND Jaccard token overlap >= half the Jaccard threshold. Dual-gate prevents false positives where semantically similar but lexically different events share structure (e.g., same actors, different acts).
- *Phase 2 (Intra-batch)*: Jaccard token overlap >= threshold between events in the same extraction batch.
Both phases increment `mentions` on the surviving memory/event when a duplicate is caught, enabling the Frequency Factor scoring boost.

**Testing Tiers**:
- *Tier 1*: Pure transforms (`math.js`, `helpers.js`). Unit tested.
- *Tier 2*: Orchestrators (`extract.js`, `retrieve.js`). Integration tested via `deps.js` boundary.
- *Invariant*: Messages MUST be extracted before hiding. Turn-boundary snapping prevents U/B pair splitting.