# Design: Reflections & GraphRAG Integration

## 1. Problem Statement

OpenVault currently extracts raw event memories and retrieves them via hybrid vector/BM25 scoring. This provides good short-to-medium term recall but lacks two capabilities:

1. **Long-term character arcs:** Characters cannot synthesize patterns across hundreds of events into higher-level beliefs, personality shifts, or relationship trajectories. They forget emotional arcs once raw events scroll out of the retrieval window.

2. **Global world context:** The retrieval system only finds memories relevant to the immediate query. It cannot answer "what is the state of the world" — there is no dynamic lorebook that summarizes factions, locations, ongoing plotlines, or thematic arcs.

## 2. Goals & Non-Goals

### Must Do
- Implement per-character **Reflections** (Smallville paper): synthesize raw events into high-level insights, stored and retrieved like memories
- Implement **GraphRAG knowledge graph**: extract entities/relationships, detect communities, generate community summaries as dynamic lorebook entries
- Extend the existing extraction schema to extract entities and relationships alongside events (single LLM call)
- Inject community summaries via a separate `<world_context>` prompt slot (2K token budget)
- Store all new data in `chatMetadata.openvault` (no external databases)
- All graph computation uses `graphology` imported via `esm.sh` (pure JS, no WASM, no build step)
- All new LLM calls route through existing `callLLM()` with new `LLM_CONFIGS` entries
- All structured outputs use Zod schemas

### Won't Do
- Visual graph rendering (no D3/Cytoscape/sigma.js)
- Hierarchical/multi-level community detection (single-level Louvain is sufficient)
- Planning system from Smallville paper (character intent/scheduling — out of scope)
- Separate deferred task queue (background work runs inline with extraction)
- Global narrator-level reflections (per-character only)

## 3. Proposed Architecture

### High-Level Flow

```
[Message Batch Ready]
        │
        ▼
┌─────────────────────────────┐
│  EXTRACTION (modified)      │
│  Single LLM call outputs:   │
│  • events[]                 │
│  • entities[]               │
│  • relationships[]          │
│  (existing lock system)     │
└─────────┬───────────────────┘
          │
    ┌─────┴──────┐
    ▼            ▼
┌────────┐  ┌──────────────┐
│ Events │  │ Graph Update  │
│ (exist │  │ upsert nodes │
│  flow) │  │ upsert edges │
└───┬────┘  └──────┬───────┘
    │              │
    ▼              ▼
┌────────────────────────────┐
│  POST-EXTRACTION (inline)  │
│                            │
│  1. Check reflection       │
│     trigger (importance    │
│     sum >= 30 per char)    │
│     → Run reflection       │
│       pipeline per char    │
│                            │
│  2. Check community        │
│     trigger (every 50      │
│     new messages)          │
│     → Run Louvain          │
│     → Summarize changed    │
│       communities          │
│     → Embed summaries      │
└────────────────────────────┘
          │
          ▼
┌────────────────────────────┐
│  RETRIEVAL (modified)      │
│                            │
│  Existing memory retrieval │
│  + NEW: community summary  │
│  retrieval → inject into   │
│  separate <world_context>  │
│  slot (2K budget)          │
└────────────────────────────┘
```

### Key Components

| Component | File | Responsibility |
|---|---|---|
| Extended extraction schema | `src/extraction/structured.js` | Add `entities[]` and `relationships[]` to Zod schema |
| Modified extraction pipeline | `src/extraction/extract.js` | Process entities/relationships after LLM call |
| Graph module | `src/graph/graph.js` | Node/edge CRUD, serialization, Louvain wrapper |
| Reflection module | `src/reflection/reflect.js` | Trigger check, 3-step reflection pipeline |
| Community summarization | `src/graph/communities.js` | Community grouping, LLM summarization, embedding |
| World context retrieval | `src/retrieval/world-context.js` | Cosine similarity on community embeddings, format injection |
| New LLM configs | `src/llm.js` | `LLM_CONFIGS.reflection`, `LLM_CONFIGS.community` |
| New prompts | `src/prompts.js` | Reflection and community summarization prompts |

## 4. Data Models / Schema

### 4.1 Extended Extraction Schema

```javascript
// src/extraction/structured.js — additions

const EntitySchema = z.object({
  name: z.string().describe('Entity name, capitalized'),
  type: z.enum(['PERSON', 'PLACE', 'ORGANIZATION', 'OBJECT', 'CONCEPT']),
  description: z.string().describe('Comprehensive description of the entity'),
});

const RelationshipSchema = z.object({
  source: z.string().describe('Source entity name'),
  target: z.string().describe('Target entity name'),
  description: z.string().describe('Description of the relationship'),
});

// Modify ExtractionResponseSchema:
const ExtractionResponseSchema = z.object({
  reasoning: z.string().nullable(),
  events: z.array(EventSchema),
  entities: z.array(EntitySchema),        // NEW
  relationships: z.array(RelationshipSchema), // NEW
});
```

