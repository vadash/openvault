# OpenVault Architecture & System Design

OpenVault is an agentic memory extension for SillyTavern. It functions simultaneously as a local vector database, a BM25 search engine, a GraphRAG builder, and an autonomous reflection agent.

This document outlines the high-level data flow, scoring mathematics, and system lifecycle. For implementation details on specific modules, refer to the `CLAUDE.md` files located in their respective subdirectories.

---

## 1. The Global Pipeline

OpenVault operates on two decoupled paths: a **background path** (extraction, triggered by `MESSAGE_RECEIVED`) and a **critical path** (retrieval, triggered by `GENERATION_AFTER_COMMANDS`).

### Two-Path Architecture

```text
CRITICAL PATH (synchronous, fast — runs on Generate):
  1. autoHideOldMessages()
  2. retrieveAndInjectContext()
  3. Return control to SillyTavern

BACKGROUND PATH (async, silent — runs on AI reply):
  MESSAGE_RECEIVED → wakeUpBackgroundWorker() → fire-and-forget
  Worker loop processes batches sequentially with 2s yield between each.
```

The background worker (`src/extraction/worker.js`) is single-instance (boolean guard), uses exponential backoff on failure, and halts if the user switches chats. New `MESSAGE_RECEIVED` events reset the backoff timer via a monotonic `wakeGeneration` counter with interruptible sleep.

### Extraction Pipeline (Background)

```text
[ Chat Messages ]
       │
       ▼
═══ PHASE 1 (Critical — gates auto-hide) ═══
1. EXTRACTION STAGE (Two-Stage Pipeline)
   ├─ Stage A: Event Extraction (events only, reasoning via <think> tags)
   ├─ Stage B: Graph Extraction (entities + relationships, using events as context)
   ├─ Fallback: Recovers malformed JSON arrays
   └─ Validation: Zod schemas (Events strictly >30 chars)
       │
       ▼
2. GRAPH UPDATE STAGE (GraphRAG)
   ├─ Upsert Nodes (Entities) & Edges (Relationships)
   └─ Semantic Merge: Cosine Sim > 0.94 + Token Overlap Guard (Stopwords filtered)
       │
       ▼
   INTERMEDIATE SAVE — events, graph, processed_message_ids persisted
       │
       ▼
═══ PHASE 2 (Enrichment — non-critical, errors swallowed) ═══
3. REFLECTION STAGE (Agentic Insight)
   ├─ Trigger: Character `importance_sum` >= 40
   ├─ Pre-flight Gate: Abort if recent events >85% similar to existing insights
   ├─ LLM 3-Step: Questions -> Insights -> Embeddings
   └─ Lifecycle: 3-Tier Replacement (Add / Replace / Reject)
       │
       ▼
4. COMMUNITY STAGE (World Context)
   ├─ Trigger: Every 50 extracted messages
   ├─ Graphology: Louvain algorithm groups nodes into Communities
   └─ LLM Summary: Generates dynamic lorebook entries (Title, Summary, Findings)
       │
       ▼
   FINAL SAVE — reflections, communities persisted
```

Phase 2 failures are caught and logged — they do NOT propagate to the worker's retry loop. If reflection or community detection crashes, Phase 1 data is already saved.

### Retrieval Pipeline (Synchronous)

```text
5. RETRIEVAL & INJECTION STAGE (Generation prep)
   ├─ BM25 + Vector Alpha-Blend Scoring
   ├─ Budgeting: Slice to `retrievalFinalTokens` limit
   └─ Format: Inject into `openvault_world` and `openvault_memory` ST slots
```

---

## 2. Data Storage Schema

All OpenVault data is stored entirely within the SillyTavern chat file under `chatMetadata.openvault`. No external databases are used.

