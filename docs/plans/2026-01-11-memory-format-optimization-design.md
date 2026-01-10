# Memory Format Optimization Design

## Overview

Optimize the scene_memory output format for LLM consumption, reducing token bloat by ~50% while preserving information density.

## Problem

Current format has significant redundancy:
- Per-memory emotional annotations repeat information implicit in summaries
- Causality hints (`⤷ IMMEDIATELY AFTER`) are redundant when separators handle gaps
- `[Secret]` tags on ~90% of memories add noise
- Summaries include meta-commentary ("establishing X", "showing Y")
- Verbose summaries (12-32 words) when 8-18 would suffice

## Solution

Six targeted changes to formatting and extraction prompts.

## Changes

### 1. Remove Per-Memory Emotional Annotations

**Before:**
```
[★★★★] Derek spanked Sasha as punishment.
    💔 Emotional: Sasha feels aroused, submissive, Derek feels dominant
[★★★★] Sasha confessed submissive fantasies.
    💔 Emotional: Sasha feels vulnerable, aroused
```

**After:**
```
[★★★★] Derek spanked Sasha as punishment.
[★★★★] Sasha confessed submissive fantasies.
```

Emotions are implicit in the events themselves.

### 2. Add Consolidated Emotional State Block

Replace per-memory annotations with a single block in "Current Scene" showing recent emotional trajectory.

**Format:**
```
## Current Scene
Emotional state: anxious (as of msgs #650-670)
Present: Kai

Recent emotions:
- Zoe: vulnerable → aroused → ecstatic
- Kai: dominant → caring
```

**Implementation:**
- Track last 5-10 emotional shifts per character
- Show trajectory with arrows
- Only in Current Scene section
- Omit if no emotional data

### 3. Remove Causality Hints

**Before:**
```
[★★★★] Event A happened.
    ⤷ IMMEDIATELY AFTER
[★★★] Event B happened.
    ⤷ Shortly after
[★★★] Event C happened.
```

**After:**
```
[★★★★] Event A happened.
[★★★] Event B happened.
[★★★] Event C happened.
```

Gap separators (`...`, `...Later...`, `...Much later...`) already indicate temporal distance. Absence of separator implies closeness. Causality hints are redundant.

### 4. Invert Secret Tag → Known Tag

**Before:**
```
[★★★★] [Secret] Private event between two characters.
[★★★★] [Secret] Another private event.
[★★★] Public event witnessed by others.
```

**After:**
```
[★★★★] Private event between two characters.
[★★★★] Another private event.
[★★★] [Known] Public event witnessed by others.
```

Most RP events are private. Tag the exception (public/known events) instead of the norm.

**Logic:**
- `is_secret: true` or witnesses ≤ 2 → no tag (default private)
- `is_secret: false` AND witnesses > 2 → `[Known]` tag

### 5. Terser Summaries (Prompt Change)

**Current prompt:**
```
"summary": "12-32 words, past tense, English, factual with context"
```

**New prompt:**
```
"summary": "8-18 words, past tense, English, factual. NO meta-commentary (avoid 'establishing', 'showing', 'demonstrating')."
```

**Examples to update in prompts.js:**

| Current | Terse |
|---------|-------|
| "Sarah and Tom formed an uneasy alliance despite their rivalry." | "Sarah and Tom formed uneasy alliance." |
| "Marcus attacked the assassin with his sword to protect Elena." | "Marcus attacked assassin with sword to protect Elena." |
| "Liam caressed Anya's cheek and requested a kiss, which she eagerly accepted." | "Liam caressed Anya's cheek, requested kiss; she accepted eagerly." |
| "Derek introduced pet roleplay by collaring Sasha, who accepted the submissive role and addressed him as Master for the first time." | "Derek collared Sasha, initiating pet roleplay; she called him Master." |

### 6. Simplify Star Display

**Current:** Unicode stars `★★★★★`

**Keep as-is.** Stars are visually scannable and low-token. No change needed.

## Output Format Comparison

