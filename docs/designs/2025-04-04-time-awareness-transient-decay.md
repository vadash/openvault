# Time Awareness and Transient Memory Decay

**Status:** Design Complete
**Target Implementation:** After Durability Lens (prompt-only changes)
**Scope:** Schema changes, extraction rules, decay math, formatting

---

## 1. Problem Statement

Memories currently have no sense of time. When a character says "see you next Saturday" or "I'll be back in an hour," there's no mechanism to relate that to actual dates. Additionally, short-term intentions like "go do X tonight" become misleading noise after they expire.

### Goals

1. **Time Awareness**: Extract and display temporal context so the AI understands when events happened relative to the current scene.
2. **Memory Decay**: Short-term/transient memories should fade faster than permanent facts, reducing noise from expired temporary plans.

---

## 2. Design Principles

### 2.1 Opportunistic Extraction

Time tracking is **opt-in by the user** at the message level. If users include time headers in their roleplay messages, OpenVault extracts them. If not, the system degrades gracefully — no time data is extracted, and memories work exactly as they do today.

**No UI toggle required.** The feature is always enabled but only activates when time data is present.

### 2.2 Verbatim Extraction, No Resolution

Do not attempt to resolve relative time references ("tomorrow," "in two hours") into absolute timestamps. Roleplay chats are chaotic — users swipe, delete, edit. Resolving "tomorrow" during extraction creates permanent broken data if the timeline changes later.

Instead: extract the temporal anchor **verbatim** from the message header. The Generation LLM will do the temporal reasoning when it sees both the memory's time tag and the current scene header.

### 2.3 Message Distance for Decay Math

**In-universe time is non-linear.** A 50-message combat scene might be 3 minutes of story time. A single message might say "*Five years later...*"

Therefore:
- **Decay math uses message distance** (narrative distance), not wall-clock time
- **Time data is display-only** — prepended to memory summaries for context
- The `is_transient` flag multiplies the existing message-distance decay

This ensures:
- Dense scenes don't overflow context with un-decayed memories
- Time skips don't cause instant amnesia
- Context window stays balanced regardless of in-universe time flow

---

## 3. Schema Changes

### 3.1 New Fields

```javascript
// EventSchema (extraction output)
{
  temporal_anchor: z.string().nullable().optional().default(null),
  // Example: "Friday, June 14, 3:40 PM" or null

  is_transient: z.boolean().optional().default(false),
  // true = short-term intention ("be right back", "waiting 10 minutes")
  // false = permanent fact or durable relationship change
}

// MemorySchema (storage) - inherits from EventSchema
{
  temporal_anchor: z.string().nullable().optional(),
  is_transient: z.boolean().optional()
}
// MemoryUpdateSchema (manual updates via UI)
{
  temporal_anchor: z.string().nullable().optional(),
  is_transient: z.boolean().optional()
}
```

### 3.2 No Migration Required

Both fields are **optional with sensible defaults**:
- `temporal_anchor: null` → No time prefix in formatting
- `is_transient: false` → Uses normal decay (no multiplier)

Existing memories without these fields behave exactly as before.

### 3.3 Memory Update Support

To allow users to manually correct extraction errors (e.g., an important memory mistakenly flagged as `is_transient: true`):

**In `src/store/schemas.js`:** Add both fields to `MemoryUpdateSchema` as optional:
```javascript
export const MemoryUpdateSchema = z.object({
  // ... existing fields ...
  temporal_anchor: z.string().nullable().optional(),
  is_transient: z.boolean().optional(),
});
```

**In `src/store/chat-data.js`:** Add both fields to the `allowedFields` array in `updateMemory()`:
```javascript
const allowedFields = [
  'summary',
  'importance',
  'is_secret',
  // ... existing fields ...
  'temporal_anchor',  // <-- ADD
  'is_transient',     // <-- ADD
];
```

### 3.4 Schema Safety Note

The Zod chain `z.string().nullable().optional().default(null)` handles LLM inconsistency:
- **Field omitted entirely** → `.optional()` allows undefined → `.default(null)` converts to `null`
- **Field explicitly null** → `.nullable()` accepts null
- **Field has value** → `.string()` validates type

This safely normalizes all three cases to `null` or string without brittle parsing.

---

## 4. Extraction Rules

### 4.1 Prompt Instructions (Added to `<field_instructions>`)