```typescript
{
  memories: [
    // Mixed array of both extracted events and generated reflections
    { 
      id: "event_123" | "ref_456", 
      type: "event" | "reflection", 
      summary: string, 
      importance: 1-5, 
      message_ids: number[], // Events only
      source_ids: string[],  // Reflections only (IDs of evidence memories)
      characters_involved: string[],
      embedding: number[], 
      archived: boolean      // True if replaced by a newer reflection
    }
  ],
  graph: {
    nodes: { "normalized key": { name, type, description, mentions, embedding } },
    edges: { "source__target": { source, target, description, weight } }
  },
  communities: {
    "C0": { title, summary, findings: string[], nodeKeys: string[], embedding: number[] }
  },
  character_states: {
    "Suzy": { current_emotion, emotion_intensity, known_events: string[] }
  },
  reflection_state: {
    "Suzy": { importance_sum: 42 } // Triggers reflection at threshold
  },
  processed_message_ids: number[]
}
```

---

## 3. Core Modules

### 3.1. Entity Graph & Semantic Merging (`src/graph/`)
As the LLM extracts entities, they are added to a flat JSON graph. To prevent duplicate nodes (e.g., "The King" and "King Aldric"), the system uses a dual-guard merge logic:
1. **Cosine Similarity:** Must be >= `entityMergeSimilarityThreshold` (default `0.94`). Embeddings include `type`, `name`, AND `description` to prevent false merges.
2. **Token Overlap Guard:** Breaks down both keys into word tokens. It strips out common RP stopwords (e.g., "the", "red", "large", "burgundy") using the `stopword` JS library + custom dictionaries. It then requires >= 50% token overlap or a direct substring match. 
*Why? To prevent "Burgundy panties" from semantically merging with "Burgundy candle" just because the vectors cluster around the adjective.*

### 3.2. Agentic Reflection (`src/reflection/`)
Reflections synthesize raw events into long-term psychological insights. 
To prevent "Reflection Saturation" (wasting tokens and LLM calls on repetitive insights), it uses a strict lifecycle:
* **Pre-flight Gate:** Before spending 4 LLM calls to reflect, it checks if the newest events align (>85%) with *existing* reflections. If nothing fundamentally changed, it aborts.
* **3-Tier Replacement:** When new reflections *are* generated, they are compared against existing ones:
  * `>= 90%`: **Reject** (Exact duplicate concept).
  * `80% - 89%`: **Replace** (Same theme, updated evidence). The old reflection is marked `archived: true` (ignored by retrieval) and the new one is Added.
  * `< 80%`: **Add** (Genuinely new insight).

### 3.3. GraphRAG Communities (`src/graph/communities.js`)
Runs the Louvain algorithm to detect densely connected entity clusters (e.g., "The Royal Court", "The Rebel Camp").
* **Main Character Pruning**: Temporarily removes edges involving User/Char before Louvain to prevent "hairball" where all secondary entities only connect through protagonists.
* Summaries are embedded and queried via pure Vector search.
* Injected into the prompt as a dynamic lorebook, providing high-level world state.

### 3.4. Embedding Strategy (`src/embeddings.js`)

**Cache:** The embedding cache is a true **LRU** (not FIFO). JS `Map` preserves insertion order; on every cache hit, the entry is `delete()`d then `set()` again, moving it to the tail. Eviction removes the head (oldest-accessed). Both `getQueryEmbedding` and `getDocumentEmbedding` implement this correctly. Max 500 entries.

**WebGPU Fallback:** The pipeline attempts WebGPU first, falling back to WASM if the adapter is unavailable. GPU context loss (`device.lost`) is **deliberately not monitored** — if `pipe()` fails, the catch block clears `#cachedPipeline` and `#loadingPromise`, so the next embedding call retries pipeline creation implicitly. If embeddings return `null`, retrieval degrades to BM25 keyword-only scoring automatically. This graceful degradation makes explicit `device.lost` monitoring and retry-with-backoff unnecessary complexity for the extension's use case.

### 3.5. Testing Architecture

The codebase separates into two testability tiers:

**Tier 1: Pure Data Transformations (unit-tested)**
Modules with no external I/O. Tests feed data in, assert data out.
- `src/retrieval/math.js` — scoring curves, BM25, cosine similarity
- `src/retrieval/formatting.js` — memory → prompt text
- `src/ui/helpers.js` — UI data preparation
- `src/extraction/extract.js` (pure functions: `filterSimilarEvents`, `updateCharacterStatesFromEvents`, `cleanupCharacterStates`)
- `src/graph/` — graph operations, token overlap, community algorithms

