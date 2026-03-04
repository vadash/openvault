# Design: Prompts & Quality Improvements

## 1. Problem Statement

After a holistic audit of `src/prompts.js`, the extraction pipeline, retrieval scoring, and debug export capabilities, six categories of issues were identified:

1. **Character state corruption** — LLM generates malformed `emotional_impact` keys (e.g., `"don"` from `"don't"`), creating phantom character entries
2. **Extraction prompt inefficiency** — Redundant sections, reasoning field wasted on non-reasoning models, NSFW-biased dedup rules and examples
3. **Reflection over-proliferation** — 204 reflections vs 91 events (2.2:1 ratio) with no mechanism to measure whether reflections contribute to retrieval quality
4. **Missing retrieval context for injected memories** — No star legend, no guidance for the consuming LLM
5. **Entity graph pollution** — Duplicate entities (`Vova's Apartment` × 4), unbounded description growth, no merging
6. **Community summary staleness** — Single community with all 60 nodes, summary frozen at generation time

Additionally, the debug export lacks per-memory scoring breakdowns, making it impossible to diagnose retrieval quality issues.

## 2. Goals & Non-Goals

### Must Do
- Fix character state corruption by validating character names against known characters
- Add per-memory scoring breakdown to debug export
- Add reflection retrieval stats to debug export (are reflections actually selected?)
- Generalize extraction dedup rules beyond NSFW content
- Add non-NSFW examples to extraction prompt (adventure, politics, slice-of-life)
- Remove `reasoning` field from extraction output for non-reasoning models (configurable)
- Add star legend to `scene_memory` injection format
- Implement entity description capping/compaction
- Implement basic entity key normalization improvements
- Add reflection decay/pruning mechanism
- Track reflection selection rate to inform future tuning

### Won't Do
- LLM-based entity resolution (fuzzy name merging) — too expensive for inline processing
- Multi-level community detection — Louvain limitation accepted
- Prompt A/B testing framework — manual tuning is sufficient
- Change the retrieval algorithm itself — only add observability

## 3. Proposed Architecture

Seven independent workstreams, each independently testable and committable.

### Workstream A: Character State Validation

**Problem:** `extract.js:75` blindly accepts any key from `emotional_impact` as a character name.

**Fix:** Before creating a character state entry, validate that `charName` matches either:
1. An existing character in `data[CHARACTERS_KEY]`, OR
2. A character listed in `characters_involved` for any event in the current batch, OR
3. The known `char` or `user` name from the chat context

```javascript
// extract.js — updateCharacterStatesFromEvents
function updateCharacterStatesFromEvents(events, data, validCharNames) {
    const validSet = new Set(validCharNames.map(n => n.toLowerCase()));
    // Also collect all characters_involved from the current batch
    for (const event of events) {
        for (const c of event.characters_involved || []) {
            validSet.add(c.toLowerCase());
        }
    }

    for (const event of events) {
        if (event.emotional_impact) {
            for (const [charName, emotion] of Object.entries(event.emotional_impact)) {
                if (!validSet.has(charName.toLowerCase())) {
                    log(`[extract] Skipping invalid character name in emotional_impact: "${charName}"`);
                    continue;
                }
                // ... existing logic
            }
        }
    }
}
```

**Also add cleanup for existing corrupted states:** On chat load, scan `character_states` and remove entries where the name doesn't match any character in memories or the active chat.

### Workstream B: Extraction Prompt Tuning

#### B.1: Remove `reasoning` Field (Configurable)

Add a setting `extractionReasoning` (default: `false`). When disabled:
- Remove `"reasoning"` from the output schema description
- Remove `<thinking_process>` section
- Change schema to not include `reasoning` key
- Saves ~200 output tokens per extraction + ~150 prompt tokens

When enabled (for reasoning models): keep current behavior.

Implementation: `buildExtractionPrompt` accepts a `reasoning` flag in its options and conditionally includes/excludes the sections.

#### B.2: Generalize Dedup Rules

Current dedup rules (4 conditions) are NSFW-specific. Replace with genre-neutral rules:

