# OpenVault Data Schema & Core Algorithms

Authoritative reference for data structures, retrieval formulas, and storage constants.
Implementation gotchas live in subdirectory CLAUDE.md files — see directory map in root `CLAUDE.md`.

## 1. DATA SCHEMA (`chatMetadata.openvault`)

All extension state lives within SillyTavern's `context.chatMetadata.openvault`. 
**Rule:** Never assume fields exist. Migrations must backfill all fields so domain code can read safely without defensive `if (!data.field)` checks.

```typescript
{
  schema_version: number,      // Tracks migration state (Current: 2)
  embedding_model_id: string,  // Tracks which model generated stored embeddings
  
  memories: [{                 // Both events and reflections
    id: string, 
    type: "event" | "reflection", 
    summary: string, 
    importance: 1 | 2 | 3 | 4 | 5,
    tokens: string[],          // Pre-computed stemmed BM25 tokens
    message_ids?: number[],    // For events: Source ST message indices
    source_ids?: string[],     // For reflections: Cited evidence memory IDs
    level?: number,            // Reflection hierarchy: 1 (from events), 2+ (from reflections)
    parent_ids?: string[],     // For level 2+: IDs of synthesized child reflections
    temporal_anchor: string | null, // Extracted timestamp (e.g., "Friday, 3:40 PM")
    is_transient: boolean,     // True for short-term intentions (decays ~5x faster)
    characters_involved: string[], 
    witnesses: string[],
    embedding_b64: string,     // Base64 Float32Array (Replaces legacy `embedding: number[]`)
    _st_synced?: boolean,      // True if pushed to ST Vector storage
    archived: boolean,         // True if replaced by newer reflection (ignored in retrieval)
    mentions?: number,         // Frequency boost multiplier (increments on dedup overlap)
    retrieval_hits?: number    // Dampens exponential decay (frequently recalled = slower fade)
  }],
  
  graph: {
    nodes: { 
      [normKey: string]: { 
        name: string, type: "PERSON"|"PLACE"|"ORGANIZATION"|"OBJECT"|"CONCEPT", 
        description: string, mentions: number, aliases?: string[], 
        embedding_b64: string
      } 
    },
    edges: { 
      "src__tgt": { 
        source: string, target: string, description: string, weight: number, 
        _descriptionTokens: number
      } 
    },
    _edgesNeedingConsolidation: string[] // Edge keys pending LLM summarization
  },
  
  communities: { 
    [communityId: string]: { 
      title: string, summary: string, findings: string[], nodeKeys: string[], 
      embedding_b64: string
    } 
  },
  
  global_world_state: { 
    summary: string, last_updated: number, community_count: number 
  },
  
  character_states: { 
    [charName: string]: { 
      current_emotion: string, emotion_from_messages?: {min: number, max: number},
      emotion_intensity: number, known_events: string[] // POV strictness boundary
    } 
  },
  
  reflection_state: { 
    [charName: string]: { importance_sum: number } // Triggers reflection at >= 40
  },
  
  processed_message_ids: string[], // Stores message fingerprints (send_date or cyrb53 hash)
  
  idf_cache: { 
    memoryCount: number, avgDL: number, idfMap: { [token: string]: number } 
  },
  
  perf: { 
    [metricId: string]: { ms: number, size: string | null, ts: number } 
  }
}
```

## 2. REPOSITORY MUTATIONS
**Rule:** Never `push()` to arrays or mutate schema roots directly from domain code. Use explicit repository methods from `src/store/chat-data.js`:
- `addMemories(newMemories)` - Appends to memories array.
- `markMessagesProcessed(fingerprints)` - Records processed message IDs.
- `incrementGraphMessageCount(count)` - Updates graph message counter.
- `updateMemory(id, updates)` - Updates memory fields (invalidates embedding if summary changes).
- `deleteMemory(id)` - Removes memory by ID.
- `deleteCurrentChatData()` - Purges all data for current chat and unhides all `is_system` messages.

## 3. RETRIEVAL MATH (Alpha-Blend)
**Formula:** `Score = (Base + (Alpha * VectorBonus) + ((1 - Alpha) * BM25Bonus)) × FrequencyFactor`

### Two-Pass Optimization
- **Fast Pass:** Score all memories with `Base + BM25` (O(N) cheap math).
- **Cutoff:** Take top `VECTOR_PASS_LIMIT` (200) candidates.
- **Slow Pass:** Execute `cosineSimilarity` (typed-array dot product) only on the top 200. Drops CPU load 10x on large histories.

### Base Score (Forgetfulness Curve)
- **Formula:** `Importance * e^(-Lambda * Distance)`.
- **Hit Damping:** `hitDamping = max(0.5, 1/(1 + retrieval_hits × 0.1))`. Frequently retrieved memories decay up to 50% slower.
- **Importance Floor:** Importance 5 has a soft floor of `1.0`. It never decays to zero.
- **Level-Aware Reflection Decay:** Higher-level reflections (Level 2+) decay 2x slower per level (`reflectionLevelMultiplier`). Applies linearly after 750 messages.
- **Transient Decay:** Short-term intentions (`is_transient: true`) multiply Lambda by 5.0. They fade ~5x faster than durable facts.

### 4-Tier BM25 Keyword Matching
IDF is cached in `chatMetadata.openvault.idf_cache` at extraction time. The corpus includes *both* candidates and hidden memories to prevent common terms from getting artificially high scores. POV names are dynamically stripped (stopwords) to prevent score inflation.
- **Layer 0 (Exact Phrases):** Multi-word entities (contain a space). Added once, boosted by `exactPhraseBoostWeight` (10x maxIDF).
- **Layer 1 (Entities):** Single-word graph entities. Stemmed, 5x boost.
- **Layer 2 (Corpus-Grounded):** User-message stems that exist in the established corpus vocabulary. 3x boost.
- **Layer 3 (Non-Grounded):** User-message stems NOT in corpus vocabulary. 2x boost (preserves scene context).

## 4. GRAPH MERGE, COMMUNITIES, DEDUP
See `src/graph/CLAUDE.md` for semantic merge 4-guard system, edge consolidation, Louvain communities, hairball prevention.
See `src/extraction/CLAUDE.md` for event dedup thresholds.
See `src/retrieval/CLAUDE.md` for score-first soft balancing (context budgeting).

## 5. EMBEDDING MISMATCH PROTECTION
- **Trigger:** On `CHAT_CHANGED` and Settings Dropdown change.
- **Logic:** Compares `embedding_model_id` (e.g., `multilingual-e5-small`) against current settings.
- **Action:** If a mismatch is detected, `invalidateStaleEmbeddings()` bulk-wipes all `embedding_b64` across memories, nodes, and communities. Background worker auto-triggers `backfillAllEmbeddings({ silent: true })` to regenerate them.
