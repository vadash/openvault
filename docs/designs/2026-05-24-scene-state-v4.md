# Scene State v4

## Problem

During extended roleplays, the main LLM loses track of immediate physical continuity — clothing, posture, location, props, and time of day. This causes "hallucinated clothing", character teleportation, and time inconsistencies. Users compensate by adding verbose tracking instructions to their presets, which wastes output tokens and degrades prose quality.

## Solution

A **Scene State** subsystem that runs a lightweight background extraction every N messages, tracking the current scene in an ephemeral JSON object. The state is injected as a dense XML block into the prompt, giving the main model an accurate "cheat sheet" of what is happening right now. A transition ledger records state changes so memory extraction can accurately stamp events with the correct time and location.

## Architecture

Four components:

1. **State Map** — Fingerprint-keyed map at `chatMetadata.openvault.scene_states`. Each entry is a snapshot of the scene state produced at a specific message. Injection uses backward-scan lookup to find the most recent state at or before the current last message, making the system resistant to swipes and regenerates while covering the interval gap between extractions.
2. **Ledger** — Append-only array at `chatMetadata.openvault.scene_ledger`. Records state transitions (location/time changes) with message fingerprints. Used during memory extraction for accurate temporal/spatial stamping.
3. **Extractor** — New prompt + extraction function. Reads previous state + all unanalyzed messages since last extraction, outputs updated JSON. Runs either as Stage 7 in the existing pipeline or independently when the worker has no extraction batch.
4. **Injector** — Formats the current state into dense XML block, injects at user-configured position via the 4th dropdown.

## Data Schema

### State Map (`scene_states`)

A map keyed by message fingerprint, where each value is a scene state snapshot:

```jsonc
{
  "fp_msg_10": {
    "location": "Vova's Apartment - Bedroom",
    "time": "Monday, June 16, 2025, 10:53 PM",
    "environment": "Clear night, 65°F, cool air from open window",
    "characters": {
      "Melody": {
        "clothing": ["army boots", "torn red bra hanging off waist"],
        "posture": "pinned on back against the rug",
        "physical_status": ["exhausted", "sweaty", "bruised knees"],
        "mental_status": "submissive, aroused"
      },
      "Vova": {
        "clothing": ["naked"],
        "posture": "kneeling over Melody",
        "physical_status": ["semi-erect", "sweaty"],
        "mental_status": "dominant, focused"
      }
    },
    "active_props": ["silicone erection ring (worn by Vova)"],
    "source_fp": "fp_msg_10"  // fingerprint of the message that triggered this extraction
  },
  "fp_msg_15": {
    // Updated state after messages 11-15
  }
}
```

**Swipe safety:** If the user swipes/regenerates, the last message in chat changes. The backward-scan lookup will find the most recent state entry at or before the new last message — which may be an earlier state or the same state. No desync.

**Pruning:** After each extraction, prune the map to keep only the last 10 entries. Users rarely swipe back more than a few turns.

Initialized to `{}` (empty object, not `null`) on chat creation or after disable-wipe. This avoids `TypeError` on `Object.keys()` or `for...in` lookups in subsequent reads.

### Ledger (`scene_ledger`)

```jsonc
[
  { "fp": "fp_msg_10", "location": "Vova's Apartment - Bedroom", "time": "Monday, 10:53 PM" },
  { "fp": "fp_msg_15", "location": "Vova's Apartment - Kitchen", "time": "Monday, 11:15 PM" }
]
```

Append-only. A new entry is added only when the extractor detects a change in `location` or `time` compared to the previous state. The `fp` field is the fingerprint of the **last message in the extraction window** (the message that triggered the extraction).

## Extraction Pipeline

### Trigger

- Message-count interval. New setting `sceneStateInterval` (default: 3, range: 2–10).
- Tracked via a counter `scene_counter` in chat metadata, incremented only on real messages (skips `is_system` messages, matching the existing pattern in `scheduler.js`).
- When `scene_counter >= sceneStateInterval`, extraction fires and counter resets to 0.

### When it runs

Two execution paths:

**Path A — Piggyback on existing extraction:** After Stage 6 (world state synthesis) in `extractMemories()`, check if the scene state interval is met. If yes, run scene extraction as Stage 7. This avoids an extra API call cycle since the worker is already awake.

**Path B — Standalone scene extraction:** The worker loop checks the scene state counter independently. If no memory extraction batch is pending but `scene_counter >= sceneStateInterval`, the worker runs **only** the scene state extraction function — no Phase 1/Phase 2 memory pipeline. The scene extraction function is isolated so it can run without touching `data.memories`, `data.graph`, or any other extraction state.

### Message window for extraction

The extractor does **not** use a fixed N-message slice. Instead, it captures **all unanalyzed messages since the `source_fp` of the last stored state**:

1. Find the latest entry in `scene_states`. If the map is empty (cold start — first extraction in the chat), the starting index defaults to `0` (the beginning of the chat).
2. Get its `source_fp` and resolve it to a chat index.
3. Collect all real messages (skip `is_system`) from that index + 1 to the end of chat.
4. This is the extraction window — variable-length, bounded by actual message flow.