### 4.2 Graph Storage (Flat JSON in chatMetadata)

```javascript
// chatMetadata.openvault.graph
{
  "nodes": {
    "castle": {
      "name": "Castle",
      "type": "PLACE",
      "description": "The ancient fortress overlooking the valley | The seat of King Aldric's power",
      "mentions": 3
    },
    "king aldric": {
      "name": "King Aldric",
      "type": "PERSON",
      "description": "The aging ruler of the northern realm",
      "mentions": 7
    }
  },
  "edges": {
    "king aldric__castle": {
      "source": "king aldric",
      "target": "castle",
      "description": "Rules from the castle",
      "weight": 4
    }
  }
}
```

**Key:** Nodes keyed by `name.toLowerCase().trim()`. Edges keyed by `${source}__${target}`.

**CRITICAL — Key Normalization Rule:** The LLM outputs entity names in original casing (e.g., `"King Aldric"`), but relationship `source`/`target` fields also use original casing. When processing LLM output in `extract.js`, **always** normalize `source` and `target` to `toLowerCase().trim()` before creating or looking up edges. Failure to do this creates orphaned edges disconnected from their nodes.

### 4.3 Community Storage

```javascript
// chatMetadata.openvault.communities
{
  "C0": {
    "nodeKeys": ["castle", "king aldric", "royal guard"],
    "title": "The Royal Court",
    "summary": "King Aldric rules from the ancient Castle with his loyal Royal Guard...",
    "findings": [
      "King Aldric's authority is reinforced by the Guard's loyalty",
      "The Castle serves as both political center and defensive stronghold"
    ],
    "embedding": [0.12, 0.45, ...],  // Vector of summary text
    "lastUpdated": 1709500000000
  }
}
```

### 4.4 Reflection Storage

Reflections are stored as regular memory objects with additional fields:

```javascript
// Added to chatMetadata.openvault.memories[]
{
  "id": "ref_aldric_001",
  "type": "reflection",                    // NEW — distinguishes from "event" (default)
  "summary": "King Aldric has grown increasingly paranoid about betrayal since the poisoning incident",
  "importance": 4,
  "sequence": 450,                         // Chat position when reflection was generated
  "characters_involved": ["King Aldric"],
  "character": "King Aldric",              // NEW — which character generated this reflection
  "source_ids": ["ev_012", "ev_045", "ev_078"], // NEW — evidence memory IDs
  "witnesses": ["King Aldric"],            // Only the reflecting character
  "location": null,
  "is_secret": false,
  "emotional_impact": {},
  "relationship_impact": {},
  "embedding": [0.23, 0.67, ...],
  "created_at": 1709500000000
}
```

### 4.5 New State Fields

```javascript
// chatMetadata.openvault — new top-level fields
{
  // Existing:
  memories: [...],
  character_states: {...},
  processed_message_ids: [...],

  // NEW:
  graph: { nodes: {}, edges: {} },
  communities: {},
  reflection_state: {
    // Per-character importance accumulators
    "King Aldric": { importance_sum: 0 },
    "Royal Guard": { importance_sum: 0 }
  },
  graph_message_count: 0  // Counter for community detection trigger
}
```

## 5. Interface / API Design

### 5.1 Graph Module (`src/graph/graph.js`)

```javascript
/**
 * Upsert an entity node into the flat graph structure.
 * Merges descriptions and increments mentions on duplicates.
 * @param {Object} graphData - The graph object from chatMetadata (mutated in place)
 * @param {string} name - Entity name
 * @param {string} type - PERSON | PLACE | ORGANIZATION | OBJECT | CONCEPT
 * @param {string} description - Entity description
 */
export function upsertEntity(graphData, name, type, description)

/**
 * Upsert a relationship edge. Increments weight on duplicates.
 * On duplicate edges: increments weight AND appends description if substantially
 * different from existing (prevents narrative shifts from being hidden by weight-only updates).
 * Silently skips if source or target node doesn't exist.
 * All name parameters are normalized to lowercase/trimmed internally.
 * @param {Object} graphData - The graph object from chatMetadata (mutated in place)
 * @param {string} source - Source entity name (will be normalized)
 * @param {string} target - Target entity name (will be normalized)
 * @param {string} description - Relationship description
 */
export function upsertRelationship(graphData, source, target, description)

/**
 * Convert flat graph data to a graphology instance for computation.
 * @param {Object} graphData - { nodes, edges } from chatMetadata
 * @returns {MultiDirectedGraph}
 */
export function toGraphology(graphData)

/**
 * Run Louvain community detection on the graph.
 * Converts to undirected internally.
 * @param {Object} graphData - Flat graph data
 * @returns {{ communities: Object<string, number>, count: number }}
 *   communities maps nodeKey → communityId
 */
export function detectCommunities(graphData)

/**
 * Group nodes by community ID and extract subgraph data for LLM prompts.
 * @param {Object} graphData - Flat graph data
 * @param {Object} communityPartition - nodeKey → communityId mapping
 * @returns {Object<string, { nodes: string[], edges: string[] }>}
 *   Each community has formatted node/edge lines for the prompt
 */
export function buildCommunityGroups(graphData, communityPartition)
```

