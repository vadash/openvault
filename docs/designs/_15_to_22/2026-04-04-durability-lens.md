# Durability Lens for Event Extraction

**Date:** 2026-04-04
**Status:** Approved

## Problem

The event extraction pipeline has a cinematic bias: rules and few-shot examples are tuned for physical actions and dramatic events (combat, sex, discoveries). Conversational commitments — promises, preferences, boundaries, schedules, stated rules — are either skipped entirely or rated `importance: 1-2` even though they are the most critical information for long-term roleplay continuity.

A goodbye kiss gets the same weight as a promise to "check in every day." A character stating "I'm allergic to caffeine" is ignored while "she stroked his hair" gets extracted.

## Approach

Prompt-only changes. Zero changes to Zod schemas, application logic, or data model. The `importance` field already serves as a durability signal when properly calibrated.

## Changes

### 1. `src/prompts/events/rules.js` — Three edits

#### 1a. Expand `<precision>` with commitment/preference types

Add two new bullet types after the `Combat:` line:

```
- Commitments & Rules: state the exact promise, schedule, boundary, or ongoing agreement established (e.g., "agreed to check in every day").
- Preferences: state exactly what a character explicitly revealed they like, dislike, or require.
```

Add two more vagueness blacklist entries:

```
✗ "they made a promise" ✗ "rules were discussed"
```

#### 1b. Rewrite `<importance_scale>` with durability framing

Replace the entire block:

```
<importance_scale>
Rate each event from 1 (trivial) to 5 (critical):

1 — Trivial: Quick greeting, passing touch, mundane small talk. Usually skip these entirely.
2 — Minor: Standard continuation of an established dynamic, routine acts, momentary reactions. A goodbye kiss or a one-time compliment is 2 — it matters now but not next week.
3 — Notable: Meaningful conversation, stated preferences (likes/dislikes), everyday promises ("I'll be there Saturday"), minor secrets shared, change of location.
4 — Significant: Hard boundaries established, strict ongoing rules agreed upon, long-term relationship commitments, major narrative shift, deep emotional vulnerability.
     Do NOT rate every intimate act as 4. If characters already have an established intimate relationship, routine acts are 2 or 3. Reserve 4 for narrative milestones.
5 — Critical: Life-changing events — first "I love you", pregnancy discovery, major betrayal revealed, permanent relationship change, character death.
</importance_scale>
```

Key differences from current scale:
- Importance 3 now explicitly names "stated preferences" and "everyday promises"
- Importance 4 now names "hard boundaries" and "strict ongoing rules"
- Importance 2 explicitly demotes "momentary reactions" and "goodbye kiss"
- Removed the old "routine intimate acts" language at importance 2 (redundant with the clarification in importance 4)

#### 1c. Update `<thinking_process>` Step 1

Current:
```
Step 1: List the specific actions, emotions, and facts in the new messages.
```

Proposed:
```
Step 1: List the specific actions, emotions, facts, promises, stated preferences, and ongoing rules in the new messages.
```

### 2. `src/prompts/events/examples/en.js` — New 6th example

Append after the existing Dedup edge case. A purely conversational SFW example that demonstrates:
- A promise and a schedule change (durable facts)
- A physical action (hug) that the thinking process explicitly identifies as momentary
- The thinking process showing the durability evaluation

```javascript
{
    label: 'Conversational commitment (EN/SFW)',
    input: `"I can't do Tuesdays anymore," Alice said, sipping her tea. "My new shift starts next week."
Bob nodded, adjusting his glasses. "Understood. Wednesdays then? Same place?"
"Wednesdays work. But you have to promise you'll actually text me if you're running late this time."
"I promise," Bob smiled, giving her a quick hug before walking out the door.`,
    thinking: `Step 1: Extract data — Alice changed schedule (new shift, can't do Tuesdays). Meetups moved to Wednesdays. Alice demanded Bob text if late. Bob promised to do so. Bob hugged Alice and left.
Step 2: Cross-reference — No matches in established_memories.
Step 3: Check progression — New schedule and communication rule established.
Step 4: Format JSON — The hug and sipping tea are momentary (skip). The schedule change and texting promise are durable — they matter for future interactions. Importance: 3.`,
    output: `{
  "events": [{
    "summary": "Alice and Bob agreed to move their meetups to Wednesdays, and Bob explicitly promised to text her if he runs late",
    "importance": 3,
    "characters_involved": ["Alice", "Bob"],
    "witnesses": ["Alice", "Bob"],
    "location": null,
    "is_secret": false,
    "emotional_impact": {},
    "relationship_impact": { "Alice↔Bob": "established new schedule and communication rule" }
  }]
}`,
},
```

### 3. `src/prompts/events/examples/ru.js` — New 6th example (Russian)

Same scenario translated to Russian, following the established pattern where:
- Input and output values are in Russian
- Character names are preserved in original script
- Thinking process uses the same 5-step structure

### 4. `src/prompts/graph/rules.js` — Minor tweak

Add one sentence to the CONCEPT bullet and the relationship extraction paragraph:

```
- CONCEPT: Named abilities, spells, diseases, prophecies, or strict dietary/lifestyle requirements (e.g., "Peanut Allergy", "Veganism").
```

And append to the relationship extraction paragraph:

```
IMPORTANT: Capture durable character preferences as relationships (e.g., Character -> CONCEPT: "Strongly dislikes").
```

## Explicitly Out of Scope

- **No new `<durability_lens>` XML section** — durability is embedded into the importance scale and thinking process where the model uses it, rather than adding another cross-referenced section.
- **No schema changes** — `EventSchema` stays the same. No migrations needed.
- **No new fields** — no `is_commitment` flag or `durability` score. The `importance` field already serves this purpose.
- **No `relationship_impact` description change** in `schema.js` — the current description is adequate; the few-shot example demonstrates correct usage.

## Expected Impact

- Conversational commitments will be extracted as events with `importance: 3-4` instead of being skipped or rated 1-2.
- The few-shot example teaches the model to evaluate momentary vs. durable facts explicitly.
- Higher importance scores mean these events decay slower in the alpha-blend forgetfulness curve, surviving across sessions.
- Event summaries like "Character A promised Character B they would check in daily" will naturally match BM25 and `exactPhraseBoostWeight` layers when relevant topics come up in future chats.

## Files Modified

| File | Change |
|------|--------|
| `src/prompts/events/rules.js` | Expand precision, rewrite importance scale, update Step 1 |
| `src/prompts/events/examples/en.js` | Add 6th conversational commitment example |
| `src/prompts/events/examples/ru.js` | Add 6th conversational commitment example (Russian) |
| `src/prompts/graph/rules.js` | Add preference capture to CONCEPT and relationships |
