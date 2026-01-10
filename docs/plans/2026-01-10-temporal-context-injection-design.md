# Temporal Context Injection Design

## Overview

Replace flat memory list injection with narrative timeline buckets to improve LLM understanding of causality, emotional consistency, and plot coherence.

## Problem

Current approach injects memories as a flat list sorted by score/chronology. LLMs struggle with causality when events are presented as bullet points without temporal structure. They can't distinguish whether event A caused event B or vice versa.

## Solution

Structure memories into three time buckets based on their position in the chat timeline:

- **ESTABLISHED HISTORY** (Old): First 40% of chat
- **PREVIOUSLY** (Mid): Middle 40% of chat (40-80%)
- **RECENT EVENTS** (Recent): Last 20% of chat

## Bucket Calculation

```javascript
chatLength = current message count
recentThreshold = chatLength * 0.80
midThreshold = chatLength * 0.40

For each memory:
  position = average(memory.message_ids)  // midpoint of message range

  if position >= recentThreshold → RECENT
  else if position >= midThreshold → MID
  else → OLD
```

Fallback: If memory has no `message_ids`, use `sequence / 1000` as position estimate.

## Output Format

```
<scene_memory>
(Current chat has #500 messages)

[ESTABLISHED HISTORY] (messages 1-200)
[★★] You bought a sword to defend the village.
[★★★] The village elder warned of goblin raids.

[PREVIOUSLY] (messages 200-400)
[★★★★] The goblin stole the amulet.
[★★] You tracked the goblin into the forest.

[RECENT EVENTS] (messages 400-500)
Emotional state: anxious
Relationships with present characters:
- Goblin: enemy (low trust, high tension)

[★★★★★] The goblin camp was burned down.
[★★] The goblin is now cornered and desperate.
</scene_memory>
```

### Format Rules

- Bucket headers include message range for LLM context
- Empty buckets omitted entirely
- Emotional state + relationships appear at start of RECENT bucket
- Memories sorted chronologically within each bucket (oldest first)
- Secret memories retain `[Secret]` prefix
- Importance shown as stars (★ to ★★★★★), no message numbers

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No memories at all | Return minimal `<scene_memory>` with just chat length header |
| All memories in one bucket | Only that bucket renders, others skipped |
| Memory has no message_ids | Fall back to `sequence / 1000` as position estimate |
| Chat length is 0 or undefined | Treat all memories as RECENT |
| RECENT bucket empty but has emotional state | Still render RECENT with emotional/relationship info |

## Implementation

### File Changes

**`src/retrieval/formatting.js`** (only file modified):

1. Add new helper function `assignMemoriesToBuckets(memories, chatLength)`
2. Modify `formatContextForInjection` to:
   - Calculate bucket thresholds
   - Assign memories to buckets
   - Render each non-empty bucket with header
   - Place emotional state + relationships in RECENT section
   - Update token budget calculation for multiple headers

### No Changes Required

- `retrieve.js` - passes same memory array
- `scoring.js` - scoring logic unchanged
- `parser.js` - sequence data already exists
- `worker.js` - math unchanged

### Token Budget

- Calculate overhead for all non-empty bucket headers upfront
- Distribute remaining budget across buckets proportionally to memory count
- Truncate within each bucket if needed (least important first)

## Testing

### Unit Tests

1. `assignMemoriesToBuckets` - correct bucket assignment at boundaries
2. Bucket calculation with various chat lengths (10, 100, 1000)
3. Empty bucket skipping
4. Memory position calculation from message_ids midpoint
5. Fallback to sequence when message_ids missing
6. Token budget distribution across buckets
7. Emotional state + relationships in RECENT section

### Integration Tests

1. Full `formatContextForInjection` output matches expected format
2. Token budget respected across all buckets
3. Chronological ordering preserved within buckets

### Manual Verification

- Load into SillyTavern, check browser console for `[OpenVault]` logs
- Verify output in prompt inspection tools

## Future Enhancements (Not in v1)

- Time-gap aware connective phrases ("Much later...", "Shortly after...")
- User-configurable bucket thresholds
- LLM-generated bucket summaries
