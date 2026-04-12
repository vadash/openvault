/**
 * JSON output schema for event extraction.
 */

export const EVENT_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "events": [
    {
      "summary": "8-25 word description of what happened, past tense",
      "importance": 3,
      "characters_involved": ["CharacterName"],
      "witnesses": ["CharacterName", "OtherCharacter"],
      "location": null,
      "is_secret": false,
      "emotional_impact": {"CharacterName": "emotion description"},
      "relationship_impact": {"CharacterA->CharacterB": "how relationship changed"}
    }
  ]
}

FIELD DEFINITIONS:
- characters_involved: Characters who actively participated or were directly affected (the main actors).
- witnesses: ALL characters who would know this event occurred. MUST include characters_involved PLUS any present/observers. In a 1-on-1 scene, BOTH characters are witnesses.
- is_secret: true ONLY for hidden actions (internal thoughts, secret plots). Most events are false.

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. The "events" key MUST always be present. If nothing found: "events": []. Do not just stop generating.
3. Do NOT wrap in markdown code blocks.
4. Keep character names exactly as they appear in the input.
5. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.`;