### 5.2 Reflection Module (`src/reflection/reflect.js`)

```javascript
/**
 * Check if a character has accumulated enough importance to trigger reflection.
 * Threshold: importance sum >= 30.
 * @param {Object} reflectionState - Per-character accumulators
 * @param {string} characterName
 * @returns {boolean}
 */
export function shouldReflect(reflectionState, characterName)

/**
 * Accumulate importance scores from newly extracted events for each involved character.
 * @param {Object} reflectionState - Mutated in place
 * @param {Array} newEvents - Newly extracted event memories
 */
export function accumulateImportance(reflectionState, newEvents)

/**
 * Run the 3-step reflection pipeline for a single character.
 * Step 1: Generate 3 salient questions from recent memories
 * Step 2: For each question, retrieve relevant memories and extract insights (3 calls in parallel via Promise.all)
 * Step 3: Store reflections as memory objects with embeddings
 *
 * @param {string} characterName
 * @param {Array} allMemories - Full memory stream
 * @param {Object} characterStates - For POV filtering
 * @param {Function} callLLM - LLM call wrapper
 * @param {Function} embedText - Embedding function
 * @returns {Array} New reflection memory objects
 */
export async function generateReflections(characterName, allMemories, characterStates, callLLM, embedText)
```

### 5.3 Community Summarization (`src/graph/communities.js`)

```javascript
/**
 * Generate or update community summaries.
 * Only regenerates communities whose node membership changed.
 *
 * @param {Object} graphData - Flat graph data
 * @param {Object} existingCommunities - Current community summaries from state
 * @param {Function} callLLM - LLM wrapper
 * @param {Function} embedText - Embedding function
 * @returns {Object} Updated communities object
 */
export async function updateCommunitySummaries(graphData, existingCommunities, callLLM, embedText)
```

### 5.4 World Context Retrieval (`src/retrieval/world-context.js`)

```javascript
/**
 * Retrieve the most relevant community summaries for the current context.
 * Uses cosine similarity between query embedding and community summary embeddings.
 *
 * @param {Object} communities - Community data from state
 * @param {number[]} queryEmbedding - Embedding of current context
 * @param {number} tokenBudget - Max tokens for world context (default: 2000)
 * @returns {{ text: string, communityIds: string[] }}
 */
export function retrieveWorldContext(communities, queryEmbedding, tokenBudget)
```

### 5.5 New LLM Configs

```javascript
// src/llm.js — additions to LLM_CONFIGS
LLM_CONFIGS.reflection = {
  profileSettingKey: 'extractionProfile',  // Reuse extraction profile
  maxTokens: 2000,
  errorContext: 'Reflection',
  timeoutMs: 90000,
  getJsonSchema: getReflectionJsonSchema
};

LLM_CONFIGS.community = {
  profileSettingKey: 'extractionProfile',  // Reuse extraction profile
  maxTokens: 2000,
  errorContext: 'Community summarization',
  timeoutMs: 90000,
  getJsonSchema: getCommunityJsonSchema
};
```

### 5.6 New Zod Schemas

```javascript
// Reflection Step 1: Salient Questions
const SalientQuestionsSchema = z.object({
  questions: z.array(z.string()).length(3)
});

// Reflection Step 2: Insight Extraction
const InsightExtractionSchema = z.object({
  insights: z.array(z.object({
    insight: z.string(),
    evidence_ids: z.array(z.string())
  })).min(1).max(5)
});

// Community Summary
const CommunitySummarySchema = z.object({
  title: z.string(),
  summary: z.string(),
  findings: z.array(z.string()).min(1).max(5)
});
```

### 5.7 Modified Extraction Flow (extract.js)

