# Durability Lens Implementation Plan

**Goal:** Modify prompt files to bias event extraction toward durable conversational commitments (promises, preferences, boundaries, schedules) using the existing `importance` field.

**Architecture:** Prompt-only changes — no schema modifications, no application logic changes. Expands existing rules in `src/prompts/events/rules.js` with durability framing, adds conversational commitment examples to EN/RU example files, and tweaks graph rules to capture preferences as CONCEPT entities.

**Tech Stack:** JavaScript (ESM), string templates, Vitest for tests.

---

### File Structure Overview

- **Modify:** `src/prompts/events/rules.js` - Expand precision section, rewrite importance scale, update Step 1
- **Modify:** `src/prompts/events/examples/en.js` - Add 6th conversational commitment example
- **Modify:** `src/prompts/events/examples/ru.js` - Add 6th conversational commitment example (Russian)
- **Modify:** `src/prompts/graph/rules.js` - Add preference capture to CONCEPT and relationships

---

### Task 1: Update Event Rules - Precision Section

**Files:**
- Modify: `src/prompts/events/rules.js`
- Test: `tests/prompts/events/rules.test.js` (to be created)

**Common Pitfalls:**
- The file uses template literals with `${}` interpolation — maintain consistency
- Preserve existing line endings (Windows CRLF) if present

- [ ] Step 1: Read the current file to understand structure

```bash
head -50 src/prompts/events/rules.js
```

- [ ] Step 2: Write failing test for new precision content

Create `tests/prompts/events/rules.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import { EVENT_RULES } from '../../../src/prompts/events/rules.js';

describe('events/rules', () => {
    it('should include Commitments & Rules in precision section', () => {
        expect(EVENT_RULES).toContain('Commitments & Rules:');
        expect(EVENT_RULES).toContain('exact promise, schedule, boundary');
    });

    it('should include Preferences in precision section', () => {
        expect(EVENT_RULES).toContain('Preferences:');
        expect(EVENT_RULES).toContain('like, dislike, or require');
    });

    it('should include vagueness blacklist entries for commitments', () => {
        expect(EVENT_RULES).toContain('"they made a promise"');
        expect(EVENT_RULES).toContain('"rules were discussed"');
    });
});
```

- [ ] Step 3: Run test to verify it fails

```bash
npm test -- tests/prompts/events/rules.test.js
```

Expected: FAIL with "EVENT_RULES does not contain" or similar

- [ ] Step 4: Write minimal implementation

In `src/prompts/events/rules.js`, locate the `<precision>` section and add after the `Combat:` line:

```javascript
- Commitments & Rules: state the exact promise, schedule, boundary, or ongoing agreement established (e.g., "agreed to check in every day").
- Preferences: state exactly what a character explicitly revealed they like, dislike, or require.
```

Also add to the vagueness blacklist:

```
✗ "they made a promise" ✗ "rules were discussed"
```

- [ ] Step 5: Run test to verify it passes

```bash
npm test -- tests/prompts/events/rules.test.js
```

Expected: PASS

- [ ] Step 6: Commit

```bash
git add -A && git commit -m "feat(events): add Commitments & Rules and Preferences to precision section"
```

---

### Task 2: Update Event Rules - Importance Scale

**Files:**
- Modify: `src/prompts/events/rules.js`
- Test: `tests/prompts/events/rules.test.js`

- [ ] Step 1: Write failing test for importance scale content

Add to `tests/prompts/events/rules.test.js`:

```javascript
    it('should include durability-framed importance scale', () => {
        expect(EVENT_RULES).toContain('<importance_scale>');
        expect(EVENT_RULES).toContain('</importance_scale>');
        expect(EVENT_RULES).toContain('durable — they matter for future interactions');
    });

    it('should demote momentary actions in importance scale', () => {
        expect(EVENT_RULES).toContain('A goodbye kiss or a one-time compliment is 2');
        expect(EVENT_RULES).toContain('it matters now but not next week');
    });

    it('should explicitly name stated preferences at importance 3', () => {
        expect(EVENT_RULES).toContain('Stated preferences (likes/dislikes)');
        expect(EVENT_RULES).toContain('everyday promises');
    });

    it('should explicitly name boundaries at importance 4', () => {
        expect(EVENT_RULES).toContain('Hard boundaries established');
        expect(EVENT_RULES).toContain('strict ongoing rules agreed upon');
    });
```

- [ ] Step 2: Run test to verify it fails

```bash
npm test -- tests/prompts/events/rules.test.js::"importance"
```

Expected: FAIL

- [ ] Step 3: Write minimal implementation

In `src/prompts/events/rules.js`, locate and replace the `<importance_scale>` block with:

```javascript
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

- [ ] Step 4: Run test to verify it passes

```bash
npm test -- tests/prompts/events/rules.test.js::"importance scale"
```

Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(events): rewrite importance scale with durability framing"
```

---

### Task 3: Update Event Rules - Thinking Process Step 1

**Files:**
- Modify: `src/prompts/events/rules.js`
- Test: `tests/prompts/events/rules.test.js`

- [ ] Step 1: Write failing test for updated thinking process