### Before (~180 tokens)
```
<scene_memory>
(Current chat has #673 messages)

## The Story So Far
[★★★★] [Secret] Derek spanked Sasha on her buttocks as punishment for being a 'bad girl,' establishing a disciplinary dynamic between them.
    💔 Emotional: Sasha feels aroused, submissive, Derek feels dominant
[★★★★] [Secret] Sasha confessed her submissive fantasies to Derek, including being spanked, kneeling, and inspected, establishing consent for their intimate dynamic.
    ⤷ IMMEDIATELY AFTER
    💔 Emotional: Sasha feels vulnerable, aroused

## Current Scene
Emotional state: relaxed (as of msgs #630-659)
Present: Derek

</scene_memory>
```

### After (~90 tokens)
```
<scene_memory>
(#673 messages)

## The Story So Far
[★★★★] Derek spanked Sasha as punishment for 'bad girl' behavior.
[★★★★] Sasha confessed submissive fantasies including spanking and inspection.

## Current Scene
Present: Derek
Emotions: Sasha relaxed, Derek caring

</scene_memory>
```

## Token Impact Estimate

| Change | Savings |
|--------|---------|
| Remove per-memory emotional annotations | -30% |
| Remove causality hints | -10% |
| Invert [Secret] → [Known] | -5% |
| Terser summaries | -15% |
| Simplified header | -2% |
| Add emotional block (Current Scene only) | +2% |
| **Net** | **~-50%** |

## Implementation

### File Changes

**`src/retrieval/formatting.js`:**
- Remove `getEmotionalAnnotation()` calls from all buckets
- Remove `getCausalityHint()` calls from all buckets
- Add `formatEmotionalTrajectory()` function for Current Scene
- Update `formatMemory()` to use `[Known]` instead of `[Secret]`
- Simplify header from `(Current chat has #N messages)` to `(#N messages)`

**`src/prompts.js`:**
- Update `<output_format>` summary spec: `"8-18 words, past tense, English, factual. NO meta-commentary."`
- Update examples to show terser summaries
- Add negative example showing what NOT to do (meta-commentary)

**`src/extraction/parser.js`:**
- No changes needed (is_secret field still extracted, just rendered differently)

### New Helper Function

```javascript
/**
 * Format emotional trajectory for Current Scene
 * @param {Object} data - OpenVault data with character states
 * @param {number} limit - Max emotions to show (default 5)
 * @returns {string|null} Formatted emotions line or null
 */
function formatEmotionalTrajectory(data, limit = 5) {
    const chars = data[CHARACTERS_KEY] || {};
    const lines = [];

    for (const [name, state] of Object.entries(chars)) {
        const emotion = state.current_emotion;
        if (emotion && emotion !== 'neutral') {
            lines.push(`${name} ${emotion}`);
        }
    }

    if (lines.length === 0) return null;
    return `Emotions: ${lines.slice(0, limit).join(', ')}`;
}
```

### Known Tag Logic

```javascript
function formatMemory(memory) {
    const importance = memory.importance || 3;
    const stars = '★'.repeat(importance);

    // Invert: tag [Known] for public events, default is private
    const isKnown = !memory.is_secret && (memory.witnesses?.length || 0) > 2;
    const prefix = isKnown ? '[Known] ' : '';

    return `[${stars}] ${prefix}${memory.summary}`;
}
```

## Testing

### Unit Tests

1. `formatMemory()` returns `[Known]` only for public events with >2 witnesses
2. `formatEmotionalTrajectory()` returns null when no emotions
3. `formatEmotionalTrajectory()` limits output to specified count
4. No causality hints in any bucket output
5. No per-memory emotional annotations in output

### Manual Verification

1. Load into SillyTavern with existing chat
2. Compare token count before/after
3. Verify LLM still maintains context coherence
4. Check that terse summaries are still informative

## Migration

No data migration needed. Changes are display-only:
- `is_secret` field remains in stored events
- `emotional_impact` field remains in stored events
- Rendering logic changes, not data structure

## Risks

1. **Terser summaries lose context** - Mitigated by keeping 8-18 word minimum
2. **Removing emotions loses nuance** - Mitigated by trajectory block in Current Scene
3. **[Known] tag confusion** - Clear from context; rare tag draws attention appropriately