```
existing extractBatch():
  ...
  Step 3: LLM call → now returns { events, entities, relationships }
  Step 4: Dedup events (existing)
  Step 5: Embed events (existing)

  NEW Step 6: Graph update
    → upsertEntity() for each entity
    → upsertRelationship() for each relationship
    → increment graph_message_count

  NEW Step 7: Reflection check (per character in new events)
    → accumulateImportance()
    → for each character where shouldReflect():
        → generateReflections()
        → reset importance accumulator
        → append reflections to memories[]

  NEW Step 8: Community check (if graph_message_count % 50 === 0)
    → detectCommunities()
    → updateCommunitySummaries()
    → save to state.communities

  Step 9: Save state (existing saveChatConditional)
```

### 5.8 Modified Retrieval Flow (retrieve.js)

```
existing updateInjection():
  ...
  After memory retrieval & formatting:

  NEW: World context retrieval
    → retrieveWorldContext(communities, queryEmbedding, 2000)
    → if result.text is non-empty:
        → safeSetExtensionPrompt('openvault_world', result.text, position)
    → else:
        → safeSetExtensionPrompt('openvault_world', '', position)
```

**Named Prompt Slots:** `safeSetExtensionPrompt` in `utils.js` must be updated to accept a `name` parameter. SillyTavern's `setExtensionPrompt(name, content, position)` supports named slots. Use:
- `'openvault_memory'` — existing memory injection (closer to bottom of prompt)
- `'openvault_world'` — community summaries (higher in prompt, providing global context before specific memories)

### 5.9 ESM.sh Import Strategy

```javascript
// src/graph/graph.js — pin versions to avoid breaking changes
import { MultiDirectedGraph } from 'https://esm.sh/graphology@0.25.4';
import louvain from 'https://esm.sh/graphology-communities-louvain@0.12.0';
import { toUndirected } from 'https://esm.sh/graphology-operators@1.6.0';
```

No fallback strategy. Assume `esm.sh` resolves correctly in the browser.

## 6. Risks & Edge Cases

### 6.1 Extraction Schema Expansion
**Risk:** Mid-tier LLMs may produce unreliable output when the schema is too large (events + entities + relationships in one call).
**Mitigation:** The entities/relationships schemas are simpler than events (fewer fields). If models struggle, the fallback is to make entities/relationships optional in the Zod schema (`z.array(...).default([])`) so extraction never fails — it just produces fewer graph updates.

### 6.2 Entity Deduplication
**Risk:** LLMs may refer to the same entity with different names ("King Aldric", "Aldric", "the King").
**Mitigation (Phase 1):** Case-insensitive exact match only. Accept some duplication — it's functional.
**Mitigation (Phase 2, future):** Add an LLM-based entity resolution pass that merges similar nodes. Out of scope for this design.

### 6.3 Reflection POV Filtering
**Risk:** Per-character reflections require filtering the memory stream to what the character knows. The existing POV system (`pov.js`) handles this for retrieval, but reflections need the same filter at generation time.
**Mitigation:** Reuse `filterMemoriesByPOV()` from `pov.js` when building the memory context for reflection. The character only reflects on memories they witnessed or know about.

### 6.4 Extraction Duration
**Risk:** Inline reflection + community summarization extends extraction time. A single extraction could involve: 1 extraction call + (N characters × 4 reflection calls) + (M communities × 1 summary call).
**Mitigation:**
- Reflections trigger infrequently (importance sum must reach 30, which takes ~10-20 messages per character).
- Community detection triggers every 50 messages.
- **Parallelize Step 2 of Reflections:** The 3 insight-extraction calls (one per salient question) must use `Promise.all()` to run in parallel. This reduces per-character reflection time from ~15s to ~5s.
- In the worst case, both trigger simultaneously for 2 characters: 1 + 2×(1+1) + 3 = 8 LLM calls (with parallelized insight extraction). At ~5s per call with a mid-tier API, that's ~40s. The existing 120s timeout on the extraction lock accommodates this.
- The generation lock prevents the user from sending messages during extraction, so there's no race condition.

### 6.5 Graph Growth
**Risk:** Graph data growing unbounded in chatMetadata for very long RPs (1000+ messages).
**Mitigation:** A graph with 500 nodes and 1000 edges serializes to ~100KB of JSON. Combined with community summaries (~50KB), this is well within SillyTavern's chat file tolerance. No pruning needed for the foreseeable future.

### 6.6 Chat Switching During Background Work
**Risk:** User switches chats while reflection/community tasks are running inline. The save would write to the wrong chat.
**Mitigation:** Existing pattern: check `getCurrentChatId()` before saving. The extraction lock already prevents concurrent operations. Add the same chat ID check before saving reflection/community results.

