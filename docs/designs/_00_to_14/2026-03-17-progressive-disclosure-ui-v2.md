# OpenVault UI Revamp: Progressive Disclosure Design (v2)

## Overview

Complete Information Architecture restructuring of the OpenVault settings panel. This revision prioritizes **user activity patterns** over technical categorization: users visit tabs to check status, browse memories, or view graph data - not to tweak sliders.

## Core UX Principles

1. **Dashboard = Status First** - Users want health checks, not configuration
2. **Browsers Above Settings** - Active use (searching) before set-and-forget (sliders)
3. **World = Pure Viewer** - No configuration, only exploration
4. **Progressive Disclosure** - Essentials visible, math hidden behind warnings
5. **Fail-Safe Defaults** - Hide constants users will break
6. **Preserve Investment** - Reset preserves connections, only resets fine-tunes

---

## Constants Migration (Hidden from UI)

The following 9 settings are internal implementation details and removed from user interface:

| Constant | Previous Location | Value | Rationale |
|----------|-------------------|-------|-----------|
| `REFLECTION_DEDUP_REJECT_THRESHOLD` | Memories (3-tier) | 0.90 | Reflection deduplication math |
| `REFLECTION_DEDUP_REPLACE_THRESHOLD` | Memories (3-tier) | 0.80 | auto: reject - 0.10 |
| `REFLECTION_DECAY_THRESHOLD` | Memories | 750 | Internal freshness tracking |
| `ENTITY_DESCRIPTION_CAP` | Memories | 3 | FIFO eviction detail |
| `EDGE_DESCRIPTION_CAP` | Memories | 5 | FIFO eviction detail |
| `COMMUNITY_STALENESS_THRESHOLD` | Memories | 100 | Community freshness tracking |
| `COMBINED_BOOST_WEIGHT` | Advanced | 15 | Alpha-blend scoring internal |
| `IMPORTANCE_5_FLOOR` | Advanced | 5 | Decay curve detail |
| `ENTITY_MERGE_THRESHOLD` | Advanced | 0.80 | Graph clustering detail |

---

## Revised Tab Structure

### Tab 1: Dashboard (Status & Health)

**Purpose:** Immediate system health visibility. Configuration collapsed by default.

| Section | Content | Default State |
|---------|---------|---------------|
| Quick Toggles | Enable OpenVault, Auto-hide Messages | Visible |
| Status Card | Status indicator, subtext, embedding status | Visible |
| Stats Grid | 6 metrics (Memories, Characters, Embeddings, Reflections, Entities, Communities) | Visible |
| Progress | Extraction progress bar, Backfill buttons | Visible |
| `[details]` Connection & Setup | Extraction Profile, Backup Profile, Preamble Language, Output Language, Assistant Prefill | **Collapsed** |
| `[details]` Embeddings | Model selector, prefixes, Ollama URL + Test | **Collapsed** |
| `[details]` API Limits | Cloud API Concurrency, Backfill RPM | **Collapsed** |

**UX Notes:**
- First-time users expand setup once, then it stays collapsed
- Status is immediately visible on every visit
- No scrolling to see if system is healthy

---

### Tab 2: Memories (Browse & Engine)

**Purpose:** Active memory browsing first, engine tuning accessible but secondary.

| Section | Content | Default State |
|---------|---------|---------------|
| **Memory Browser** | Search, Type filter, Character filter, Memory list, Pagination | Visible |
| `[details]` Character States | Per-character tracking | Collapsed |
| `[details]` Extraction & Context | Extraction Batch Size, Context Window, Context & Injection Budgets, Payload Calculator | Collapsed |
| `[details]` Reflection Engine | Threshold (importance sum), Max insights per reflection, Max reflections per character | Collapsed |

**UX Notes:**
- Users come here to search/browse - that's at the top
- Settings are "set and forget" - collapsed after initial configuration
- Payload calculator shows color-coded total + LLM compatibility warning

---

### Tab 3: World (Pure Viewer)

**Purpose:** Read-only exploration of GraphRAG-generated lore. **No settings.**

| Section | Content |
|---------|---------|
| Graph Stats Card | Entities Tracked, Relationships, Communities, Last Clustered |
| Communities Browser | List of communities with summaries (collapsible cards) |
| Entity Browser | Search, Type filter, Entity list |

**UX Notes:**
- Pure exploration - users can't break anything here
- Graph Stats proves the system is working
- Communities and Entities are browsable lore

---

### Tab 4: Advanced (Expert Math)

**Purpose:** Warning-protected fine-tuning for users who understand the math.