Add to `tests/prompts/events/rules.test.js`:

```javascript
    it('should include promises and preferences in thinking Step 1', () => {
        expect(EVENT_RULES).toContain('promises, stated preferences, and ongoing rules');
    });
```

- [ ] Step 2: Run test to verify it fails

```bash
npm test -- tests/prompts/events/rules.test.js::"thinking"
```

Expected: FAIL

- [ ] Step 3: Write minimal implementation

In `src/prompts/events/rules.js`, locate `Step 1:` in the `<thinking_process>` section and change:

From:
```
Step 1: List the specific actions, emotions, and facts in the new messages.
```

To:
```
Step 1: List the specific actions, emotions, facts, promises, stated preferences, and ongoing rules in the new messages.
```

- [ ] Step 4: Run test to verify it passes

```bash
npm test -- tests/prompts/events/rules.test.js::"promises"
```

Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(events): update thinking process Step 1 to include commitments"
```

---

### Task 4: Add EN Conversational Commitment Example

**Files:**
- Modify: `src/prompts/events/examples/en.js`
- Test: `tests/prompts/events/examples/en.test.js` (to be created)

- [ ] Step 1: Write failing test

Create `tests/prompts/events/examples/en.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../../src/prompts/events/examples/en.js';

describe('events/examples/en', () => {
    it('should have 6 examples', () => {
        expect(EXAMPLES).toHaveLength(6);
    });

    it('should include conversational commitment example', () => {
        const commitmentExample = EXAMPLES.find(e => e.label.includes('Conversational commitment'));
        expect(commitmentExample).toBeDefined();
        expect(commitmentExample.input).toContain("I can't do Tuesdays anymore");
        expect(commitmentExample.input).toContain('Alice');
        expect(commitmentExample.input).toContain('Bob');
    });

    it('should show durability evaluation in thinking process', () => {
        const commitmentExample = EXAMPLES.find(e => e.label.includes('Conversational commitment'));
        expect(commitmentExample.thinking).toContain('momentary (skip)');
        expect(commitmentExample.thinking).toContain('durable');
    });

    it('should extract schedule change and promise as importance 3', () => {
        const commitmentExample = EXAMPLES.find(e => e.label.includes('Conversational commitment'));
        expect(commitmentExample.output).toContain('importance": 3');
        expect(commitmentExample.output).toContain('moved to Wednesdays');
        expect(commitmentExample.output).toContain('promised to text');
    });
});
```

- [ ] Step 2: Run test to verify it fails

```bash
npm test -- tests/prompts/events/examples/en.test.js
```

Expected: FAIL — only 5 examples found

- [ ] Step 3: Write minimal implementation

In `src/prompts/events/examples/en.js`, append to the `EXAMPLES` array:

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

- [ ] Step 4: Run test to verify it passes

```bash
npm test -- tests/prompts/events/examples/en.test.js
```

Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(examples): add conversational commitment example (EN)"
```

---

### Task 5: Add RU Conversational Commitment Example

**Files:**
- Modify: `src/prompts/events/examples/ru.js`
- Test: `tests/prompts/events/examples/ru.test.js` (to be created)

**Common Pitfalls:**
- Preserve UTF-8 encoding for Russian characters
- Keep character names in original script (Alice/Bob, not Алиса/Боб)
- Input/output in Russian, thinking in English

- [ ] Step 1: Write failing test

Create `tests/prompts/events/examples/ru.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../../src/prompts/events/examples/ru.js';

describe('events/examples/ru', () => {
    it('should have 6 examples', () => {
        expect(EXAMPLES).toHaveLength(6);
    });

    it('should include conversational commitment example', () => {
        const commitmentExample = EXAMPLES.find(e => e.label.includes('Conversational commitment'));
        expect(commitmentExample).toBeDefined();
        expect(commitmentExample.input).toContain('вторникам');
        expect(commitmentExample.input).toContain('Alice');
    });

    it('should have Russian input/output and English thinking', () => {
        const commitmentExample = EXAMPLES.find(e => e.label.includes('Conversational commitment'));
        // Thinking should be in English (per language rules)
        expect(commitmentExample.thinking).toContain('Cross-reference');
        expect(commitmentExample.thinking).toContain('durable');
        // Output should contain Russian text
        expect(commitmentExample.output).toContain('ср');  // средам (Wednesdays)
    });

    it('should show durability evaluation in thinking process', () => {
        const commitmentExample = EXAMPLES.find(e => e.label.includes('Conversational commitment'));
        expect(commitmentExample.thinking).toContain('momentary');
        expect(commitmentExample.thinking).toContain('durable');
    });
});
```

- [ ] Step 2: Run test to verify it fails

```bash
npm test -- tests/prompts/events/examples/ru.test.js
```

Expected: FAIL — only 5 examples found

- [ ] Step 3: Write minimal implementation

In `src/prompts/events/examples/ru.js`, append to the `EXAMPLES` array:

```javascript
    {
        label: 'Conversational commitment (RU/SFW)',
        input: `— Не смогу больше по вторникам, — сказала Alice, попивая чай. — Новая смена начинается на следующей неделе.