```
<dedup_rules>
BEFORE creating ANY event, check <established_memories>.

If a scene is ALREADY recorded there, ONLY create a new event if ONE of these conditions is true:
1. A fundamentally NEW type of action begins (e.g., conversation → combat, foreplay → penetration)
2. A major outcome occurs (climax, death, unconsciousness, escape, capture)
3. A new element is introduced that changes the scene's nature (new character arrives, weapon drawn, secret revealed, new kink/toy introduced)
4. An explicit boundary is set or broken (safeword, surrender, betrayal, promise)

If NONE of those conditions apply, the current messages are continuing an existing scene.
In that case, set "events" to an empty array [].
</dedup_rules>
```

#### B.3: Diversify Examples

Add 2-3 non-NSFW examples and remove 1-2 redundant NSFW dedup examples (keep one NSFW dedup, one NSFW first-contact). Target mix: 3 NSFW, 3 adventure/combat/political, 2 emotional/social.

New examples to add:

```
<example name="political_betrayal">
Input messages: "[Aldric]: *slams the treaty onto the table* Your envoy was seen meeting with the Ashborne rebels. Explain. [Sera]: *doesn't flinch* I did what needed to be done to protect this kingdom. Something you've been too afraid to do."
Established memories: "Sera secretly met with Ashborne rebels to negotiate a ceasefire"

Correct output:
{"events": [{"summary": "Sera openly admitted to King Aldric that she met with Ashborne rebels, defending it as necessary for the kingdom", "importance": 4, "characters_involved": ["Sera", "Aldric"], ...}], "entities": [...], "relationships": [...]}
</example>

<example name="adventure_dedup">
Input messages: "[Kira]: *rolls behind the pillar as another arrow whistles past* *returns fire with her crossbow, bolt embedding in the archer's shoulder*"
Established memories: "Kira engaged in a ranged firefight with enemy archers in the temple ruins"

Correct output:
{"reasoning": "...", "events": [], "entities": [], "relationships": []}
</example>
```

### Workstream C: Reflection Quality & Decay

#### C.1: Reflection Selection Tracking

Add a counter to each memory: `retrieval_hits` (number of times this memory was selected during retrieval). Increment in `selectRelevantMemories` when a memory makes the final cut.

This enables:
- Measuring reflection vs event selection rates
- Identifying "dead" memories that never get retrieved
- Future pruning decisions

#### C.2: Reflection Decay

The current system has no mechanism to prevent reflection proliferation. With 204 reflections, many are stale or superseded by newer reflections.

**Approach: Importance decay for old reflections.**

During scoring, reflections older than N messages (configurable, default: 500) get an additional decay multiplier:

```javascript
// In calculateScore or a wrapper
if (memory.type === 'reflection') {
    const reflectionAge = chatLength - getMemoryPosition(memory);
    if (reflectionAge > REFLECTION_DECAY_THRESHOLD) {
        // Gentle linear decay: at 2x threshold, reflections score at 50% of normal
        const decayFactor = Math.max(0.25, 1 - (reflectionAge - REFLECTION_DECAY_THRESHOLD) / (2 * REFLECTION_DECAY_THRESHOLD));
        total *= decayFactor;
    }
}
```

This doesn't delete old reflections — it just makes them compete less with fresh events/reflections in retrieval.

#### C.3: Reflection Cap

Add a setting `maxReflectionsPerCharacter` (default: 50). When a character's reflection count exceeds this, the oldest reflections (by sequence) are marked as `archived: true` and excluded from retrieval scoring. They remain in storage for debug/export purposes.

### Workstream D: Retrieval Formatting Improvements

#### D.1: Star Legend

Add a one-line legend at the top of `<scene_memory>`:

```
<scene_memory>
(#693 messages | ★=minor ★★★=notable ★★★★★=critical)
```

This costs ~10 tokens and gives the consuming LLM context for interpreting importance.

#### D.2: Reflection Type Indicator

When a reflection memory is injected, prefix it differently from events to help the LLM distinguish observed facts from synthesized insights:

