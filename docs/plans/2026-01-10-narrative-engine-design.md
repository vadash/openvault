# Narrative Engine Design

## Overview

Upgrade the temporal bucket system to a full "narrative engine" that helps LLMs understand causality in long chats. Fixes the scaling problem where percentage-based buckets become meaningless at 5000+ messages.

## Problem

Current implementation uses percentage-based buckets:
- Recent: last 20% of chat
- Mid: 40-80% of chat
- Old: first 40%

At 5000 messages, "Recent" spans 1000 messages—destroying the meaning of "current scene." Events from 800 messages ago appear under `[RECENT EVENTS]`, breaking cause-and-effect reasoning.

## Solution

Replace percentages with fixed windows, add time-gap separators, causality hints, and emotional annotations.

## Output Format

```
<scene_memory>
(Current chat has #5000 messages)

## The Story So Far
[★★] You bought a sword.
[★★★] The village elder warned of goblin raids.
    ⤷ Shortly after

...Later...

[★★] You met Marcus at the tavern.

...Much later...

[★★★★] The great battle began.
    💔 Emotional: fear, determination

## Leading Up To This Moment
[★★★★] The goblin stole the amulet.
[★★] You tracked the goblin into the forest.
    ⤷ IMMEDIATELY AFTER

...

[★★★] Marcus betrayed the group.
    💔 Emotional: guilt

## Current Scene
Emotional state: anxious
Relationships: Goblin (enemy, high tension)

[★★★★★] The goblin camp was burned.
[★★] The goblin is cornered.
    ⤷ IMMEDIATELY AFTER
</scene_memory>
```

## Design Decisions

### 1. Fixed Window Sizes (Hardcoded)

| Bucket | Window | Description |
|--------|--------|-------------|
| Current Scene | Last 50 messages | Immediate action |
| Leading Up To This Moment | Messages 51-500 ago | Recent narrative arc |
| The Story So Far | Everything older than 500 | Background/lore |

```javascript
const CURRENT_SCENE_SIZE = 50;
const LEADING_UP_SIZE = 500;

const recentThreshold = chatLength - CURRENT_SCENE_SIZE;
const midThreshold = chatLength - LEADING_UP_SIZE;
```

**Edge cases:**
- Chat < 50 messages: Everything → "Current Scene"
- Chat 50-500 messages: No "Story So Far", just two buckets
- Chat > 500 messages: All three buckets

### 2. Gap Detection and Separators

Inject visual separators when memories within "Story So Far" bucket are far apart.

| Gap (messages) | Separator |
|----------------|-----------|
| < 15 | None |
| 15-99 | `...` |
| 100-499 | `...Later...` |
| ≥ 500 | `...Much later...` |

Only applies to "Story So Far" bucket. Other buckets are tight enough that internal gaps are rare.

### 3. Causality Hints (Proximity-Based)

When consecutive memories are close, append a proximity label. Applies to all buckets.

| Gap (messages) | Label |
|----------------|-------|
| < 5 | `⤷ IMMEDIATELY AFTER` |
| 5-14 | `⤷ Shortly after` |
| ≥ 15 | None (use separator instead) |

Hint appears indented below the memory it applies to.

### 4. Emotional Annotations

For memories with importance ≥ 4 that have `emotional_impact` data:

```
[★★★★] Marcus betrayed the group.
    💔 Emotional: guilt, shock
```

Lower importance memories don't get annotations to reduce noise.

### 5. Message Numbers

Omitted from output. Bucket structure and gap markers convey timing. Numbers would add noise.

### 6. Token Budget

- Minimum budget: 1000 tokens (enforce in UI sliders)
- No degraded/fallback mode needed at 1k minimum
- Truncation priority: Drop from "Story So Far" first, then "Leading Up", preserve "Current Scene"

## Implementation

### File Changes

**`src/retrieval/formatting.js`:**
- Replace percentage thresholds with fixed constants
- Add gap calculation between consecutive memories
- Add separator injection logic for "Story So Far"
- Add causality hint logic for all buckets
- Add emotional annotation for importance ≥ 4
- Update bucket headers to markdown format
- Update `formatMemory` to accept previous memory for gap calculation

**UI files (sliders):**
- Set minimum value to 1000 for token budget sliders

### Constants

```javascript
// Window sizes
const CURRENT_SCENE_SIZE = 50;
const LEADING_UP_SIZE = 500;

// Gap thresholds
const GAP_SMALL = 15;
const GAP_MEDIUM = 100;
const GAP_LARGE = 500;

// Causality thresholds
const IMMEDIATE_GAP = 5;
const CLOSE_GAP = 15;

// Annotation threshold
const EMOTIONAL_IMPORTANCE_MIN = 4;
```

### Bucket Headers

```javascript
const bucketHeaders = {
    old: '## The Story So Far',
    mid: '## Leading Up To This Moment',
    recent: '## Current Scene',
};
```

## Testing

### Unit Tests

1. Fixed window bucket assignment at various chat lengths (10, 100, 1000, 5000)
2. Gap separator injection at threshold boundaries
3. Causality hint injection for close memories
4. Emotional annotation only for importance ≥ 4
5. Edge case: chat < 50 messages (single bucket)
6. Edge case: chat 50-500 messages (two buckets)
7. Token budget truncation from correct bucket

### Manual Verification

- Load into SillyTavern with long chat (1000+ messages)
- Verify output format in prompt inspection
- Check that "Current Scene" is actually recent (last 50 msgs)
- Confirm gap separators appear between distant memories