Bob кивнул, поправляя очки. — Понял. Значит, средам? В том же месте?
— Средам подходит. Но ты должен пообещать, что на этот раз точно напишешь мне, если опоздаешь.
— Обещаю, — улыбнулся Bob и быстро обнял её, прежде чем выйти за дверь.`,
        thinking: `Step 1: Extract data — Alice changed schedule (new shift, can't do Tuesdays). Meetups moved to Wednesdays. Alice demanded Bob text if late. Bob promised to do so. Bob hugged Alice and left.
Step 2: Cross-reference — No matches in established_memories.
Step 3: Check progression — New schedule and communication rule established.
Step 4: Format JSON — The hug and sipping tea are momentary (skip). The schedule change and texting promise are durable — they matter for future interactions. Importance: 3. Values in Russian.`,
        output: `{
  "events": [{
    "summary": "Alice и Bob договорились перенести встречи на средам, и Bob явно пообещал написать ей, если опоздает",
    "importance": 3,
    "characters_involved": ["Alice", "Bob"],
    "witnesses": ["Alice", "Bob"],
    "location": null,
    "is_secret": false,
    "emotional_impact": {},
    "relationship_impact": { "Alice↔Bob": "установлены новый график и правило коммуникации" }
  }]
}`,
    },
```

- [ ] Step 4: Run test to verify it passes

```bash
npm test -- tests/prompts/events/examples/ru.test.js
```

Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(examples): add conversational commitment example (RU)"
```

---

### Task 6: Update Graph Rules - CONCEPT and Relationships

**Files:**
- Modify: `src/prompts/graph/rules.js`
- Test: `tests/prompts/graph/rules.test.js` (add new assertions)

- [ ] Step 1: Write failing test

Add to `tests/prompts/graph/rules.test.js`:

```javascript
    it('should include dietary/lifestyle requirements in CONCEPT definition', () => {
        expect(GRAPH_RULES).toContain('dietary/lifestyle requirements');
        expect(GRAPH_RULES).toContain('Peanut Allergy');
        expect(GRAPH_RULES).toContain('Veganism');
    });

    it('should include preference capture instruction', () => {
        expect(GRAPH_RULES).toContain('Capture durable character preferences as relationships');
        expect(GRAPH_RULES).toContain('Strongly dislikes');
    });
```

- [ ] Step 2: Run test to verify it fails

```bash
npm test -- tests/prompts/graph/rules.test.js
```

Expected: FAIL — new assertions not satisfied

- [ ] Step 3: Write minimal implementation

In `src/prompts/graph/rules.js`, locate the CONCEPT line in `GRAPH_RULES` and update:

From:
```javascript
- ${ENTITY_TYPES.CONCEPT}: Named abilities, spells, diseases, prophecies
```

To:
```javascript
- ${ENTITY_TYPES.CONCEPT}: Named abilities, spells, diseases, prophecies, or strict dietary/lifestyle requirements (e.g., "Peanut Allergy", "Veganism").
```

Also locate the paragraph about relationship extraction and append:

From (end of relationship paragraph):
```
Do NOT re-describe existing static relationships unless a specific progression or change occurred in this batch.
```

To:
```
Do NOT re-describe existing static relationships unless a specific progression or change occurred in this batch.

IMPORTANT: Capture durable character preferences as relationships (e.g., Character -> CONCEPT: "Strongly dislikes").
```

- [ ] Step 4: Run test to verify it passes

```bash
npm test -- tests/prompts/graph/rules.test.js
```

Expected: PASS

- [ ] Step 5: Commit

```bash
git add -A && git commit -m "feat(graph): add preference capture to CONCEPT and relationships"
```

---

### Task 7: Verify All Tests Pass

- [ ] Step 1: Run full test suite

```bash
npm test
```

Expected: All tests pass (including existing tests)

- [ ] Step 2: Run Biome linting

```bash
npm run lint
```

Expected: No errors

- [ ] Step 3: Commit if any formatting changes

```bash
git add -A && git commit -m "chore: apply biome formatting" || echo "No changes"
```

---

## Summary

This plan implements the Durability Lens feature through prompt-only changes:

1. **Event Rules** (`src/prompts/events/rules.js`):
   - Added `Commitments & Rules` and `Preferences` bullet types to `<precision>`
   - Added vagueness blacklist entries for commitments
   - Rewrote `<importance_scale>` with durability framing (momentary vs durable)
   - Updated `Step 1` of thinking process to extract promises/preferences

2. **EN Examples** (`src/prompts/events/examples/en.js`):
   - Added 6th example showing conversational commitments (schedule change, promise)
   - Demonstrates durability evaluation in thinking process

3. **RU Examples** (`src/prompts/events/examples/ru.js`):
   - Added 6th example (Russian translation of same scenario)
   - Follows language rules: input/output in Russian, thinking in English

4. **Graph Rules** (`src/prompts/graph/rules.js`):
   - Expanded CONCEPT definition to include dietary/lifestyle requirements
   - Added instruction to capture preferences as relationships

**No schema changes**, **no migrations needed**, **no application logic changes**. The existing `importance` field serves as the durability signal when properly calibrated by the updated prompts.