**Tier 2: Orchestrators (integration-tested via deps.js boundary)**
Modules that coordinate I/O through `getDeps()`. Tests provide mock boundaries and assert on final data state.
- `src/extraction/extract.js` (`extractMemories`) — tested with mock `connectionManager` + `fetch`
- `src/retrieval/retrieve.js` — tested with mock `connectionManager` + `fetch` + `setExtensionPrompt`
- `src/reflection/reflect.js` — runs real code in extract tests, hits mock LLM boundary

**Intentionally Untested:**
- `src/extraction/worker.js` — infinite async loop with interruptible sleep; mock complexity exceeds value
- `src/main.js` (event wiring) — wiring ST events to handlers; testing implementation details

---

## 4. Retrieval & Scoring Mathematics (`src/retrieval/math.js`)

Memory retrieval ranks candidate memories using a hybrid **Alpha-Blend** formula.

**Formula:**
`Total Score = Base + (Alpha * VectorBonus) + ((1 - Alpha) * BM25Bonus)`

#### Component 1: The Forgetfulness Curve (`Base`)
Memories decay based on narrative distance (current chat length minus memory message ID).
* `Base = Importance * e^(-Lambda * Distance)`
* `Lambda = BASE_LAMBDA / (Importance ^ 2)` *(Higher importance decays exponentially slower).*
* **Importance 5 Soft Floor:** Critical events (level 5) have a soft floor of 1.0, allowing natural decay while maintaining baseline relevance.
* **Reflection Decay:** Reflections older than 750 messages suffer an additional linear penalty (down to 0.25x) to ensure character insights evolve over time rather than remaining frozen.

#### Component 2: Vector Similarity (`VectorBonus`)
Cosine similarity between the Memory Embedding and the Query Embedding (last 3 user messages + extracted entities).
* Filtered by `vectorSimilarityThreshold` (default `0.5`). 
* Scales the similarity strictly above the threshold into points multiplied by `combinedBoostWeight` (default `15`).

#### Component 3: BM25 Keyword Search (`BM25Bonus`)
TF-IDF based keyword matching.
* Includes **IDF-Aware Query Token Adjustment**: Before scoring, the query tokens are weighted by their inverse document frequency.
* **Dynamic Character Stopwords**: Main character names are filtered from BM25 query tokens since they appear in nearly every memory and have near-zero IDF, allowing BM25 weight to focus on discriminative action verbs and objects.

---

## 5. Prompt Injection Layout

OpenVault injects context into SillyTavern using named prompt slots. This ensures strict placement within the LLM context window.

### Slot 1: `openvault_world` (Positioned High)
Contains GraphRAG community summaries. Gives the LLM global context before specific events.
```xml
<world_context>
## Northern Kingdom Royal Court
The Northern Kingdom's power is centered on King Aldric who rules from Castle Northhold...
Key findings:
  - King Aldric's authority is publicly legitimate but privately undermined...
</world_context>
```

### Slot 2: `openvault_memory` (Positioned Low, near current chat)
Contains the timeline of retrieved events and reflections. Grouped into temporal buckets to give the LLM narrative momentum.
```xml
<scene_memory>
(#450 messages | ★=minor ★★★=notable ★★★★★=critical)

## The Story So Far
[★★★★★] [Known] King Aldric discovered the rebellion...
...Much later...
[★★★★] Sera secretly met with Ashborne rebels... 

## Leading Up To This Moment
[★★★] Aldric confronted Sera about her secret meeting...

## Current Scene
Present: King Aldric, Sera
Emotions: Aldric anger, Sera defiance

[★★★★] Sera's willingness to challenge Aldric directly indicates a permanent shift in power dynamics ❘insight❙
[★★★] Sera drew her dagger and placed it on the table...
</scene_memory>
```