```
[★★★★] Suzy's fear of abandonment is driving her attachment to Vova ⟨insight⟩
```

vs current:
```
[★★★★] Suzy's fear of abandonment is driving her attachment to Vova
```

### Workstream E: Entity Graph Cleanup

#### E.1: Description Capping

Current behavior: descriptions are append-only with `" | "` separator, growing unbounded.

**Fix:** Cap entity descriptions at 3 entries (most recent wins). In `upsertEntity`:

```javascript
export function upsertEntity(graphData, name, type, description) {
    const key = name.toLowerCase().trim();
    const existing = graphData.nodes[key];

    if (existing) {
        existing.mentions++;
        // Cap descriptions at 3, keeping most recent
        const descriptions = existing.description.split(' | ');
        if (!descriptions.includes(description)) {
            descriptions.push(description);
            if (descriptions.length > 3) {
                descriptions.shift(); // Remove oldest
            }
            existing.description = descriptions.join(' | ');
        }
        // Update type if more specific
        if (type !== existing.type && type !== 'CONCEPT') {
            existing.type = type;
        }
    } else {
        graphData.nodes[key] = { name, type, description, mentions: 1 };
    }
}
```

#### E.2: Key Normalization Improvements

Add basic normalization to reduce duplicates:
- Strip possessive suffixes: `"Vova's Apartment"` → key `"vova apartment"` (strip `'s`)
- Collapse whitespace
- This won't merge `"Vova's house/room"` with `"Vova's Apartment"` (that requires fuzzy matching), but it prevents the most obvious duplicates

```javascript
function normalizeEntityKey(name) {
    return name
        .toLowerCase()
        .replace(/['']s\b/g, '') // Strip possessives
        .replace(/\s+/g, ' ')    // Collapse whitespace
        .trim();
}
```

#### E.3: Entity Pruning (Low-mention cleanup)

Add a slash command `/openvault-prune-entities` that removes entities with `mentions === 1` and no edges, since these are one-off mentions that add noise. This is manual, not automatic.

### Workstream F: Community Summary Refresh

#### F.1: Staleness Detection

Track `lastUpdated` timestamp on each community. During retrieval, if the community was last updated more than N messages ago (configurable, default: 100), flag it for re-summarization on next extraction cycle.

#### F.2: Force Single-Community Refresh

When there's only 1 community containing all nodes (as in the debug export), Louvain can't help — the graph is too interconnected. In this case:
- Re-summarize the single community every 100 messages instead of only when membership changes
- Consider splitting by entity type (PERSON community, PLACE community) as a fallback when Louvain produces a single partition

### Workstream G: Debug Export Scoring Breakdown

#### G.1: Per-Memory Scoring Details

In `debug-cache.js`, cache the full scoring breakdown from the last retrieval. Structure:

```json
{
  "lastRetrieval": {
    "scoringDetails": [
      {
        "memoryId": "ev_042",
        "type": "event",
        "summary": "Suzy and Vova had vaginal sex...",
        "scores": {
          "base": 3.2,
          "baseAfterFloor": 3.2,
          "recencyPenalty": 0,
          "vectorSimilarity": 0.78,
          "vectorBonus": 5.88,
          "bm25Score": 0.34,
          "bm25Bonus": 1.53,
          "total": 10.61
        },
        "selected": true,
        "bucket": "recent",
        "distance": 15
      }
    ],
    "stats": {
      "totalScored": 295,
      "selected": 35,
      "reflectionsScored": 204,
      "reflectionsSelected": 8,
      "eventsScored": 91,
      "eventsSelected": 27,
      "avgReflectionScore": 0.41,
      "avgEventScore": 0.55,
      "topScore": 10.61,
      "cutoffScore": 2.3
    }
  }
}
```

**Implementation:** `scoreMemories` in `math.js` already returns full breakdowns. The integration point is `selectRelevantMemories` in `scoring.js` — cache the scored array before truncation.

#### G.2: Rejected Memories Sample

Include the top 10 rejected memories (scored but not selected) to show what was close to making the cut. Useful for tuning thresholds.

## 4. Data Models / Schema

