# OpenVault Architecture

Decoupled two-path architecture operating entirely within SillyTavern's `chatMetadata.openvault`.

## 1. DATA FLOW PIPELINES

### Critical Path (Synchronous, on `GENERATION_AFTER_COMMANDS`)
1. `autoHideOldMessages()`: Marks extracted messages as `is_system=true` if visible tokens > budget. Turn-boundary snapped.
2. `retrieveAndInjectContext()`: Scores memories -> Injects via `safeSetExtensionPrompt` (`openvault_memory` & `openvault_world`).

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
  memories: [{ // Both events and reflections
    id: string, type: "event"|"reflection", summary: string, importance: 1-5,
    tokens: string[], message_ids?: number[], source_ids?: string[], // source_ids for reflections
    characters_involved: string[], embedding_b64: string, archived: boolean
  }],
  graph: {
    nodes: { [normKey]: { name, type, description, mentions, embedding_b64: string, aliases? } },
    edges: { "src__tgt": { source, target, description, weight } }
  },
  communities: { "C0": { title, summary, findings: string[], nodeKeys: string[], embedding_b64: string } },
  character_states: { "Name": { current_emotion, emotion_intensity, known_events: string[] } },
  reflection_state: { "Name": { importance_sum: number } },
  processed_message_ids: number[]
}
```

## 3. CORE SYSTEMS SAUCE

**Retrieval Math (Alpha-Blend)**: `Score = Base + (Alpha * VectorBonus) + ((1 - Alpha) * BM25Bonus)`
- *Base (Forgetfulness)*: `Importance * e^(-Lambda * Distance)`. Imp 5 has soft floor of 1.0. Reflections > 750 msgs decay linearly to 0.25x.
- *BM25*: IDF-aware. Dynamic Character Stopwords (names filtered out to prevent score inflation).

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

**Testing Tiers**:
- *Tier 1*: Pure transforms (`math.js`, `helpers.js`). Unit tested.
- *Tier 2*: Orchestrators (`extract.js`, `retrieve.js`). Integration tested via `deps.js` boundary.
- *Invariant*: Messages MUST be extracted before hiding. Turn-boundary snapping prevents U/B pair splitting.