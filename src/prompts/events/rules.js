/**
 * Task-specific rules for event extraction.
 */

export const EVENT_RULES = `<precision>
Event summaries MUST be complete, highly descriptive sentences (minimum 6 words, 30 characters).
Do not extract fragmented thoughts or micro-actions like "Character breathed" or "She nodded."

Core principle: Name the exact action, emotion, or revelation. The output summary must preserve the source text's level of specificity. A vague generalization where the source has a concrete event is an extraction error.

- Physical actions: specify the exact act, method, and participants as described in the source
- Emotional events: name the specific emotion and its cause
- Revelations: state the exact information that was disclosed
- Combat: name the weapon, target, and outcome

A correct extraction preserves all source specificity.
An incorrect extraction loses detail through generalization.

These are all WRONG — information destroyed by vagueness:
✗ "they got intimate" ✗ "combat occurred" ✗ "feelings were expressed" ✗ "a secret was shared" ✗ "things escalated"
</precision>

<dedup>
This is the MOST IMPORTANT rule. Duplicating memories already in established_memories is the worst error.

BEFORE creating ANY event, you MUST check the <established_memories> section in the user message.

If a scene is already recorded there, DO NOT repeat the same actions. Instead, look for the NEWEST change within that scene:
1. A shift in emotional state (e.g., confidence → vulnerability, pleasure → discomfort).
2. A new phase or escalation (e.g., foreplay → penetration, sparring → real fight).
3. The scene concluding (e.g., climax, falling asleep, location change, combat ends).
4. A power dynamic reversal (e.g., submissive takes control, ambush turns into retreat).
5. A new element changing the scene's nature (new character arrives, weapon drawn, secret revealed).
6. A safeword explicitly used to halt the scene.

If the messages contain ONLY a continuation of the exact same action with no shift, escalation, or conclusion — then output "events": [].

When in doubt, extract a brief progression event rather than output nothing. The system will automatically filter true duplicates.
</dedup>

<importance_scale>
Rate each event from 1 (trivial) to 5 (critical):

1 — Trivial: Quick greeting, passing touch, mundane small talk. Usually skip these entirely.
2 — Minor: Standard continuation of an established dynamic. Routine intimate acts between characters already in a sexual relationship. Repeated daily actions.
3 — Notable: Meaningful conversation, change of location or scene, new emotional context, minor secret shared, notable gift.
4 — Significant: A major narrative shift, deep emotional vulnerability, first use of a safeword, establishing a new relationship dynamic, a major argument or confrontation.
     Do NOT rate every intimate act as 4. If characters already have an established intimate relationship, routine acts are 2 or 3. Reserve 4 for narrative milestones.
5 — Critical: Life-changing events — first "I love you", pregnancy discovery, major betrayal revealed, permanent relationship change, character death.
</importance_scale>

<thinking_process>
Follow these steps IN ORDER. Write your work inside  tags BEFORE outputting the JSON:

Step 1: List the specific actions, emotions, and facts in the new messages.
Step 2: Check <established_memories>. Is any of this already recorded?
Step 3: Apply dedup rules. If this is a continuation, look for the newest progression. If there is none at all, plan to output "events": [].
Step 4: For genuinely NEW events, assign importance (1-5) and write a specific factual summary.
Step 5: Output the final JSON object with the "events" key.
</thinking_process>`;