### New Settings

```javascript
// constants.js — additions to defaultSettings
{
    extractionReasoning: false,         // Include reasoning field in extraction
    reflectionDecayThreshold: 500,      // Messages before reflections start decaying
    maxReflectionsPerCharacter: 50,     // Cap per character
    communityStalenessThreshold: 100,   // Messages before forced re-summarization
    entityDescriptionCap: 3,            // Max description segments per entity
}
```

### New Memory Fields

```javascript
// Added to memory objects
{
    retrieval_hits: 0,  // Incremented each time memory is selected in retrieval
}
```

### New Debug Cache Fields

```javascript
// Added to debug export via debug-cache.js
{
    scoringDetails: [...],  // Per-memory scoring breakdown
    stats: { ... },         // Aggregate statistics
}
```

## 5. Interface / API Design

### Modified Functions

| Function | File | Change |
|---|---|---|
| `buildExtractionPrompt` | `prompts.js` | Accept `reasoning` flag; conditionally include reasoning sections |
| `updateCharacterStatesFromEvents` | `extract.js` | Accept `validCharNames` param; skip unknown names |
| `upsertEntity` | `graph/graph.js` | Cap descriptions at 3; improve key normalization |
| `formatContextForInjection` | `retrieval/formatting.js` | Add star legend; tag reflections with `⟨insight⟩` |
| `scoreMemories` | `retrieval/math.js` | Apply reflection decay multiplier |
| `selectRelevantMemories` | `retrieval/scoring.js` | Increment `retrieval_hits`; cache scoring details |

### New Functions

| Function | File | Purpose |
|---|---|---|
| `cleanupCharacterStates` | `extract.js` | Remove corrupted entries on chat load |
| `normalizeEntityKey` | `graph/graph.js` | Better key normalization |
| `getCachedScoringDetails` | `retrieval/debug-cache.js` | Return scoring breakdown for debug export |

## 6. Risks & Edge Cases

### Reflection Decay May Hide Important Insights
**Risk:** Decaying old reflections could suppress genuinely important character arcs that were synthesized early.
**Mitigation:** The decay floor is 0.25× (never zero). Importance-5 reflections retain their floor protection. The `retrieval_hits` counter provides data to tune the threshold.

### Entity Description Capping Loses History
**Risk:** Capping at 3 descriptions loses early character context.
**Mitigation:** The 3 most recent descriptions are the most accurate (they reflect the latest narrative state). Early descriptions are often vague/generic. Community summaries preserve the holistic view.

### Removing Reasoning Field Affects Debug Visibility
**Risk:** Without the reasoning field, it's harder to understand why the LLM made extraction decisions.
**Mitigation:** The setting defaults to `false` but is easily toggled. When `requestLogging` is enabled, full LLM payloads are logged regardless.

### Single-Community Re-summarization Cost
**Risk:** Re-summarizing every 100 messages for a single large community adds 1 LLM call per cycle.
**Mitigation:** Community summarization uses the `community` LLM config (2000 tokens, 90s timeout). One extra call per 100 messages is negligible.

## 7. Implementation Phases

### Phase 1: Bug Fixes (A + D.1)
- Fix character state validation (Workstream A)
- Add star legend to scene_memory (Workstream D.1)
- Quick wins, no settings changes needed

### Phase 2: Debug Observability (G)
- Add scoring breakdown to debug export (G.1 + G.2)
- Add reflection selection tracking (C.1)
- This phase provides data to inform all subsequent tuning decisions

### Phase 3: Prompt Tuning (B)
- Configurable reasoning field (B.1)
- Generalized dedup rules (B.2)
- Diversified examples (B.3)

### Phase 4: Entity Quality (E)
- Description capping (E.1)
- Key normalization (E.2)
- Optional prune command (E.3)

### Phase 5: Reflection Quality (C.2 + C.3)
- Reflection decay in scoring (C.2)
- Reflection cap per character (C.3)
- Use Phase 2 data to validate settings

### Phase 6: Community Freshness (F)
- Staleness detection (F.1)
- Single-community refresh (F.2)