```xml
<field_instructions>
...
temporal_anchor: Look for timestamp headers in messages (e.g., time/date markers). Extract ONLY the concise date and time as written by the user (e.g., "Friday, June 14, 3:40 PM" or "Wednesday, 30 October 2024. 4:43 PM"). Strip decorative elements like emojis, locations, and weather if present, but preserve the verbatim date/time format chosen by the user. If no time is stated, return null.

is_transient: Set to true ONLY for short-term intentions, temporary states, or immediate plans (e.g., "going to wash up", "waiting for 10 minutes", "be right back", "let's meet at 7 PM"). Set to false for permanent facts, completed actions, or durable relationship changes (e.g., "revealed a secret", "professed love", "moved to a new city").
</field_instructions>
```

### 4.2 Examples Update Required

The few-shot examples in `src/prompts/events/en.js` and `src/prompts/events/ru.js` must be updated to include the new fields in their output JSON. This ensures the extraction LLM learns the new schema through demonstration.

**Example pattern:**

```javascript
// Before:
output: `{
  "summary": "Character A agreed to meet Character B at the library",
  "importance": 3,
  "characters_involved": ["Character A", "Character B"],
  ...
}`

// After:
output: `{
  "summary": "Character A agreed to meet Character B at the library",
  "importance": 3,
  "temporal_anchor": "Friday, June 14, 3:40 PM",
  "is_transient": true,
  "characters_involved": ["Character A", "Character B"],
  ...
}`
```

---

## 5. Decay Math

### 5.1 Current Formula (Unchanged)

```javascript
// Lambda calculation (higher importance = slower decay)
const hits = memory.retrieval_hits || 0;
const hitDamping = Math.max(0.5, 1 / (1 + hits * 0.1));
let lambda = (BASE_LAMBDA / (importance * importance)) * hitDamping;

// Base score: Importance × e^(-λ × Distance)
const base = importance * Math.exp(-lambda * distance);
```

### 5.2 Transient Multiplier (New)

```javascript
// Apply 5x decay acceleration for transient memories
if (memory.is_transient) {
    const multiplier = settings.transientDecayMultiplier || 5.0;
    lambda *= multiplier;
}
```

### 5.3 Tuning Rationale

With default settings (`BASE_LAMBDA = 0.05`, importance = 3):

| Distance | Normal Decay | Transient (5×) |
|----------|-------------|----------------|
| 30 messages | Score: 2.5 | Score: 1.3 |
| 50 messages | Score: 2.3 | Score: 0.74 |
| 70 messages | Score: 2.1 | Score: 0.42 |

**Why this works:**

Memories enter the retrieval pool when messages become `is_system` (hidden), typically at distance ~20-30. A transient memory enters with score ~1.3 (still retrievable), fades to marginal at distance 50, and is effectively gone by distance 70.

This gives transient memories a short but meaningful life (20-40 messages) after the original text disappears from the visible chat, then they fade to reduce noise.

### 5.4 Configuration

```javascript
// src/constants.js
transientDecayMultiplier: 5.0  // Multiplier for short-term memory decay
```

No UI control needed — this is a sensible default that works across different context window sizes.

---

## 6. Formatting Changes

### 6.1 Injection Syntax

Prepend temporal anchor to memory summary using bracket notation (consistent with existing `[★★★]` and `[Known]` tags):

```javascript
const formatMemory = (memory) => {
    const importance = memory.importance || 3;
    const stars = '★'.repeat(importance);
    const isKnown = !memory.is_secret && (memory.witnesses?.length || 0) > 2;
    const prefix = isKnown ? '[Known] ' : '';

    // NEW: Add temporal anchor if present
    const timePrefix = memory.temporal_anchor ? `[${memory.temporal_anchor}] ` : '';

    return `[${stars}] ${timePrefix}${prefix}${memory.summary}`;
};
```

### 6.2 Example Output

**With time data:**
```
[★★★] [Friday, June 14, 3:40 PM] Character A suggested meeting at the library.
[★★] [3:45 PM] Character B agreed to the plan.
[★★★★] [Saturday, June 15, 9:00 AM] Character A revealed a long-held secret.
```

**Without time data (degrades gracefully):**
```
[★★★] Character A suggested meeting at the library.
[★★] Character B agreed to the plan.
```

### 6.3 Token Efficiency

The full temporal string is included for every memory. While this uses ~4-5 tokens per memory, it ensures:
- Self-contained context (no complex date parsing needed)
- Works across all languages and date formats
- No brittle "same day detection" logic that breaks on format variations

---

## 7. Implementation Checklist

### Phase 1: Schema & Constants
- [ ] Add `transientDecayMultiplier: 5.0` to `defaultSettings` in `src/constants.js`
- [ ] Add `temporal_anchor` and `is_transient` to `EventSchema` in `src/store/schemas.js`
- [ ] Add same fields to `MemorySchema` in `src/store/schemas.js`
- [ ] Add `transientDecayMultiplier` to `ScoringConfigSchema`