| Section | Content | Default State |
|---------|---------|---------------|
| ⚠️ Warning Banner | "These values are pre-calibrated..." | Visible |
| `[details]` Scoring & Weights | Alpha (vector/keyword balance) | Collapsed |
| `[details]` Decay Math | Lambda (forgetfulness rate) | Collapsed |
| `[details]` Similarity Thresholds | Vector threshold, Dedup cosine, Dedup jaccard | Collapsed |
| `[details]` Danger Zone | Restore Default Math & Thresholds, Delete Chat Data | Collapsed |

**UX Notes:**
- Warning banner always visible - no artificial locks
- Each section collapsible to reduce visual noise
- Reset button renamed for clarity about what it affects

---

### Tab 5: Performance (Diagnostics)

**Purpose:** Monitoring and troubleshooting.

| Section | Content |
|---------|---------|
| Timings Table | 12 metrics with health indicators |
| Copy Button | Plain-text export |

---

## Relocated Settings

| Setting | Old Location | New Location | Rationale |
|---------|--------------|--------------|-----------|
| Visible Chat Budget | World tab | Memories > Context & Injection | Global prompt limit belongs with memory system |
| Final Context Budget | World tab | Memories > Context & Injection | Memory injection budget belongs with memory system |
| Cloud API Concurrency | Memories tab | Dashboard > API Limits | Connection setting, not memory setting |
| Backfill RPM | Memories tab | Dashboard > API Limits | Connection setting, not memory setting |

---

## Terminology Changes

| Old Term | New Term | Rationale |
|----------|----------|-----------|
| Extraction Token Budget | **Extraction Batch Size** | "Budget" implies context limit; this is batch processing size |
| Reset Settings | **Restore Default Math & Thresholds** | Clarifies what gets reset, reduces anxiety about data loss |

---

## Reset Logic

### Preserved (Environment Settings)

These are connection-specific and should never be wiped:

- Extraction Profile (LLM)
- Backup Profile
- Preamble Language
- Output Language
- Assistant Prefill preset
- Embedding Model and all related settings
- Cloud API Concurrency
- Backfill RPM
- Debug Mode

### Reset (Fine-Tune Settings)

These are mathematical optimizations safe to reset:

- Extraction Batch Size
- Context Window Size
- Final Context Budget
- World Context Budget
- Visible Chat Budget
- Reflection Threshold
- Max Insights per Reflection
- Max Reflections per Character
- Alpha (scoring)
- Lambda (decay)
- Vector Similarity Threshold
- Dedup Cosine Threshold
- Dedup Jaccard Threshold
- Auto-hide toggle

---

## Description Rewrites (Complete)

### Dashboard

| Setting | Description |
|---------|-------------|
| Enable OpenVault | Turn memory system on/off |
| Auto-hide Messages | Hide old messages from AI context (they remain saved as Memories) |
| Extraction Profile | Which AI model extracts memories from your chat |
| Backup Profile | Backup AI to use if main profile fails |
| Preamble Language | Language for the AI instructions that prevent refusals |
| Output Language | What language memories should be written in |
| Assistant Prefill | How to start the AI's response (model-specific) |
| Embedding Model | How to convert text to searchable vectors |
| Cloud API Concurrency | How many simultaneous API calls. Use 1 for local (Ollama/LM Studio), 3-5 for cloud (Kimi/OpenAI) |
| Backfill RPM | Max requests per minute when processing old messages |

### Memories

| Setting | Description |
|---------|-------------|
| Memory Search | Find memories by content, character, or type |
| Extraction Batch Size | How much chat history to send to the background AI at once. Larger batches = fewer API calls but longer waits between updates |
| Context Window Size | How far back the AI reads to extract new memories. Larger = better context, but costs more tokens |
| Context & Injection Budgets | How many tokens of memories to inject into each AI response |
| Reflection Threshold | How much 'interesting stuff' needs to happen before the AI thinks deeper about a character. Lower = more frequent insights |
| Max Insights per Reflection | How many new insights per reflection (1-5). More = richer character understanding, but more tokens |
| Max Reflections per Character | Maximum stored insights per character. Older ones are archived when exceeded |

### World

| Section | Description |
|---------|-------------|
| Graph Stats | Real-time view of the knowledge graph: entities tracked, relationships mapped, communities clustered |
| Communities | AI-discovered groups of related people, places, and concepts |
| Entities | Browse all people, places, organizations, objects, and concepts in your story |

### Advanced