### 6.7 Empty Graph
**Risk:** Louvain fails or produces nonsensical results on a graph with < 3 nodes.
**Mitigation:** Guard: skip community detection if `Object.keys(graphData.nodes).length < 3`.

### 6.8 Community Stability
**Risk:** Louvain may produce different community assignments on each run, causing unnecessary LLM re-summarization.
**Mitigation:** Compare new community node sets with existing ones. Only regenerate summaries for communities whose membership actually changed (set comparison on `nodeKeys`).

### 6.9 Reflection Self-Referencing
**Risk:** Reflections are stored in the memory stream. Future reflections might retrieve past reflections as evidence, creating recursive abstraction layers.
**Mitigation:** This is actually **desirable** — it matches the Smallville paper's design where reflections can reference other reflections, creating hierarchical abstraction (observations → reflections → meta-reflections). No special handling needed.

### 6.10 Token Budget Pressure
**Risk:** The existing 10K memory budget + new 2K world context = 12K total injected tokens, which may crowd the LLM context window for users with small context models.
**Mitigation:** Both budgets are configurable via settings. Document the default and let users adjust. The 2K world context budget is conservative and optional (no injection if no communities exist).

## 7. Implementation Phases

Build in this order. Each phase is independently testable and committable.

### Phase 0: Prune Obsolete "Smart Retrieval"
- Remove `selectRelevantMemoriesSmart` and `RetrievalResponseSchema` from `src/retrieval/scoring.js` and `src/extraction/structured.js`
- Remove `LLM_CONFIGS.retrieval` from `src/llm.js`
- Simplify `selectRelevantMemories` in `src/retrieval/scoring.js` to only use the simple mathematical scoring (Vector + BM25)
- Remove all UI toggles and settings related to `smartRetrievalEnabled` and `retrievalProfile` from `src/ui/settings.js`, `src/constants.js`, and the HTML templates
- Reflections + GraphRAG make inline LLM memory selection obsolete

### Phase 1: Schema & Graph CRUD
- Update `src/extraction/structured.js` with `EntitySchema`, `RelationshipSchema`, and modified `ExtractionResponseSchema`
- Create `src/graph/graph.js` with flat storage CRUD: `upsertEntity`, `upsertRelationship`, key normalization
- Unit tests for CRUD operations and dedup/merge behavior
- **Does not** touch LLM calls or extraction flow yet

### Phase 2: Extraction Pipeline Integration
- Update `src/prompts.js` to instruct the LLM to output entities and relationships alongside events
- Update `src/extraction/extract.js` to process `entities[]` and `relationships[]` from LLM response into graph CRUD
- Ensure all names are normalized to lowercase/trimmed before graph operations
- Initialize `graph` and `graph_message_count` in state if missing
- Test: extraction still works end-to-end, graph populates in chatMetadata

### Phase 3: Reflection Engine
- Create `src/reflection/reflect.js` with importance accumulator, threshold check, and 3-step pipeline
- Step 2 (insight extraction) uses `Promise.all()` for the 3 parallel LLM calls
- Add `LLM_CONFIGS.reflection` and Zod schemas (`SalientQuestionsSchema`, `InsightExtractionSchema`)
- Add reflection prompts to `src/prompts.js`
- Hook trigger into `extract.js` after graph update (Step 7)
- Reuse `filterMemoriesByPOV()` for per-character memory filtering
- Test: reflections appear in memories with `type: "reflection"` and valid `source_ids`

### Phase 4: Community Detection & Summarization
- Create `src/graph/communities.js` with `toGraphology`, `detectCommunities`, `updateCommunitySummaries`
- Import graphology + louvain via `esm.sh` (pinned versions)
- Add `LLM_CONFIGS.community` and `CommunitySummarySchema`
- Add community summarization prompt to `src/prompts.js`
- Membership-change check: compare `nodeKeys` sets before re-summarizing
- Guard: skip if < 3 nodes
- Hook trigger into `extract.js` (Step 8, every 50 messages)
- Test: communities appear in state with summaries and embeddings

### Phase 5: Retrieval & World Context Injection
- Create `src/retrieval/world-context.js` with cosine similarity retrieval against community embeddings
- Update `safeSetExtensionPrompt` in `utils.js` to accept a `name` parameter
- Update `src/retrieval/retrieve.js` to call world context retrieval and inject via `'openvault_world'` slot
- Rename existing memory injection to `'openvault_memory'` slot
- World context positioned higher in prompt than memories
- Test: community summaries appear in `<world_context>` tags in the generated prompt