### Phase 2: Extraction
- [ ] Update extraction rules in `src/prompts/events/rules.js` with new field instructions
- [ ] Update all few-shot examples in `src/prompts/events/en.js` to include new fields
- [ ] Update all few-shot examples in `src/prompts/events/ru.js` to include new fields
- [ ] Run `npm run generate-types` to regenerate TypeScript declarations

### Phase 3: Retrieval Math
- [ ] Add `transientDecayMultiplier` to `scoringConfig` in `buildRetrievalContext()` (`src/retrieval/retrieve.js`)
- [ ] Pass `transientDecayMultiplier` through `scoreMemoriesDirect()` to `scoreMemories()`
- [ ] Update `calculateScore()` in `src/retrieval/math.js` to apply multiplier when `memory.is_transient` is true

### Phase 4: Formatting
- [ ] Update `formatMemory` helper in `src/retrieval/formatting.js` to prepend `temporal_anchor`

### Phase 5: UI
- [ ] Add informational hint to `templates/settings_panel.html` under Extraction section

### Phase 6: Testing
- [ ] Add unit tests for `calculateScore` with transient multiplier
- [ ] Add unit tests for `formatMemory` with and without temporal_anchor
- [ ] Verify schema validation accepts new fields
- [ ] Test with extraction examples to ensure LLM outputs new fields correctly

---

## 8. UI/UX Considerations

### 8.1 No Settings Toggle

As agreed, no checkbox for "enable time tracking." The feature is opportunistic.

### 8.2 Informational Hint

Add a small informational note in the Extraction settings section:

> **Time Awareness:** Include timestamps in your messages (e.g., `[Friday, June 14, 3:40 PM]`) to enable temporal memory tracking. Short-term plans marked as transient will fade from context faster than permanent facts.

This educates users without adding configuration complexity.

---

## 9. Edge Cases & Decisions

### 9.1 Missing Time Data

**Scenario:** User has some messages with time headers, some without.
**Behavior:** Memories extracted from messages without time headers have `temporal_anchor: null` and display without time prefix. System continues working normally.

### 9.2 Inconsistent Time Formats

**Scenario:** User switches between "June 14, 3:40 PM" and "14th of June, afternoon"
**Behavior:** Both extracted verbatim. LLM handles the variation during generation. No normalization attempted.

### 9.3 Combat Scenes & Time Skips

**Scenario:** 50-message combat (3 min story time) or "*Five years later...*"
**Behavior:** Decay uses message distance, so combat memories decay normally across the 50 messages. Time skip doesn't affect decay math — memories from before the skip remain retrievable based on message distance.

### 9.4 High-Importance Transient

**Scenario:** "The bomb explodes in 10 minutes" — importance 5 (critical), transient true
**Behavior:** Gets 5× decay multiplier despite importance 5. Still survives longer than importance-1 transient due to importance's effect on base lambda, but fades faster than a permanent importance-5 memory.

---

## 10. Success Criteria

1. Memories extracted from time-stamped messages display their temporal anchor in injected context
2. Transient memories (e.g., "be right back") fade from retrieval ~2× faster than normal memories
3. Existing memories without new fields continue working unchanged
4. Users without time headers see no behavioral changes
5. All tests pass, including new unit tests for decay math and formatting

---

## Appendix: File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/constants.js` | Add | `transientDecayMultiplier: 5.0` to defaults |
| `src/store/schemas.js` | Add | `temporal_anchor` and `is_transient` to EventSchema, MemorySchema, MemoryUpdateSchema, ScoringConfigSchema |
| `src/store/chat-data.js` | Edit | Add `temporal_anchor` and `is_transient` to `allowedFields` in `updateMemory()` |
| `src/prompts/events/rules.js` | Edit | Add field instructions for temporal_anchor and is_transient |
| `src/prompts/events/en.js` | Edit | Update all example outputs to include new fields |
| `src/prompts/events/ru.js` | Edit | Update all example outputs to include new fields |
| `src/retrieval/retrieve.js` | Edit | Pass `transientDecayMultiplier` in scoringConfig |
| `src/retrieval/math.js` | Edit | Apply multiplier in `calculateScore()` when `is_transient` |
| `src/retrieval/formatting.js` | Edit | Prepend `temporal_anchor` in `formatMemory()` |
| `templates/settings_panel.html` | Edit | Add informational hint about time awareness |
| `src/types.d.ts` | Regenerate | Run `npm run generate-types` |
