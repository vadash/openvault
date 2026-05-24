/**
 * JSON output schema for scene state extraction.
 */

export const SCENE_STATE_SCHEMA = `Output EXACTLY ONE JSON object with this structure:

{
  "location": "Current location name or description",
  "time": "Current time of day or temporal anchor (e.g., 'Friday evening, around 7 PM')",
  "environment": "Optional: ambient details like lighting, weather, atmosphere",
  "characters": {
    "CharacterName": {
      "clothing": ["item1", "item2"],
      "posture": "Current physical posture or position",
      "physical_status": ["status1", "status2"],
      "mental_status": ["emotional state", "mood"]
    }
  },
  "active_props": ["prop currently in scene", "another prop"],
  "source_fp": "The fingerprint of the LAST message in the input window"
}

FORMAT RULES:
1. Top level MUST be a JSON object { }, NEVER a bare array [ ].
2. "location" and "time" are REQUIRED. "environment" is optional.
3. "characters" is a map keyed by character name. Each character MUST have "posture". Arrays (clothing, physical_status, mental_status) default to [].
4. "active_props" defaults to [] if no props are present.
5. "source_fp" is REQUIRED — it MUST match the fingerprint of the last message you received.
6. Do NOT wrap in markdown code blocks.
7. NEVER use string concatenation ("+") inside JSON values. Write all text as a single, unbroken line within the quotes.`;