This handles edge cases where:
- The user changed the interval setting mid-chat.
- Multiple messages arrived between worker ticks (fast typing, group chats).
- The standalone path fires after a variable delay.

### Extraction prompt

System prompt provides:
- The previous scene state JSON (the latest entry in `scene_states`, or `"No previous state — this is the first extraction."`)
- The messages in the extraction window (only real messages — skip `is_system`)
- Instructions to output the updated JSON with all fields filled

**Prompt engineering rules:**

1. **State Inertia (Preservation):** *"Preserve all existing clothing, props, and physical traits from the previous state unless they are explicitly changed, removed, or rendered impossible by the new dialogue. If a character was wearing army boots and the last 3 messages don't mention footwear, the army boots remain."*

2. **Stale Character Eviction (Cleanup):** *"If a character has explicitly left the scene, or has not been mentioned or present for more than 10 messages, remove their entry from the characters dictionary. Do not carry ghosts."*

3. **Clothing Transition:** *"When a piece of clothing is removed, delete it from the character's `clothing` array. If the item remains relevant to the scene (e.g., thrown on the floor, held in hand), move it to the `active_props` array."*

4. **Prop Eviction:** *"If an active prop is discarded, consumed, or no longer physically present in the immediate area, remove it from `active_props`."*

The LLM infers time progression from described actions (e.g., "they showered" → increment 20 minutes). No programmatic clock.

Output: single JSON object matching the state schema. Validated with Zod before saving.

### State map and ledger updates

After successful extraction:

1. Get the fingerprint of the last message in the extraction window.
2. Store the new state in `scene_states[fp]`.
3. Compare new `location` and `time` to the previous state (latest entry before this one).
4. If either changed, append a ledger entry `{ fp, location, time }`.
5. Prune `scene_states` to keep only the last 10 entries.
6. Save.

## Injection

### Format

The state JSON is formatted into a dense XML block:

```xml
<scene_status>
[Location]: Vova's Apartment - Bedroom | [Time]: Monday 10:53 PM, Clear 65°F
[Melody]: On back, pinned. Wearing: army boots, torn red bra. Status: exhausted, sweaty.
[Vova]: Kneeling over Melody. Wearing: naked + erection ring. Status: dominant, semi-erect.
</scene_status>
```

Approximately 60–100 tokens depending on scene complexity. One line per character plus environment header.

### Injection lookup (backward scan)

The state map is keyed by the fingerprint of the message that triggered extraction — not by every message in chat. Between extractions, most messages won't have a direct key. The lookup uses a **backward scan**:

1. Start from the last message in chat.
2. Walk **backward** through the chat array.
3. For each message, check if its fingerprint exists as a key in `scene_states`.
4. The **first match** found is the current scene state — format and inject it.
5. If the start of chat is reached without finding any match, skip injection. There is no hard message-count limit on the backward scan — the state map is already bounded by pruning to 10 entries, so the scan is always fast.

This ensures:
- State from message 10 continues to be injected during messages 11–14, until message 15 triggers a new extraction.
- If the user swipes back to message 12, the backward scan finds the state from message 10 (or 15 if the swipe direction works that way).
- No stale data is ever injected — only the most recent state that was derived from messages at or before the current position.

### Injection mechanism

Follows the exact same pattern as memory/reflections/world:
- New setting path: `injection.scene.position` (default: 4 = In-chat), `injection.scene.depth` (default: 4)
- New extension prompt key: `openvault_scene`
- New macro: `{{openvault_scene}}`
- 4th dropdown in the "Injection Positions" section of the Adv tab
- Supports all position options including Disabled (-2) and Custom (-1)

### Short chats guard

When injection position is `IN_CHAT` (4) and `chat.length < depth`, fall back to injecting at `AFTER_MAIN` (1) for that turn. Once the chat grows past the depth threshold, resume normal `IN_CHAT` injection. This prevents undefined behavior on new chats with only 1–2 messages.

### Where it is injected in the pipeline

In `injectContext()` (`src/retrieval/retrieve.js`), add a 4th parameter `sceneText` and inject it the same way as the other three. The scene state text is produced by the backward-scan lookup and formatting.

## Memory Temporal Stamping

When the event extraction pipeline processes a batch of messages, the ledger provides temporal/spatial grounding:

### Ledger resolution algorithm

Given a batch of messages (e.g., indices 0 to 20):

1. For each message in the batch, get its fingerprint (`fp`).
2. Sort the `scene_ledger` entries by position in chat (newest first).
3. For each message, scan the ledger **backward**: the correct scene context for the message is the **first ledger entry** whose registered fingerprint corresponds to a message at or before the current message's position in chat.
4. If no ledger entry exists for a message (pre-feature messages), stamp with `null` — the memory has no scene context.
5. Segment the extraction batch into sub-batches where the scene context is uniform.

### Extraction context injection

Before calling `fetchEventsFromLLM`, an `<extraction_context>` block is prepended to the extraction prompt:

```xml
<extraction_context>
The following batch contains scenes. Apply these parameters to the extracted events:
- Messages [1 to 10]: Location: Vova's Bedroom | Time: Monday, 10:53 PM
- Messages [11 to 20]: Location: Vova's Kitchen | Time: Monday, 11:15 PM
</extraction_context>
```

### Deterministic stamping

After extraction, each memory gets `location` and `temporal_anchor` fields injected by JS from the ledger — not from the LLM output. This is mathematically precise and never hallucinated.

This replaces the need for the main model to print `[ 🕰️ 10:53 PM | 📍 Location ]` brackets in chat output. The user can remove those instructions from their preset, saving output tokens and improving prose quality.

## Settings & UI

### New constants (`src/constants.js`)

```javascript
// In defaultSettings:
sceneStateInterval: 3,  // Messages between scene state extractions

// In injection defaults:
injection: {
    memory: { position: 1, depth: 4 },
    reflections: { position: 1, depth: 4 },
    world: { position: 1, depth: 4 },
    scene: { position: 4, depth: 4 },  // Default: In-chat at depth 4
}
```

### New UI elements

1. **Slider** in extraction settings: "Scene State Interval" (range 2–10, default 3)
2. **4th dropdown** in Injection Positions: "Scene Position" — follows exact same HTML/JS pattern as the other three dropdowns, with all position options including Disabled and Custom

### Disable semantics

Setting Scene Position to Disabled (-2):
- Wipe `scene_states` (set to `{}`, not `null`) and `scene_ledger` (set to `[]`) from chat metadata
- Reset `scene_counter` to 0
- Confirmation dialog before wipe (same pattern as reflections/world)

Note: `safeSetExtensionPrompt` in `st-helpers.js` already handles `-2` correctly (line 58-65: clears prompt, returns false). No change needed there.

## Error Handling

- **Extraction failure**: Old state map preserved. No partial updates. Log error.
- **Invalid JSON from LLM**: Zod validation rejects it. Old state preserved. Log error.
- **First chat / no state**: `scene_states` is `{}` → backward scan finds nothing → nothing injected → no harm.
- **Swipe/regenerate**: The backward-scan lookup naturally finds the most recent state at or before the current last message. If the swipe goes to a message before any extraction ran, no state is injected until the next extraction tick.
- **Backfill**: Scene state extraction is skipped during backfill (same as reflections/world). Ledger backfill is not needed — it builds forward from when the feature is enabled.

## Files Changed

| File | Change |
|------|--------|
| `src/constants.js` | Add `sceneStateInterval` to `defaultSettings`, add `scene` to `injection` defaults |
| `src/settings.js` | Add `injection.scene.position`, `injection.scene.depth`, `sceneStateInterval` to required paths |
| `templates/settings_panel.html` | Add slider for interval, add 4th dropdown for Scene Position |
| `src/ui/settings.js` | Add event handlers for new slider and dropdown, `updateInjectionUI` for scene |
| `src/retrieval/retrieve.js` | Add `sceneText` parameter to `injectContext()`, backward-scan lookup from `scene_states` |
| `src/retrieval/formatting.js` | Add `formatSceneStateForInjection()` to convert JSON → XML |
| `src/injection/macros.js` | Add `scene` to `cachedContent`, register `openvault_scene` macro |
| `src/extraction/extract.js` | Add Stage 7: scene state extraction after world state synthesis |
| `src/extraction/worker.js` | Add standalone scene state extraction path when no extraction batch is pending |
| `src/extraction/scene-state.js` | New file: extraction prompt, Zod schema, ledger diffing, state map management, extraction function |
| `src/prompts/scene-state/` | New directory: system prompt, rules, examples for scene state extraction |
| `src/store/migrations/` | Migration to add `scene_states` (`{}`), `scene_ledger` (`[]`), `scene_counter` (`0`) fields |
| `include/DATA_SCHEMA.md` | Document `scene_states` and `scene_ledger` schemas |

## Testing Strategy

- **Unit**: Zod schema validation for scene state and ledger entries
- **Unit**: State map pruning logic (keep last 10)
- **Unit**: Injection backward-scan lookup (exact match, interval gap, empty map, swipe to earlier message)
- **Unit**: Ledger backward-scan resolution algorithm
- **Unit**: Injection formatting (JSON → XML block)
- **Unit**: Interval counter logic (increment on real messages only, skip `is_system`, trigger, reset)
- **Unit**: Short chats guard (depth > chat.length fallback)
- **Unit**: Variable extraction window (all messages since last `source_fp`)
- **Integration**: End-to-end scene state extraction with mock LLM responses
- **Integration**: Swipe simulation — backward scan returns correct pre-swipe state
- **Integration**: Interval gap — state from message 10 is injected at messages 11-14
- **Integration**: Memory stamping with ledger lookup
- **Integration**: Injection position dropdown follows established pattern

## Out of Scope (v1)

- Visual UI widget showing current scene state
- Separate model selector for scene state extraction
- Programmatic clock / time multiplier
- Manual override commands (e.g., `/scene-time`)
- Scene state in debug export (can add later)
- Backfill of scene state from existing chats
- Hook into `MESSAGE_EDITED` / `MESSAGE_UPDATED` events for immediate re-extraction on user edits