| Setting | Description |
|---------|-------------|
| Alpha | Balance between 'find similar meaning' (1.0) and 'find exact words' (0.0). Default 0.7 works for most RPs |
| Lambda | How quickly old memories fade in relevance. Higher = forgets faster. Lower = remembers longer. Default 0.05 is highly recommended |
| Vector Threshold | Minimum similarity for a memory to match. Higher = fewer, more relevant results. Lower = more matches, more noise |
| Dedup Cosine | How similar memories must be to count as duplicates. Higher = keeps more variations. Lower = more aggressive merging |
| Dedup Jaccard | Word-level duplicate detection. Backup filter when semantic similarity is borderline |
| Restore Default Math & Thresholds | Reset fine-tuning values to defaults. Your chat memories and connection profiles will not be touched |
| Delete Chat Data | Permanently remove all OpenVault data for this chat |

---

## Visual Design Specifications

### Warning Banner (Advanced Tab)

```
┌─────────────────────────────────────────────────────────┐
│ ⚠️  Expert Tuning                                       │
│                                                         │
│ These values are pre-calibrated for optimal AI          │
│ performance. Change them only if you understand         │
│ cosine similarity and BM25 math.                        │
└─────────────────────────────────────────────────────────┘
```

- Red/amber left border (3px)
- Warning icon for visual attention
- No dismiss button (always visible)

### Payload Calculator

```
✅  Estimated total: ~32,000 tokens
    (12k batch + 8k rearview + 12k overhead)
    Ensure your background LLM supports at least 32k context.
```

- Emoji indicators: ✅ 🟡 🟠 🔴
- Color-coded backgrounds matching emojis
- **NEW:** Explicit LLM compatibility warning

### Graph Stats Card (World Tab)

```
┌────────────────────────────────────────┐
│  Graph Status                          │
│  ─────────────────────────────────     │
│  Entities Tracked:     142             │
│  Relationships:        310             │
│  Communities:          4               │
│  Last Clustered:       12 msgs ago     │
└────────────────────────────────────────┘
```

- Compact, read-only
- Real-time updates
- Proof that GraphRAG is active

---

## Implementation Checklist

### Phase 1: Constants Migration
- [ ] Add 9 constants to `src/constants.js`
- [ ] Remove from `defaultSettings` export
- [ ] Remove HTML elements from `templates/settings_panel.html`
- [ ] Remove bindings from `src/ui/settings.js`

### Phase 2: Dashboard Restructure
- [ ] Reorder: Quick Toggles → Status → Stats → Progress → [details] Setup
- [ ] Move Connection, Language, Embeddings, API Limits into collapsible details
- [ ] Default details to **closed** (open on first visit only)

### Phase 3: Memories Restructure
- [ ] Move Memory Browser to **top** of tab
- [ ] Move Settings to bottom in `[details]` blocks
- [ ] Group: Character States, Extraction & Context, Reflection Engine
- [ ] Rename "Extraction Token Budget" → "Extraction Batch Size"

### Phase 4: World Purification
- [ ] Remove all sliders from World tab
- [ ] Add Graph Stats Card (new component)
- [ ] Keep Communities and Entity browsers

### Phase 5: Settings Relocation
- [ ] Move Visible Chat Budget to Memories > Context
- [ ] Move Final Context Budget to Memories > Context
- [ ] Move Cloud API Concurrency to Dashboard > API Limits
- [ ] Move Backfill RPM to Dashboard > API Limits

### Phase 6: Advanced Polish
- [ ] Add warning banner at top
- [ ] Group all settings in `[details]` blocks
- [ ] Rename reset button + add preservation subtext

### Phase 7: Description Updates
- [ ] Update all hint text per Description Rewrites section
- [ ] Add LLM compatibility line to payload calculator

### Phase 8: CSS/Visual
- [ ] Style warning banner (red border, icon)
- [ ] Style Graph Stats card
- [ ] Ensure details elements have consistent expand/collapse icons
- [ ] Payload calculator color classes (payload-safe, payload-caution, etc.)

---

## Success Criteria

1. **Dashboard**: User sees system health without scrolling
2. **Memories**: Search is immediately accessible
3. **World**: Zero settings, pure exploration
4. **Advanced**: Clear warning, no accidental changes
5. **Terminology**: "Batch Size" not confused with context budgets
6. **Reset**: User understands what will and won't be lost
7. **Payload**: User knows if their LLM can handle the load

---

## Design Decisions Summary

| Decision | Rationale |
|----------|-----------|
| Dashboard = Status first | Users check health more than they change config |
| Browsers above settings | Active use before set-and-forget |
| World = No settings | GraphRAG is for viewing, not configuring |
| Prompt budgets in Memories | They affect memory injection, not world lore |
| API limits in Dashboard | They're connection settings |
| 9 constants hidden | Users will break optimized math |
| No master expert lock | Power users find artificial locks annoying |
| Preserve connections on reset | Environment-specific settings shouldn't wipe |

---

*Design Version: 2.0*
*Date: 2026-03-17*
*Status: Ready for Implementation*
